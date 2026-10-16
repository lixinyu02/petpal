import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
const source=ts.transpileModule(await readFile(new URL('../src/platform/android-official-account.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
function fixture({available=true,bind,verified=true,connected=true,runtime}={}){
  const document=new EventTarget(),window=new EventTarget(),watchers=new Set(),calls=[];document.hidden=false;
  let epoch=1,identity=verified?{instanceId:'server-a',userId:'alice'}:null,connection={url:'https://server.example',token:connected?'petpal-session':''};
  class SessionChangedError extends Error{}
  runtime??={status:{supported:true,state:'signed-out',activeProfileId:null,planUsageEnabled:false,profiles:[],models:[]},binding:0,key:'',scopeId:''};
  const status=runtime.status;
  let statusListener;
  const native={bind:async value=>{calls.push({action:'bind',value});const key=`${value.url}:${value.instanceId}:${value.userId}`;if(runtime.key!==key){runtime.key=key;runtime.scopeId=`scope-${++runtime.binding}`;}return bind?bind(value,runtime.scopeId):{scopeId:runtime.scopeId,status};},clearScope:async()=>{calls.push({action:'clearScope'});runtime.key='';runtime.scopeId='';status.state='signed-out';},async addListener(event,listener){assert.equal(event,'status');statusListener=listener;return{async remove(){if(statusListener===listener)statusListener=undefined;}};}};
  for(const action of ['status','start','cancel','select','logout','refresh','resumeUsage'])native[action]=async value=>{calls.push({action,value});if(action==='start')status.state='signing-in';return structuredClone(status);};
  const api={getConnection:()=>connection,getIdentity:()=>identity,getSessionEpoch:()=>epoch,subscribeSession:watcher=>{watchers.add(watcher);return()=>watchers.delete(watcher);},SessionChangedError};
  const capacitor={Capacitor:{isNativePlatform:()=>true,getPlatform:()=> 'android',isPluginAvailable:()=>available},registerPlugin:name=>{assert.equal(name,'PetOfficialAccount');return native;}};
  const module={exports:{}};vm.runInNewContext(source,{module,exports:module.exports,document,window,Event,location:{origin:'https://localhost'},Promise,Error,require:name=>name==='@capacitor/core'?capacitor:api});
  return{session:module.exports,calls,SessionChangedError,status,runtime,window,document,emitStatus(){statusListener?.();},async flush(){for(let n=0;n<20;n++)await Promise.resolve();},verify(userId='alice'){identity={instanceId:'server-a',userId};for(const watcher of watchers)watcher();},change(userId,url=connection.url){epoch++;identity=userId?{instanceId:'server-a',userId}:null;connection={url,token:userId?'new-session':''};for(const watcher of watchers)watcher();},get watcherCount(){return watchers.size;}};
}
test('Android binds once to the verified PetPal scope and does not expose native credentials',async()=>{
  const f=fixture(),bridge=f.session.androidOfficialAccount();
  await bridge.status();await bridge.refresh();await bridge.start({profileId:'profile-a'});await bridge.select('profile-b');
  assert.equal(f.calls.filter(call=>call.action==='bind').length,1);
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls.at(-1))),{action:'select',value:{scopeId:'scope-1',profileId:'profile-b'}});
  assert.equal(f.session.supportsAndroidOfficialAccount(),true);
  f.change(null);await assert.rejects(bridge.status(),/先登录/);
});
test('missing native plugin keeps old Android clients unsupported',()=>{const f=fixture({available:false});assert.equal(f.session.androidOfficialAccount(),undefined);});
test('session switch immediately revokes binding and ignores a late old account',async()=>{
  const old=deferred(),f=fixture({bind:(_value,scopeId)=>scopeId==='scope-1'?old.promise:{scopeId,status:{}}});
  const unmount=f.session.mountAndroidOfficialSession();await f.flush();
  const reading=f.session.androidOfficialAccount().status();await f.flush();f.change('bob');await f.flush();
  old.resolve({scopeId:'old-scope',status:f.status});await assert.rejects(reading,f.SessionChangedError);
  await f.session.androidOfficialAccount().status();assert.equal(f.calls.at(-1).value.scopeId,'scope-2');
  unmount();assert.equal(f.watcherCount,0);assert.equal(f.calls.filter(call=>call.action==='clearScope').length,1);
});
test('a failed bind can retry without retaining a permanently pending scope',async()=>{
  let first=true;const f=fixture({bind:(_value,scopeId)=>{if(first){first=false;throw new Error('offline');}return{scopeId,status:{}};}});
  const bridge=f.session.androidOfficialAccount();await assert.rejects(bridge.status(),/offline/);await bridge.status();assert.equal(f.calls.filter(call=>call.action==='bind').length,2);assert.equal(f.calls.at(-1).value.scopeId,'scope-1');
});
test('native connection changes notify the UI only while the session lifecycle is mounted',async()=>{
  const f=fixture();let notified=0;f.window.addEventListener('petpal:official-native-change',()=>notified++);
  const close=f.session.mountAndroidOfficialSession();await f.flush();f.emitStatus();assert.equal(notified,1);
  close();f.emitStatus();assert.equal(notified,1);
});

