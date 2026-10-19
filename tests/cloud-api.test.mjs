import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {createPetServer} from '../server/app.mjs';
import {JsonStore} from '../server/store.mjs';
import {createServiceModels} from '../server/service-models.mjs';
import {listenFixture} from './helpers/loopback.mjs';

const bootstrap='synthetic-cloud-api-owner-token';
async function fixture(t){
 const dir=await mkdtemp(path.join(tmpdir(),'petpal-cloud-api-')),store=await new JsonStore(dir).init(),calls=[],records=[];let centralCalls=0,paired=false;
 const catalog={schema:'api-harbor-model-catalog.v1',service:'api-harbor',models:[{id:'fixture-responses',protocols:['responses'],capabilities:{responses:{inputModalities:['text']}}}]};
 const links={async status(){return{links:paired?{'api-harbor':{kind:'api-harbor',state:'ready',baseUrl:'https://harbor.invalid',catalog}}:{}};},async pair(){paired=true;},async refresh(){},async disconnect(){paired=false;},async credential(){return{baseUrl:'https://harbor.invalid',credential:'synthetic-harbor-private-distribution-key',connectionId:'one'};},async close(){}};
 const cloud={has:id=>records.some(r=>r.id===id),list:userId=>records.filter(r=>r.userId===userId||userId===store.state.ownerId).map(r=>({...r,isOwn:r.userId===userId})),hostFor(userId,id){const h=this.list(userId).find(r=>r.id===id);if(!h)throw Object.assign(new Error('foreign docker'),{status:403});return h;},target(userId,id){const h=this.hostFor(userId,id);if(!h.online)throw Object.assign(new Error('offline docker'),{status:409});return{hostId:h.id,hostName:h.name};},isBusy(){return false;},async refresh(){},async catalog(){return{sources:[{id:'local',available:true}],templates:[{id:'agent'}]};},async create(userId,body){const h={id:randomUUID(),userId,name:body.name,requestId:body.requestId,kind:'docker',platform:'linux',online:true,docker:{state:'running',generation:'one',desktopAvailable:true},codex:{available:true,configured:true,projectDirectory:true,images:false,independentReviewModel:false}};records.push(h);return{...h,isOwn:true};},async action(userId,id,action){const r=records.find(r=>r.id===this.hostFor(userId,id).id);r.online=action==='start';return r;},async prepare(){return{ready:true};},bind(entry){return{async run(args){calls.push({entry,args});return{text:'cloud-completed',threadId:'cloud-fixture-thread'};},async close(){}};},async close(){}};
 const codex={async status(){return{available:true,authenticated:true};},async run(){centralCalls++;return{text:'central'};},async close(){}};
 const app=await createPetServer({dataDir:dir,token:bootstrap,codex,serviceLinksOptions:{service:links},cloudDockerOptions:{service:cloud}});await listenFixture(app.server);const base=`http://127.0.0.1:${app.server.address().port}`;
 const request=async(route,{token=bootstrap,method='GET',body}={})=>{const response=await fetch(base+'/api'+route,{method,headers:{...(token?{Authorization:`Bearer ${token}`}:{ }),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:response.status,data:await response.json()};};
 async function member(name){const created=await request('/admin/users',{method:'POST',body:{username:name,password:'cloud-fixture-password',providerIds:[],agentAccess:'full'}});assert.equal(created.status,201);const login=await request('/auth/login',{method:'POST',token:null,body:{username:name,password:'cloud-fixture-password'}});return{id:created.data.user.id,token:login.data.token};}
 t.after(async()=>{await app.close();assert.ok(dir.startsWith(path.join(tmpdir(),'petpal-cloud-api-')));await rm(dir,{recursive:true,force:true});});
 return{request,member,calls,dir,records,get centralCalls(){return centralCalls;}};
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
