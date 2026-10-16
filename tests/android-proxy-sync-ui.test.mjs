import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

const compile=async name=>ts.transpileModule(await readFile(new URL(`../src/${name}.tsx`,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const sources={android:await compile('AndroidAppProxySettings'),admin:await compile('ServerProxyProfilesSettings')};
const stopped={supported:true,state:'stopped',configured:true,running:false,autoStart:false,version:'1.19.32',platform:'android',abi:'x86_64',groups:[],mode:'rule',source:'manual'};
const profile={id:'10000000-0000-4000-8000-000000000001',revision:'revision-1',name:'测试服务器配置',mode:'rule',selections:{代理:'节点 A'},groups:[{name:'代理',choices:['节点 A','节点 B']}],userIds:['alice'],sha256:'a'.repeat(64),updatedAt:'2026-10-16T00:00:00.000Z'};
const users=[{id:'alice',username:'alice',displayName:'Alice',isAdmin:true},{id:'bob',username:'bob',displayName:'Bob',isAdmin:false}];
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):!tree||typeof tree!=='object'?[]:[tree,...nodes(tree.props?.children)];
const text=tree=>Array.isArray(tree)?tree.map(text).join(''):tree==null||typeof tree==='boolean'?'':typeof tree!=='object'?typeof tree==='symbol'?'':String(tree):text(tree.props?.children);
const plain=value=>JSON.parse(JSON.stringify(value));

function fixture({kind='android',connected=true,available=true,admin=true,userId='alice',value=stopped,profiles=[profile],handlers={}}={}){
  let epoch=1,identity={instanceId:'server-fixture',userId},user={id:userId,isAdmin:admin,isOwner:false},actual=structuredClone(value),catalog=structuredClone(profiles),index=0,tree,mounted=true,dirty=false,updatesAfterUnmount=0;
  const window=new EventTarget(),document=new EventTarget(),hooks=[],effects=[],listeners=new Set(),calls=[];document.hidden=false;
  const react={
    useId(){index++;return'proxy-test';},
    useState(initial){const at=index++;hooks[at]||={value:typeof initial==='function'?initial():initial};return[hooks[at].value,next=>{if(!mounted)updatesAfterUnmount++;hooks[at].value=typeof next==='function'?next(hooks[at].value):next;dirty=true;}];},
    useRef(initial){const at=index++;hooks[at]||={current:initial};return hooks[at];},
    useEffect(effect,deps){const at=index++,previous=hooks[at];if(!previous||deps.some((value,i)=>!Object.is(value,previous.deps[i])))effects.push(()=>{previous?.cleanup?.();hooks[at]={deps,cleanup:effect()};});},
  };
  async function call(action,input){calls.push({action,...(input===undefined?{}:{input:plain(input)})});if(handlers[action])return handlers[action](input,actual);if(action==='list'||action==='adminList')return{profiles:structuredClone(catalog)};if(action==='users')return{users:structuredClone(users)};
    if(action==='importFile'||action==='importText'||action==='importUrl')actual={...actual,configured:true,source:'manual'};
    if(action==='importServer')actual={...actual,source:'server',serverProfileName:'测试服务器配置',serverStatus:'current',serverUpdateAvailable:false};
    if(action==='mode')actual={...actual,mode:input.mode};if(action==='select')actual={...actual,groups:actual.groups.map(group=>group.name===input.group?{...group,selected:input.name}:group)};
    if(action==='start')actual={...actual,running:true,state:'running'};if(action==='stop')actual={...actual,running:false,state:'stopped'};
    return structuredClone(actual);
  }
  const modules={react,'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},'lucide-react':new Proxy({},{get:(_target,key)=>Symbol.for(String(key))}),
    './api':{getIdentity:()=>connected?identity:null,getSessionEpoch:()=>epoch,subscribeSession:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},api:route=>{assert.equal(route,'/admin/users');return call('users');}},
    './platform/android-app-proxy':{supportsAndroidAppProxy:()=>available,androidAppProxyAction:(action,input)=>call(action,input)},
    './platform/server-proxy-profiles':{listServerProxyProfiles:()=>call('list'),listAdminProxyProfiles:()=>call('adminList'),createServerProxyProfile:input=>call('create',input),updateServerProxyProfile:(id,input)=>call('update',{id,...input}),deleteServerProxyProfile:(id,revision)=>call('delete',{id,revision})},
  };
  const module={exports:{}};vm.runInNewContext(sources[kind],{module,exports:module.exports,window,document,TextEncoder,Error,Object,Date,Promise,require:name=>{if(name.endsWith('.css'))return{};assert.ok(Object.hasOwn(modules,name),name);return modules[name];}});
  const render=()=>{index=0;dirty=false;effects.length=0;tree=module.exports.default({connected,user});for(const effect of effects)effect();return tree;};
  const find=(type,predicate=()=>true)=>nodes(tree).find(node=>node.type===type&&predicate(node.props));
  const findAll=(type,predicate=()=>true)=>nodes(tree).filter(node=>node.type===type&&predicate(node.props));
  const flush=async()=>{for(let count=0;count<35;count++){await Promise.resolve();if(dirty&&mounted)render();}};
  const button=label=>{const node=find('button',props=>props['aria-label']===label||text(props.children)===label);assert.ok(node,`Missing button ${label}`);return node;};
  const click=label=>button(label).props.onClick();
  const change=(node,value)=>{assert.ok(node);node.props.onChange({target:{value}});render();};
  render();
  return{calls,render,flush,find,findAll,button,click,change,text:()=>text(tree),get tree(){return tree;},get updatesAfterUnmount(){return updatesAfterUnmount;},
    open(){find('details').props.onToggle({currentTarget:{open:true}});render();},
    changeSession({authenticated=connected,newUser='bob',isAdmin=admin,rerender=true}={}){epoch++;connected=authenticated;identity={...identity,userId:newUser};user={id:newUser,isAdmin,isOwner:false};for(const listener of listeners)listener();if(rerender)render();},
    changeIdentity(){identity={instanceId:'replacement-server',userId:'bob'};for(const listener of listeners)listener();},
    setProfiles(value){catalog=structuredClone(value);},
    submit(){const form=find('form');assert.ok(form);form.props.onSubmit({preventDefault(){}});},
    file(file){const field=find('input',props=>props.type==='file');assert.ok(field);field.props.onChange({target:{files:[file],value:'selected.yaml'}});},
    visibility(hidden){document.hidden=hidden;document.dispatchEvent(new Event('visibilitychange'));},
    close(){if(!mounted)return;mounted=false;for(const hook of hooks)hook?.cleanup?.();},
  };
}

test('Android controls require a native device and a verified signed-in identity',async t=>{
  for(const options of [{available:false},{connected:false}]){const f=fixture(options);t.after(()=>f.close());await f.flush();assert.equal(f.calls.length,0);assert.equal(f.find('button'),undefined);}
});
test('a server 404 leaves manual import and the existing local proxy usable',async t=>{
  const f=fixture({handlers:{list(){throw Object.assign(new Error('private-upstream-body'),{status:404});}}});t.after(()=>f.close());await f.flush();assert.match(f.text(),/更新后端/);assert.doesNotMatch(f.text(),/private-upstream/);assert.equal(f.button('导入 YAML').props.disabled,false);assert.equal(f.button('启用代理').props.disabled,false);f.click('导入 YAML');await f.flush();assert.equal(f.calls.at(-1).action,'importFile');
});
test('server imports are deduplicated immediately, while updating keeps local policy unless explicitly reset',async t=>{
  const wait=deferred(),server={...stopped,source:'server',serverProfileName:profile.name,serverStatus:'current',serverUpdateAvailable:true},f=fixture({handlers:{importServer:()=>wait.promise,updateServer:()=>server}});t.after(()=>f.close());await f.flush();const captured=f.button('使用此配置').props.onClick;captured();captured();assert.equal(f.calls.filter(call=>call.action==='importServer').length,1);assert.deepEqual(f.calls.at(-1).input,{profileId:profile.id});wait.resolve(server);await f.flush();
  f.click('更新配置');await f.flush();assert.deepEqual(f.calls.at(-1),{action:'updateServer'});f.click('同步服务器策略');await f.flush();assert.deepEqual(f.calls.at(-1),{action:'updateServer',input:{resetPolicy:true}});
});
test('late Android catalog and native responses cannot replace a new account or update an unmounted view',async t=>{
  const list=deferred(),native=deferred();let calls=0;const f=fixture({handlers:{list:()=>++calls===1?list.promise:{profiles:[]},checkServer:()=>calls<=1?native.promise:stopped}});t.after(()=>f.close());f.changeSession();await f.flush();list.resolve({profiles:[{...profile,name:'Old account private profile'}]});native.resolve({...stopped,source:'server',serverProfileName:'Old native status'});await f.flush();assert.doesNotMatch(f.text(),/Old account|Old native/);
  const wait=deferred(),other=fixture({handlers:{importFile:()=>wait.promise}});await other.flush();other.click('导入 YAML');other.close();wait.resolve(stopped);await other.flush();assert.equal(other.updatesAfterUnmount,0);
});
test('stale Android controls and visibility callbacks cannot invoke the new account before rerender',async t=>{
  const f=fixture();t.after(()=>f.close());await f.flush();const handler=f.button('使用此配置').props.onClick,before=f.calls.length;f.changeSession({rerender:false});handler();f.visibility(false);await f.flush();assert.equal(f.calls.slice(before).filter(call=>call.action==='importServer').length,0);assert.equal(f.calls.slice(before).filter(call=>call.action==='checkServer').length,1,'only the new render refresh is allowed');
});
test('Android YAML drafts clear on account switch and raw native failure text stays hidden',async t=>{
  const f=fixture({handlers:{importText(){throw new Error('Bearer private-node-secret');}}});t.after(()=>f.close());await f.flush();f.click('粘贴 Clash YAML');await f.flush();f.change(f.find('textarea'),'synthetic-private-yaml');f.click('保存配置');await f.flush();assert.match(f.text(),/操作未完成/);assert.doesNotMatch(f.text(),/private-node-secret/);f.changeSession();await f.flush();assert.equal(f.find('textarea'),undefined);f.click('粘贴 Clash YAML');await f.flush();assert.equal(f.find('textarea').props.value,'');
});
test('server management is lazy and requires the current administrator identity',async t=>{
  for(const options of [{kind:'admin',admin:false},{kind:'admin',connected:false}]){const f=fixture(options);t.after(()=>f.close());await f.flush();assert.equal(f.tree,null);assert.equal(f.calls.length,0);}
  const f=fixture({kind:'admin'});t.after(()=>f.close());await f.flush();assert.equal(f.calls.length,0);f.open();await f.flush();assert.deepEqual(f.calls.map(call=>call.action).sort(),['adminList','users']);assert.match(f.text(),/测试服务器配置/);
});
test('admin creation sends the explicitly assigned users and deduplicates submission before rerender',async t=>{
  const wait=deferred(),f=fixture({kind:'admin',handlers:{create:()=>wait.promise}});t.after(()=>f.close());f.open();await f.flush();f.click('添加配置');await f.flush();f.change(f.find('input',props=>props.required===true),'New profile');f.change(f.find('textarea'),'proxies: []');const bob=f.findAll('input',props=>props.type==='checkbox')[1];bob.props.onChange({target:{checked:true}});f.render();const submit=f.find('form').props.onSubmit;submit({preventDefault(){}});submit({preventDefault(){}});assert.equal(f.calls.filter(call=>call.action==='create').length,1);assert.deepEqual(f.calls.at(-1).input.userIds,['alice','bob']);assert.equal(f.calls.at(-1).input.yaml,'proxies: []');await f.flush();assert.equal(f.find('textarea').props.value,'');wait.resolve({});await f.flush();assert.equal(f.find('form'),undefined);assert.match(f.text(),/配置已保存/);
});
test('editing metadata retains the existing file and forwards the exact revision; deletion is explicit',async t=>{
  const f=fixture({kind:'admin'});t.after(()=>f.close());f.open();await f.flush();f.click('编辑');await f.flush();f.submit();await f.flush();const update=f.calls.find(call=>call.action==='update');assert.equal(update.input.revision,'revision-1');assert.equal(Object.hasOwn(update.input,'yaml'),false);assert.equal(f.calls.filter(call=>call.action==='delete').length,0);f.click('删除');await f.flush();assert.match(f.text(),/撤销账号访问/);f.click('删除并撤销');await f.flush();assert.deepEqual(f.calls.find(call=>call.action==='delete').input,{id:profile.id,revision:profile.revision});
});
test('an old admin form cannot write using a newly switched account before React rerenders',async t=>{
  const f=fixture({kind:'admin'});t.after(()=>f.close());f.open();await f.flush();f.click('编辑');await f.flush();const submit=f.find('form').props.onSubmit,before=f.calls.length;f.changeSession({newUser:'bob',isAdmin:true,rerender:false});submit({preventDefault(){}});await f.flush();assert.equal(f.calls.slice(before).filter(call=>call.action==='update').length,0);
});
test('identity changes without an epoch increment still reject old Android and administrator handlers',async t=>{
  const android=fixture();t.after(()=>android.close());await android.flush();const select=android.button('使用此配置').props.onClick;android.changeIdentity();const before=android.calls.length;select();await android.flush();assert.equal(android.calls.slice(before).filter(call=>call.action==='importServer').length,0);
  const admin=fixture({kind:'admin'});t.after(()=>admin.close());admin.open();await admin.flush();admin.click('编辑');await admin.flush();const save=admin.find('form').props.onSubmit;admin.changeIdentity();const previous=admin.calls.length;save({preventDefault(){}});await admin.flush();assert.equal(admin.calls.slice(previous).filter(call=>call.action==='update').length,0);
});
test('late admin reads and file reads are discarded after account change, cancellation or unmount',async t=>{
  const pending=deferred(),f=fixture({kind:'admin',handlers:{adminList:()=>pending.promise}});t.after(()=>f.close());f.open();f.changeSession({isAdmin:false});pending.resolve({profiles:[{...profile,name:'Old private profile'}]});await f.flush();assert.equal(f.tree,null);
  const other=fixture({kind:'admin'});t.after(()=>other.close());other.open();await other.flush();other.click('添加配置');await other.flush();const file=deferred();other.file({size:12,text:()=>file.promise});other.click('取消');await other.flush();file.resolve('old file contents');await other.flush();assert.equal(other.find('textarea'),undefined);other.click('添加配置');await other.flush();assert.equal(other.find('textarea').props.value,'');
  const last=deferred();other.file({size:12,text:()=>last.promise});other.close();last.resolve('late');await other.flush();assert.equal(other.updatesAfterUnmount,0);
});
test('the latest selected file wins when an earlier file read is slower',async t=>{
  const f=fixture({kind:'admin'});t.after(()=>f.close());f.open();await f.flush();f.click('添加配置');await f.flush();const old=deferred(),recent=deferred();f.file({size:10,text:()=>old.promise});f.file({size:10,text:()=>recent.promise});recent.resolve('newest file');await f.flush();old.resolve('older file');await f.flush();assert.equal(f.find('textarea').props.value,'newest file');
});
test('manual YAML typing invalidates an older in-flight file read',async t=>{
  const f=fixture({kind:'admin'});t.after(()=>f.close());f.open();await f.flush();f.click('添加配置');await f.flush();const old=deferred();f.file({size:10,text:()=>old.promise});f.change(f.find('textarea'),'my current manual draft');old.resolve('old file');await f.flush();assert.equal(f.find('textarea').props.value,'my current manual draft');
});
test('admin file UTF-8 limits and server errors use fixed messages without reflecting private responses',async t=>{
  const missing=fixture({kind:'admin',handlers:{adminList(){throw Object.assign(new Error('private-service-response'),{status:404});}}});t.after(()=>missing.close());missing.open();await missing.flush();assert.match(missing.text(),/更新后端/);assert.doesNotMatch(missing.text(),/private-service/);
  const f=fixture({kind:'admin'});t.after(()=>f.close());f.open();await f.flush();f.click('添加配置');await f.flush();let reads=0;f.file({size:4*1024*1024+1,text(){reads++;return Promise.resolve('');}});await f.flush();assert.equal(reads,0);assert.match(f.text(),/不能超过/);f.file({size:1,text:async()=>'字'.repeat(Math.ceil(4*1024*1024/3))});await f.flush();assert.equal(f.find('textarea').props.value,'');assert.match(f.text(),/UTF-8/);assert.equal(f.calls.filter(call=>call.action==='create').length,0);
});
test('dynamic provider groups accept a named default alongside static suggestions',async t=>{
  const f=fixture({kind:'admin',profiles:[{...profile,groups:[{name:'代理',choices:['DIRECT'],dynamic:true}]}]});t.after(()=>f.close());
  f.open();await f.flush();f.click('编辑');await f.flush();
  const input=f.find('input',props=>!!props.list);assert.ok(input);f.change(input,'订阅东京节点');await f.flush();f.submit();await f.flush();
  assert.equal(f.calls.find(call=>call.action==='update').input.selections['代理'],'订阅东京节点');
});
