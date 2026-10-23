import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import * as policy from '../src/platform/android-permission-policy.mjs';
import * as guides from '../src/platform/background-settings-guide.mjs';
import {createDevicePreferences} from '../src/media/device-preferences.mjs';

const source=ts.transpileModule(await readFile(new URL('../src/AndroidPermissionsSettings.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'?[value,...nodes(value.props?.children)]:[];
const text=value=>Array.isArray(value)?value.map(text).join(' '):typeof value==='string'?value:value&&typeof value==='object'?text(value.props?.children):'';
const initial=()=>({device:{brand:'HONOR',model:'Magic7',androidRelease:'16',apiLevel:36},microphone:{state:'prompt',supported:true,blocked:null},camera:{state:'settings',supported:true,blocked:null},notifications:{runtimeGranted:false,enabled:false,channels:Object.fromEntries(['task','companion','watch','overlay'].map(key=>[key,{created:true,enabled:key!=='task'}]))},overlay:{granted:false,supported:true},install:{granted:false,supported:true},battery:{exempt:false},routes:Object.fromEntries(policy.ANDROID_PERMISSION_SETTINGS.map(key=>[key,{available:true}]))});
function fixture({connected=true,native=true,available=true,read=async()=>initial(),media=async()=>({getTracks:()=>[]})}={}){
  const hooks=[],effects=[],frames=new Map(),reads=[],opens=[],captures=[],listeners=new Map();let index=0,frameId=0,dirty=false,mounted=true,tree,epoch=1,user='user',lateUpdates=0;
  const identity=()=>({instanceId:'host',userId:user});
  const same=(a,b)=>a&&b&&a.length===b.length&&a.every((entry,at)=>Object.is(entry,b[at]));
  const react={
    useState(value){const at=index++;hooks[at]||={value:typeof value==='function'?value():value};return [hooks[at].value,next=>{if(!mounted)lateUpdates++;hooks[at].value=typeof next==='function'?next(hooks[at].value):next;dirty=true;}];},
    useRef(value){const at=index++;hooks[at]||={ref:{current:value}};return hooks[at].ref;},
    useSyncExternalStore(_subscribe,snapshot){index++;return snapshot();},
    useEffect(action,deps){const at=index++,previous=hooks[at];if(!same(previous?.deps,deps))effects.push(()=>{previous?.cleanup?.();hooks[at]={deps,cleanup:action()};});},
  };
  const events=prefix=>({addEventListener(name,fn){const key=prefix+name;if(!listeners.has(key))listeners.set(key,new Set());listeners.get(key).add(fn);},removeEventListener(name,fn){listeners.get(prefix+name)?.delete(fn);}});
  const document={hidden:false,...events('d:')},storage=new Map();
  const window={isSecureContext:true,localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},...events('w:')};
  const bridge={async status(){reads.push(true);return read(reads.length);},async openSettings(input){opens.push(input);return {opened:true,kind:input.kind,route:'android-app-details',fallback:true};}};
  const modules={react,'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},'lucide-react':new Proxy({},{get:(_,name)=>String(name)}),'./api':{getIdentity:identity,getSessionEpoch:()=>epoch,subscribeSession:()=>()=>{}},'./media/device-preferences.mjs':{createDevicePreferences},'./media/devices':{mediaFailure:failure=>failure.message},'./platform/android-permissions':{PetPermissions:bridge,supportsAndroidPermissions:()=>native,hasAndroidPermissionsBridge:()=>available},'./platform/android-permission-policy.mjs':policy,'./platform/background-settings-guide.mjs':guides};
  const module={exports:{}};
  vm.runInNewContext(source,{module,exports:module.exports,window,document,AbortController,setTimeout,clearTimeout,navigator:{mediaDevices:{getUserMedia:constraints=>{captures.push(constraints);return media(constraints);}}},requestAnimationFrame:fn=>{frames.set(++frameId,fn);return frameId;},cancelAnimationFrame:id=>frames.delete(id),require:name=>{if(name.endsWith('.css'))return {};assert.ok(Object.hasOwn(modules,name),name);return modules[name];}});
  const render=()=>{index=0;dirty=false;effects.length=0;tree=module.exports.default({connected});for(const effect of effects)effect();};
  const event=(name,target='w:')=>{for(const listener of listeners.get(target+name)||[])listener();};
  const flush=async()=>{for(let i=0;i<24;i++){await Promise.resolve();if(dirty&&mounted)render();if(frames.size){const pending=[...frames.values()];frames.clear();for(const fn of pending)fn();}}};
  render();
  return {reads,opens,captures,flush,window,document,event,get tree(){return tree;},get lateUpdates(){return lateUpdates;},text:()=>text(tree),
    click(label){const button=nodes(tree).find(node=>node.type==='button'&&text(node.props.children).replace(/\s/g,'')===label);assert.ok(button,`button ${label}`);assert.ok(!button.props.disabled,`${label} enabled`);button.props.onClick();},
    clickChannel(label){const channel=nodes(tree).find(node=>node.type==='div'&&node.props?.children?.[0]?.props?.children?.[0]?.props?.children===label);assert.ok(channel,label);const button=nodes(channel).find(node=>node.type==='button');button.props.onClick();},
    login(next){connected=next;render();},changeAccount(){epoch++;user='next';event('petpal:session-change');render();},
    hide(){document.hidden=true;event('visibilitychange','d:');},show(){document.hidden=false;event('visibilitychange','d:');event('focus');event('pageshow');},
    close(){mounted=false;for(const hook of hooks)hook?.cleanup?.();},
  };
}
test('permissions stay gated by login and native capability; older clients have an upgrade message',async t=>{
  for(const options of [{connected:false},{native:false},{available:false}]){
    const f=fixture(options);await f.flush();assert.equal(f.reads.length,0);assert.equal(f.captures.length,0);
    if(options.available===false)assert.match(f.text(),/升级客户端/);
    if(options.native===false)assert.equal(f.tree,null);f.close();
  }
});
test('native snapshot separates denied channel and install status, and overlay notification opens notifications',async t=>{
  const f=fixture();t.after(()=>f.close());await f.flush();assert.equal(f.reads.length,1);assert.equal(f.captures.length,0);
  assert.match(f.text(),/此通知类别已关闭/);assert.match(f.text(),/安装来源/);assert.match(f.text(),/HONOR Magic7/);
  f.clickChannel('悬浮伙伴');await f.flush();assert.deepEqual(JSON.parse(JSON.stringify(f.opens)),[{kind:'notifications'}]);assert.match(f.text(),/手动检查/);
});
test('foreground events coalesce and cannot request microphone or camera implicitly',async t=>{
  const f=fixture();t.after(()=>f.close());await f.flush();f.hide();f.event('focus');f.event('pageshow');await f.flush();assert.equal(f.reads.length,1);
  f.show();await f.flush();assert.equal(f.reads.length,2);assert.equal(f.captures.length,0);
});
test('account replacement ignores stale native status and removes old handlers',async t=>{
  const pending=deferred();const f=fixture({read:call=>call===1?pending.promise:Promise.resolve(initial())});t.after(()=>f.close());await f.flush();f.changeAccount();await f.flush();
  pending.resolve({...initial(),device:{brand:'STALE'}});await f.flush();assert.doesNotMatch(f.text(),/STALE/);assert.match(f.text(),/HONOR Magic7/);
});
test('late microphone grant after unmount releases all tracks without updating state',async()=>{
  const capture=deferred();let stops=0;const f=fixture({media:()=>capture.promise});await f.flush();f.click('允许麦克风');await f.flush();assert.equal(f.captures.length,1);
  assert.equal(f.captures[0].video,false);f.close();capture.resolve({getTracks:()=>[{stop(){stops++;}}]});await f.flush();assert.equal(stops,1);assert.equal(f.lateUpdates,0);
});
test('denial feedback survives automatic native status refresh',async t=>{
  const f=fixture({media:async()=>{throw new Error('fixture permission denied');}});t.after(()=>f.close());await f.flush();f.click('允许麦克风');await f.flush();
  assert.match(f.text(),/fixture permission denied/);assert.equal(f.reads.length,2);
});
