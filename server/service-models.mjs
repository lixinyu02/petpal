import {createHash} from 'node:crypto';
import {normalizeReasoningEffort,normalizeBaseUrl} from './providers.mjs';

const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Persisted Agent revisions use UUIDs and fence work on identity/capability changes.
const revision=value=>{const hash=digest(value);return `${hash.slice(0,8)}-${hash.slice(8,12)}-8${hash.slice(13,16)}-${((parseInt(hash[16],16)&3)|8).toString(16)}${hash.slice(17,20)}-${hash.slice(20,32)}`;};
const managed=provider=>provider?.serviceLink==='api-harbor';
const textProtocols=new Map([['responses','responses'],['chat','chat-completions']]);
const knownProtocols=new Set([...textProtocols.keys(),'embeddings','speech','transcribe','asr_stream']);
export const serviceModelSupportsAgent=provider=>provider.protocol==='responses' && provider.capabilities?.tools!==false && provider.capabilities?.stream!==false && (!Array.isArray(provider.capabilities?.inputModalities)||provider.capabilities.inputModalities.includes('text'));
const supportsChat=(provider,{tools=false}={})=>provider.capabilities?.stream!==false && (!tools||provider.capabilities?.tools!==false) && (!Array.isArray(provider.capabilities?.inputModalities)||provider.capabilities.inputModalities.includes('text'));
const prefer=(provider,roles)=>{
 if(managed(provider))return;
 const upstreamProtocol=[...textProtocols].find(([,protocol])=>protocol===provider.protocol)?.[0];
 const descriptor=roles.get(upstreamProtocol)?.find(candidate=>candidate.model===provider.model);if(!descriptor)return;
 const capabilities=descriptor.capabilities;
 let effort=provider.reasoningEffort||descriptor.reasoningEffort;
 if(Array.isArray(capabilities.reasoningEfforts)&&!capabilities.reasoningEfforts.includes(effort))effort=descriptor.reasoningEffort;
 return {...provider,...descriptor,id:provider.id,name:provider.name,protocol:provider.protocol,reasoningEffort:effort,supportsImages:provider.supportsImages!==false&&Array.isArray(capabilities.inputModalities)&&capabilities.inputModalities.includes('image'),linkRevision:revision([descriptor.linkRevision,provider])};
};

