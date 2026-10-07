import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import * as preferences from '../src/chat-assistant-preferences.mjs';
import * as directories from '../src/project-directory-preferences.mjs';
import * as reviewUi from '../src/approval-review-ui.mjs';
import * as messageReuse from '../src/conversation-message-reuse.mjs';

const source=ts.transpileModule(await readFile(new URL('../src/ChatAssistant.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):!tree||typeof tree!=='object'?[]:[tree,...nodes(tree.props?.children)];
const text=tree=>Array.isArray(tree)?tree.map(text).join(''):tree==null||typeof tree==='boolean'?'':typeof tree!=='object'?String(tree):text(tree.props?.children);
const clone=value=>structuredClone(value);
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};

/** Execute the real background-task effects and approval event handlers, with controllable HTTP delivery. */
function fixture({hasApproval=true,review,failInitialRead=false,messages=[]}={}){
  let index=0,tree,dirty=false,epoch=1,mounted=true,lateUpdates=0,timerId=0;
  const hooks=[],effects=[],timers=new Map(),requests=[],failures=[],delays=[];
  const child={id:'child-agent',mode:'codex',messages:clone(messages),agent:{revision:1,queue:[],paused:false,run:{id:'run-one',status:'running',permissions:{access:'full-access',approval:'review'},approvalReview:review},approvals:hasApproval?[{id:'approval-one',kind:'desktopTool',description:'将 Fixture PC 系统音量调到 45%'}]:[]}};
  const task={id:'task-one',conversationId:child.id,hostId:'fixture-pc',hostName:'Fixture PC',status:'running',message:'处理电脑操作'};
  const props={conversationId:'foreground-chat',tasks:[task],onUpdate(){}};
  const same=(left,right)=>left&&right&&left.length===right.length&&left.every((entry,at)=>Object.is(entry,right[at]));
  const react={
    useState(initial){const at=index++;hooks[at]||={value:typeof initial==='function'?initial():initial};return[hooks[at].value,next=>{if(!mounted)lateUpdates++;hooks[at].value=typeof next==='function'?next(hooks[at].value):next;dirty=true;}];},
    useRef(initial){const at=index++;hooks[at]||={ref:{current:initial}};return hooks[at].ref;},
    useEffect(effect,deps){const at=index++,before=hooks[at];if(!same(before?.deps,deps))effects.push(()=>{before?.cleanup?.();hooks[at]={deps,cleanup:effect()};});},
    useCallback:callback=>callback,useId:()=> 'task-fixture',
  };react.useLayoutEffect=react.useEffect;
  const element=(type,props)=>({type,props}),module={exports:{}};
  const api={getSessionEpoch:()=>epoch,isSessionChanged:cause=>cause?.name==='SessionChangedError',api:async(path,options={})=>{
    const method=options.method||'GET';requests.push({path,method,body:options.body?JSON.parse(options.body):undefined});
    const failure=failures.findIndex(entry=>entry.path===path&&entry.method===method);if(failure>=0)throw failures.splice(failure,1)[0].error;
    let value;
    if(path===`/conversations/${child.id}`&&method==='GET')value=clone(child);
    else if(path==='/conversations/foreground-chat'&&method==='GET')value={id:props.conversationId,mode:'chat',messages:[],assistantTasks:props.tasks};
    else if(path==='/codex/approvals/approval-one'&&method==='POST'){
      assert.ok(child.agent.approvals.some(item=>item.id==='approval-one'),'fixture cannot positively acknowledge a consumed approval');
      child.agent.approvals=[];child.agent.revision++;value={ok:true};
    }else throw Error(`Unexpected API: ${method} ${path}`);
    const delayed=delays.findIndex(entry=>entry.path===path&&entry.method===method);
    if(delayed>=0){const entry=delays.splice(delayed,1)[0];entry.started.resolve(value);await entry.release.promise;return entry.value===undefined?value:clone(entry.value);}
    return value;
  }};
  const modules={react,'react/jsx-runtime':{jsx:element,jsxs:element},'react-dom':{createPortal:element},'lucide-react':new Proxy({},{get:(_target,key)=>Symbol.for(String(key))}),
    './api':api,'./AgentPermissions':{__esModule:true,default:Symbol('AgentPermissions'),defaultAgentPermissions:{access:'read-only',approval:'ask'}},
    './WorkspaceControls':{ExecutionHostPicker:Symbol('ExecutionHostPicker'),ModelPicker:Symbol('ModelPicker')},'./ProjectDirectory':{__esModule:true,default:Symbol('ProjectDirectory')},
    './chat-assistant-preferences.mjs':preferences,'./project-directory-preferences.mjs':directories,'./approval-review-ui.mjs':reviewUi,'./conversation-message-reuse.mjs':messageReuse,'./platform/ui-motion.ts':{useUiEntrance:()=>({current:null})}};
  vm.runInNewContext(source,{module,exports:module.exports,AbortController,setTimeout(callback,delay){const id=++timerId;timers.set(id,{callback,delay});return id;},clearTimeout:id=>timers.delete(id),require:name=>{if(name.endsWith('.css'))return{};assert.ok(Object.hasOwn(modules,name),`Unexpected dependency: ${name}`);return modules[name];}});
  const render=()=>{for(let pass=0;pass<8;pass++){index=0;effects.length=0;dirty=false;tree=module.exports.ChatAssistantTasks(props);for(const effect of effects)effect();if(!dirty)return tree;}assert.fail('fixture failed to settle');};
  const find=(type,predicate=()=>true)=>nodes(tree).find(node=>node.type===type&&predicate(node.props));
  const flush=async()=>{for(let tick=0;tick<10;tick++){await new Promise(resolve=>setImmediate(resolve));if(dirty&&mounted)render();}};
  if(failInitialRead)failures.push({path:`/conversations/${child.id}`,method:'GET',error:new Error('Fixture child read unavailable')});
  render();
  return{requests,child,props,find,render,flush,text:()=>text(tree),get lateUpdates(){return lateUpdates;},
    get snapshot(){return hooks.find(hook=>hook?.value&&Object.hasOwn(hook.value,child.id))?.value[child.id];},
    tick(delay){const entry=[...timers].find(([,timer])=>timer.delay===delay);assert.ok(entry,`Missing ${delay}ms poll timer`);timers.delete(entry[0]);entry[1].callback();render();},
    click(label){const button=find('button',props=>text(props.children)===label);assert.ok(button,`Missing ${label}`);button.props.onClick();render();},
    failNext(path,method='GET',error=new Error('Fixture lost response')){failures.push({path,method,error});},
    delayNext(path,method='GET'){const entry={path,method,started:deferred(),release:deferred()};delays.push(entry);return{started:entry.started.promise,release(value){entry.value=value;entry.release.resolve();}};},
    changeSession(){epoch++;},
    changeParent(){props.conversationId='another-chat';props.tasks=[];render();},
    async close(){if(mounted){mounted=false;for(const hook of hooks)hook?.cleanup?.();}await flush();assert.equal(timers.size,0);assert.equal(lateUpdates,0,'late approval continuations cannot update an unmounted task view');},
  };
}

test('background approvals are visible as waiting for confirmation, and repeated event handlers send one decision',async t=>{
  const f=fixture();t.after(()=>f.close());await f.flush();assert.match(f.text(),/等待确认/);
  const post=f.delayNext('/codex/approvals/approval-one','POST'),handler=f.find('button',props=>text(props.children)==='允许本次').props.onClick;
  handler();handler();await post.started;f.render();assert.equal(f.requests.filter(item=>item.method==='POST').length,1);assert.equal(f.find('button',props=>text(props.children)==='拒绝').props.disabled,true);
  post.release();await f.flush();assert.equal(f.find('div',props=>props.className==='assistant-task-approval'),undefined);handler();await f.flush();assert.equal(f.requests.filter(item=>item.method==='POST').length,1);
});

test('a positive background decision immediately consumes the card even while stale progress readback is pending',async t=>{
  const f=fixture();t.after(()=>f.close());await f.flush();const stale=clone(f.child),read=f.delayNext(`/conversations/${f.child.id}`);
  f.click('允许本次');await read.started;f.render();assert.equal(f.find('div',props=>props.className==='assistant-task-approval'),undefined);
  read.release(stale);await f.flush();assert.equal(f.find('div',props=>props.className==='assistant-task-approval'),undefined);assert.equal(f.requests.filter(item=>item.method==='POST').length,1);
});

test('background approval success followed by a failed read explains the committed decision without offering replay',async t=>{
  const f=fixture();t.after(()=>f.close());await f.flush();f.failNext(`/conversations/${f.child.id}`);f.click('允许本次');await f.flush();
  assert.match(f.text(),/确认已提交.*后台任务进度暂时无法刷新.*请勿重复提交/);assert.equal(f.find('div',props=>props.className==='assistant-task-approval'),undefined);assert.equal(f.requests.filter(item=>item.method==='POST').length,1);
});

test('uncertain background delivery requires explicit read-only status refresh before another decision',async t=>{
  const f=fixture();t.after(()=>f.close());await f.flush();const handler=f.find('button',props=>text(props.children)==='允许本次').props.onClick;
  f.failNext('/codex/approvals/approval-one','POST');handler();await f.flush();assert.match(f.text(),/确认结果尚未收到/);assert.equal(f.find('button',props=>text(props.children)==='允许本次'),undefined);
  handler();await f.flush();assert.equal(f.requests.filter(item=>item.method==='POST').length,1);f.click('刷新审批状态');await f.flush();
  assert.equal(f.find('button',props=>text(props.children)==='允许本次').props.disabled,false);assert.equal(f.requests.filter(item=>item.method==='POST').length,1);
});

test('a child read failure is surfaced and a successful refresh recovers the genuine pending approval',async t=>{
  const f=fixture({failInitialRead:true});t.after(()=>f.close());await f.flush();
  assert.match(f.text(),/无法读取后台 Agent 的审批状态/);assert.equal(f.find('div',props=>props.className==='assistant-task-approval'),undefined);
  f.click('刷新审批状态');await f.flush();assert.doesNotMatch(f.text(),/无法读取/);assert.match(f.text(),/等待确认/);assert.ok(f.find('div',props=>props.className==='assistant-task-approval'));
  assert.ok(f.requests.every(item=>item.method==='GET'),'status recovery must never launch or approve a task');
});

for(const boundary of ['session','parent','unmount'])test(`late background approval replies cannot escape the ${boundary} boundary`,async t=>{
  const f=fixture();t.after(()=>f.close());await f.flush();const post=f.delayNext('/codex/approvals/approval-one','POST');f.click('允许本次');await post.started;
  if(boundary==='session')f.changeSession();else if(boundary==='parent')f.changeParent();else await f.close();
  const reads=f.requests.filter(item=>item.method==='GET').length;post.release();await f.flush();
  assert.equal(f.requests.filter(item=>item.method==='GET').length,reads,'old reply cannot start an approval read in the new scope');assert.equal(f.lateUpdates,0);
  if(boundary==='parent')assert.equal(f.find('div',props=>props.className==='assistant-task-approval'),undefined);
});

test('guardian progress is reported while manual approvals retain priority over automatic-review feedback',async t=>{
  const reviewing=fixture({hasApproval:false,review:{status:'inProgress',reviewId:'review-one',rationale:'检查本次命令授权'}});t.after(()=>reviewing.close());await reviewing.flush();assert.match(reviewing.text(),/自动审查中/);assert.match(reviewing.text(),/检查本次命令授权/);assert.equal(reviewing.find('div',props=>props.className==='assistant-task-approval'),undefined);
  const waiting=fixture({review:{status:'approved',source:'local-rule'}});t.after(()=>waiting.close());await waiting.flush();assert.match(waiting.text(),/等待确认/);assert.match(waiting.text(),/音量操作已通过本地规则审查/);assert.ok(waiting.requests.every(item=>item.method==='GET'));
});

const history=()=>[
  {id:'child-user',role:'user',content:'请检查项目状态'},
  {id:'child-assistant',role:'assistant',content:'正在检查',status:'running',model:'fixture-model'},
];

test('real background child polls preserve message references while rendering the latest agent state',async t=>{
  const f=fixture({hasApproval:false,messages:history()});t.after(()=>f.close());await f.flush();
  const before=f.snapshot;assert.ok(before);const reads=f.requests.length;
  f.child.agent.revision=2;f.child.agent.run.approvalReview={status:'inProgress',rationale:'检查项目授权'};
  f.tick(3000);await f.flush();
  assert.equal(f.requests.length,reads+1);assert.notStrictEqual(f.snapshot,before);
  assert.strictEqual(f.snapshot.messages,before.messages);assert.equal(f.snapshot.agent.revision,2);
  assert.equal(f.snapshot.agent.run.approvalReview.status,'inProgress');assert.match(f.text(),/自动审查中/);assert.match(f.text(),/检查项目授权/);
  assert.ok(f.requests.every(item=>item.method==='GET'),'polling must remain read-only');
});

test('real background child polls replace only changed final content and preserve the historical message',async t=>{
  const f=fixture({hasApproval:false,messages:history()});t.after(()=>f.close());await f.flush();const before=f.snapshot;
  f.child.messages[1].content='检查完成，项目状态正常';f.child.messages[1].status='completed';f.child.agent.revision=3;f.child.agent.run.status='completed';
  f.tick(3000);await f.flush();
  assert.notStrictEqual(f.snapshot.messages,before.messages);assert.strictEqual(f.snapshot.messages[0],before.messages[0]);assert.notStrictEqual(f.snapshot.messages[1],before.messages[1]);
  assert.equal(f.snapshot.messages[1].content,'检查完成，项目状态正常');assert.equal(f.snapshot.messages[1].status,'completed');assert.equal(f.snapshot.agent.revision,3);
});

test('manual approval-state refresh uses the real child read and preserves unchanged message references',async t=>{
  const f=fixture({hasApproval:false,messages:history()});t.after(()=>f.close());await f.flush();const before=f.snapshot;
  f.failNext(`/conversations/${f.child.id}`);f.tick(3000);await f.flush();assert.match(f.text(),/无法读取后台 Agent 的审批状态/);
  f.child.agent.revision=4;f.child.agent.run.approvalReview={status:'inProgress',rationale:'刷新后的审批进度'};
  const reads=f.requests.length;f.click('刷新审批状态');await f.flush();
  assert.equal(f.requests.length,reads+1);assert.strictEqual(f.snapshot.messages,before.messages);assert.equal(f.snapshot.agent.revision,4);
  assert.match(f.text(),/刷新后的审批进度/);assert.doesNotMatch(f.text(),/无法读取后台 Agent/);assert.ok(f.requests.every(item=>item.method==='GET'));
});

for(const boundary of ['session','parent','unmount'])test(`late child snapshots cannot replace messages across the ${boundary} boundary`,async t=>{
  const f=fixture({hasApproval:false,messages:history()});t.after(()=>f.close());await f.flush();const before=f.snapshot;
  f.child.messages[1].content='late old-scope response';f.child.agent.revision=99;
  const read=f.delayNext(`/conversations/${f.child.id}`);f.tick(3000);await read.started;
  if(boundary==='session')f.changeSession();else if(boundary==='parent')f.changeParent();else await f.close();
  read.release();await f.flush();
  if(boundary==='parent')assert.equal(f.snapshot,undefined);else assert.strictEqual(f.snapshot,before);
  assert.equal(f.lateUpdates,0);assert.doesNotMatch(f.text(),/late old-scope response/);
});

test('manual child read cannot install a late snapshot after the session epoch changes',async t=>{
  const f=fixture({hasApproval:false,messages:history()});t.after(()=>f.close());await f.flush();const before=f.snapshot;
  f.failNext(`/conversations/${f.child.id}`);f.tick(3000);await f.flush();
  f.child.messages[1].content='late manually refreshed response';f.child.agent.revision=99;
  const read=f.delayNext(`/conversations/${f.child.id}`);f.click('刷新审批状态');await read.started;f.changeSession();read.release();await f.flush();
  assert.strictEqual(f.snapshot,before);assert.equal(f.lateUpdates,0);assert.equal(f.snapshot.agent.revision,1);
});
