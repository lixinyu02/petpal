import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {createVisiblePoll} from '../src/platform/visible-poll.mjs';
import {mergeConversationOrganization} from '../src/conversation-organization-sync.mjs';
import {reuseConversationMessages} from '../src/conversation-message-reuse.mjs';
import {SessionChangedError} from '../src/auth/request-scope.mjs';

// Run the shipped App effect and its real snapshot commit path, not a parallel
// implementation. HTTP ignores AbortSignal to expose late-update regressions.
const source=await readFile(new URL('../src/App.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const app=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='App');
const declaration=name=>app.body.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name).getText(ast);
const effect=app.body.statements.find(node=>ts.isExpressionStatement(node)&&ts.isCallExpression(node.expression)&&node.expression.expression.getText(ast)==='useEffect'&&node.expression.arguments[0]?.getText(ast).includes('refreshConversation(selected'));
assert.ok(effect,'Agent polling effect must remain identifiable by its actual conversation refresh');
const compiled=ts.transpileModule(declaration('cacheAutomationConversation')+'\n'+declaration('refreshConversation')+'\nglobalThis.beginPolling='+effect.expression.arguments[0].getText(ast)+';',{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None},
}).outputText;
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
class Surface extends EventTarget{
  listeners=new Map();
  addEventListener(type,callback,options){super.addEventListener(type,callback,options);const set=this.listeners.get(type)||new Set();set.add(callback);this.listeners.set(type,set);}
  removeEventListener(type,callback,options){super.removeEventListener(type,callback,options);this.listeners.get(type)?.delete(callback);}
  get listenerCount(){return [...this.listeners.values()].reduce((sum,set)=>sum+set.size,0);}
}
const snapshot=(extra={})=>({id:'agent-one',mode:'codex',title:'Agent',messages:[],agent:{revision:1,run:{id:'run-one',status:'running'},submissions:[]},...extra});
const reply=(id,status='complete',content=id)=>({id,role:'assistant',status,content});

function fixture(t,{hidden=false,online=true,automation=false,selected='agent-one',mode='codex'}={}){
  const requests=[],timers=new Map(),document=new Surface(),window=new Surface(),spoken=[],phases=[],errors=[],pollErrors=[],submissions=[],queued=[];
  document.hidden=hidden;window.navigator={onLine:online};
  let epoch=1,clock=0,timerId=0,mounted=true,lateUpdates=0,deferUpdates=false;
  const initial=snapshot(automation?{automationId:'automation-one'}:{});
  let state={conversations:automation?[]:[initial]},loaded=automation?initial:null;
  const setTimeoutFn=(callback,delay)=>{const id=timerId++;timers.set(id,{callback,due:clock+delay});return id;};
  const clearTimeoutFn=id=>timers.delete(id);
  const update=(kind,value)=>{
    if(!mounted){lateUpdates++;return;}
    const apply=()=>{
      if(!mounted){lateUpdates++;return;}
      if(kind==='state')state=typeof value==='function'?value(state):value;
      else{loaded=typeof value==='function'?value(loaded):value;context.loadedAutomationConversationRef.current=loaded;}
    };
    if(deferUpdates)queued.push(apply);else apply();
  };
  const context={document,window,AbortController,DOMException,JSON,Set,SessionChangedError,selected,currentMode:mode,accountEpoch:1,
    getSessionEpoch:()=>epoch,isSessionChanged:error=>error?.name==='SessionChangedError',approvalAlive:{current:true},deletedConversationIds:{current:new Set()},organizationRevision:{current:0},
    loadedAutomationConversationRef:{current:loaded},setLoadedAutomationConversation:value=>update('loaded',value),setState:value=>update('state',value),
    reuseConversationMessages,mergeConversationOrganization,
    agentSubmissionRef:{current:null},resolveSubmission:value=>submissions.push(value),
    speechRef:{current:{speakIfEnabled:(text,id)=>spoken.push({text,id})}},performancePhase:(...args)=>phases.push(args),
    setError:value=>{if(!mounted){lateUpdates++;return;}errors.push(typeof value==='function'?value(errors.at(-1)||''):value);},
    setAgentPollError:value=>{if(!mounted){lateUpdates++;return;}pollErrors.push(typeof value==='function'?value(pollErrors.at(-1)||''):value);},
    api(path,options={}){
      assert.equal(path,'/conversations/agent-one');assert.equal(options.method,undefined,'passive polling cannot stop or mutate an Agent');
      const pending=deferred();requests.push({path,options,epoch,...pending});return pending.promise;
    },
    createVisiblePoll:options=>createVisiblePoll({...options,setTimeoutFn,clearTimeoutFn}),
    setTimeout:setTimeoutFn,clearTimeout:clearTimeoutFn,
  };
  vm.runInNewContext(compiled,context);
  let cleanup=context.beginPolling();
  const flush=async()=>{for(let index=0;index<10;index++)await new Promise(resolve=>setImmediate(resolve));};
  const close=()=>{if(!mounted)return;cleanup?.();context.approvalAlive.current=false;mounted=false;};
  t.after(async()=>{close();for(const request of requests)request.resolve(snapshot());await flush();assert.equal(lateUpdates,0);assert.equal(timers.size,0);assert.equal(document.listenerCount+window.listenerCount,0);});
  return{context,requests,timers,document,window,spoken,phases,errors,pollErrors,submissions,get state(){return state;},get loaded(){return loaded;},close,flush,
    async resolve(index,value=snapshot()){requests[index].resolve(value);await flush();},
    async reject(index,error){requests[index].reject(error);await flush();},
    hide(value){document.hidden=value;document.dispatchEvent(new Event('visibilitychange'));},
    online(value){window.navigator.onLine=value;window.dispatchEvent(new Event(value?'online':'offline'));},
    queueUpdates(){deferUpdates=true;},applyQueued(){deferUpdates=false;for(const apply of queued.splice(0))apply();},
    changeAccount(){epoch++;cleanup?.();cleanup=null;},
    async advance(milliseconds){const end=clock+milliseconds;for(;;){const next=[...timers].filter(([,timer])=>timer.due<=end).sort((a,b)=>a[1].due-b[1].due)[0];if(!next)break;timers.delete(next[0]);clock=next[1].due;next[1].callback();await flush();}clock=end;await flush();},
  };
}

