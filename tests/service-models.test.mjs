import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {createServiceModels,serviceModelSupportsAgent} from '../server/service-models.mjs';
import {streamProvider} from '../server/providers.mjs';
import {listenFixture} from './helpers/loopback.mjs';

function fixture(providers=[]){
 const store={state:{providers,users:[{providerIds:['existing']}],settings:{defaultProviderId:'existing'}},async save(){}},original=structuredClone(store.state);
 const catalog={models:[{id:'same-model',protocols:['responses'],capabilities:{responses:{tools:true,stream:true,inputModalities:['text','image']}}}]};
 let state='ready',connection={instanceId:'receiver-fixture',connectionId:'connection-one',baseUrl:'https://harbor.invalid',credential:'private-fixture-one'};
 const links={isReady(_kind,expected){return state==='ready'&&expected.credential===connection.credential&&expected.connectionId===connection.connectionId;},async status(){return{instanceId:'receiver-fixture',links:{'api-harbor':{state,issuerInstanceId:'issuer-fixture',catalog}}};},async credential(){if(state!=='ready')throw new Error('not ready');return{...connection};}};
 const service=createServiceModels({store,links});
 return{store,original,catalog,service,setState(value){state=value;},setConnection(value){connection={...connection,...value};}};
}
const provider={id:'existing',name:'Existing granted choice',model:'same-model',protocol:'responses',baseUrl:'https://old.invalid/v1',apiKey:'retained-old-key',supportsImages:true,reasoningEffort:''};

test('exact ID/protocol preference preserves original records, account grants/default and missing-type fallback',async()=>{
 const wrongProtocol={...provider,id:'chat-only',protocol:'chat-completions'},missing={...provider,id:'missing',model:'other-model'},f=fixture([provider,wrongProtocol,missing]);
 await f.service.synchronize();const selected=f.service.resolve(provider);
 assert.equal(selected.id,provider.id);assert.equal(selected.name,provider.name);assert.equal(selected.apiKey,'private-fixture-one');assert.equal(selected.baseUrl,'https://harbor.invalid/v1');assert.equal(selected.source,'api-harbor');
 assert.equal(f.service.resolve(wrongProtocol),wrongProtocol);assert.equal(f.service.resolve(missing),missing);
 assert.deepEqual(f.store.state.providers.slice(0,3),f.original.providers);assert.deepEqual(f.store.state.users,f.original.users);assert.deepEqual(f.store.state.settings,f.original.settings);
 assert.equal(f.store.state.providers.filter(item=>item.serviceLink).every(item=>item.apiKey===''),true);
 f.setState('offline');assert.equal(f.service.resolve(provider),provider);assert.equal(f.service.forProtocol('responses'),undefined);
 f.setState('ready');f.catalog.models=[];await f.service.synchronize();assert.equal(f.service.resolve(provider),provider);
 await f.service.close();
});

test('admission follows current provider edits and newly configured providers without stale same-ID models',async()=>{
 const f=fixture([provider]);await f.service.synchronize();
 const edited={...provider,model:'changed-model'};assert.equal(f.service.resolve(edited),edited);
 const added={...provider,id:'new-explicit-grant',supportsImages:false};assert.equal(f.service.resolve(added).id,added.id);assert.equal(f.service.resolve(added).supportsImages,false);
 await f.service.close();
});

test('Chat admission respects required streaming, text and collaboration tools, retaining original capability fallback',async()=>{
 for(const capabilities of [{stream:false},{inputModalities:['image']},{tools:false}]){
  const f=fixture([provider]);f.catalog.models[0].capabilities.responses=capabilities;await f.service.synchronize();
  const requiresTools=capabilities.tools===false;assert.equal(f.service.resolve(provider,{tools:requiresTools}),provider);
  const managed=f.store.state.providers.find(item=>item.serviceLink);assert.equal(f.service.resolve(managed,{tools:requiresTools}),undefined);
  if(requiresTools)assert.equal(f.service.resolve(provider).source,'api-harbor','plain text chat may still use a model without tools');await f.service.close();
 }
});

test('image requirements retain a capable original without changing text preference or inventing Harbor-only vision',async()=>{
 const f=fixture([provider]);f.catalog.models[0].capabilities.responses.inputModalities=['text'];await f.service.synchronize();
 assert.equal(f.service.resolve(provider).source,'api-harbor');assert.equal(f.service.resolve(provider,{images:true}),provider);assert.equal(f.service.resolve(provider,{agent:true,images:true}),provider);
 const managed=f.store.state.providers.find(candidate=>candidate.serviceLink);assert.equal(f.service.resolve(managed,{images:true}),undefined);assert.equal(f.service.resolve(managed).supportsImages,false);
 f.setState('revoking');assert.equal(f.service.resolve(managed),undefined);assert.equal(f.service.resolve(provider),provider);await f.service.close();
});

