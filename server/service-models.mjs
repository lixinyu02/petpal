import {createHash} from 'node:crypto';
import {normalizeReasoningEffort,normalizeBaseUrl} from './providers.mjs';

const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Persisted Agent revisions use UUIDs. Keep this stable across restarts while
// invalidating active work whenever the connection credential or model changes.
const revision=value=>{const hash=digest(value);return `${hash.slice(0,8)}-${hash.slice(8,12)}-8${hash.slice(13,16)}-${((parseInt(hash[16],16)&3)|8).toString(16)}${hash.slice(17,20)}-${hash.slice(20,32)}`;};
const managed=provider=>provider?.serviceLink==='api-harbor';

/** Durable metadata participates in existing account grants; credentials stay in memory. */
export function createServiceModels({store,links}){
 let current=new Map(),queue=Promise.resolve();const secrets=new Set();
 const service={
  isManaged:id=>store.state.providers.some(p=>p.id===id&&managed(p)),
  resolve:provider=>managed(provider)?current.get(provider.id):provider,
  revision:id=>current.get(id)?.linkRevision,
  secrets:()=>[...secrets],
  async synchronize(){
   const operation=queue.then(async()=>{
    const status=await links.status(),link=status.links?.['api-harbor'];let connection;
    try{if(link?.state==='ready')connection=await links.credential('api-harbor');}catch{}
    const next=new Map();
    if(connection)secrets.add(connection.credential);
    if(connection&&link.catalog?.models)for(const model of link.catalog.models)for(const upstreamProtocol of model.protocols){
     const protocol=upstreamProtocol==='responses'?'responses':'chat-completions';
     const id='harbor-'+digest([connection.connectionId,model.id,protocol]).slice(0,40);
     let reasoningEffort='';try{reasoningEffort=normalizeReasoningEffort(model.defaultReasoningEffort);}catch{}
     const modalities=model.capabilities?.[upstreamProtocol]?.inputModalities;
     const metadata={id,name:`API Harbor · ${model.id}${protocol==='responses'?'':' · Chat'}`,protocol,baseUrl:normalizeBaseUrl(connection.baseUrl+'/v1',protocol),model:model.id,reasoningEffort,supportsImages:Array.isArray(modalities)&&modalities.includes('image'),serviceLink:'api-harbor',harborModelId:model.id};
     next.set(id,{...metadata,apiKey:connection.credential,linkRevision:revision([connection.connectionId,connection.credential,metadata]),source:'api-harbor'});
    }
    const changed=[...current].filter(([id,p])=>next.get(id)?.linkRevision!==p.linkRevision).map(([id])=>id);
    const before=store.state.providers,records=[...before];let updated=false;
    for(const provider of next.values()){
     const {apiKey,linkRevision,source,...metadata}=provider,index=records.findIndex(p=>p.id===provider.id),record={...metadata,apiKey:''};
     if(index<0){records.push(record);updated=true;}else if(digest(records[index])!==digest(record)){records[index]=record;updated=true;}
    }
    if(updated){store.state.providers=records;try{await store.save();}catch(error){store.state.providers=before;throw error;}}
    current=next;return{changed,models:next.size};
   });queue=operation.catch(()=>{});return operation;
  },
  async close(){await queue;current.clear();},
 };
 return service;
}
