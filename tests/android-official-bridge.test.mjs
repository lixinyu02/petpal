import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
const source=ts.transpileModule(await readFile(new URL('../src/platform/android-official-account.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
function fixture({available=true,bind}={}){
  const document=new EventTarget(),window=new EventTarget(),watchers=new Set(),calls=[];document.hidden=false;
  let epoch=1,identity={instanceId:'server-a',userId:'alice'},connection={url:'https://server.example',token:'petpal-session'},binding=0;
  class SessionChangedError extends Error{}
  const status={supported:true,state:'signed-out',activeProfileId:null,planUsageEnabled:false,profiles:[],models:[]};
  let statusListener;
  const native={bind:async value=>{calls.push({action:'bind',value});const scopeId=`scope-${++binding}`;return bind?bind(value,scopeId):{scopeId,status};},clearScope:async()=>{calls.push({action:'clearScope'});},async addListener(event,listener){assert.equal(event,'status');statusListener=listener;return{async remove(){statusListener=undefined;}};}};
  for(const action of ['status','start','cancel','select','logout','refresh','resumeUsage'])native[action]=async value=>{calls.push({action,value});return structuredClone(status);};
  const api={getConnection:()=>connection,getIdentity:()=>identity,getSessionEpoch:()=>epoch,subscribeSession:watcher=>{watchers.add(watcher);return()=>watchers.delete(watcher);},SessionChangedError};
  const capacitor={Capacitor:{isNativePlatform:()=>true,getPlatform:()=> 'android',isPluginAvailable:()=>available},registerPlugin:name=>{assert.equal(name,'PetOfficialAccount');return native;}};
  const module={exports:{}};vm.runInNewContext(source,{module,exports:module.exports,document,window,Event,location:{origin:'https://localhost'},Promise,Error,require:name=>name==='@capacitor/core'?capacitor:api});
  return{session:module.exports,calls,SessionChangedError,status,window,emitStatus(){statusListener?.();},async flush(){for(let n=0;n<20;n++)await Promise.resolve();},change(userId){epoch++;identity=userId?{instanceId:'server-a',userId}:null;connection={...connection,token:userId?'new-session':''};for(const watcher of watchers)watcher();},get watcherCount(){return watchers.size;}};
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
  unmount();assert.equal(f.watcherCount,0);assert.equal(f.calls.at(-1).action,'clearScope');
});
test('a failed bind can retry without retaining a permanently pending scope',async()=>{
  let first=true;const f=fixture({bind:(_value,scopeId)=>{if(first){first=false;throw new Error('offline');}return{scopeId,status:{}};}});
  const bridge=f.session.androidOfficialAccount();await assert.rejects(bridge.status(),/offline/);await bridge.status();assert.equal(f.calls.at(-1).value.scopeId,'scope-2');
});
test('native connection changes notify the UI only while the session lifecycle is mounted',async()=>{
  const f=fixture();let notified=0;f.window.addEventListener('petpal:official-native-change',()=>notified++);
  const close=f.session.mountAndroidOfficialSession();await f.flush();f.emitStatus();assert.equal(notified,1);
  close();f.emitStatus();assert.equal(notified,1);
});