test('the first verified mount binds the same owner without clearing a pending native authorization',async()=>{
  const f=fixture();f.status.state='signing-in';
  const close=f.session.mountAndroidOfficialSession();await f.flush();
  assert.deepEqual(f.calls.map(call=>call.action),['bind']);
  assert.equal((await f.session.androidOfficialAccount().status()).state,'signing-in');
  close();assert.equal(f.calls.some(call=>call.action==='clearScope'),false);
});

test('fresh Activity JS waits for restored identity and reuses the native pending scope',async()=>{
  const first=fixture(),close=first.session.mountAndroidOfficialSession();await first.flush();
  await first.session.androidOfficialAccount().start();const scopeId=first.runtime.scopeId;
  close();
  // A new WebView module has neither the old JS scope nor verified /auth/me yet.
  const restored=fixture({verified:false,runtime:first.runtime}),stop=restored.session.mountAndroidOfficialSession();await restored.flush();
  assert.deepEqual(restored.calls,[]);assert.equal(restored.status.state,'signing-in');
  restored.verify();await restored.flush();
  assert.deepEqual(restored.calls.map(call=>call.action),['bind']);
  assert.equal(restored.runtime.scopeId,scopeId);
  assert.equal((await restored.session.androidOfficialAccount().status()).state,'signing-in');
  stop();
});

test('confirmed absence of saved credentials clears native state exactly once across StrictMode remount',async()=>{
  const f=fixture({verified:false,connected:false});f.status.state='signing-in';
  const first=f.session.mountAndroidOfficialSession();await f.flush();first();
  const second=f.session.mountAndroidOfficialSession();await f.flush();
  assert.deepEqual(f.calls.map(call=>call.action),['clearScope']);
  assert.equal(f.status.state,'signed-out');second();
});

test('StrictMode cleanup and immediate remount preserve a pending bind and its native attempt',async()=>{
  const gate=deferred(),f=fixture({bind:()=>gate.promise});
  const close=f.session.mountAndroidOfficialSession();await f.flush();
  const reading=f.session.androidOfficialAccount().status();close();
  const stop=f.session.mountAndroidOfficialSession();await f.flush();
  assert.deepEqual(f.calls.map(call=>call.action),['bind']);
  f.status.state='signing-in';gate.resolve({scopeId:'scope-1',status:f.status});
  assert.equal((await reading).state,'signing-in');stop();
  assert.equal(f.calls.some(call=>call.action==='clearScope'),false);
});

test('logout and switching a server revoke immediately and ignore a late binding',async()=>{
  for(const replacement of [null,'alice']){
    const gate=deferred(),f=fixture({bind:(_value,scopeId)=>scopeId==='scope-1'?gate.promise:{scopeId,status:{}}});
    const close=f.session.mountAndroidOfficialSession();await f.flush();
    const reading=f.session.androidOfficialAccount().status();await f.flush();
    f.change(replacement,'https://different.example');
    assert.equal(f.calls.at(-1).action,'clearScope','revocation does not wait for native bind');
    gate.resolve({scopeId:'late-old-scope',status:f.status});await assert.rejects(reading,f.SessionChangedError);await f.flush();
    if(replacement){await f.session.androidOfficialAccount().status();assert.equal(f.calls.at(-1).value.scopeId,'scope-2');}
    else assert.equal(f.calls.some(call=>call.action==='status'),false);
    close();
  }
});

test('a session changed during a detached page is revoked before a new owner binds',async()=>{
  const f=fixture(),close=f.session.mountAndroidOfficialSession();await f.flush();close();
  f.change('bob');const stop=f.session.mountAndroidOfficialSession();await f.flush();
  assert.deepEqual(f.calls.map(call=>call.action),['bind','clearScope','bind']);
  assert.equal(f.calls.at(-1).value.userId,'bob');stop();
});