test('Agent uses 800ms running and 2500ms idle reads, suppressing initial completion speech',async t=>{
  const f=fixture(t);
  await f.resolve(0,snapshot({messages:[reply('old-completion')]}));assert.equal(f.spoken.length,0);
  await f.advance(799);assert.equal(f.requests.length,1);await f.advance(1);assert.equal(f.requests.length,2);
  await f.resolve(1,snapshot({agent:{revision:2,run:{status:'completed'},submissions:[]},messages:[reply('new-completion')]}));
  assert.deepEqual(f.spoken.map(value=>value.text),['new-completion']);
  await f.advance(2499);assert.equal(f.requests.length,2);await f.advance(1);assert.equal(f.requests.length,3);
});

test('Agent read failures recover their own error without clearing an action error or replaying work',async t=>{
  const f=fixture(t);
  f.context.setError('A command failed independently');
  assert.equal(f.requests[0].options.timeoutMs,12000);
  await f.reject(0,Object.assign(new Error('Status read timed out'),{name:'TimeoutError'}));
  assert.equal(f.pollErrors.at(-1),'Status read timed out');
  await f.advance(2500);assert.equal(f.requests.length,2);
  await f.resolve(1,snapshot({agent:{revision:2,run:{status:'completed'},submissions:[]}}));
  assert.equal(f.pollErrors.at(-1),'');
  assert.deepEqual(f.errors,['A command failed independently']);
  assert.equal(f.submissions.length,0);
});

test('Agent rejects an incomplete success snapshot without replacing the displayed conversation',async t=>{
  const f=fixture(t),before=f.state;
  await f.resolve(0,{id:'agent-one'});
  assert.equal(f.state,before);assert.match(f.pollErrors.at(-1),/对话状态/);
  await f.advance(2500);await f.resolve(1,snapshot());
  assert.equal(f.pollErrors.at(-1),'');
});

