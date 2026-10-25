import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

const compile=async file=>ts.transpileModule(await readFile(new URL(file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
const [source,scopeSource]=await Promise.all(['../src/HistoryArchives.tsx','../src/platform/cloud-session.ts'].map(compile));
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):!tree||typeof tree!=='object'?[]:[tree,...nodes(tree.props?.children)];
const text=tree=>Array.isArray(tree)?tree.map(text).join(''):tree==null||typeof tree==='boolean'?'':typeof tree!=='object'?String(tree):text(tree.props?.children);
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const user={id:'history-account-one',username:'fixture',displayName:'Fixture',role:'user',isAdmin:false,isOwner:false,canUseCodex:true,agentAccess:'full'};
const archive={id:'archive-first',personName:'本人历史',sourceStart:'2025-07-20T10:00:00+08:00',sourceEnd:'2026-10-25T12:00:00+08:00',messageCount:53464,importedAt:'2026-10-25T14:00:00+08:00',memory:{total:625,acked:125,state:'running'}};
const message=(id,body,rest={})=>({id,speaker:'self',speakerName:'本人',occurredAt:'2025-07-20T16:30:00Z',text:body,kind:'text',attachmentCount:0,...rest});

/** Real handlers and useCloudSession run against isolated HTTP and React lifetimes. */
function fixture(options={}){
  let epoch=1,identity={instanceId:'history-instance',userId:user.id},hookIndex=0,tree,dirty=false,mounted=true,afterUnmount=0;
  const hooks=[],effects=[],requests=[],subscriptions=new Set(),props={connected:true,user,...options.props};
  identity.userId=props.user?.id||'no-user';
  const same=(left,right)=>left&&right&&left.length===right.length&&left.every((value,index)=>Object.is(value,right[index]));
  const react={
    useRef(value){const at=hookIndex++;hooks[at]??={ref:{current:value}};return hooks[at].ref;},
    useState(value){const at=hookIndex++;hooks[at]??={value:typeof value==='function'?value():value};return[hooks[at].value,next=>{if(!mounted){afterUnmount++;return;}hooks[at].value=typeof next==='function'?next(hooks[at].value):next;dirty=true;}];},
    useEffect(effect,deps){const at=hookIndex++,prior=hooks[at];if(!same(prior?.deps,deps))effects.push(()=>{prior?.cleanup?.();hooks[at]={deps,cleanup:effect()};});},
  };
  class SessionChangedError extends Error{constructor(){super('Session changed');this.name='SessionChangedError';}}
  const api=async(path,request={})=>{
    const call={path,signal:request.signal,epoch,method:request.method||'GET'};requests.push(call);
    if(options.request){const value=await options.request(call);if(value!==undefined)return value;}
    if(path==='/history-archives')return{archives:options.archives??[archive]};
    if(path.includes('/messages?'))return options.page??{messages:[message('first','保留的原消息')],nextCursor:null,total:1};
    throw new Error('Unexpected fixture route');
  };
  const apiModule={api,getSessionEpoch:()=>epoch,getIdentity:()=>identity,subscribeSession:listener=>{subscriptions.add(listener);return()=>subscriptions.delete(listener);},SessionChangedError,isSessionChanged:failure=>failure?.name==='SessionChangedError'};
  const element=(type,props)=>typeof type==='function'?type(props):{type,props};
  const modules={react,'react/jsx-runtime':{jsx:element,jsxs:element},'lucide-react':new Proxy({},{get:(_target,name)=>Symbol.for(String(name))}),'./api':apiModule,'../api':apiModule};
  function evaluate(code){const module={exports:{}};vm.runInNewContext(code,{module,exports:module.exports,AbortController,DOMException,URLSearchParams,Date,Intl,Promise,require:name=>{if(name.endsWith('.css'))return{};assert.ok(Object.hasOwn(modules,name),name);return modules[name];}});return module.exports;}
  modules['./platform/cloud-session']=evaluate(scopeSource);
  const Component=evaluate(source).default;
  const render=()=>{hookIndex=0;dirty=false;effects.length=0;tree=Component(props);for(const effect of effects)effect();return tree;};
  const flush=async()=>{for(let count=0;count<14;count++){await new Promise(resolve=>setImmediate(resolve));if(mounted&&dirty)render();}};
  const find=(type,check=()=>true)=>nodes(tree).find(node=>node.type===type&&check(node.props));
  const button=label=>find('button',p=>p['aria-label']===label||text(p.children).trim()===label);
  const clickNode=node=>{assert.ok(node,'Missing button');if(!node.props.disabled)node.props.onClick?.({preventDefault(){}});render();};
  render();
  return{requests,props,render,flush,find,button,text:()=>text(tree),get tree(){return tree;},get afterUnmount(){return afterUnmount;},
    click(label){clickNode(button(label));},
    choose(name){clickNode(find('button',p=>p.className==='history-archive-choice'&&text(p.children).includes(name)));},
    change(label,value){const node=nodes(tree).find(node=>['input','select'].includes(node.type)&&node.props['aria-label']===label);assert.ok(node,label);node.props.onChange({target:{value}});render();},
    submit(){const form=find('form');assert.ok(form);form.props.onSubmit({preventDefault(){}});render();},
    session(nextUser){epoch++;identity={instanceId:'history-instance-next',userId:nextUser?.id||'no-user'};props.user=nextUser;for(const listener of subscriptions)listener();render();},
    disconnect(){props.connected=false;render();},
    close(){if(!mounted)return;mounted=false;for(const hook of hooks)hook?.cleanup?.();},
  };
}

const open=async f=>{f.click('查看历史档案');await f.flush();};
const choose=async(f,name=archive.personName)=>{f.choose(name);await f.flush();};

test('archive catalog and original messages load only after deliberate expansion and selection',async()=>{
  const f=fixture();assert.equal(f.requests.length,0);await open(f);
  assert.deepEqual(f.requests.map(r=>r.path),['/history-archives']);assert.match(f.text(),/53,464 条原消息/);assert.match(f.text(),/本人记忆材料已同步 125 \/ 625/);assert.doesNotMatch(f.text(),/已确认事实/);
  await choose(f);assert.equal(f.requests.length,2);assert.equal(new URL(f.requests[1].path,'https://fixture.invalid').searchParams.get('limit'),'100');assert.match(f.text(),/保留的原消息/);assert.match(f.text(),/2025\/07\/21 00:30:00/);assert.doesNotMatch(f.requests[1].path,/userId|history-account/);f.close();
});

test('actual archive job states distinguish preparation, extraction and disabled memory',async()=>{
  for(const [state,label] of Object.entries({staging:'等待导入',prepared:'准备完成',working:'提炼中',disabled:'记忆已停用',complete:'已完成'})){
    const f=fixture({archives:[{...archive,memory:{...archive.memory,state}}]});await open(f);assert.match(f.text(),new RegExp(label));assert.match(f.text(),/本人记忆材料已同步 125 \/ 625/);assert.doesNotMatch(f.text(),/待确认|已确认事实/);f.close();
  }
});

test('historical speakers and 81KB originals remain literal text with reversible visual folding',async()=>{
  const original='<script>window.untrusted()</script>\n'+('原文'.repeat(41000))+'\nhttps://example.invalid/untrusted';
  const f=fixture({page:{messages:[message('long',original),message('other','另一位真人的话',{speaker:'other',speakerName:'另一位',attachmentCount:2,kind:'image'}),message('system','系统原记录',{speaker:'system',speakerName:''})],nextCursor:null,total:3}});await open(f);await choose(f);
  assert.ok(nodes(f.tree).some(node=>node.type==='div'&&node.props.children===original));assert.ok(!nodes(f.tree).some(node=>['script','iframe','img','a'].includes(node.type)||node.props?.dangerouslySetInnerHTML));
  assert.match(f.text(),/对方 · 另一位/);assert.match(f.text(),/系统记录/);assert.match(f.text(),/附件引用 2/);assert.doesNotMatch(f.text(),/AI assistant/);
  assert.equal(f.button('展开原文 long').props['aria-expanded'],false);f.click('展开原文 long');assert.equal(f.button('收起原文 long').props['aria-expanded'],true);assert.ok(nodes(f.tree).some(node=>node.props?.children===original&&!node.props.className?.includes('is-collapsed')));assert.equal(f.requests.length,2);f.close();
});

test('filter submission encodes terms and source dates without sending account identity',async()=>{
  const f=fixture();await open(f);await choose(f);
  f.change('搜索历史原文',' 新想法 & 下一步 ');f.change('历史起始日期','2025-07-20');f.change('历史结束日期','2025-08-01');f.change('历史说话人','self');assert.equal(f.requests.length,2);f.submit();await f.flush();
  const params=new URL(f.requests.at(-1).path,'https://fixture.invalid').searchParams;assert.equal(params.get('q'),'新想法 & 下一步');assert.equal(params.get('from'),'2025-07-20');assert.equal(params.get('to'),'2025-08-01');assert.equal(params.get('speaker'),'self');assert.equal(params.get('cursor'),'0');assert.equal(params.has('userId'),false);
  f.change('历史起始日期','2025-09-01');f.submit();await f.flush();assert.match(f.text(),/请检查起止日期/);assert.equal(f.requests.length,3);f.close();
});

test('pagination requests its cursor once and does not duplicate an overlapping message',async()=>{
  const next=deferred();const f=fixture({request:call=>call.path.includes('/messages?')?new URL(call.path,'https://fixture.invalid').searchParams.get('cursor')==='100'?next.promise:{messages:[message('first','第一条原消息')],nextCursor:100,total:2}:undefined});await open(f);await choose(f);
  f.click('加载更多原消息');f.click('加载更多原消息');assert.equal(f.requests.length,3);next.resolve({messages:[message('first','第一条原消息'),message('second','第二条原消息')],nextCursor:null,total:2});await f.flush();
  assert.equal(nodes(f.tree).filter(node=>node.type==='article').length,2);assert.equal(f.button('加载更多原消息'),undefined);assert.match(f.text(),/已显示 2 条/);f.close();
});

test('switching archives aborts late pages and never labels them as the newly selected archive',async()=>{
  const late=deferred(),other={...archive,id:'archive-next',personName:'第二份历史'};
  const f=fixture({archives:[archive,other],request:call=>call.path.startsWith('/history-archives/archive-first/messages')?late.promise:call.path.startsWith('/history-archives/archive-next/messages')?{messages:[message('next','第二份的原文')],nextCursor:null,total:1}:undefined});await open(f);f.choose(archive.personName);const old=f.requests.at(-1);f.click('全部档案');await f.flush();await choose(f,other.personName);assert.equal(old.signal.aborted,true);
  late.resolve({messages:[message('old','旧档案迟到原文')],nextCursor:null,total:1});await f.flush();assert.match(f.text(),/第二份的原文/);assert.doesNotMatch(f.text(),/旧档案迟到原文/);f.close();
});

test('account changes, disconnect and unmount abort their requests and suppress old-account content',async()=>{
  for(const action of ['session','disconnect','close']){
    const late=deferred(),f=fixture({request:call=>call.path==='/history-archives'?late.promise:undefined});f.click('查看历史档案');const pending=f.requests[0];
    if(action==='session')f.session({...user,id:'history-account-two'});else f[action]();assert.equal(pending.signal.aborted,true);
    late.resolve({archives:[{...archive,personName:'旧账号私人档案'}]});await f.flush();assert.doesNotMatch(f.text(),/旧账号私人档案/);assert.equal(f.afterUnmount,0);f.close();
  }
});

test('private diagnostics are not rendered and a failed page can be retried explicitly',async()=>{
  let calls=0;const f=fixture({request:call=>{if(call.path.includes('/messages?')&&++calls===1)throw new Error('private diagnostic detail');}});await open(f);await choose(f);assert.match(f.text(),/暂时无法读取历史档案/);assert.doesNotMatch(f.text(),/private diagnostic/);
  f.click('刷新档案');await f.flush();assert.match(f.text(),/保留的原消息/);assert.doesNotMatch(f.text(),/暂时无法读取历史档案/);assert.equal(calls,2);f.close();
});

test('malformed archive pages remain a bounded error instead of breaking the memory settings page',async()=>{
  const f=fixture({page:{messages:[{id:'unsafe',text:{nested:'invalid'},speaker:'self'}],nextCursor:0,total:1}});await open(f);await choose(f);assert.match(f.text(),/暂时无法读取历史档案/);assert.equal(nodes(f.tree).filter(node=>node.type==='article').length,0);f.close();
});
