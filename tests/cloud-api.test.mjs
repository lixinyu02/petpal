import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {createPetServer} from '../server/app.mjs';
import {JsonStore} from '../server/store.mjs';
import {createServiceModels} from '../server/service-models.mjs';
import {defaultCodexConfig} from '../server/codex-config.mjs';
import {listenFixture} from './helpers/loopback.mjs';

const bootstrap='synthetic-cloud-api-owner-token';
async function fixture(t,{capabilities={inputModalities:['text']},providers=[],memoryOptions,harborBaseUrl='https://harbor.invalid',codexConfig,bridgeRun}={}){
 const dir=await mkdtemp(path.join(tmpdir(),'petpal-cloud-api-')),store=await new JsonStore(dir).init(),calls=[],records=[];let centralCalls=0,paired=false,linkState='ready',failedAction='';
 if(providers.length){store.state.providers=structuredClone(providers);await store.save();}
 if(codexConfig){store.state.codexConfig={...defaultCodexConfig(),...codexConfig};await store.save();}
 const catalog={schema:'api-harbor-model-catalog.v1',service:'api-harbor',models:[{id:'fixture-responses',protocols:['responses'],capabilities:{responses:capabilities}}]};
 const links={isReady(){return paired&&linkState==='ready';},async status(){return{links:paired?{'api-harbor':{kind:'api-harbor',state:linkState,baseUrl:harborBaseUrl,catalog}}:{}};},async pair(){paired=true;},async refresh(){if(failedAction==='refresh'){linkState='offline';throw Object.assign(new Error('refresh unavailable'),{status:502});}},async disconnect(){if(failedAction==='disconnect'){linkState='revoking';throw Object.assign(new Error('revoke unavailable'),{status:502});}paired=false;},async credential(){return{baseUrl:harborBaseUrl,credential:'synthetic-harbor-private-distribution-key',connectionId:'one'};},async close(){}};
 const cloud={has:id=>records.some(r=>r.id===id),list:userId=>records.filter(r=>r.userId===userId||userId===store.state.ownerId).map(r=>({...r,isOwn:r.userId===userId})),hostFor(userId,id){const h=this.list(userId).find(r=>r.id===id);if(!h)throw Object.assign(new Error('foreign docker'),{status:403});return h;},target(userId,id){const h=this.hostFor(userId,id);if(!h.online)throw Object.assign(new Error('offline docker'),{status:409});return{hostId:h.id,hostName:h.name};},isBusy(){return false;},async refresh(){},async catalog(){return{sources:[{id:'local',available:true}],templates:[{id:'agent'}]};},async create(userId,body){const h={id:randomUUID(),userId,name:body.name,requestId:body.requestId,kind:'docker',platform:'linux',online:true,docker:{state:'running',generation:'one',desktopAvailable:true},codex:{available:true,configured:true,projectDirectory:true,images:false,independentReviewModel:false}};records.push(h);return{...h,isOwn:true};},async action(userId,id,action){const r=records.find(r=>r.id===this.hostFor(userId,id).id);r.online=action==='start';return r;},async prepare(){return{ready:true};},bind(entry){return{async run(args){calls.push({entry,args});return{text:'cloud-completed',threadId:'cloud-fixture-thread'};},async close(){}};},async close(){}};
 const centralAgentCalls=[],codex={async status(){return{available:true,authenticated:true};},async run(args){centralCalls++;centralAgentCalls.push(args);return{text:'central',threadId:'central-fixture-thread'};},async close(){}};
 const bridgeConfigs=[],agentCalls=[],codexFactory=({config})=>{const captured={...config};bridgeConfigs.push(captured);return{async status(){return{available:true,authenticated:true,configured:true};},async run(args){agentCalls.push({config:captured,args});return bridgeRun?bridgeRun(args,captured):{text:'harbor-default-completed',threadId:'harbor-default-fixture-thread'};},async close(){}};};
 const app=await createPetServer({dataDir:dir,token:bootstrap,codex,codexFactory,memoryOptions,serviceLinksOptions:{service:links},cloudDockerOptions:{service:cloud}});await listenFixture(app.server);const base=`http://127.0.0.1:${app.server.address().port}`;
 const configuredAtStart=JSON.stringify(JSON.parse(await readFile(path.join(dir,'state.json'),'utf8')).codexConfig);
 const request=async(route,{token=bootstrap,method='GET',body,raw=false}={})=>{const response=await fetch(base+'/api'+route,{method,headers:{...(token?{Authorization:`Bearer ${token}`}:{ }),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:response.status,data:raw?await response.text():await response.json()};};
 const upload=async()=>{const response=await fetch(base+'/api/attachments',{method:'POST',headers:{Authorization:`Bearer ${bootstrap}`,'Content-Type':'image/webp'},body:Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA','base64')});assert.equal(response.status,201);return response.json();};
 async function member(name){const created=await request('/admin/users',{method:'POST',body:{username:name,password:'cloud-fixture-password',providerIds:[],agentAccess:'full'}});assert.equal(created.status,201);const login=await request('/auth/login',{method:'POST',token:null,body:{username:name,password:'cloud-fixture-password'}});return{id:created.data.user.id,token:login.data.token};}
 t.after(async()=>{await app.close();assert.ok(dir.startsWith(path.join(tmpdir(),'petpal-cloud-api-')));await rm(dir,{recursive:true,force:true});});
 return{request,upload,member,calls,dir,records,catalog,agentCalls,centralAgentCalls,bridgeConfigs,configuredAtStart,failAction(value){failedAction=value;},setLinkState(value){linkState=value;},get centralCalls(){return centralCalls;}};
}
test('cloud APIs require login, keep service pairing administrator-only and isolate targets',async t=>{
 const f=await fixture(t),a=await f.member('cloud-a'),b=await f.member('cloud-b');
 assert.equal((await f.request('/cloud-docker',{token:null})).status,401);assert.equal((await f.request('/service-links',{token:a.token})).status,403);
 const created=await f.request('/cloud-docker',{token:a.token,method:'POST',body:{name:'owned cloud',source:'local',bundle:'agent',requestId:randomUUID()}});assert.equal(created.status,201);const id=created.data.instance.id;
 assert.equal((await f.request('/cloud-docker',{token:b.token})).data.instances.length,0);assert.equal((await f.request('/cloud-docker/'+id+'/stop',{token:b.token,method:'POST',body:{}})).status,403);
 const targets=(await f.request('/agent/hosts',{token:a.token})).data.hosts;assert.equal(targets.some(h=>h.id==='central'),false);assert.equal(targets.find(h=>h.id===id).kind,'docker');
 assert.equal((await f.request('/cloud-docker/'+id+'/desktop-ticket',{token:b.token,method:'POST',body:{}})).status,403);
 assert.equal((await f.request('/cloud-docker/prepare',{token:a.token,method:'POST',body:{}})).status,403);
 assert.equal((await f.request('/settings',{token:a.token,method:'PATCH',body:{chatAssistantHostId:id}})).status,200);
 const restored=await new JsonStore(f.dir).init();assert.equal(restored.state.users.find(u=>u.id===a.id).settings.chatAssistantHostId,id,'Docker default target survives store reload');
 assert.equal((await f.request('/settings',{token:b.token,method:'PATCH',body:{chatAssistantHostId:id}})).status,403);
});
test('Agent dispatch keeps the selected Docker target and never falls back to central',async t=>{
 const f=await fixture(t),a=await f.member('cloud-agent');
 await f.request('/service-links/api-harbor/pair',{method:'POST',body:{baseUrl:'https://harbor.invalid',code:'synthetic'}});
 const provider=(await f.request('/state')).data.providers.find(p=>p.source==='api-harbor');
 await f.request('/admin/users/'+a.id,{method:'PATCH',body:{providerIds:[provider.id],agentAccess:'full'}});
 const host=(await f.request('/cloud-docker',{token:a.token,method:'POST',body:{name:'fixed cloud',source:'local',bundle:'agent',requestId:randomUUID()}})).data.instance;
 const conversation=(await f.request('/conversations',{token:a.token,method:'POST',body:{mode:'codex'}})).data;
 const body={submissionId:randomUUID(),content:'Run only inside the selected container.',providerId:provider.id,hostId:host.id,permissions:{access:'read-only',approval:'ask'}};
 const result=await f.request(`/conversations/${conversation.id}/agent/submit`,{token:a.token,method:'POST',body});assert.equal(result.status,200);
 for(let at=0;at<100&&!f.calls.length;at++)await new Promise(resolve=>setTimeout(resolve,5));
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].entry.hostId,host.id);assert.equal(f.calls[0].entry.auth.userId,a.id);assert.equal(f.centralCalls,0);
 assert.match(f.calls[0].entry.codexRevision,/^[a-f0-9]{8}-[a-f0-9]{4}-8[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
 let saved;
 for(let at=0;at<100;at++){saved=JSON.parse(await readFile(path.join(f.dir,'state.json'),'utf8'));if(saved.conversations.find(c=>c.id===conversation.id)?.threadCodexRevision)break;await new Promise(resolve=>setTimeout(resolve,5));}
 assert.equal(saved.conversations.find(c=>c.id===conversation.id).threadCodexRevision,f.calls[0].entry.codexRevision);
 await new JsonStore(f.dir).init(); // Completed Harbor-backed work must remain loadable after restart.
 assert.equal((await f.request(`/conversations/${conversation.id}/agent/submit`,{token:a.token,method:'POST',body})).status,200);assert.equal(f.calls.length,1);
 f.records[0].online=false;
 const offline=await f.request(`/conversations/${conversation.id}/agent/submit`,{token:a.token,method:'POST',body:{...body,submissionId:randomUUID()}});assert.equal(offline.status,409);assert.equal(f.centralCalls,0);assert.equal(f.calls.length,1);
});
test('Harbor import uses the existing account grant boundary and never persists distribution keys',async t=>{
 const f=await fixture(t),a=await f.member('harbor-user');
 assert.equal((await f.request('/service-links/api-harbor/pair',{method:'POST',body:{baseUrl:'https://harbor.invalid',code:'synthetic'}})).status,200);
 const admin=(await f.request('/state')).data,provider=admin.providers.find(p=>p.source==='api-harbor');assert.ok(provider);assert.equal(provider.hasApiKey,true);assert.equal(provider.editable,false);
 assert.equal((await f.request('/state',{token:a.token})).data.providers.some(p=>p.id===provider.id),false);
 assert.equal((await f.request('/admin/users/'+a.id,{method:'PATCH',body:{providerIds:[provider.id],agentAccess:'full'}})).status,200);
 const state=(await f.request('/state',{token:a.token})).data;assert.equal(state.providers[0].id,provider.id);assert.ok(state.codex.eligibleProviderIds.includes(provider.id));
 const disk=await readFile(path.join(f.dir,'state.json'),'utf8');assert.equal(disk.includes('synthetic-harbor-private-distribution-key'),false);
 assert.equal((await f.request('/providers/'+provider.id,{method:'DELETE'})).status,409);
 assert.equal((await f.request('/service-links/api-harbor',{method:'DELETE'})).status,200);assert.equal((await f.request('/state',{token:a.token})).data.providers.length,0);
});
test('service model metadata is stable and catalog removal disables future resolution without deleting history',async()=>{
 const store={state:{providers:[]},async save(){}},catalog={models:[{id:'model',protocols:['responses'],capabilities:{responses:{inputModalities:['text','image']}}}]};let enabled=true;
 const links={async status(){return{links:{'api-harbor':{state:'ready',catalog:enabled?catalog:{models:[]}}}};},async credential(){return{baseUrl:'https://harbor.invalid',credential:'private-fixture-key',connectionId:'stable'};}};
 const models=createServiceModels({store,links});await models.synchronize();const record=store.state.providers[0];assert.equal(record.apiKey,'');assert.equal(models.resolve(record).supportsImages,true);assert.deepEqual((await models.synchronize()).changed,[]);enabled=false;assert.deepEqual((await models.synchronize()).changed,[record.id]);assert.equal(models.resolve(record),undefined);assert.equal(store.state.providers.length,1);await models.close();
});

test('failed Harbor refresh and disconnect synchronize runtime removal while retaining durable grants/history',async t=>{
 for(const action of ['refresh','disconnect']){
  const f=await fixture(t),member=await f.member('failed-'+action);
  await f.request('/service-links/api-harbor/pair',{method:'POST',body:{baseUrl:'https://harbor.invalid',code:'synthetic'}});
  const provider=(await f.request('/state')).data.providers.find(p=>p.source==='api-harbor');
  await f.request('/admin/users/'+member.id,{method:'PATCH',body:{providerIds:[provider.id],agentAccess:'full'}});
  f.failAction(action);
  const result=await f.request('/service-links/api-harbor'+(action==='refresh'?'/refresh':''),{method:action==='refresh'?'POST':'DELETE',...(action==='refresh'?{body:{}}:{})});assert.equal(result.status,502);
  const state=(await f.request('/state',{token:member.token})).data;assert.equal(state.providers.length,0);assert.deepEqual(state.codex.eligibleProviderIds,[]);
  const disk=JSON.parse(await readFile(path.join(f.dir,'state.json'),'utf8'));assert.ok(disk.providers.some(p=>p.id===provider.id));assert.deepEqual(disk.users.find(u=>u.id===member.id).providerIds,[provider.id]);
 }
});

test('Harbor Agent eligibility honors explicit tools=false without excluding ordinary function-compatible models',async t=>{
 for(const [capabilities,eligible] of [[{tools:false},false],[{tools:true,customTools:false},true],[{tools:true,stream:false},false],[{tools:true,inputModalities:['image']},false]]){
  const f=await fixture(t,{capabilities});await f.request('/service-links/api-harbor/pair',{method:'POST',body:{baseUrl:'https://harbor.invalid',code:'synthetic'}});
  const state=(await f.request('/state')).data,provider=state.providers.find(p=>p.source==='api-harbor');
  if(capabilities.stream===false||capabilities.inputModalities&&!capabilities.inputModalities.includes('text')){assert.equal(provider,undefined);assert.deepEqual(state.codex.eligibleProviderIds,[]);}else{assert.ok(provider);assert.equal(state.codex.eligibleProviderIds.includes(provider.id),eligible);}
 }
});

test('existing Harbor-preferred provider edits and deletes use the durable record and never persist runtime credentials',async t=>{
 const original={id:randomUUID(),name:'Original saved connection',protocol:'responses',baseUrl:'https://retained.invalid/v1',model:'fixture-responses',apiKey:'retained-original-private-key',reasoningEffort:'high',supportsImages:true},other={...original,id:randomUUID(),name:'Unrelated retained connection',model:'missing-in-harbor'};
 const f=await fixture(t,{providers:[original,other]}),member=await f.member('retained-grant');
 await f.request('/admin/users/'+member.id,{method:'PATCH',body:{providerIds:[original.id],agentAccess:'full'}});
 await f.request('/service-links/api-harbor/pair',{method:'POST',body:{baseUrl:'https://harbor.invalid',code:'synthetic'}});
 const visible=(await f.request('/state',{token:member.token})).data.providers;assert.equal(visible.length,1);assert.equal(visible[0].id,original.id);assert.equal(visible[0].baseUrl,original.baseUrl);assert.equal(visible[0].source,'api-harbor');
 assert.equal((await f.request('/providers',{method:'POST',body:{id:original.id,name:'Renamed original'}})).status,200);
 let disk=JSON.parse(await readFile(path.join(f.dir,'state.json'),'utf8'));assert.deepEqual(disk.providers.find(p=>p.id===original.id),{...original,name:'Renamed original'});assert.deepEqual(disk.providers.find(p=>p.id===other.id),other);assert.equal(JSON.stringify(disk).includes('synthetic-harbor-private-distribution-key'),false);assert.deepEqual(disk.users.find(u=>u.id===member.id).providerIds,[original.id]);
 assert.equal((await f.request('/providers/'+original.id,{method:'DELETE'})).status,200);
 disk=JSON.parse(await readFile(path.join(f.dir,'state.json'),'utf8'));assert.equal(disk.providers.some(p=>p.id===original.id),false);assert.deepEqual(disk.providers.find(p=>p.id===other.id),other);assert.equal(disk.providers.filter(p=>p.serviceLink==='api-harbor').length,1);
});

test('disconnect during asynchronous chat preparation fences the captured Harbor credential before inference dispatch',async t=>{
 let requests=0,entered,release;
 const upstream=http.createServer((_req,res)=>{requests++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({status:'completed',output_text:'must not run'}));});await listenFixture(upstream);t.after(async()=>{upstream.closeAllConnections();await new Promise(resolve=>upstream.close(resolve));});
 const started=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;}),memory={async getContext(){entered();return gate;},async close(){}};
 const original={id:randomUUID(),name:'Original connection',protocol:'responses',baseUrl:'https://old.invalid/v1',model:'fixture-responses',apiKey:'retained-original-key',reasoningEffort:'',supportsImages:true};
 const f=await fixture(t,{providers:[original],memoryOptions:{service:memory},harborBaseUrl:`http://127.0.0.1:${upstream.address().port}`});t.after(()=>release(''));
 await f.request('/service-links/api-harbor/pair',{method:'POST',body:{baseUrl:'https://harbor.invalid',code:'synthetic'}});
 const created=await f.request('/conversations',{method:'POST',body:{mode:'chat',providerId:original.id}});
 const pending=f.request(`/conversations/${created.data.id}/messages`,{method:'POST',body:{content:'single inference'},raw:true});await started;
 f.setLinkState('revoking');release('');const result=await pending;assert.match(result.data,/模型连接已变化/);assert.equal(requests,0,'a stale captured credential must never be sent after revocation intent');
});

test('explicit grants support more than 32 known Harbor providers without implicitly expanding other accounts',async t=>{
 const f=await fixture(t),before=await f.member('unchanged-grants');
 f.catalog.models=Array.from({length:40},(_,index)=>({id:'known-model-'+index,protocols:['responses'],capabilities:{responses:{tools:true,inputModalities:['text']}}}));
 await f.request('/service-links/api-harbor/pair',{method:'POST',body:{baseUrl:'https://harbor.invalid',code:'synthetic'}});
 const ids=(await f.request('/state')).data.providers.map(provider=>provider.id);assert.equal(ids.length,40);assert.equal((await f.request('/state',{token:before.token})).data.providers.length,0);
 const created=await f.request('/admin/users',{method:'POST',body:{username:'large-explicit-grant',password:'synthetic-fixture-password',providerIds:ids}});assert.equal(created.status,201);assert.deepEqual(created.data.user.providerIds,ids);
 const id=created.data.user.id;assert.equal((await f.request('/admin/users/'+id,{method:'PATCH',body:{providerIds:ids.slice(0,39)}})).status,200);
 for(const providerIds of [[...ids.slice(0,38),ids[0]],['unknown-id'],[null]])assert.equal((await f.request('/admin/users/'+id,{method:'PATCH',body:{providerIds}})).status,400);
 assert.equal((await f.request('/state',{token:before.token})).data.providers.length,0);const disk=JSON.parse(await readFile(path.join(f.dir,'state.json'),'utf8'));assert.deepEqual(disk.users.find(user=>user.id===before.id).providerIds,[]);
});

test('Harbor catalog records do not consume the retained manual-provider capacity',async t=>{
 const f=await fixture(t);
 f.catalog.models=Array.from({length:40},(_,index)=>({id:'catalog-capacity-'+index,protocols:['responses'],capabilities:{responses:{inputModalities:['text'],stream:true}}}));
 await f.request('/service-links/api-harbor/pair',{method:'POST',body:{baseUrl:'https://harbor.invalid',code:'synthetic'}});
 for(let index=0;index<32;index++){
  const created=await f.request('/providers',{method:'POST',body:{name:'Retained manual '+index,model:'missing-manual-'+index,protocol:'responses',baseUrl:'https://retained.invalid/v1',apiKey:'synthetic-retained-capacity-key'}});
  assert.equal(created.status,200,'known Harbor catalog entries must not prevent adding a missing manual model');
 }
 const rejected=await f.request('/providers',{method:'POST',body:{name:'Over manual capacity',model:'missing-manual-32',protocol:'responses',baseUrl:'https://retained.invalid/v1',apiKey:'synthetic-retained-capacity-key'}});
 assert.equal(rejected.status,400);
 const disk=JSON.parse(await readFile(path.join(f.dir,'state.json'),'utf8'));
 assert.equal(disk.providers.filter(provider=>provider.serviceLink==='api-harbor').length,40);
 assert.equal(disk.providers.filter(provider=>provider.serviceLink!=='api-harbor').length,32);
 assert.equal(JSON.stringify(disk).includes('synthetic-harbor-private-distribution-key'),false);
});

const defaultApiConfig={mode:'api',baseUrl:'https://retained-agent.invalid/v1',model:'fixture-responses',apiKey:'retained-global-agent-key',reasoningEffort:'high'};
const defaultSubmission=()=>({submissionId:randomUUID(),content:'Use the configured default once.',providerId:null,hostId:'central',permissions:{access:'read-only',approval:'ask'}});
async function waitFor(check){for(let at=0;at<200;at++){if(await check())return;await new Promise(resolve=>setTimeout(resolve,5));}assert.fail('Agent fixture did not settle');}

test('administrator null-provider default prefers exact Harbor Agent model while original global config and grants remain unchanged',async t=>{
 const f=await fixture(t,{codexConfig:defaultApiConfig,capabilities:{tools:true,stream:true,inputModalities:['text']}}),member=await f.member('null-default-member');
 await f.request('/service-links/api-harbor/pair',{method:'POST',body:{baseUrl:'https://harbor.invalid',code:'synthetic'}});
 const state=(await f.request('/state')).data;assert.equal(state.codex.baseUrl,defaultApiConfig.baseUrl);assert.equal(state.codex.source,'api-harbor');assert.equal(state.codex.effectiveConfig.baseUrl,'https://harbor.invalid/v1');assert.notEqual(state.codex.effectiveConfig.revision,state.codex.revision);assert.equal(JSON.stringify(state).includes('synthetic-harbor-private-distribution-key'),false);
 const created=await f.request('/conversations',{method:'POST',body:{mode:'codex'}}),route=`/conversations/${created.data.id}/agent/submit`;
 assert.equal((await f.request(route,{method:'POST',body:defaultSubmission()})).status,200);await waitFor(()=>f.agentCalls.length===1);await waitFor(async()=>['completed','error'].includes((await f.request('/conversations/'+created.data.id)).data.agent?.run?.status));
 assert.equal(f.centralCalls,0);assert.equal(f.agentCalls[0].config.baseUrl,'https://harbor.invalid/v1');assert.equal(f.agentCalls[0].config.apiKey,'synthetic-harbor-private-distribution-key');assert.equal(f.agentCalls[0].config.model,defaultApiConfig.model);assert.equal(f.agentCalls[0].config.revision,state.codex.effectiveConfig.revision);
 const ownMember=await f.request('/conversations',{token:member.token,method:'POST',body:{mode:'codex'}});assert.equal((await f.request(`/conversations/${ownMember.data.id}/agent/submit`,{token:member.token,method:'POST',body:defaultSubmission()})).status,403);assert.equal((await f.request('/state',{token:member.token})).data.codex.source,undefined);
 assert.equal((await f.request('/service-links/api-harbor',{method:'DELETE'})).status,200);
 const fallback=await f.request('/conversations',{method:'POST',body:{mode:'codex'}});assert.equal((await f.request(`/conversations/${fallback.data.id}/agent/submit`,{method:'POST',body:defaultSubmission()})).status,200);await waitFor(()=>f.centralCalls===1);assert.equal(f.agentCalls.length,1);
 const disk=JSON.parse(await readFile(path.join(f.dir,'state.json'),'utf8'));assert.equal(JSON.stringify(disk.codexConfig),f.configuredAtStart);assert.equal(JSON.stringify(disk).includes('synthetic-harbor-private-distribution-key'),false);assert.deepEqual(disk.users.find(user=>user.id===member.id).providerIds,[]);
});

test('administrator null-provider default retains original source for missing model, unsupported tools and host mode',async t=>{
 for(const options of [{codexConfig:{...defaultApiConfig,model:'missing-global-model'}},{codexConfig:defaultApiConfig,capabilities:{tools:false,stream:true,inputModalities:['text']}},{codexConfig:{mode:'host'}}]){
  const f=await fixture(t,options);await f.request('/service-links/api-harbor/pair',{method:'POST',body:{baseUrl:'https://harbor.invalid',code:'synthetic'}});
  const state=(await f.request('/state')).data;assert.equal(state.codex.source,undefined);assert.equal(state.codex.effectiveConfig,undefined);
  const created=await f.request('/conversations',{method:'POST',body:{mode:'codex'}});assert.equal((await f.request(`/conversations/${created.data.id}/agent/submit`,{method:'POST',body:defaultSubmission()})).status,200);await waitFor(()=>f.centralCalls===1);assert.equal(f.agentCalls.length,0);
  const disk=JSON.parse(await readFile(path.join(f.dir,'state.json'),'utf8'));assert.equal(JSON.stringify(disk.codexConfig),f.configuredAtStart);
 }
});

test('null-provider image admission and legacy messages use the same effective Harbor default configuration',async t=>{
 const f=await fixture(t,{codexConfig:{...defaultApiConfig,supportsImages:false},capabilities:{tools:true,stream:true,inputModalities:['text']}});await f.request('/service-links/api-harbor/pair',{method:'POST',body:{baseUrl:'https://harbor.invalid',code:'synthetic'}});
 const image=await f.upload(),created=await f.request('/conversations',{method:'POST',body:{mode:'codex'}}),route=`/conversations/${created.data.id}`;
 for(const suffix of ['/agent/submit','/messages']){
  const result=await f.request(route+suffix,{method:'POST',body:{...(suffix==='/agent/submit'?defaultSubmission():{content:'inspect image'}),attachmentIds:[image.id]}});assert.equal(result.status,400);assert.match(result.data.error,/仅支持文本/);
 }
 assert.equal(f.agentCalls.length,0);assert.equal(f.centralCalls,0);
 const response=await f.request(route+'/messages',{method:'POST',body:{content:'Legacy default plain text.'},raw:true});assert.equal(response.status,200);assert.match(response.data,/harbor-default-completed/);assert.equal(f.agentCalls.length,1);assert.equal(f.agentCalls[0].config.apiKey,'synthetic-harbor-private-distribution-key');
 const disk=JSON.parse(await readFile(path.join(f.dir,'state.json'),'utf8'));assert.equal(disk.conversations.find(item=>item.id===created.data.id).threadCodexRevision,f.agentCalls[0].config.revision);assert.equal(JSON.stringify(disk.codexConfig),f.configuredAtStart);
});

test('default Harbor revision changes stop active null-provider work and cancel its queued old-source entries',async t=>{
 let aborted=false;
 const f=await fixture(t,{codexConfig:defaultApiConfig,capabilities:{tools:true,stream:true,inputModalities:['text']},bridgeRun:args=>new Promise((_resolve,reject)=>{args.signal.addEventListener('abort',()=>{aborted=true;reject(args.signal.reason);},{once:true});})});
 await f.request('/service-links/api-harbor/pair',{method:'POST',body:{baseUrl:'https://harbor.invalid',code:'synthetic'}});
 const created=await f.request('/conversations',{method:'POST',body:{mode:'codex'}}),route=`/conversations/${created.data.id}/agent/submit`;
 assert.equal((await f.request(route,{method:'POST',body:defaultSubmission()})).status,200);await waitFor(()=>f.agentCalls.length===1);
 assert.equal((await f.request(route,{method:'POST',body:defaultSubmission()})).status,200);await waitFor(async()=>(await f.request('/conversations/'+created.data.id)).data.agent?.queue?.length===1);
 assert.equal((await f.request('/service-links/api-harbor',{method:'DELETE'})).status,200);assert.equal(aborted,true);const stopped=(await f.request('/conversations/'+created.data.id)).data;assert.equal(stopped.agent.queue.length,0);assert.equal(stopped.agent.paused,true);assert.equal(f.agentCalls.length,1);assert.equal(f.centralCalls,0,'queued old-source work must not be replayed into the retained default');
});

test('saving global config establishes the new default revision before an unrelated service-link refresh',async t=>{
 let aborted=false,completeRun;
 const f=await fixture(t,{codexConfig:defaultApiConfig,capabilities:{tools:true,stream:true,inputModalities:['text']},bridgeRun:args=>new Promise((resolve,reject)=>{completeRun=()=>resolve({text:'new configured default completed'});args.signal.addEventListener('abort',()=>{aborted=true;reject(args.signal.reason);},{once:true});})});t.after(()=>completeRun?.());
 await f.request('/service-links/api-harbor/pair',{method:'POST',body:{baseUrl:'https://harbor.invalid',code:'synthetic'}});
 const updated=await f.request('/codex/config',{method:'PATCH',body:{reasoningEffort:'medium'}});assert.equal(updated.status,200);
 const created=await f.request('/conversations',{method:'POST',body:{mode:'codex'}});assert.equal((await f.request(`/conversations/${created.data.id}/agent/submit`,{method:'POST',body:defaultSubmission()})).status,200);await waitFor(()=>f.agentCalls.length===1);
 assert.equal(f.agentCalls[0].config.reasoningEffort,'medium');assert.equal((await f.request('/service-links/api-harbor/refresh',{method:'POST',body:{}})).status,200);assert.equal(aborted,false);assert.equal((await f.request('/conversations/'+created.data.id)).data.agent.run.status,'running');completeRun();await waitFor(async()=>(await f.request('/conversations/'+created.data.id)).data.agent.run.status==='completed');
});

test('same granted provider sends text through Harbor and image history through its retained vision endpoint',async t=>{
 const calls={harbor:[],original:[]};
 const servers=await Promise.all(['harbor','original'].map(async kind=>{const server=http.createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;calls[kind].push({path:req.url,authorization:req.headers.authorization,body:JSON.parse(raw)});res.setHeader('Content-Type','application/json');res.end(JSON.stringify(req.url.endsWith('/responses')?{status:'completed',output_text:kind+' actual reply'}:{choices:[{message:{content:kind+' actual reply'},finish_reason:'stop'}]}));
 });await listenFixture(server);t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});return server;}));
 const harborBaseUrl=`http://127.0.0.1:${servers[0].address().port}`,originalBaseUrl=`http://127.0.0.1:${servers[1].address().port}/v1`;
 for(const protocol of ['responses','chat-completions']){
  calls.harbor.length=0;calls.original.length=0;
  const original={id:randomUUID(),name:'Granted vision connection',protocol,baseUrl:originalBaseUrl,model:'fixture-responses',apiKey:'retained-original-private-key',supportsImages:true,reasoningEffort:''};
  const f=await fixture(t,{providers:[original],harborBaseUrl,capabilities:{tools:true,stream:true,inputModalities:['text']}});if(protocol==='chat-completions'){f.catalog.models[0].protocols=['chat'];f.catalog.models[0].capabilities.chat=f.catalog.models[0].capabilities.responses;}
  await f.request('/service-links/api-harbor/pair',{method:'POST',body:{baseUrl:harborBaseUrl,code:'synthetic'}});
  const created=await f.request('/conversations',{method:'POST',body:{mode:'chat',providerId:original.id}}),route=`/conversations/${created.data.id}/messages`;
  assert.match((await f.request(route,{method:'POST',body:{content:'plain text'},raw:true})).data,/harbor actual reply/);assert.equal(calls.harbor.length,1);assert.equal(calls.original.length,0);
  const image=await f.upload();assert.match((await f.request(route,{method:'POST',body:{content:'inspect the attached image',attachmentIds:[image.id]},raw:true})).data,/original actual reply/);assert.equal(calls.harbor.length,1);assert.equal(calls.original.length,1);assert.equal(calls.original[0].authorization,'Bearer retained-original-private-key');assert.equal(calls.original[0].body.model,original.model);assert.match(JSON.stringify(calls.original[0].body),/data:image\/webp;base64,/);
  assert.match((await f.request(route,{method:'POST',body:{content:'continue discussing that image'},raw:true})).data,/original actual reply/);assert.equal(calls.original.length,2);assert.equal(calls.harbor.length,1,'image history remains on the capable retained source');
  const managed=(await f.request('/state')).data.providers.find(provider=>provider.id!==original.id&&provider.source==='api-harbor'),harborOnly=await f.request('/conversations',{method:'POST',body:{mode:'chat',providerId:managed.id}});
  const rejected=await f.request(`/conversations/${harborOnly.data.id}/messages`,{method:'POST',body:{content:'do not pretend vision',attachmentIds:[image.id]},raw:true});assert.ok([400,404].includes(rejected.status));assert.equal(calls.original.length,2);assert.equal(calls.harbor.length,1);
  assert.equal((await f.request('/service-links/api-harbor',{method:'DELETE'})).status,200);const next=await f.request('/conversations',{method:'POST',body:{mode:'chat',providerId:original.id}});assert.match((await f.request(`/conversations/${next.data.id}/messages`,{method:'POST',body:{content:'after disconnect'},raw:true})).data,/original actual reply/);assert.equal(calls.harbor.length,1);assert.equal(calls.original.length,3);
  const disk=JSON.parse(await readFile(path.join(f.dir,'state.json'),'utf8'));assert.deepEqual(disk.providers.find(provider=>provider.id===original.id),original);assert.equal(JSON.stringify(disk).includes('synthetic-harbor-private-distribution-key'),false);
 }
});

