import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

const source=ts.transpileModule(await readFile(new URL('../src/AgentQueue.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):!tree||typeof tree!=='object'?[]:[tree,...nodes(tree.props?.children)];
const text=tree=>Array.isArray(tree)?tree.map(text).join(''):tree==null||typeof tree==='boolean'?'':typeof tree!=='object'?String(tree):text(tree.props?.children);
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const entry=(id,content=id)=>({id,submissionId:`submission-${id}`,revision:1,content,attachmentIds:[],permissions:{access:'full-access',approval:'ask'},providerId:'fixture-provider',model:'fixture-model',effort:'low',hostId:'fixture-pc',hostName:'Fixture PC',projectDirectory:'/work/project',createdAt:'2026-10-15T00:00:00Z'});

/** Run the actual component handlers with controllable request delivery and React lifecycle. */
function fixture({state={revision:7,queueRevision:3,paused:false,queue:[entry('a','整理项目'),entry('b','检查图片'),entry('c','运行测试')],run:null,approvals:[]}}={}){
  let index=0,tree,dirty=false,epoch=1,mounted=true,lateUpdates=0,refreshCount=0,requestError,requestWait,refreshError,refreshWait,nextSnapshot;
  const hooks=[],effects=[],requests=[];
  const same=(left,right)=>left&&right&&left.length===right.length&&left.every((value,at)=>Object.is(value,right[at]));
  const react={
    useState(initial){const at=index++;hooks[at]||={value:typeof initial==='function'?initial():initial};return[hooks[at].value,next=>{if(!mounted)lateUpdates++;hooks[at].value=typeof next==='function'?next(hooks[at].value):next;dirty=true;}];},
    useRef(initial){const at=index++;hooks[at]||={ref:{current:initial}};return hooks[at].ref;},
    useEffect(effect,deps){const at=index++,before=hooks[at];if(!same(before?.deps,deps))effects.push(()=>{before?.cleanup?.();hooks[at]={deps,cleanup:effect()};});},
    useId:()=> 'queue-fixture',
  };
  const api={getSessionEpoch:()=>epoch,isSessionChanged:cause=>cause?.name==='SessionChangedError',async api(path,options){requests.push({path,method:options.method,body:JSON.parse(options.body)});const wait=requestWait;requestWait=undefined;if(wait)await wait.promise;if(requestError){const error=requestError;requestError=undefined;throw error;}return{ok:true};}};
  const props={conversationId:'queue-chat',state:structuredClone(state),hosts:[{id:'fixture-pc',name:'Fixture PC',online:true}],async refresh(){refreshCount++;const wait=refreshWait;refreshWait=undefined;if(wait)await wait.promise;if(refreshError){const error=refreshError;refreshError=undefined;throw error;}if(nextSnapshot){props.state=structuredClone(nextSnapshot);nextSnapshot=undefined;dirty=true;}}};
  const element=(type,props)=>({type,props}),module={exports:{}};
  const modules={react,'react/jsx-runtime':{jsx:element,jsxs:element},'./api':api,'lucide-react':new Proxy({},{get:(_target,key)=>Symbol.for(String(key))})};
  vm.runInNewContext(source,{module,exports:module.exports,require:name=>{if(name.endsWith('.css'))return{};assert.ok(Object.hasOwn(modules,name),`Unexpected dependency: ${name}`);return modules[name];}});
  const render=()=>{for(let pass=0;pass<8;pass++){index=0;effects.length=0;dirty=false;tree=module.exports.default(props);for(const effect of effects)effect();if(!dirty)return;}assert.fail('queue fixture did not settle');};
  const find=(type,predicate=()=>true)=>nodes(tree).find(node=>node.type===type&&predicate(node.props));
  const button=label=>find('button',props=>typeof label==='string'?props['aria-label']===label:label.test(props['aria-label']||text(props.children)));
  const flush=async()=>{for(let tick=0;tick<8;tick++){await new Promise(resolve=>setImmediate(resolve));if(dirty&&mounted)render();}};
  render();
  return{props,requests,render,flush,find,button,text:()=>text(tree),get refreshCount(){return refreshCount;},get lateUpdates(){return lateUpdates;},
    click(label){const target=button(label);assert.ok(target,`Missing button ${label}`);assert.notEqual(target.props.disabled,true,`Disabled button ${label}`);target.props.onClick();render();},
    delayRequest(){requestWait=deferred();return requestWait;},delayRefresh(){refreshWait=deferred();return refreshWait;},
    failRequest(error){requestError=error;},failRefresh(error){refreshError=error;},snapshot(value){nextSnapshot=value;},
    changeConversation(){props.conversationId='other-chat';props.state={revision:0,queueRevision:0,paused:false,queue:[entry('new','新会话任务')],run:null,approvals:[]};render();},
    changeSession(renderNow=false){epoch++;if(renderNow)render();},
    async close(){if(mounted){mounted=false;for(const hook of hooks)hook?.cleanup?.();}await flush();assert.equal(lateUpdates,0,'late queue continuations cannot update an unmounted component');},
  };
}

test('queue remains collapsed by default and exposes bounded, labelled move buttons only in its expandable list',async t=>{
  const f=fixture();t.after(()=>f.close());assert.equal(f.find('ol').props.hidden,true);f.click(/展开队列/);assert.equal(f.find('ol').props.hidden,false);
  assert.equal(f.button(/上移第 1 条.*整理项目/).props.disabled,true);assert.equal(f.button(/下移第 3 条.*运行测试/).props.disabled,true);
  assert.equal(f.button(/下移第 1 条.*整理项目/).props.disabled,false);assert.equal(f.button(/上移第 3 条.*运行测试/).props.disabled,false);
  f.button(/上移第 1 条/).props.onClick();f.button(/下移第 3 条/).props.onClick();await f.flush();assert.equal(f.requests.length,0);
});

for(const [direction,label,expected]of[['up',/上移第 2 条/,['b','a','c']],['down',/下移第 2 条/,['a','c','b']]])test(`${direction} submits only the complete pending queue order and its independent revision`,async t=>{
  const f=fixture();t.after(()=>f.close());const before=structuredClone(f.props.state);f.click(/展开队列/);f.click(label);await f.flush();
  assert.deepEqual(f.requests,[{path:'/conversations/queue-chat/agent/queue/reorder',method:'POST',body:{queueRevision:3,entryIds:expected}}]);assert.deepEqual(f.props.state,before,'no optimistic snapshot may overwrite a concurrent queue change');assert.equal(f.refreshCount,1);
});

test('old snapshots without queueRevision explicitly send migration revision zero',async t=>{
  const f=fixture();t.after(()=>f.close());delete f.props.state.queueRevision;f.render();f.click(/展开队列/);f.click(/下移第 1 条/);await f.flush();assert.equal(f.requests[0].body.queueRevision,0);
});

test('synchronous repeated handlers and all mutation buttons share one request lock',async t=>{
  const f=fixture();t.after(()=>f.close());f.props.state.paused=true;f.render();f.click(/展开队列/);const wait=f.delayRequest(),handler=f.button(/下移第 1 条/).props.onClick;
  handler();handler();f.render();assert.equal(f.requests.length,1);assert.equal(f.find('ol').props['aria-busy'],true);
  for(const target of nodes(f.find('ol')).filter(node=>node.type==='button'))assert.equal(target.props.disabled,true);
  assert.equal(f.button(/继续队列/).props.disabled,true);wait.resolve();await f.flush();assert.equal(f.find('ol').props['aria-busy'],false);assert.equal(f.refreshCount,1);
});

test('CAS conflict refreshes the server snapshot without retrying or replacing it with the attempted order',async t=>{
  const f=fixture();t.after(()=>f.close());const concurrent={...structuredClone(f.props.state),queueRevision:5,queue:[entry('c'),entry('a')]};
  f.snapshot(concurrent);f.failRequest(Object.assign(new Error('stale revision'),{status:409}));f.click(/展开队列/);f.click(/下移第 1 条/);await f.flush();
  assert.deepEqual(f.props.state,concurrent);assert.equal(f.requests.length,1);assert.equal(f.refreshCount,1);assert.match(f.text(),/队列已变化，已刷新当前顺序/);
});

test('conflict read failure and committed write read failure are distinguished',async t=>{
  const conflict=fixture();t.after(()=>conflict.close());conflict.failRequest(Object.assign(new Error('stale'),{status:409}));conflict.failRefresh(new Error('offline'));conflict.click(/展开队列/);conflict.click(/下移第 1 条/);await conflict.flush();assert.match(conflict.text(),/队列已变化，暂时无法刷新/);assert.equal(conflict.requests.length,1);
  const committed=fixture();t.after(()=>committed.close());committed.failRefresh(new Error('offline'));committed.click(/展开队列/);committed.click(/下移第 1 条/);await committed.flush();assert.match(committed.text(),/操作已提交，但队列暂时无法刷新/);assert.equal(committed.requests.length,1);
});

for(const boundary of ['conversation','session','unmount'])for(const failed of [false,true])test(`late ${failed?'failed':'successful'} reorder cannot affect the ${boundary} scope`,async t=>{
  const f=fixture();t.after(()=>f.close());f.click(/展开队列/);const wait=f.delayRequest();if(failed)f.failRequest(Object.assign(new Error('late conflict'),{status:409}));f.click(/下移第 1 条/);
  if(boundary==='conversation')f.changeConversation();else if(boundary==='session')f.changeSession();else await f.close();
  wait.resolve();await f.flush();assert.equal(f.refreshCount,0);assert.equal(f.lateUpdates,0);assert.doesNotMatch(f.text(),/late conflict|队列已变化/);
});

test('changing scope releases only its own lock and an old finally cannot unlock a new operation',async t=>{
  const f=fixture();t.after(()=>f.close());f.click(/展开队列/);const old=f.delayRequest();f.click(/下移第 1 条/);f.changeConversation();
  f.props.state.queue.push(entry('second','另一个任务'));f.render();f.click(/展开队列/);const fresh=f.delayRequest(),handler=f.button(/下移第 1 条/).props.onClick;handler();f.render();assert.equal(f.requests.length,2);
  old.resolve();await f.flush();handler();assert.equal(f.requests.length,2,'old completion cannot release the current lock');fresh.resolve();await f.flush();assert.equal(f.refreshCount,1);
});

test('late refresh completion cannot display an error after a conversation change',async t=>{
  const f=fixture();t.after(()=>f.close());f.click(/展开队列/);const wait=f.delayRefresh();f.failRefresh(new Error('late read failure'));f.click(/下移第 1 条/);await f.flush();assert.equal(f.refreshCount,1);f.changeConversation();wait.resolve();await f.flush();assert.doesNotMatch(f.text(),/操作已提交|late read failure/);assert.equal(f.lateUpdates,0);
});

test('edit, delete and resume retain their existing request contracts and no moves discard an edit draft',async t=>{
  const edit=fixture();t.after(()=>edit.close());edit.click(/展开队列/);edit.click('修改第 2 条排队消息');assert.equal(edit.button(/上移第/),undefined);
  edit.find('textarea').props.onChange({target:{value:'修改后的指令'}});edit.render();assert.equal(edit.find('textarea').props.value,'修改后的指令');edit.click('保存排队消息');await edit.flush();assert.deepEqual(edit.requests[0],{path:'/conversations/queue-chat/agent/queue/b',method:'PATCH',body:{revision:1,content:'修改后的指令',attachmentIds:[]}});
  const remove=fixture();t.after(()=>remove.close());remove.click(/展开队列/);remove.click('删除第 2 条排队消息');await remove.flush();assert.deepEqual(remove.requests[0],{path:'/conversations/queue-chat/agent/queue/b',method:'DELETE',body:{revision:1}});
  const resume=fixture();t.after(()=>resume.close());resume.props.state.paused=true;resume.render();resume.click(/继续队列/);await resume.flush();assert.deepEqual(resume.requests[0],{path:'/conversations/queue-chat/agent/queue/resume',method:'POST',body:{}});
});

test('active execution is excluded from reorder and image-only messages retain unique accessible labels',async t=>{
  const f=fixture();t.after(()=>f.close());f.props.state.run={id:'active-run',status:'running'};f.props.state.queue[1].content='';f.props.state.queue[1].attachmentIds=['image'];f.render();f.click(/展开队列/);assert.ok(f.button('上移第 2 条排队消息：b'));f.click(/上移第 2 条/);await f.flush();assert.deepEqual(f.requests[0].body.entryIds,['b','a','c']);assert.ok(!f.requests[0].body.entryIds.includes('active-run'));
});
