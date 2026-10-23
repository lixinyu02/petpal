import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

const moduleUrl=source=>'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText).toString('base64');
const nativeUrl=moduleUrl(await readFile(new URL('../src/auth/native-fetch.ts',import.meta.url),'utf8'));
let source=(await readFile(new URL('../src/api.ts',import.meta.url),'utf8')).replaceAll("'./auth/native-fetch'",JSON.stringify(nativeUrl));
for(const name of ['connection-targets','request-scope'])source=source.replaceAll(`'./auth/${name}.mjs'`,JSON.stringify(new URL(`../src/auth/${name}.mjs`,import.meta.url).href));
for(const name of ['speech-stream','speech-emotion'])source=source.replaceAll(`'./avatar/${name}.mjs'`,JSON.stringify(new URL(`../src/avatar/${name}.mjs`,import.meta.url).href));
let revision=0;
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const state=(userId='member',history=false)=>({instanceId:'fixture-host',user:{id:userId},settings:{petName:'Fixture',companionKind:'anime'},providers:[],conversations:history?[{id:'fixture-conversation'}]:[],codex:{}});

test('verified startup warmups preserve authentication, cancellation and one-use freshness',async t=>{
  const keys=['window','location','history','sessionStorage','fetch'],originals=new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const install=(key,value)=>Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  const disk=new Map(),window=new EventTarget();window.speechSynthesis={cancel(){}};
  install('window',window);install('location',{hash:'',pathname:'/',search:'',origin:'https://fixture.example'});install('history',{replaceState(){}});
  install('sessionStorage',{getItem:key=>disk.get(key)??null,setItem:(key,value)=>disk.set(key,value),removeItem:key=>disk.delete(key)});
  async function fixture(t,{verified=true}={}){
    const api=await import(moduleUrl(source+`\n// warm fixture ${++revision}`)),calls=[];
    let handler=async url=>json(state('member',url.includes('/state')));
    install('fetch',(url,options)=>{calls.push({url,signal:options.signal});return handler(url,options);});
    await api.setConnection({url:'https://fixture.example',token:'synthetic-member-token'},'session');
    if(verified){await api.api('/auth/me');calls.length=0;}
    t.after(()=>api.setConnection({url:'https://fixture.example',token:''},'none'));
    return{api,calls,respond:next=>{handler=next;}};
  }
  try{
    await t.test('a restored token cannot start private warm IO before verified identity',async t=>{
      const f=await fixture(t,{verified:false});f.api.warmInitialState();f.api.warmInitialState({history:true});await flush();
      assert.equal(f.calls.length,0);assert.equal(f.api.getIdentity(),null);
      await f.api.api('/auth/me');f.calls.length=0;f.api.warmInitialState();f.api.warmInitialState();await flush();
      assert.equal(f.calls.length,1);assert.equal(f.calls[0].url,'https://fixture.example/api/bootstrap');
      assert.deepEqual(await f.api.loadInitialState(),state());assert.equal(f.calls.length,1);
      await f.api.loadInitialState();assert.equal(f.calls.length,2,'a successful read consumes its prefetched snapshot');
    });
    await t.test('home and workbench preserve their separate bootstrap and history requests',async t=>{
      const f=await fixture(t);f.api.warmInitialState();f.api.warmInitialState({history:true});await flush();
      assert.equal(f.calls.length,2);
      assert.deepEqual(await f.api.loadInitialState({history:true}),state('member',true));
      assert.deepEqual(await f.api.loadInitialState(),state());assert.equal(f.calls.length,2);
      assert.deepEqual(f.calls.map(call=>call.url),['https://fixture.example/api/bootstrap','https://fixture.example/api/state?runtime=deferred']);
    });
    await t.test('StrictMode unmount cancels only its reader and the remount reuses warm IO',async t=>{
      const f=await fixture(t),gate=deferred(),reason=new Error('fixture unmounted');f.respond(()=>gate.promise);
      f.api.warmInitialState();const abandoned=new AbortController(),first=f.api.loadInitialState({signal:abandoned.signal});
      abandoned.abort(reason);await assert.rejects(first,error=>error===reason);assert.equal(f.calls[0].signal.aborted,false);
      const second=f.api.loadInitialState();gate.resolve(json(state()));assert.deepEqual(await second,state());assert.equal(f.calls.length,1);
    });
    await t.test('a reader deadline does not cancel the owner or prevent another reader',async t=>{
      const f=await fixture(t),gate=deferred();f.respond(()=>gate.promise);f.api.warmInitialState();
      await assert.rejects(f.api.loadInitialState({timeoutMs:10}),/加载个人设置超时/);assert.equal(f.calls[0].signal.aborted,false);
      const next=f.api.loadInitialState();gate.resolve(json(state()));await next;assert.equal(f.calls.length,1);
    });
    await t.test('completed snapshots are actively evicted at five seconds even if Date does not advance',async t=>{
      const f=await fixture(t);t.mock.timers.enable({apis:['setTimeout']});
      f.api.warmInitialState();await flush();assert.equal(f.calls.length,1);
      t.mock.timers.tick(5000);await f.api.loadInitialState();assert.equal(f.calls.length,2,'timer eviction, not a later freshness check, releases the completed entry');
    });
    await t.test('the warm owner has a fifteen second deadline even when transport ignores abort',async t=>{
      const f=await fixture(t),gate=deferred();t.mock.timers.enable({apis:['setTimeout']});f.respond(()=>gate.promise);
      f.api.warmInitialState();const reading=f.api.loadInitialState(),rejected=assert.rejects(reading,/加载个人设置超时/);
      t.mock.timers.tick(15000);await rejected;assert.equal(f.calls[0].signal.aborted,true);
      f.respond(async()=>json(state()));await f.api.loadInitialState();assert.equal(f.calls.length,2);
      gate.resolve(json(state()));await flush();
    });
    await t.test('prefetch failure evicts before mount, while a consuming reader sees its original failure without retry',async t=>{
      const f=await fixture(t),failure=new TypeError('fixture network unavailable');f.respond(async()=>{throw failure;});
      f.api.warmInitialState();await flush();f.respond(async()=>json(state()));await f.api.loadInitialState();assert.equal(f.calls.length,2);
      const gate=deferred();f.respond(()=>gate.promise);f.api.warmInitialState();const reading=f.api.loadInitialState();gate.reject(failure);
      await assert.rejects(reading,error=>error===failure);assert.equal(f.calls.length,3);
      f.respond(async()=>json(state()));await f.api.loadInitialState();assert.equal(f.calls.length,4);
    });
    await t.test('only an absent bootstrap falls back and deferred history is never replaced by home state',async t=>{
      const f=await fixture(t);f.respond(async url=>url.endsWith('/bootstrap')?json({error:'missing'},404):json(state('member',true)));
      f.api.warmInitialState();assert.deepEqual(await f.api.loadInitialState(),state('member',true));
      assert.deepEqual(f.calls.map(call=>call.url),['https://fixture.example/api/bootstrap','https://fixture.example/api/state']);
      f.respond(async()=>json({error:'state missing'},404));f.api.warmInitialState({history:true});
      await assert.rejects(f.api.loadInitialState({history:true}),error=>error.status===404);assert.equal(f.calls.length,3);
    });
    await t.test('an account change cancels warm readers before ignored-abort transport settles and late JSON is discarded',async t=>{
      const f=await fixture(t),gate=deferred();f.respond(()=>gate.promise);f.api.warmInitialState();
      const reading=f.api.loadInitialState(),rejected=assert.rejects(reading,f.api.SessionChangedError);
      await f.api.setConnection({url:'https://another.example',token:'synthetic-new-token'},'session');await rejected;
      assert.equal(f.calls[0].signal.aborted,true);assert.equal(f.api.getIdentity(),null);
      gate.resolve(json(state('previous-user')));await flush();assert.equal(f.api.getIdentity(),null);
      f.respond(async()=>json(state('new-user')));await f.api.loadInitialState();assert.equal(f.api.getIdentity().userId,'new-user');
    });
    await t.test('identity replacement within one epoch invalidates pending and completed warm snapshots',async t=>{
      const f=await fixture(t),gate=deferred(),epoch=f.api.getSessionEpoch();f.respond(url=>url.endsWith('/auth/me')?Promise.resolve(json(state('replacement'))):gate.promise);
      f.api.warmInitialState();const reading=f.api.loadInitialState(),rejected=assert.rejects(reading,f.api.SessionChangedError);
      await f.api.api('/auth/me');await rejected;assert.equal(f.api.getSessionEpoch(),epoch);assert.equal(f.calls[0].signal.aborted,true);
      gate.resolve(json(state('member')));await flush();assert.equal(f.api.getIdentity().userId,'replacement');
      f.respond(async()=>json(state('replacement')));f.api.warmInitialState();await flush();
      f.respond(async()=>json(state('third-user')));await f.api.api('/auth/me');
      await f.api.loadInitialState();assert.equal(f.api.getIdentity().userId,'third-user');assert.equal(f.calls.length,5);
    });
    await t.test('an unauthorized warm response clears login and cannot provide startup data',async t=>{
      const f=await fixture(t);f.respond(async()=>json({error:'expired'},401));f.api.warmInitialState();
      await assert.rejects(f.api.loadInitialState());assert.equal(f.api.getConnection().token,'');assert.equal(f.api.getIdentity(),null);assert.equal(f.calls.length,1);
      f.api.warmInitialState();await flush();assert.equal(f.calls.length,1);
    });
    await t.test('pre-cancelled readers leave warm data available and issue no extra fetch',async t=>{
      const f=await fixture(t),reason=new Error('already cancelled');f.api.warmInitialState();await flush();
      const cancelled=new AbortController();cancelled.abort(reason);
      await assert.rejects(f.api.loadInitialState({signal:cancelled.signal}),error=>error===reason);
      assert.deepEqual(await f.api.loadInitialState(),state());assert.equal(f.calls.length,1);
    });
  }finally{for(const[key,descriptor]of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
});