test('same-identity catalog save failure invalidates all Harbor admission instead of retaining stale capabilities',async()=>{
 const f=fixture([provider]);await f.service.synchronize();const managed=f.store.state.providers.find(item=>item.serviceLink);assert.ok(f.service.resolve(managed,{agent:true}));
 f.catalog.models[0].capabilities.responses.tools=false;f.store.save=async()=>{throw new Error('fixture persistence failure');};
 await assert.rejects(f.service.synchronize(),/fixture persistence failure/);assert.equal(f.service.resolve(managed,{agent:true}),undefined);assert.equal(f.service.resolve(provider),provider);assert.equal(f.service.forProtocol('responses'),undefined);await f.service.close();
});

test('Harbor-only IDs survive credential/connection rotation but revisions fence identity and capability changes',async()=>{
 const f=fixture([provider]);await f.service.synchronize();const record=f.store.state.providers.find(item=>item.serviceLink),before=f.service.resolve(record),oldRevision=f.service.revision(provider.id);
 f.setConnection({connectionId:'connection-two',credential:'private-fixture-two'});
 assert.equal(f.service.resolve(record),undefined);assert.equal(f.service.resolve(provider),provider,'old credentials are fenced before synchronization');
 const rotated=await f.service.synchronize();assert.equal(f.store.state.providers.filter(item=>item.serviceLink).length,1);assert.equal(f.service.resolve(record).id,before.id);assert.notEqual(f.service.resolve(record).linkRevision,before.linkRevision);assert.notEqual(f.service.revision(provider.id),oldRevision);assert.ok(rotated.changed.includes(provider.id));
 const rotatedRevision=f.service.revision(provider.id);f.catalog.models[0].capabilities.responses.tools=false;await f.service.synchronize();assert.notEqual(f.service.revision(provider.id),rotatedRevision);
 assert.equal(f.service.resolve(provider,{agent:true}),provider);assert.equal(f.service.resolve(record,{agent:true}),undefined);assert.equal(f.service.resolve(provider).source,'api-harbor');
 await f.service.close();
});

test('legacy managed IDs migrate once and remain stable on repeated synchronization and re-pairing',async()=>{
 const id='harbor-'+createHash('sha256').update(JSON.stringify(['connection-one','same-model','responses'])).digest('hex').slice(0,40);
 const legacy={...provider,id,serviceLink:'api-harbor',harborModelId:provider.model,apiKey:''},f=fixture([legacy]);
 await f.service.synchronize();assert.equal(f.store.state.providers.length,1);assert.ok(f.store.state.providers[0].harborScope);assert.equal(f.service.resolve(legacy).id,id);
 await f.service.synchronize();assert.equal(f.store.state.providers.length,1);assert.equal(f.service.resolve(legacy).id,id);
 f.setConnection({connectionId:'re-paired',credential:'re-paired-secret'});await f.service.synchronize();assert.equal(f.store.state.providers.length,1);assert.equal(f.service.resolve(legacy).id,id);
 f.setConnection({baseUrl:'https://another-harbor.invalid'});await f.service.synchronize();assert.equal(f.store.state.providers.length,2);assert.equal(f.service.resolve(legacy),undefined,'a different issuer endpoint must not inherit the old managed ID grant');await f.service.close();
});

test('media protocols stay role-specific, unknown extensions never become chat and missing roles retain fallback',async()=>{
 const f=fixture();f.catalog.models=[{id:'voice',protocols:['speech','transcribe','asr_stream','embeddings','future_video'],capabilities:{speech:{nativeProfile:'cosyvoice',stream:true},transcribe:{nativeProfile:'sensevoice'},asr_stream:{nativeProfile:'funasr_streaming'}}}];
 await f.service.synchronize();assert.equal(f.store.state.providers.length,0);assert.equal(f.service.forProtocol('speech').model,'voice');assert.equal(f.service.forProtocol('speech').capabilities.nativeProfile,'cosyvoice');assert.equal(f.service.forProtocol('speech',{model:'other'}),undefined);assert.equal(f.service.forProtocol('future_video'),undefined);assert.equal(f.service.forProtocol('responses'),undefined);
 f.setState('revoking');assert.equal(f.service.forProtocol('speech'),undefined);await f.service.close();
});

test('Agent respects explicit advertised tools, streaming and text limits while customTools alone remains compatible',()=>{
 for(const capabilities of [{tools:false},{stream:false},{inputModalities:['image']}])assert.equal(serviceModelSupportsAgent({...provider,capabilities}),false);
 for(const capabilities of [{},{tools:null},{tools:true,customTools:false},{inputModalities:['text','image']}])assert.equal(serviceModelSupportsAgent({...provider,capabilities}),true);
 assert.equal(serviceModelSupportsAgent({...provider,protocol:'chat-completions'}),false);
});

