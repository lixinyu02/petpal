import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import * as guide from '../src/platform/background-settings-guide.mjs';

const compile=async file=>ts.transpileModule(await readFile(new URL(file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
const source=await compile('../src/TaskNotificationsSettings.tsx');
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):!tree||typeof tree!=='object'?[]:[tree,...nodes(tree.props?.children)];
const text=tree=>Array.isArray(tree)?tree.map(text).join(''):tree==null||typeof tree==='boolean'?'':typeof tree!=='object'?String(tree):text(tree.props?.children);
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const route={available:true,direct:true,fallback:false,route:'honor-autostart'};
const phone=(extra={})=>({manufacturer:'HONOR',brand:'HONOR',model:'PTP-AN00',androidRelease:'15',vendor:'honor',apiLevel:35,batteryExempt:false,routes:{battery:route,autostart:route,notifications:route,app:route},...extra});

/** The native metadata and system-setting launch are fixtures; the real TSX
 * performs guide selection, action filtering and request/session fencing. */
function fixture({native=true,connected=true,device=phone(),read,open}={}){
 let index=0,tree,dirty=false,mounted=true,epoch=1,reads=0;
 const hooks=[],effects=[],calls=[],same=(a,b)=>a&&b&&a.length===b.length&&a.every((item,at)=>Object.is(item,b[at]));
 const react={
  useState(value){const at=index++;hooks[at]??={value:typeof value==='function'?value():value};return [hooks[at].value,next=>{assert.ok(mounted,'late state writes are forbidden');hooks[at].value=typeof next==='function'?next(hooks[at].value):next;dirty=true;}];},
  useRef(value){const at=index++;hooks[at]??={ref:{current:value}};return hooks[at].ref;},
  useEffect(effect,deps){const at=index++,previous=hooks[at];if(!same(previous?.deps,deps))effects.push(()=>{previous?.cleanup?.();hooks[at]={deps,cleanup:effect()};});},
  useCallback(callback,deps){const at=index++;if(!same(hooks[at]?.deps,deps))hooks[at]={deps,value:callback};return hooks[at].value;},
  useSyncExternalStore(_subscribe,snapshot){index++;return snapshot();},
 };
 const window=new EventTarget(),document=new EventTarget();document.visibilityState='visible';
 const nativeApi={async backgroundSettings(){calls.push({kind:'read'});return read?read(++reads):structuredClone(device);},async openBackgroundSettings(input){calls.push(input);return open?open(input):{opened:true,kind:input.kind,route:'honor-autostart',fallback:false};},async openSystemSettings(){calls.push({kind:'app'});}};
 const session={subscribe:()=>()=>{},snapshot:()=>({busy:false,error:'',status:{enabled:false,running:false,permission:'prompt',connection:'stopped'}}),async refresh(){calls.push({kind:'refresh'});},async enable(){calls.push({kind:'enable'});},async disable(){calls.push({kind:'disable'});}};
 const module={exports:{}},element=(type,props)=>({type,props}),modules={react,'react/jsx-runtime':{jsx:element,jsxs:element},'lucide-react':new Proxy({},{get:(_target,name)=>Symbol.for(name)}),'./api':{getConnection:()=>({url:'https://fixture.invalid'}),getIdentity:()=>({instanceId:'phone-ui-instance',userId:`phone-ui-user-${epoch}`}),getSessionEpoch:()=>epoch,subscribeSession:()=>()=>{}},'./platform/task-notifications':{PetTaskNotifications:nativeApi,supportsTaskNotifications:()=>native},'./platform/background-settings-guide.mjs':guide,'./platform/task-notification-session':{taskNotificationSession:session},'./platform/task-notification-controller.mjs':{notificationServerUrl:()=> 'https://fixture.invalid'}};
 vm.runInNewContext(source,{module,exports:module.exports,window,document,require:name=>{if(name.endsWith('.css'))return {};assert.ok(Object.hasOwn(modules,name),name);return modules[name];}});
 const render=()=>{index=0;dirty=false;effects.length=0;tree=module.exports.default({connected});for(const effect of effects)effect();};
 const flush=async()=>{for(let tick=0;tick<12;tick++){await Promise.resolve();if(dirty&&mounted)render();}};
 const button=label=>nodes(tree).find(node=>node.type==='button'&&text(node.props.children).trim()===label);
 render();return {calls,flush,button,text:()=>text(tree),get tree(){return tree;},click(label){const node=button(label);assert.ok(node,label);node.props.onClick();render();},session(){epoch++;render();},hide(){document.visibilityState='hidden';},close(){mounted=false;for(const hook of hooks)hook?.cleanup?.();}};
}

test('Honor phone shows only its actual native model, Android version and Honor paths',async t=>{
 const f=fixture();t.after(()=>f.close());await f.flush();assert.match(f.text(),/HONOR PTP-AN00/);assert.match(f.text(),/Android 15 · API 35/);assert.match(f.text(),/荣耀 \/ MagicOS/);assert.ok(f.button('应用启动管理'));assert.doesNotMatch(f.text(),/小米|Redmi|POCO|华为|OPPO|realme|vivo|三星|Windows|Ubuntu|MagicOS \d/);assert.equal(f.calls.some(call=>['enable','battery','autostart','notifications'].includes(call.kind)),false);
});

test('a generic Android device gets only generic directions and no guessed retail name or OEM system version',async t=>{
 const f=fixture({device:phone({manufacturer:'Google',brand:'Google',model:'Pixel fixture',vendor:'generic',androidRelease:'16',apiLevel:36})});t.after(()=>f.close());await f.flush();assert.match(f.text(),/Google Pixel fixture/);assert.match(f.text(),/Android 16 · API 36/);assert.ok(f.button('应用后台设置'));assert.doesNotMatch(f.text(),/荣耀|MagicOS|小米|华为|OPPO|vivo|三星/);
});

test('legacy native metadata keeps generic labels and never infers an Android release from the API level',async t=>{
 const f=fixture({device:phone({manufacturer:'',brand:'',model:undefined,androidRelease:undefined,vendor:'generic',apiLevel:35})});t.after(()=>f.close());await f.flush();assert.match(f.text(),/Android 设备/);assert.match(f.text(),/Android · API 35/);assert.doesNotMatch(f.text(),/Android 15|Magic7|Magic8|MagicOS/);
});

test('unavailable native settings routes are hidden while usable app-scoped controls remain',async t=>{
 const f=fixture({device:phone({routes:{battery:{...route,available:false},autostart:{...route,available:false},notifications:route,app:route}})});t.after(()=>f.close());await f.flush();assert.equal(f.button('省电限制'),undefined);assert.equal(f.button('应用启动管理'),undefined);assert.ok(f.button('应用通知'));assert.ok(f.button('系统设置'));f.click('应用通知');await f.flush();assert.equal(f.calls.find(call=>call.kind==='notifications')?.kind,'notifications');assert.deepEqual(Object.keys(f.calls.find(call=>call.kind==='notifications')),['kind']);assert.equal(f.calls.some(call=>call.kind==='enable'),false);
});

test('metadata pending or failed never exposes unverified OEM action shortcuts',async t=>{
 const wait=deferred(),f=fixture({read:()=>wait.promise});t.after(()=>f.close());assert.equal(f.button('应用启动管理'),undefined);assert.equal(f.button('自启动设置'),undefined);assert.doesNotMatch(f.text(),/荣耀|MagicOS|Android 15/);wait.reject(Error('unavailable'));await f.flush();assert.match(f.text(),/暂时无法读取/);assert.ok(f.button('系统设置'));assert.equal(f.button('应用后台设置'),undefined);
});

test('old-account or unmounted metadata cannot replace the current phone state',async()=>{
 const wait=deferred(),f=fixture({read:()=>wait.promise});f.session();f.close();wait.resolve(phone());await f.flush();assert.doesNotMatch(f.text(),/PTP-AN00|Android 15/);
});

test('web and logged-out settings make no native metadata or permission changes',async t=>{
 const web=fixture({native:false});t.after(()=>web.close());await web.flush();assert.equal(web.tree,null);assert.equal(web.calls.length,0);
 const guest=fixture({connected:false});t.after(()=>guest.close());await guest.flush();assert.equal(guest.calls.some(call=>call.kind==='read'),false);assert.equal(guest.button('系统设置').props.disabled,true);assert.equal(guest.calls.some(call=>call.kind==='enable'),false);
});

test('background shortcuts serialize double taps and never launch while the app is hidden',async t=>{
 const wait=deferred(),f=fixture({open:()=>wait.promise});t.after(()=>f.close());await f.flush();const handler=f.button('应用启动管理').props.onClick;handler();handler();assert.equal(f.calls.filter(call=>call.kind==='autostart').length,1);wait.resolve({opened:true,kind:'autostart',route:'android-app-details',fallback:true});await f.flush();assert.match(f.text(),/应用信息.*手动检查/);f.hide();f.button('应用通知').props.onClick();assert.equal(f.calls.filter(call=>call.kind==='notifications').length,0);
});
