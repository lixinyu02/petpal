import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import {executionHostChoices,groupExecutionHosts} from '../src/execution-host-picker.mjs';
import {executionHostLock,resolveExecutionHostId} from '../src/execution-hosts.mjs';
import {remoteDesktopUrl} from '../src/remote-desktop-url.mjs';
import {createVisiblePoll} from '../src/platform/visible-poll.mjs';
import {randomUUID} from 'node:crypto';

const compile=async file=>ts.transpileModule(await readFile(new URL(file,import.meta.url),'utf8'),{fileName:file.replace(/\.mjs$/,'.js'),compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
const [cloudSource,linksSource,desktopSource,scopeSource,typesSource,creationSource]=await Promise.all(['../src/CloudDockerView.tsx','../src/ServiceLinksSettings.tsx','../src/RemoteDesktopPanel.tsx','../src/platform/cloud-session.ts','../src/platform/cloud-docker.ts','../src/cloud-create-request.mjs'].map(compile));
const clone=value=>JSON.parse(JSON.stringify(value));
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):!tree||typeof tree!=='object'?[]:[tree,...nodes(tree.props?.children)];
const text=tree=>Array.isArray(tree)?tree.map(text).join(''):tree==null||typeof tree==='boolean'?'':typeof tree!=='object'?String(tree):text(tree.props?.children);
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const user={id:'cloud-user-one',username:'alice',displayName:'Alice',isAdmin:false,isOwner:false,role:'user',canUseCodex:true};
const own={id:'cloud-own-instance',name:'我的云端工作区',kind:'docker',platform:'linux',online:true,isOwn:true,owner:{id:user.id,username:'alice',displayName:'Alice'},docker:{bundle:'desktop',source:'platform',state:'running'}};
const other={...own,id:'cloud-other-instance',name:'其他用户的环境',isOwn:false,owner:{id:'other-user',username:'bob',displayName:'Bob'}};
const sources=[{id:'local',name:'服务器 Docker',available:true},{id:'platform',name:'云端 Docker 平台',available:true}];
const catalog={sources,nodes:[{id:'node-a',name:'隔离节点 A',available:true},{id:'node-off',name:'离线节点',available:false}]};
const ticket={ticket:'one_use_ticket_0123456789012345',path:`/api/cloud-docker/${own.id}/desktop/ws`,expiresAt:new Date(Date.now()+60000).toISOString()};

/** Real component handlers and shared lifetime hook run against a small React
 * scheduler. Only HTTP, RFB and browser primitives are fixtures. */
function fixture(component='cloud',options={}){
  let epoch=1,identity={instanceId:'central-fixture',userId:user.id},index=0,tree,dirty=false,mounted=true,afterUnmount=0,timerId=0;
  const hooks=[],effects=[],requests=[],timers=new Map(),subscriptions=new Set(),clients=[],calls=[];
  const props={connected:true,user,...(component==='desktop'?{host:own,onClose:()=>calls.push('close')}:{onUse:host=>calls.push(['use',host.id]),onDesktop:host=>calls.push(['desktop',host.id]),onConfigure:()=>calls.push('configure'),onChanged:()=>calls.push('changed')}),...options.props};
  identity.userId=props.user?.id||'no-user';
  const same=(left,right)=>left&&right&&left.length===right.length&&left.every((value,at)=>Object.is(value,right[at]));
  const react={
    useRef(value){const at=index++;hooks[at]??={ref:{current:value}};return hooks[at].ref;},
    useState(value){const at=index++;hooks[at]??={value:typeof value==='function'?value():value};return [hooks[at].value,next=>{if(!mounted){afterUnmount++;return;}hooks[at].value=typeof next==='function'?next(hooks[at].value):next;dirty=true;}];},
    useEffect(effect,deps){const at=index++,previous=hooks[at];if(!same(previous?.deps,deps))effects.push(()=>{previous?.cleanup?.();hooks[at]={deps,cleanup:effect()};});},
  };
  class SessionChangedError extends Error{constructor(){super('Session changed');this.name='SessionChangedError';}}
  const api=async(path,value={})=>{
    const call={path,method:value.method||'GET',body:value.body?JSON.parse(value.body):undefined,signal:value.signal,epoch};requests.push(call);
    if(options.request){const response=await options.request(call);if(response!==undefined)return response;}
    if(path==='/cloud-docker')return call.method==='GET'?{instances:clone(options.hosts??[own,other])}:{instance:clone(own)};
    if(path==='/cloud-docker/catalog')return clone(options.catalog??catalog);
    if(path==='/cloud-docker/prepare')return {ok:true};
    if(path.endsWith('/desktop-ticket'))return {...ticket};
    if(path==='/service-links')return {links:options.links??[]};
    if(path.startsWith('/service-links/')||/^\/cloud-docker\/[^/]+\/(start|stop)$/.test(path))return {ok:true};
    throw new Error(`Unexpected cloud UI route ${path}`);
  };
  const apiModule={api,getSessionEpoch:()=>epoch,getIdentity:()=>identity,subscribeSession:listener=>{subscriptions.add(listener);return()=>subscriptions.delete(listener);},SessionChangedError,isSessionChanged:error=>error?.name==='SessionChangedError',getConnection:()=>({url:'https://petpal.example/prefix',token:'never-include-permanent-token'})};
  const window=new EventTarget(),document=new EventTarget();window.navigator={onLine:true};document.hidden=false;
  window.matchMedia=()=>({matches:options.narrow??false,addEventListener(){},removeEventListener(){}});
  class FakeRfb extends EventTarget{
    constructor(target,url,rfbOptions){super();this.target=target;this.url=url;this.options=rfbOptions;this.closed=0;clients.push(this);}
    disconnect(){this.closed++;this.dispatchEvent(new Event('disconnect'));}
    focus(){calls.push('focus');}
  }
  const element=(type,elementProps)=>typeof type==='function'?type(elementProps):({type,props:elementProps});
  const modules={react,'react/jsx-runtime':{jsx:element,jsxs:element},'lucide-react':new Proxy({},{get:(_target,name)=>Symbol.for(String(name))}),'./api':apiModule,'../api':apiModule,'./remote-desktop-url.mjs':{remoteDesktopUrl},'@novnc/novnc/lib/rfb.js':{__esModule:true,default:FakeRfb},'./platform/visible-poll.mjs':{createVisiblePoll:value=>createVisiblePoll({...value,setTimeoutFn(callback){const id=++timerId;timers.set(id,callback);return id;},clearTimeoutFn:id=>timers.delete(id)})}};
  function evaluate(source){const module={exports:{}};vm.runInNewContext(source,{module,exports:module.exports,window,document,URL,Event,AbortController,DOMException,Promise,Date,crypto:{randomUUID},require:name=>{if(name.endsWith('.css'))return {};assert.ok(Object.hasOwn(modules,name),`Unknown UI module ${name}`);return modules[name];}});return module.exports;}
  modules['./platform/cloud-session']=evaluate(scopeSource);modules['./platform/cloud-docker']=evaluate(typesSource);modules['./cloud-create-request.mjs']=evaluate(creationSource);
  const Component=evaluate(component==='links'?linksSource:component==='desktop'?desktopSource:cloudSource).default;
  const render=()=>{index=0;dirty=false;effects.length=0;tree=Component(props);for(const node of nodes(tree))if(node.props?.ref&&!node.props.ref.current)node.props.ref.current={replaceChildren(){calls.push('clear-canvas');}};for(const effect of effects)effect();return tree;};
  const flush=async()=>{for(let count=0;count<12;count++){await new Promise(resolve=>setImmediate(resolve));if(mounted&&dirty)render();}};
  const find=(type,check=()=>true)=>nodes(tree).find(node=>node.type===type&&check(node.props));
  const button=label=>find('button',p=>p['aria-label']===label||text(p.children).trim()===label);
  const field=label=>nodes(tree).find(node=>['input','select'].includes(node.type)&&node.props['aria-label']===label);
  render();
  return {requests,clients,calls,props,flush,render,button,field,find,text:()=>text(tree),get afterUnmount(){return afterUnmount;},
    click(label){const node=button(label);assert.ok(node,`Missing ${label}`);node.props.onClick?.({preventDefault(){}});render();},
    change(label,value){const node=field(label);assert.ok(node,`Missing ${label}`);node.props.onChange({target:{value}});render();},
    submit(){const form=find('form');assert.ok(form);form.props.onSubmit({preventDefault(){}});render();},
    session(nextUser){epoch++;identity={instanceId:'other-central',userId:nextUser?.id||'no-user'};if(nextUser)props.user=nextUser;for(const listener of subscriptions)listener();render();},
    close(){if(!mounted)return;mounted=false;for(const hook of hooks)hook?.cleanup?.();},
  };
}

test('Docker targets form a distinct group and frozen Docker tasks cannot select a physical fallback',()=>{
  const choices=executionHostChoices([own,other,{id:'physical',name:'实体机',kind:'desktop',platform:'win32',online:true,isOwn:true}],own.id,'physical',false);
  assert.deepEqual(choices.map(choice=>choice.id),[own.id,'physical']);
  assert.equal(groupExecutionHosts(choices).find(group=>group.id==='docker').label,'云端 Docker');
  assert.equal(choices.find(choice=>choice.id===own.id).kind,'docker');
  const lock=executionHostLock({run:{status:'unknown',hostId:own.id}},null);
  assert.equal(resolveExecutionHostId({requestedId:'physical',lockedId:lock,localHostId:'physical'}),own.id);
});

test('ordinary user sees only owned Docker instances and exact chosen target reaches callbacks',async t=>{
  const f=fixture();t.after(()=>f.close());await f.flush();
  assert.match(f.text(),/我的云端工作区/);assert.doesNotMatch(f.text(),/其他用户的环境/);assert.equal(f.button('连接 Docker 平台 / API Harbor'),undefined);
  f.click('用于 Agent');f.click('桌面');assert.deepEqual(f.calls,[['use',own.id],['desktop',own.id]]);
  assert.equal(f.requests.some(call=>call.method!=='GET'),false);
});

test('raw userId ownership and explicit unavailable desktop flags are respected',async t=>{
  const raw={...own,userId:user.id,isOwn:undefined,owner:undefined,docker:{...own.docker,desktopAvailable:false}};
  const f=fixture('cloud',{hosts:[raw,{...other,userId:'other-account',owner:undefined}]});t.after(()=>f.close());await f.flush();
  assert.match(f.text(),/我的云端工作区/);assert.doesNotMatch(f.text(),/其他用户的环境/);assert.equal(f.button('桌面').props.disabled,true);
});

test('unverified login cannot request environments, pair services or request a desktop ticket',async t=>{
  for(const component of ['cloud','links','desktop']){const f=fixture(component,{props:{connected:false,user:{...user,isAdmin:true}}});t.after(()=>f.close());await f.flush();assert.equal(f.requests.length,0);assert.equal(f.clients.length,0);}
});

test('only administrators prepare local Docker images; ordinary users see the truthful pending state',async t=>{
  const pending={sources:[{id:'local',available:true,imageAvailable:false}],local:{available:true,imageAvailable:false}};
  const f=fixture('cloud',{catalog:pending,hosts:[]});t.after(()=>f.close());await f.flush();assert.equal(f.button('准备 Docker 环境'),undefined);assert.equal(f.button('新建环境').props.disabled,true);assert.match(f.text(),/管理员尚未准备/);
  const gate=deferred(),admin=fixture('cloud',{catalog:pending,hosts:[],props:{user:{...user,isAdmin:true}},request:call=>call.path==='/cloud-docker/prepare'?gate.promise:undefined});t.after(()=>{gate.resolve({});admin.close();});await admin.flush();
  const prepare=admin.button('准备 Docker 环境').props.onClick;prepare();prepare();admin.render();assert.equal(admin.requests.filter(call=>call.path==='/cloud-docker/prepare').length,1);gate.resolve({});await admin.flush();
});

test('create freezes platform node and bundle, and synchronous duplicate submits create once',async t=>{
  const gate=deferred(),f=fixture('cloud',{request:call=>call.path==='/cloud-docker'&&call.method==='POST'?gate.promise:undefined});t.after(()=>{gate.resolve({});f.close();});await f.flush();
  f.click('新建环境');f.change('环境名称','写作工作区');f.change('Docker 运行位置','platform');f.change('运行节点','node-a');f.change('环境类型','agent');
  const submit=f.find('form').props.onSubmit;submit({preventDefault(){}});submit({preventDefault(){}});f.render();
  const writes=f.requests.filter(call=>call.method==='POST');assert.equal(writes.length,1);const {requestId,...body}=clone(writes[0].body);assert.match(requestId,/^[a-f0-9-]{36}$/);assert.deepEqual(body,{name:'写作工作区',source:'platform',bundle:'agent',resources:{cpus:2,memoryMiB:4096},nodeId:'node-a'});
  gate.resolve({});await f.flush();assert.equal(f.calls.filter(call=>call==='changed').length,1);
});

test('a lost creation reply keeps requestId and frozen configuration for a later retry',async t=>{
  const created=new Map();let attempts=0;
  const f=fixture('cloud',{hosts:[],request:call=>{
    if(call.path!=='/cloud-docker'||call.method!=='POST')return;
    attempts++;if(!created.has(call.body.requestId))created.set(call.body.requestId,clone(call.body));
    if(attempts===1)throw new TypeError('Network reply lost after server committed');
    return {instance:{...own,requestId:call.body.requestId}};
  }});t.after(()=>f.close());await f.flush();f.click('新建环境');f.change('环境名称','固定的环境');f.submit();await f.flush();
  const first=f.requests.find(call=>call.method==='POST');assert.equal(f.field('环境名称').props.disabled,true);assert.match(f.text(),/创建结果尚未确认/);
  f.change('环境名称','不应被重新创建的另一环境');f.submit();await f.flush();
  const writes=f.requests.filter(call=>call.method==='POST');assert.equal(writes.length,2);assert.deepEqual(clone(writes[1].body),clone(first.body));assert.equal(created.size,1);assert.equal(f.find('form'),undefined);
});

test('refresh confirms an earlier committed request by requestId instead of issuing another create',async t=>{
  let committed=null;
  const f=fixture('cloud',{hosts:[],request:call=>{
    if(call.path!=='/cloud-docker')return;
    if(call.method==='GET')return {instances:committed?[{...own,requestId:committed.requestId}]:[]};
    committed=clone(call.body);throw new TypeError('Creation reply was lost');
  }});t.after(()=>f.close());await f.flush();f.click('新建环境');f.submit();await f.flush();assert.ok(committed);f.click('刷新云端环境');await f.flush();
  assert.equal(f.requests.filter(call=>call.method==='POST').length,1);assert.equal(f.find('form'),undefined);assert.match(f.text(),/已确认上次创建/);
});

test('a matching but stopped instance retains its frozen create body until that exact request is running',async t=>{
  let committed=null,record=null,attempts=0;
  const f=fixture('cloud',{hosts:[],request:call=>{
    if(call.path!=='/cloud-docker')return;
    if(call.method==='GET')return {instances:record?[record]:[]};
    attempts++;committed??=clone(call.body);
    record??={...own,online:false,requestId:committed.requestId,docker:{...own.docker,state:'stopped',desktopAvailable:false}};
    if(attempts===1)throw new TypeError('Reply lost after an incomplete create');
    return {instance:clone(record)};
  }});t.after(()=>f.close());await f.flush();f.click('新建环境');f.change('环境名称','等待恢复的环境');f.submit();await f.flush();
  f.click('刷新云端环境');await f.flush();assert.ok(f.find('form'));assert.equal(f.field('环境名称').props.disabled,true);assert.doesNotMatch(f.text(),/已确认上次创建/);
  f.submit();await f.flush();const writes=f.requests.filter(call=>call.method==='POST');assert.equal(writes.length,2);assert.deepEqual(clone(writes[1].body),committed);assert.ok(f.find('form'));assert.match(f.text(),/环境尚未运行/);
  record={...record,online:true,docker:{...record.docker,state:'running',desktopAvailable:true}};f.click('刷新云端环境');await f.flush();assert.equal(f.find('form'),undefined);assert.match(f.text(),/已确认上次创建/);assert.equal(f.requests.filter(call=>call.method==='POST').length,2);
});

test('pairing has one request, clears the secret immediately and old-account handlers cannot mutate',async t=>{
  const gate=deferred(),f=fixture('links',{props:{user:{...user,role:'admin',isAdmin:true}},request:call=>call.path.endsWith('/pair')?gate.promise:undefined});t.after(()=>{gate.resolve({});f.close();});await f.flush();
  f.change('配对服务类型','api-harbor');f.change('配对服务地址','https://harbor.example');f.change('一次性配对码','private-single-use-code');
  const submit=f.find('form').props.onSubmit;submit({preventDefault(){}});submit({preventDefault(){}});f.render();
  const write=f.requests.find(call=>call.method==='POST');assert.deepEqual(clone(write.body),{baseUrl:'https://harbor.example',code:'private-single-use-code'});assert.equal(f.requests.filter(call=>call.method==='POST').length,1);assert.equal(f.field('一次性配对码').props.value,'');
  f.session({...user,id:'second-account',role:'admin',isAdmin:true});submit({preventDefault(){}});gate.resolve({});await f.flush();
  assert.equal(write.signal.aborted,true);assert.equal(f.requests.filter(call=>call.method==='POST').length,1);assert.doesNotMatch(f.text(),/配对成功/);
  assert.equal(f.calls.includes('changed'),false,'a former account must not refresh the current account model catalog');
});

test('successful pairing, catalog refresh and disconnect refresh global model state once per mutation',async t=>{
 for(const action of ['pair','refresh','disconnect']){
  const f=fixture('links',{props:{user:{...user,role:'admin',isAdmin:true}},links:action==='pair'?[]:[{kind:'api-harbor',state:'ready',baseUrl:'https://harbor.example'}]});t.after(()=>f.close());await f.flush();
  if(action==='pair'){f.change('配对服务类型','api-harbor');f.change('配对服务地址','https://harbor.example');f.change('一次性配对码','single-use-code');f.submit();}
  else if(action==='refresh')f.click('同步目录');else{f.click('断开API Harbor');f.click('确认断开');}
  await f.flush();assert.equal(f.calls.filter(call=>call==='changed').length,1,action);assert.equal(f.requests.filter(call=>call.method!=='GET').length,1,action);
 }
});

test('a failed global model refresh after successful pairing preserves the confirmed operation and reports only stale UI state',async t=>{
 let paired=false;
 const f=fixture('links',{props:{user:{...user,role:'admin',isAdmin:true},onChanged:async()=>{throw new Error('state unavailable');}},request:call=>{
  if(call.path==='/service-links')return{links:paired?[{kind:'api-harbor',state:'ready',baseUrl:'https://harbor.example'}]:[]};
  if(call.path.endsWith('/pair')){paired=true;return{};}
 }});t.after(()=>f.close());await f.flush();f.change('配对服务类型','api-harbor');f.change('配对服务地址','https://harbor.example');f.change('一次性配对码','single-use-code');f.submit();await f.flush();
 assert.match(f.text(),/配对成功/);assert.match(f.text(),/模型列表暂未同步/);assert.doesNotMatch(f.text(),/配对结果尚未确认/);assert.ok(f.button('同步目录'));assert.equal(f.field('一次性配对码'),undefined);assert.equal(f.requests.filter(call=>call.path.endsWith('/pair')).length,1);
});

test('lost pairing reply reloads the pending operation and offers continuation without a replacement code',async t=>{
  let pending=false;
  const f=fixture('links',{props:{user:{...user,role:'admin',isAdmin:true}},request:call=>{
    if(call.path==='/service-links')return {links:pending?[{kind:'api-harbor',state:'confirming',baseUrl:'https://harbor.example'}]:[]};
    if(call.path.endsWith('/pair')){pending=true;throw new TypeError('Reply lost after exchange');}
  }});t.after(()=>f.close());await f.flush();
  f.change('配对服务类型','api-harbor');f.change('配对服务地址','https://harbor.example');f.change('一次性配对码','private-single-use-code');f.submit();await f.flush();
  assert.ok(f.button('继续配对'));assert.equal(f.field('一次性配对码'),undefined);assert.match(f.text(),/无需新的配对码/);assert.doesNotMatch(f.text(),/获取新的配对码/);
  f.click('继续配对');await f.flush();assert.equal(f.requests.filter(call=>call.path.endsWith('/pair')).length,1);assert.equal(f.requests.filter(call=>call.path==='/service-links/api-harbor/refresh'&&call.method==='POST').length,1);
});

test('revoking links resume the original disconnect and cannot start a fresh pairing',async t=>{
  const f=fixture('links',{props:{user:{...user,role:'admin',isAdmin:true}},links:[{kind:'api-harbor',state:'revoking',baseUrl:'https://harbor.example'}]});t.after(()=>f.close());await f.flush();
  f.change('配对服务类型','api-harbor');assert.ok(f.button('继续断开'));assert.equal(f.field('一次性配对码'),undefined);assert.match(f.text(),/继续原断开操作/);
  f.click('继续断开');await f.flush();assert.equal(f.requests.filter(call=>call.path==='/service-links/api-harbor/refresh'&&call.method==='POST').length,1);assert.equal(f.requests.some(call=>call.path.endsWith('/pair')),false);
});

test('unknown pairing delivery survives failed status reads without offering another code',async t=>{
  let pending=false,recovered=false;
  const f=fixture('links',{props:{user:{...user,role:'admin',isAdmin:true}},request:call=>{
    if(call.path==='/service-links'){if(pending&&!recovered)throw new TypeError('Status also unavailable');return {links:pending?[{kind:'api-harbor',state:'ready',baseUrl:'https://harbor.example'}]:[]};}
    if(call.path.endsWith('/pair')){pending=true;throw new TypeError('Pairing reply lost');}
    if(call.path.endsWith('/refresh')){recovered=true;return {};}
  }});t.after(()=>f.close());await f.flush();
  f.change('配对服务类型','api-harbor');f.change('配对服务地址','https://harbor.example');f.change('一次性配对码','private-single-use-code');f.submit();await f.flush();
  assert.equal(f.field('一次性配对码'),undefined);assert.ok(f.button('继续配对'));assert.match(f.text(),/操作结果尚未确认/);
  f.click('继续配对');await f.flush();assert.equal(f.requests.filter(call=>call.path.endsWith('/pair')).length,1);assert.equal(f.requests.filter(call=>call.path.endsWith('/refresh')).length,1);assert.ok(f.button('同步目录'));assert.equal(f.field('一次性配对码'),undefined);
});

test('late catalogs are not shown after logout and unmount aborts all outstanding requests',async t=>{
  const gate=deferred(),f=fixture('cloud',{request:call=>call.path==='/cloud-docker'?gate.promise:undefined});t.after(()=>{gate.resolve({instances:[own]});f.close();});await f.flush();
  const pending=f.requests.find(call=>call.path==='/cloud-docker');f.session();gate.resolve({instances:[own]});await f.flush();assert.equal(pending.signal.aborted,true);assert.doesNotMatch(f.text(),/我的云端工作区/);
  f.close();await f.flush();assert.equal(f.afterUnmount,0);
});

test('desktop uses same service prefix and one-use ticket without any permanent account token',async t=>{
  const f=fixture('desktop');t.after(()=>f.close());await f.flush();
  assert.equal(f.clients.length,1);const client=f.clients[0],url=new URL(client.url);
  assert.equal(url.protocol,'wss:');assert.equal(url.host,'petpal.example');assert.equal(url.pathname,`/prefix/api/cloud-docker/${own.id}/desktop/ws`);assert.deepEqual([...url.searchParams.keys()],['ticket']);assert.equal(url.searchParams.get('ticket'),ticket.ticket);assert.doesNotMatch(client.url,/never-include-permanent-token/);
  assert.equal(client.viewOnly,true);client.dispatchEvent(new Event('connect'));await f.flush();assert.equal(f.button('允许鼠标键盘').props['aria-pressed'],false);
});

test('desktop control is explicit; logout disconnects RFB and late ticket responses never reconnect',async t=>{
  const f=fixture('desktop');t.after(()=>f.close());await f.flush();const client=f.clients[0];client.dispatchEvent(new Event('connect'));await f.flush();f.click('允许鼠标键盘');await f.flush();assert.equal(client.viewOnly,false);
  f.session();await f.flush();assert.equal(client.closed,1);assert.equal(f.clients.length,1);
  const gate=deferred(),late=fixture('desktop',{request:call=>call.path.endsWith('/desktop-ticket')?gate.promise:undefined});t.after(()=>{gate.resolve(ticket);late.close();});await late.flush();const pending=late.requests[0];late.close();gate.resolve(ticket);await late.flush();assert.equal(pending.signal.aborted,true);assert.equal(late.clients.length,0);assert.equal(late.afterUnmount,0);
});

test('desktop URLs reject arbitrary proxy destinations, expired tickets and malformed service URLs',()=>{
  assert.throws(()=>remoteDesktopUrl('https://petpal.example',own.id,{...ticket,path:'https://other.example/ws'}));
  assert.throws(()=>remoteDesktopUrl('https://petpal.example',own.id,{...ticket,path:'//other.example/ws'}));
  assert.throws(()=>remoteDesktopUrl('https://petpal.example',own.id,{...ticket,expiresAt:Date.now()-1}));
  assert.throws(()=>remoteDesktopUrl('https://petpal.example',own.id,{...ticket,ticket:'credential?token=forever'}));
  assert.throws(()=>remoteDesktopUrl('https://user:password@petpal.example',own.id,ticket));
});

test('K3s selection forces CLI, submits resources, and unready nodes remain visibly blocked',async t=>{
 const node={id:'k3s-node',name:'K3s',available:true,ready:false,runtimeKind:'kubernetes',message:'K3s 节点待配置',kubernetesConstraints:{pidsLimit:256}};
 const f=fixture('cloud',{catalog:{sources,nodes:[node]},hosts:[]});t.after(()=>f.close());await f.flush();
 f.click('新建环境');f.change('Docker 运行位置','platform');f.change('运行节点','k3s-node');
 assert.equal(f.field('环境类型').props.value,'agent');assert.equal(f.button('创建环境').props.disabled,true);assert.match(f.text(),/K3s 节点待配置/);
 f.submit();await f.flush();assert.equal(f.requests.filter(c=>c.method==='POST').length,0);
 const ready=fixture('cloud',{catalog:{sources,nodes:[{...node,ready:true}]},hosts:[],identity:{userId:'k3s-user'}});t.after(()=>ready.close());await ready.flush();
 ready.click('新建环境');ready.change('Docker 运行位置','platform');ready.change('运行节点','k3s-node');ready.change('CPU 核数','1');ready.change('内存（MiB）','1024');ready.submit();await ready.flush();
 const post=ready.requests.find(c=>c.method==='POST');assert.equal(post.body.bundle,'agent');assert.deepEqual(clone(post.body.resources),{cpus:1,memoryMiB:1024});
});
