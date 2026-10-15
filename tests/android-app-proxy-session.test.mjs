import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import vm from 'node:vm';

const source=ts.transpileModule(await readFile(new URL('../src/platform/android-app-proxy.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
function fixture(){
  let epoch=1,identity={instanceId:'fixture-server',userId:'alice'},connection={url:'https://fixture.example',token:'fixture-session-not-real'},scope='',counter=0,slow;
  const callbacks=new Set(),calls=[],window=new EventTarget(),document=Object.assign(new EventTarget(),{hidden:false});
  const status=()=>({supported:true,unavailableReason:'',scope,platform:'android',abi:'arm64-v8a',version:'1.19.32',state:'stopped',running:false,configured:true,autoStart:false,remoteConfigured:false,remoteUpdatedAt:'',groups:[],error:''});
  const native={clearScope:async()=>{calls.push({action:'clear'});scope='';return status();},bindScope:async(input)=>{calls.push({action:'bind',...input});if(slow)await slow;scope='scope-'+(++counter);return status();},status:async()=>{calls.push({action:'status'});return status();},start:async(input)=>{calls.push({action:'start',...input});return {...status(),state:'running',running:true};}};
  const module={exports:{}};
  vm.runInNewContext(source,{module,exports:module.exports,window,document,location:{origin:'https://localhost'},Promise,Error,Object,Array,Set,require(name){if(name==='@capacitor/core')return{Capacitor:{isNativePlatform:()=>true,getPlatform:()=>'android',isPluginAvailable:()=>true},registerPlugin:()=>native};if(name==='../api')return{getConnection:()=>connection,getIdentity:()=>identity,getSessionEpoch:()=>epoch,subscribeSession:fn=>{callbacks.add(fn);return()=>callbacks.delete(fn);},SessionChangedError:class extends Error{}};throw Error(name);}});
  return{api:module.exports,calls,native,setSlow(value){slow=value;},async settle(){for(let i=0;i<25;i++)await Promise.resolve();},change(user='bob',url=connection.url){epoch++;identity=user?{instanceId:'fixture-server',userId:user}:null;connection={...connection,url};window.dispatchEvent(new Event('petpal:session-change'));for(const callback of callbacks)callback();}};
}
test('proxy lifecycle binds exact authenticated server and user and clears before account changes',async()=>{
  const f=fixture(),cleanup=f.api.mountAndroidAppProxyLifecycle();await f.settle();
  assert.deepEqual(f.calls.map(x=>x.action),['clear','bind']);assert.equal(f.calls[1].url,'https://fixture.example');assert.equal(f.calls[1].userId,'alice');
  f.change('bob','https://other.example');await f.settle();assert.deepEqual(f.calls.slice(-2).map(x=>x.action),['clear','bind']);assert.equal(f.calls.at(-1).url,'https://other.example');assert.equal(f.calls.at(-1).userId,'bob');
  f.change('');await f.settle();assert.equal(f.calls.at(-1).action,'clear');await assert.rejects(f.api.androidAppProxyAction('start'),/先登录/);cleanup();
});
test('a late binding from the previous login cannot start or return its proxy configuration',async()=>{
  const f=fixture();let finish;f.setSlow(new Promise(resolve=>{finish=resolve;}));const pending=f.api.androidAppProxyAction('start');await f.settle();f.change('bob');const cleanup=f.api.mountAndroidAppProxyLifecycle();finish();await assert.rejects(pending);await f.settle();assert.equal(f.calls.some(x=>x.action==='start'),false);cleanup();
});
test('status reader strips native YAML credentials unknown fields and untrusted error text',()=>{
  const f=fixture();const base={supported:true,unavailableReason:'',scope:'scope-test',platform:'android',abi:'arm64-v8a',version:'1.19.32',state:'stopped',running:false,configured:true,autoStart:false,remoteConfigured:true,remoteUpdatedAt:'2026-10-16T00:00:00.000Z',groups:[],error:'do not echo upstream data',yaml:'secret node configuration',url:'https://subscription.example/secret'};
  const result=f.api.readAndroidAppProxyStatus(base);assert.equal(Object.hasOwn(result,'yaml'),false);assert.equal(Object.hasOwn(result,'url'),false);assert.doesNotMatch(result.error,/upstream/);
  assert.throws(()=>f.api.readAndroidAppProxyStatus({...base,state:'running',running:false}),/状态不完整/);
  assert.throws(()=>f.api.readAndroidAppProxyStatus({...base,groups:[{name:'g',selected:'a',choices:['bad\nchoice']}]}),/节点状态不完整/);
});