test('real HTTP inference prefers Harbor, falls back only before dispatch and never replays an issued request',async t=>{
 const calls={old:[],harbor:[]};let rejected=false;
 const servers=await Promise.all(['old','harbor'].map(async kind=>{
  const server=http.createServer(async(req,res)=>{
   let raw='';for await(const chunk of req)raw+=chunk;calls[kind].push({path:req.url,authorization:req.headers.authorization,body:JSON.parse(raw)});
   res.writeHead(kind==='harbor'&&rejected?503:200,{'Content-Type':'application/json'});res.end(JSON.stringify(kind==='harbor'&&rejected?{error:{message:'fixture unavailable'}}:{status:'completed',output_text:kind+' reply'}));
  });await listenFixture(server);t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});return server;
 }));
 const configured={...provider,baseUrl:`http://127.0.0.1:${servers[0].address().port}/v1`},f=fixture([configured]);f.setConnection({baseUrl:`http://127.0.0.1:${servers[1].address().port}`});await f.service.synchronize();t.after(()=>f.service.close());
 const send=(options={})=>streamProvider({provider:f.service.resolve(configured,{tools:!!options.onToolCall}),messages:[{role:'user',content:'single request'}],...options});
 assert.equal((await send()).text,'harbor reply');assert.equal(calls.harbor.length,1);assert.equal(calls.old.length,0);assert.equal(calls.harbor[0].authorization,'Bearer private-fixture-one');assert.equal(calls.harbor[0].body.model,configured.model);
 rejected=true;await assert.rejects(send(),/HTTP 503/);assert.equal(calls.harbor.length,2);assert.equal(calls.old.length,0,'already-issued inference must never replay through the retained provider');
 rejected=false;f.catalog.models[0].capabilities.responses.tools=false;await f.service.synchronize();assert.equal((await send({onToolCall:async()=>({})})).text,'old reply');assert.equal(calls.old.length,1);assert.ok(calls.old[0].body.tools?.length);assert.equal(calls.harbor.length,2,'tool-unsupported Harbor must not receive a collaboration tool call');
 f.catalog.models[0].capabilities.responses.stream=false;await f.service.synchronize();assert.equal((await send()).text,'old reply');assert.equal(calls.old.length,2);assert.equal(calls.harbor.length,2,'stream-unsupported Harbor must not receive stream:true');
 f.setState('offline');assert.equal((await send()).text,'old reply');assert.equal(calls.old.length,3);assert.equal(calls.old[2].authorization,'Bearer retained-old-key');assert.equal(calls.harbor.length,2);
});

test('runtime-only Harbor authorizer fences a real HTTP tool continuation after revocation without replay',async t=>{
 let calls=0;
 const upstream=http.createServer(async(req,res)=>{
  for await(const _chunk of req){}calls++;res.setHeader('Content-Type','application/json');
  res.end(JSON.stringify({status:'completed',output:[{type:'function_call',call_id:'one-tool-call',name:'run_agent',arguments:JSON.stringify({task:'one authorized task'})}]}));
 });await listenFixture(upstream);t.after(async()=>{upstream.closeAllConnections();await new Promise(resolve=>upstream.close(resolve));});
 const f=fixture([provider]);f.setConnection({baseUrl:`http://127.0.0.1:${upstream.address().port}`});await f.service.synchronize();t.after(()=>f.service.close());
 const captured=f.service.resolve(provider,{tools:true});assert.equal(typeof captured.authorize,'function');assert.equal(Object.keys(captured).includes('authorize'),false);assert.equal(JSON.stringify(f.store.state).includes('authorize'),false);assert.equal(structuredClone(captured).authorize,undefined);
 await assert.rejects(streamProvider({provider:captured,messages:[{role:'user',content:'dispatch'}],onToolCall:async()=>{f.setState('revoking');return {status:'submitted'};}}),/模型连接已变化/);
 assert.equal(calls,1,'no new model call or fallback replay is allowed after revocation between tool rounds');
});

test('the internal synchronous authorizer and fetch have no intervening microtask admission gap',async t=>{
 const previous=globalThis.fetch;let admitted=false,called=false;t.after(()=>{globalThis.fetch=previous;});
 globalThis.fetch=async()=>{called=true;assert.equal(admitted,true);return new Response(JSON.stringify({status:'completed',output_text:'same-turn admission'}),{headers:{'Content-Type':'application/json'}});};
 const runtime={...provider,authorize(){admitted=true;queueMicrotask(()=>{admitted=false;});}};
 assert.equal((await streamProvider({provider:runtime,messages:[{role:'user',content:'once'}]})).text,'same-turn admission');assert.equal(called,true);
});
