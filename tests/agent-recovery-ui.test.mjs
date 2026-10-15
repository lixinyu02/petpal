import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

const source=ts.transpileModule(await readFile(new URL('../src/AgentQueue.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):!tree||typeof tree!=='object'?[]:[tree,...nodes(tree.props?.children)];
const text=tree=>Array.isArray(tree)?tree.map(text).join(''):tree==null||typeof tree==='boolean'?'':typeof tree!=='object'?String(tree):text(tree.props?.children);
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
const base=()=>({revision:11,queueRevision:3,paused:true,queue:[{id:'queued-one',revision:1,content:'待执行任务',attachmentIds:[],permissions:{access:'full-access',approval:'ask'},model:'fixture',hostId:'pc'}],run:{id:'lost-run',status:'unknown',hostName:'原执行电脑'},approvals:[],submissions:[{submissionId:'lost-submit',entryId:'lost-run',status:'uncertain',content:'可能仍执行的任务'}]});

/** Execute real recovery UI handlers, including post-request and lifecycle races. */
function fixture(state=base()){
  let index=0,tree,dirty=false,epoch=1,mounted=true,lateUpdates=0,refreshCount=0,newCount=0,requestWait,requestFailure,refreshWait,refreshFailure,nextSnapshot;
  const hooks=[],effects=[],requests=[];
  const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
  const react={
    useState(initial){const at=index++;hooks[at]||={value:typeof initial==='function'?initial():initial};return[hooks[at].value,value=>{if(!mounted)lateUpdates++;hooks[at].value=typeof value==='function'?value(hooks[at].value):value;dirty=true;}];},
    useRef(initial){const at=index++;hooks[at]||={ref:{current:initial}};return hooks[at].ref;},
    useEffect(effect,deps){const at=index++,old=hooks[at];if(!same(old?.deps,deps))effects.push(()=>{old?.cleanup?.();hooks[at]={deps,cleanup:effect()};});},useId:()=> 'recovery-fixture',
  };
  const api={getSessionEpoch:()=>epoch,isSessionChanged:error=>error?.name==='SessionChangedError',async api(path,options){requests.push({path,method:options.method,body:JSON.parse(options.body)});const wait=requestWait;requestWait=undefined;if(wait)await wait.promise;if(requestFailure){const error=requestFailure;requestFailure=undefined;throw error;}return{ok:true};}};
  const props={conversationId:'original-chat',state:structuredClone(state),hosts:[{id:'pc',online:true}],onNewConversation(){newCount++;},async refresh(){refreshCount++;const wait=refreshWait;refreshWait=undefined;if(wait)await wait.promise;if(refreshFailure){const error=refreshFailure;refreshFailure=undefined;throw error;}if(nextSnapshot){props.state=structuredClone(nextSnapshot);nextSnapshot=undefined;dirty=true;}}};
  const element=(type,props)=>({type,props}),module={exports:{}},modules={react,'react/jsx-runtime':{jsx:element,jsxs:element},'./api':api,'lucide-react':new Proxy({},{get:(_target,key)=>Symbol.for(String(key))})};
  vm.runInNewContext(source,{module,exports:module.exports,require:name=>{if(name.endsWith('.css'))return{};assert.ok(Object.hasOwn(modules,name),`Unexpected module ${name}`);return modules[name];}});
  const render=()=>{for(let pass=0;pass<8;pass++){index=0;effects.length=0;dirty=false;tree=module.exports.default(props);for(const effect of effects)effect();if(!dirty)return;}assert.fail('recovery UI failed to settle');};
  const find=(type,predicate=()=>true)=>nodes(tree).find(node=>node.type===type&&predicate(node.props));
  const button=label=>find('button',props=>typeof label==='string'?(props['aria-label']||text(props.children))===label:label.test(props['aria-label']||text(props.children)));
  const flush=async()=>{for(let i=0;i<8;i++){await new Promise(resolve=>setImmediate(resolve));if(dirty&&mounted)render();}};
  render();
  return{props,requests,render,flush,find,button,text:()=>text(tree),get refreshCount(){return refreshCount;},get newCount(){return newCount;},get lateUpdates(){return lateUpdates;},
    click(label){const target=button(label);assert.ok(target,`Missing ${label}`);assert.notEqual(target.props.disabled,true,`Disabled ${label}`);target.props.onClick();render();},
    check(value=true){const input=find('input',props=>props.type==='checkbox');assert.ok(input);assert.notEqual(input.props.disabled,true);input.props.onChange({target:{checked:value}});render();},
    delayRequest(){requestWait=deferred();return requestWait;},failRequest(error){requestFailure=error;},delayRefresh(){refreshWait=deferred();return refreshWait;},failRefresh(error){refreshFailure=error;},snapshot(value){nextSnapshot=value;},
    changeState(update){props.state={...props.state,...update};render();},changeConversation(){props.conversationId='different-chat';props.state={...base(),run:{id:'other-run',status:'unknown'},submissions:[]};render();},changeSession(renderNow=false){epoch++;if(renderNow)render();},
    async close(){if(mounted){mounted=false;for(const hook of hooks)hook?.cleanup?.();}await flush();assert.equal(lateUpdates,0);},
  };
}
const open=/处理任务 lost-run 的未知执行状态/;
const submit=/确认解除任务 lost-run 的状态保护/;

test('unknown execution requires explicit two-step confirmation and never duplicates its uncertain submission card',async t=>{
  const f=fixture();t.after(()=>f.close());assert.ok(f.button(open));assert.equal(f.find('input'),undefined);assert.doesNotMatch(f.text(),/可能仍执行的任务/);assert.equal(f.button('继续队列').props.disabled,true);
  f.click(open);assert.equal(f.find('input').props.checked,false);assert.equal(f.button(submit).props.disabled,true);assert.equal(f.requests.length,0);
  f.button(submit).props.onClick();await f.flush();assert.equal(f.requests.length,0,'unchecked direct handler cannot submit');f.check();f.click(submit);await f.flush();
  assert.deepEqual(f.requests,[{path:'/conversations/original-chat/agent/recover',method:'POST',body:{runId:'lost-run',revision:11,confirmedStopped:true}}]);assert.match(f.text(),/队列仍暂停.*另点「继续队列」.*不会重新派发/);assert.equal(f.refreshCount,1);
});

test('a completed run with several uncertain steer deliveries exposes individually scoped recovery entries',async t=>{
  const state=base();state.run.status='completed';state.submissions=[{submissionId:'s1',entryId:'steer-one',status:'uncertain',content:'第一条引导'},{submissionId:'s2',entryId:'steer-two',status:'uncertain',content:'第二条引导'}];
  const f=fixture(state);t.after(()=>f.close());assert.ok(f.button(/处理任务 steer-one/));assert.ok(f.button(/处理任务 steer-two/));assert.equal(f.button('继续队列').props.disabled,true);
  f.click(/处理任务 steer-two/);f.check();f.click(/确认解除任务 steer-two/);await f.flush();assert.deepEqual(f.requests[0].body,{runId:'steer-two',revision:11,confirmedStopped:true});assert.equal(f.requests.length,1);
});

test('recovery success updates from the server and leaves resumption as a separate user action',async t=>{
  const f=fixture();t.after(()=>f.close());const restored=base();restored.revision=12;restored.run.status='cancelled';restored.submissions=[];f.snapshot(restored);
  f.click(open);f.check();f.click(submit);await f.flush();assert.equal(f.props.state.paused,true);assert.equal(f.requests.length,1);assert.equal(f.button('继续队列').props.disabled,false);assert.equal(f.button(open),undefined);
  f.click('继续队列');await f.flush();assert.deepEqual(f.requests[1],{path:'/conversations/original-chat/agent/queue/resume',method:'POST',body:{}});
});

test('canceling recovery submits nothing and opening it again never retains an earlier checked assertion',async t=>{
  const f=fixture();t.after(()=>f.close());f.click(open);f.check();f.click('取消');assert.equal(f.find('input'),undefined);assert.equal(f.requests.length,0);f.click(open);assert.equal(f.find('input').props.checked,false);f.click('取消');f.click('开启新对话');assert.equal(f.newCount,1);assert.equal(f.requests.length,0);
});

test('switching between uncertain items cannot transfer the stopped confirmation',async t=>{
  const state=base();state.submissions.push({submissionId:'s2',entryId:'other-uncertain',status:'uncertain',content:'其他未确认引导'});const f=fixture(state);t.after(()=>f.close());
  f.click(open);f.check();f.click(/处理任务 other-uncertain/);assert.equal(f.find('input').props.checked,false);assert.equal(f.button(/确认解除任务 other-uncertain/).props.disabled,true);assert.equal(f.requests.length,0);
});

for(const status of ['running','stopping'])test(`recovery cannot submit while the authoritative run is ${status}`,async t=>{
  const state=base();state.run.status=status;const f=fixture(state);t.after(()=>f.close());const target=f.button(open);assert.ok(target);assert.equal(target.props.disabled,true);target.props.onClick();f.render();assert.equal(f.find('input'),undefined);assert.equal(f.requests.length,0);
});

for(const change of ['revision','run','conversation','session'])test(`a ${change} change clears an old confirmation and fences its captured submit handler`,async t=>{
  const f=fixture();t.after(()=>f.close());f.click(open);f.check();const handler=f.button(submit).props.onClick;
  if(change==='revision')f.changeState({revision:12});else if(change==='run')f.changeState({run:{id:'different-run',status:'unknown'}});else if(change==='conversation')f.changeConversation();else f.changeSession(true);
  assert.equal(f.find('input'),undefined);handler();await f.flush();assert.equal(f.requests.length,0);assert.doesNotMatch(f.text(),/已解除所选任务/);
});

test('even an account change without rerender fences a captured checked submit',async t=>{
  const f=fixture();t.after(()=>f.close());f.click(open);f.check();const handler=f.button(submit).props.onClick;f.changeSession();handler();await f.flush();assert.equal(f.requests.length,0);
});

test('repeated submit and shared queue mutations are single flight without any automatic re-dispatch',async t=>{
  const f=fixture();t.after(()=>f.close());f.click(open);f.check();const wait=f.delayRequest(),handler=f.button(submit).props.onClick;handler();handler();f.render();
  assert.equal(f.requests.length,1);const openAgain=f.button(open);assert.equal(openAgain.props.disabled,true);openAgain.props.onClick();f.render();assert.equal(f.find('input'),undefined);
  f.click(/展开队列/);f.button(/删除第 1 条/).props.onClick();assert.equal(f.requests.length,1);wait.resolve();await f.flush();assert.equal(f.refreshCount,1);assert.equal(f.requests.length,1);
});

test('stale recovery revision refreshes authoritative state without retry or an inherited checked confirmation',async t=>{
  const f=fixture();t.after(()=>f.close());const changed=base();changed.revision=15;changed.run.id='other-lost-run';changed.submissions=[];f.snapshot(changed);f.failRequest(Object.assign(new Error('stale revision'),{status:409}));
  f.click(open);f.check();f.click(submit);await f.flush();assert.deepEqual(f.props.state,changed);assert.match(f.text(),/任务状态已变化，已刷新/);assert.equal(f.find('input'),undefined);assert.equal(f.requests.length,1);assert.equal(f.refreshCount,1);
});

test('a confirmed write whose state refresh fails remains reported as committed and does not replay',async t=>{
  const f=fixture();t.after(()=>f.close());f.failRefresh(new Error('offline'));f.click(open);f.check();f.click(submit);await f.flush();assert.match(f.text(),/已解除所选任务.*队列仍暂停/);assert.match(f.text(),/操作已提交，但队列暂时无法刷新/);assert.equal(f.requests.length,1);assert.equal(f.find('input'),undefined);
});

for(const boundary of ['conversation','session','unmount'])for(const failed of [false,true])test(`late ${failed?'failed':'successful'} recovery cannot escape the ${boundary} boundary`,async t=>{
  const f=fixture();t.after(()=>f.close());f.click(open);f.check();const wait=f.delayRequest();if(failed)f.failRequest(Object.assign(new Error('late conflict'),{status:409}));f.click(submit);
  if(boundary==='conversation')f.changeConversation();else if(boundary==='session')f.changeSession();else await f.close();wait.resolve();await f.flush();assert.equal(f.refreshCount,0);assert.equal(f.lateUpdates,0);assert.doesNotMatch(f.text(),/已解除所选任务|late conflict|任务状态已变化/);
});

test('a recovery conflict followed by a failed read does not retain its checked form or retry',async t=>{
  const f=fixture();t.after(()=>f.close());f.failRequest(Object.assign(new Error('stale'),{status:409}));f.failRefresh(new Error('offline'));f.click(open);f.check();f.click(submit);await f.flush();assert.equal(f.requests.length,1);assert.equal(f.find('input'),undefined);assert.match(f.text(),/暂时无法刷新/);
});