/** Durable metadata participates in existing account grants; credentials stay in memory. */
export function createServiceModels({store,links}){
 let current=new Map(),preferred=new Map(),roles=new Map(),identity,queue=Promise.resolve();const secrets=new Set();
 const ready=()=>identity && links.isReady?.('api-harbor',identity)!==false;
 const authorized=(candidate,lookup)=>Object.defineProperty({...candidate},'authorize',{value:()=>{
  if(!ready()||lookup()?.linkRevision!==candidate.linkRevision)throw Object.assign(new Error('模型连接已变化，请重新提交。'),{status:409});
 }});
 const service={
  isManaged:id=>store.state.providers.some(p=>p.id===id&&managed(p)),
  resolve(provider,{agent=false,tools=false,images=false}={}){
   const candidate=ready()?(managed(provider)?current.get(provider.id):prefer(provider,roles)):undefined;
   if(candidate&&supportsChat(candidate,{tools})&&(!images||candidate.supportsImages===true)&&(!agent||serviceModelSupportsAgent(candidate)))return authorized(candidate,()=>managed(provider)?current.get(provider.id):prefer(store.state.providers.find(record=>record.id===provider.id)||provider,roles));
   return managed(provider)?undefined:provider;
  },
  revision(id){const provider=store.state.providers.find(candidate=>candidate.id===id);return provider?service.resolve(provider)?.linkRevision:undefined;},
  // Internal only. Media callers retain their existing account/feature checks.
  forProtocol(protocol,{model}={}){
   if(!ready()||!knownProtocols.has(protocol))return;
   const candidate=roles.get(protocol)?.find(candidate=>model===undefined||candidate.model===model);
   return candidate?authorized(candidate,()=>roles.get(protocol)?.find(record=>record.model===candidate.model)):undefined;
  },
  secrets:()=>[...secrets],
  async synchronize(){
   const operation=queue.then(async()=>{
    const status=await links.status(),link=status.links?.['api-harbor'];let connection;
    try{if(link?.state==='ready')connection=await links.credential('api-harbor');}catch{}
    const next=new Map(),nextPreferred=new Map(),nextRoles=new Map();
    if(connection)secrets.add(connection.credential);
    if(connection&&link.catalog?.models)for(const model of link.catalog.models)for(const upstreamProtocol of model.protocols){
     if(!knownProtocols.has(upstreamProtocol))continue;
     const protocol=textProtocols.get(upstreamProtocol),capabilities=structuredClone(model.capabilities?.[upstreamProtocol]||{});
     let reasoningEffort='';try{reasoningEffort=normalizeReasoningEffort(model.defaultReasoningEffort);}catch{}
     const scope=digest([status.instanceId||connection.instanceId||'',connection.baseUrl,link.issuerInstanceId||'']);
     const baseUrl=normalizeBaseUrl(connection.baseUrl+'/v1',protocol);
     const descriptor={model:model.id,baseUrl,apiKey:connection.credential,capabilities,reasoningEffort,source:'api-harbor',receiverInstanceId:connection.instanceId};
     descriptor.linkRevision=revision([scope,connection.connectionId,connection.credential,upstreamProtocol,descriptor]);
     if(!nextRoles.has(upstreamProtocol))nextRoles.set(upstreamProtocol,[]);
     nextRoles.get(upstreamProtocol).push(descriptor);
     // A media/unknown protocol is never advertised as a text provider.
     if(!protocol)continue;
     const oldId='harbor-'+digest([connection.connectionId,model.id,protocol]).slice(0,40);
     const retained=store.state.providers.find(p=>managed(p)&&p.harborScope===scope&&p.harborModelId===model.id&&p.protocol===protocol);
     const legacy=store.state.providers.find(p=>managed(p)&&!p.harborScope&&p.id===oldId);
     const id=retained?.id||legacy?.id||'harbor-'+digest([scope,model.id,protocol]).slice(0,40);
     const metadata={id,name:`API Harbor · ${model.id}${protocol==='responses'?'':' · Chat'}`,protocol,baseUrl,model:model.id,reasoningEffort,supportsImages:Array.isArray(capabilities.inputModalities)&&capabilities.inputModalities.includes('image'),serviceLink:'api-harbor',harborModelId:model.id,harborScope:scope,capabilities};
     next.set(id,{...metadata,...descriptor,linkRevision:revision([descriptor.linkRevision,metadata])});
    }
    // Derive overrides at admission too, so edits/new providers cannot reuse a
    // stale same-ID mapping between catalog refreshes.
    for(const provider of store.state.providers){const candidate=prefer(provider,nextRoles);if(candidate)nextPreferred.set(provider.id,candidate);}
    const old=new Map([...current,...preferred]),after=new Map([...next,...nextPreferred]);
    const changed=[...new Set([...old.keys(),...after.keys()])].filter(id=>old.get(id)?.linkRevision!==after.get(id)?.linkRevision);
    const before=store.state.providers,records=[...before];let updated=false;
    for(const provider of next.values()){
     const {apiKey,linkRevision,source,receiverInstanceId,...metadata}=provider,index=records.findIndex(p=>p.id===provider.id),record={...metadata,apiKey:''};
     if(index<0){records.push(record);updated=true;}else if(digest(records[index])!==digest(record)){records[index]=record;updated=true;}
    }
    if(updated){store.state.providers=records;try{await store.save();}catch(error){store.state.providers=before;throw error;}}
    current=next;preferred=nextPreferred;roles=nextRoles;identity=connection;return{changed,models:next.size};
   }).catch(error=>{identity=undefined;throw error;});queue=operation.catch(()=>{});return operation;
  },
  async close(){await queue;identity=undefined;current.clear();preferred.clear();roles.clear();},
 };
 return service;
}