test('Agent hidden or offline startup performs no GET until both allow a fresh read',async t=>{
  for(const options of [{hidden:true},{online:false},{hidden:true,online:false}]){
    const f=fixture(t,options);assert.equal(f.requests.length,0);await f.advance(30000);assert.equal(f.requests.length,0);
    if(options.hidden)f.hide(false);if(options.online===false)f.online(true);
    assert.equal(f.requests.length,1);f.close();
  }
});

test('Chat mode or an empty selected conversation never owns Agent polling',async t=>{
  for(const options of [{mode:'chat'},{selected:null}]){
    const f=fixture(t,options);assert.equal(f.requests.length,0);assert.equal(f.document.listenerCount+f.window.listenerCount,0);
    f.hide(true);f.hide(false);f.online(false);f.online(true);await f.advance(10000);assert.equal(f.requests.length,0);
  }
});

for(const cause of ['hidden','offline'])test(`${cause} Agent page aborts reads, drops late data, and resumes without overlapping ignored-abort work`,async t=>{
  const f=fixture(t);await f.resolve(0,snapshot({messages:[reply('first','streaming')]}));await f.advance(800);assert.equal(f.requests.length,2);
  if(cause==='hidden')f.hide(true);else f.online(false);
  assert.equal(f.requests[1].options.signal.aborted,true);assert.equal(f.timers.size,0);
  await f.advance(30000);assert.equal(f.requests.length,2);
  if(cause==='hidden')f.hide(false);else f.online(true);
  f.hide(false);f.online(true);assert.equal(f.requests.length,2);
  const before=f.state;await f.resolve(1,snapshot({messages:[reply('late')]}));
  assert.equal(f.state,before);assert.equal(f.spoken.length,0);assert.equal(f.requests.length,3);
  await f.resolve(2,snapshot({messages:[reply('finished')],agent:{revision:3,run:{status:'completed'},submissions:[]}}));
  assert.deepEqual(f.spoken.map(value=>value.text),['finished']);
  f.hide(true);f.hide(false);assert.equal(f.requests.length,4);
  await f.resolve(3,snapshot({messages:[reply('finished')],agent:{revision:3,run:{status:'completed'},submissions:[]}}));
  assert.equal(f.spoken.length,1);
});

test('Agent drops both late data and errors after account replacement or unmount',async t=>{
  for(const cause of ['account','unmount'])for(const reject of [false,true]){
    const f=fixture(t),before=f.state;if(cause==='account')f.changeAccount();else f.close();
    assert.equal(f.requests[0].options.signal.aborted,true);
    if(reject)await f.reject(0,new Error('old account error'));else await f.resolve(0,snapshot({messages:[reply('late')]}));
    assert.equal(f.state,before);assert.equal(f.errors.length,0);assert.equal(f.spoken.length,0);assert.equal(f.timers.size,0);
  }
});

test('Agent refresh rechecks visibility inside already queued ordinary and automation snapshot updates',async t=>{
  for(const automation of [false,true])for(const resumeBeforeCommit of [false,true]){
    const f=fixture(t,{automation});const before=automation?f.loaded:f.state;
    f.queueUpdates();await f.resolve(0,snapshot({...(automation?{automationId:'automation-one'}:{}),messages:[reply('late')]}));
    f.hide(true);if(resumeBeforeCommit)f.hide(false);f.applyQueued();assert.equal(automation?f.loaded:f.state,before);
    if(!resumeBeforeCommit)f.hide(false);assert.equal(f.requests.length,2);
    await f.resolve(1,snapshot({...(automation?{automationId:'automation-one'}:{}),messages:[reply('fresh')]}));
    assert.equal((automation?f.loaded:f.state.conversations[0]).messages.at(-1).content,'fresh');
  }
});

test('queued Agent snapshot commits cannot cross account replacement or resurrect a deleted conversation',async t=>{
  for(const automation of [false,true])for(const cause of ['account','delete']){
    const f=fixture(t,{automation}),before=automation?f.loaded:f.state;
    f.queueUpdates();await f.resolve(0,snapshot({...(automation?{automationId:'automation-one'}:{}),messages:[reply('late')]}));
    if(cause==='account')f.changeAccount();else f.context.deletedConversationIds.current.add('agent-one');
    f.applyQueued();assert.equal(automation?f.loaded:f.state,before);
  }
});