test('Agent image fallback uses the retained configuration and a fresh thread while later text preserves image history',async t=>{
 const original={id:randomUUID(),name:'Existing Agent vision',protocol:'responses',baseUrl:defaultApiConfig.baseUrl,model:defaultApiConfig.model,apiKey:defaultApiConfig.apiKey,supportsImages:true,reasoningEffort:'high'};
 const f=await fixture(t,{providers:[original],codexConfig:{...defaultApiConfig,supportsImages:true},capabilities:{tools:true,stream:true,inputModalities:['text']}});await f.request('/service-links/api-harbor/pair',{method:'POST',body:{baseUrl:'https://harbor.invalid',code:'synthetic'}});
 const created=await f.request('/conversations',{method:'POST',body:{mode:'codex'}}),route=`/conversations/${created.data.id}/agent/submit`,complete=count=>waitFor(async()=>f.agentCalls.length+f.centralCalls>=count&&(await f.request('/conversations/'+created.data.id)).data.agent?.run?.status==='completed');
 assert.equal((await f.request(route,{method:'POST',body:{...defaultSubmission(),providerId:original.id}})).status,200);await complete(1);assert.equal(f.agentCalls.length,1);assert.equal(f.centralCalls,0);
 const image=await f.upload();assert.equal((await f.request(route,{method:'POST',body:{...defaultSubmission(),providerId:original.id,content:'inspect image',attachmentIds:[image.id]}})).status,200);await complete(2);assert.equal(f.centralCalls,1);assert.equal(f.agentCalls.length,1);assert.equal(f.centralAgentCalls[0].threadId,undefined,'changing inference source must not resume the Harbor thread');assert.equal(f.centralAgentCalls[0].images.length,1);
 assert.equal((await f.request(route,{method:'POST',body:{...defaultSubmission(),providerId:original.id,content:'continue that image'}})).status,200);await complete(3);assert.equal(f.centralCalls,2);assert.equal(f.agentCalls.length,1);assert.equal(f.centralAgentCalls[1].threadId,'central-fixture-thread');
 const defaultConversation=await f.request('/conversations',{method:'POST',body:{mode:'codex'}});assert.equal((await f.request(`/conversations/${defaultConversation.data.id}/agent/submit`,{method:'POST',body:{...defaultSubmission(),attachmentIds:[image.id]}})).status,200);await waitFor(()=>f.centralCalls===3);assert.equal(f.agentCalls.length,1,'administrator null default must honor the same image fallback requirement');
 const disk=JSON.parse(await readFile(path.join(f.dir,'state.json'),'utf8'));assert.equal(JSON.stringify(disk.codexConfig),f.configuredAtStart);assert.equal(disk.conversations.find(conversation=>conversation.id===created.data.id).threadCodexRevision,disk.codexConfig.revision);
});
