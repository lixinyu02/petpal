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
const fresh=()=>import(moduleUrl(source+`\n// fixture ${++revision}`));
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const record=(token='synthetic-saved-token',url='https://saved.example')=>({url,token,credentialKind:'session',target:'remote'});

test('Android encrypted-session integration keeps authentication and storage in the same account epoch',async t=>{
  const keys=['window','location','history','sessionStorage','fetch'],originals=new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const install=(key,value)=>Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  const disk=new Map(),window=new EventTarget();window.speechSynthesis={cancel(){}};
  install('window',window);install('location',{hash:'',pathname:'/',search:'',origin:'https://localhost'});install('history',{replaceState(){}});
  install('sessionStorage',{getItem:key=>disk.get(key)??null,setItem:(key,value)=>disk.set(key,value),removeItem:key=>disk.delete(key)});
  const fixture=(saved=null)=>{
    disk.clear();delete window.petpal;let stored=saved,generation=0,blocked;
    const calls=[];
    window.petpalLoginSession={
      async read(){calls.push(['read']);return{connection:stored};},
      async write(value){const current=++generation;calls.push(['write',structuredClone(value)]);if(blocked)await blocked.promise;if(current!==generation)throw new Error('superseded native write');stored=structuredClone(value);},
      async clear(){generation++;calls.push(['clear']);stored=null;},
    };
    return{calls,stored:()=>stored,block(){blocked=deferred();return blocked;}};
  };
  try{
    await t.test('a cold start restores native storage before validation without needing WebView sessionStorage',async()=>{
      const f=fixture(record()),api=await fresh();await api.initConnection('https://default.example');
      assert.deepEqual(api.getConnection(),{url:'https://saved.example',token:'synthetic-saved-token'});assert.equal(api.getIdentity(),null);assert.deepEqual(f.calls,[['read']]);
      install('fetch',async(url,options)=>{assert.equal(url,'https://saved.example/api/auth/me');assert.equal(options.headers.get('Authorization'),'Bearer synthetic-saved-token');return json({instanceId:'server-fixture',user:{id:'alice'}});});
      await api.api('/auth/me');assert.deepEqual(api.getIdentity(),{instanceId:'server-fixture',userId:'alice'});
    });
    await t.test('login is not published until its durable native write completes and never stores the password',async()=>{
      const f=fixture(),api=await fresh();await api.initConnection('https://saved.example');const wait=f.block();
      install('fetch',async()=>json({token:'synthetic-new-login'}));let settled=false;
      const pending=api.login('https://saved.example','alice','never-persist-this-password').then(()=>{settled=true;});await flush();
      assert.equal(settled,false);assert.equal(api.getConnection().token,'');assert.equal(f.stored(),null);assert.deepEqual(Object.keys(f.calls.at(-1)[1]).sort(),['credentialKind','target','token','url']);assert.equal(JSON.stringify(f.calls).includes('never-persist-this-password'),false);
      wait.resolve();await pending;assert.equal(api.getConnection().token,'synthetic-new-login');assert.equal(f.stored().credentialKind,'session');
    });
    await t.test('a pairing login also waits for durable storage and only then accepts identity',async()=>{
      const f=fixture(),api=await fresh();await api.initConnection('https://saved.example');const wait=f.block();
      install('fetch',async()=>json({instanceId:'server-fixture',user:{id:'alice'}}));const pending=api.connectWithToken({url:'https://saved.example',token:'synthetic-pairing-token'});await flush();
      assert.equal(api.getIdentity(),null);assert.equal(api.getConnection().token,'');wait.resolve();await pending;assert.equal(api.getIdentity().userId,'alice');assert.equal(f.stored().credentialKind,'pairing');
    });
    await t.test('failed storage cannot report a successful login or replace an established account',async()=>{
      const f=fixture(record()),api=await fresh();await api.initConnection();const wait=f.block();install('fetch',async()=>json({token:'synthetic-other-token'}));
      const pending=api.login('https://other.example','bob','synthetic-password');await flush();wait.reject(new Error('secure storage unavailable'));await assert.rejects(pending,/secure storage unavailable/);
      assert.equal(api.getConnection().token,'synthetic-saved-token');assert.equal(f.stored().token,'synthetic-saved-token');
    });
    for(const action of ['logout','new-login'])await t.test(`late native restoration cannot overwrite ${action}`,async()=>{
      fixture();const wait=deferred();window.petpalLoginSession.read=()=>wait.promise;const api=await fresh(),pending=api.initConnection('https://default.example');await flush();
      if(action==='logout')await api.logout();else{install('fetch',async()=>json({token:'synthetic-current-token'}));await api.login('https://current.example','bob','synthetic-password');}
      wait.resolve({connection:record()});await pending;assert.equal(api.getConnection().token,action==='logout'?'':'synthetic-current-token');
    });
    await t.test('logout invalidates an in-flight durable login instead of resurrecting it later',async()=>{
      const f=fixture(),api=await fresh();await api.initConnection('https://saved.example');const wait=f.block();install('fetch',async()=>json({token:'synthetic-pending-login'}));
      const pending=api.login('https://saved.example','alice','synthetic-password');const rejected=assert.rejects(pending);await flush();await api.logout();wait.resolve();await rejected;assert.equal(api.getConnection().token,'');assert.equal(f.stored(),null);
    });
    await t.test('two same-epoch logins cannot leave the vault and rendered account with different tokens',async()=>{
      fixture();let saved=null;const firstWrite=deferred(),secondWrite=deferred(),writes=[];
      window.petpalLoginSession.write=async value=>{saved=structuredClone(value);writes.push(value.token);await(value.token==='synthetic-login-a'?firstWrite.promise:secondWrite.promise);};
      const api=await fresh();await api.initConnection('https://saved.example');install('fetch',async(_url,options)=>json({token:JSON.parse(options.body).username==='alice'?'synthetic-login-a':'synthetic-login-b'}));
      const first=api.login('https://saved.example','alice','synthetic-password'),second=api.login('https://saved.example','bob','synthetic-password');
      const rejected=assert.rejects(second,api.SessionChangedError);await flush();firstWrite.resolve();await first;secondWrite.resolve();await rejected;
      assert.equal(saved.token,api.getConnection().token);assert.deepEqual(writes,['synthetic-login-a']);
    });
    await t.test('failed logout storage clearing closes the session and emits a fixed visible persistence error',async()=>{
      fixture(record());const api=await fresh();await api.initConnection();const notifications=[],listener=()=>notifications.push(api.getLoginPersistenceError());window.addEventListener('petpal:login-persistence-error',listener);
      try{window.petpalLoginSession.clear=async()=>{throw new Error('private-native-clear-error');};await assert.rejects(api.logout());assert.equal(api.getConnection().token,'');assert.match(api.getLoginPersistenceError(),/无法清除|未能清除/);assert.doesNotMatch(api.getLoginPersistenceError(),/private-native/);assert.equal(notifications.length,1);}finally{window.removeEventListener('petpal:login-persistence-error',listener);}
    });
    await t.test('a 401 still reports authorization failure when clearing the saved session also fails',async()=>{
      fixture(record());const api=await fresh();await api.initConnection();window.petpalLoginSession.clear=async()=>{throw new Error('private-native-clear-error');};install('fetch',async()=>json({error:'expired'},401));await assert.rejects(api.api('/auth/me'),error=>error.status===401&&error.message==='expired');assert.equal(api.getConnection().token,'');assert.match(api.getLoginPersistenceError(),/无法清除|未能清除/);
    });
    await t.test('a late clear failure cannot overwrite a newer successful login or publish its warning',async()=>{
      fixture(record());const api=await fresh();await api.initConnection();const wait=deferred();window.petpalLoginSession.clear=()=>wait.promise;const clearing=api.logout(),rejected=assert.rejects(clearing);install('fetch',async()=>json({token:'synthetic-new-after-logout'}));await api.login('https://saved.example','bob','synthetic-password');wait.reject(new Error('private-old-clear-error'));await rejected;assert.equal(api.getConnection().token,'synthetic-new-after-logout');assert.equal(api.getLoginPersistenceError(),'');
    });
    await t.test('logout bypasses a delayed write callback and a new login can complete before that callback',async()=>{
      fixture();let saved=null;const old=deferred();window.petpalLoginSession.write=async value=>{saved=structuredClone(value);if(value.token==='synthetic-delayed-old')await old.promise;};window.petpalLoginSession.clear=async()=>{saved=null;};const api=await fresh();await api.initConnection('https://saved.example');
      install('fetch',async(_url,options)=>json({token:JSON.parse(options.body||'{}').username==='alice'?'synthetic-delayed-old':'synthetic-current'}));const previous=api.login('https://saved.example','alice','synthetic-password'),rejected=assert.rejects(previous,api.SessionChangedError);await flush();await api.logout();await api.login('https://saved.example','bob','synthetic-password');assert.equal(saved.token,'synthetic-current');old.resolve();await rejected;assert.equal(api.getConnection().token,'synthetic-current');assert.equal(saved.token,'synthetic-current');
    });
    await t.test('retrying a failed clear removes its warning while keeping the session closed',async()=>{
      fixture(record());const api=await fresh();await api.initConnection();const clear=window.petpalLoginSession.clear;window.petpalLoginSession.clear=async()=>{throw new Error('synthetic-clear-failure');};await assert.rejects(api.logout());assert.match(api.getLoginPersistenceError(),/未能清除/);window.petpalLoginSession.clear=clear;await api.clearSavedLogin();assert.equal(api.getLoginPersistenceError(),'');assert.equal(api.getConnection().token,'');
    });
    await t.test('the current session 401 clears durable login while offline and server errors retain it',async()=>{
      const f=fixture(record()),api=await fresh();await api.initConnection();install('fetch',async()=>{throw new Error('offline');});await assert.rejects(api.api('/auth/me'),/offline/);assert.equal(f.stored().token,'synthetic-saved-token');
      install('fetch',async()=>json({error:'server unavailable'},503));await assert.rejects(api.api('/auth/me'),/server unavailable/);assert.equal(f.stored().token,'synthetic-saved-token');
      install('fetch',async()=>json({error:'expired'},401));await assert.rejects(api.api('/auth/me'),/expired/);assert.equal(api.getConnection().token,'');assert.equal(f.stored(),null);
    });
    await t.test('legacy same-page login migrates once to the native vault',async()=>{
      const f=fixture();disk.set('petpal.connection',JSON.stringify(record()));const api=await fresh();await api.initConnection();assert.equal(api.getConnection().token,'synthetic-saved-token');assert.equal(f.stored().token,'synthetic-saved-token');assert.deepEqual(f.calls.map(value=>value[0]),['read','write']);
    });
    await t.test('a broken vault never falls back to a stale mirror and explicit login can replace it',async()=>{
      const f=fixture();disk.set('petpal.connection',JSON.stringify(record()));window.petpalLoginSession.read=async()=>{throw new Error('corrupt ciphertext');};const api=await fresh();await api.initConnection('https://default.example');assert.equal(api.getConnection().token,'');assert.match(api.getLoginPersistenceError(),/无法恢复/);assert.equal(f.calls.length,0);
      install('fetch',async()=>json({token:'synthetic-replacement'}));await api.login('https://default.example','alice','synthetic-password');assert.equal(api.getLoginPersistenceError(),'');assert.equal(f.stored().token,'synthetic-replacement');
    });
    await t.test('Web and desktop without the Android bridge retain their session-only behavior',async()=>{
      fixture();delete window.petpalLoginSession;const api=await fresh();await api.initConnection('https://web.example');install('fetch',async()=>json({token:'synthetic-web-token'}));await api.login('https://web.example','alice','synthetic-password');
      assert.equal(JSON.parse(disk.get('petpal.connection')).token,'synthetic-web-token');disk.clear();const restarted=await fresh();await restarted.initConnection('https://web.example');assert.equal(restarted.getConnection().token,'');
    });
  }finally{for(const[key,value]of originals){if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];}}
});
