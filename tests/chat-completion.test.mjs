import test from 'node:test';
import assert from 'node:assert/strict';
import {createChatCompletion,createChatRequestId,mergeChatCompletionSnapshot,readChatTerminalSnapshot,startChatRecovery} from '../src/chat-completion.mjs';

const message=(id='reply',extra={})=>({id,role:'assistant',content:'完整回复',status:'complete',...extra});
const chat=(extra={})=>({id:'chat-one',mode:'chat',title:'旧名称',messages:[message()],...extra});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const flush=async()=>{for(let index=0;index<5;index++)await new Promise(resolve=>setImmediate(resolve));};

test('Chat request IDs retain native UUIDs and use cryptographic bytes on plain LAN HTTP',()=>{
  const native='a15f950b-364e-41af-9214-5017a24fd0cd';
  assert.equal(createChatRequestId({randomUUID:()=>native}),native);
  let seed=0;
  const lan={getRandomValues(bytes){for(let i=0;i<bytes.length;i++)bytes[i]=seed+i;seed++;return bytes;}};
  const first=createChatRequestId(lan),second=createChatRequestId(lan);
  assert.match(first,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(first,second);assert.equal(first,'00010203-0405-4607-8809-0a0b0c0d0e0f');
});

test('terminal snapshots identify the foreground reply and reject foreign or unfinished snapshots',()=>{
  const foreground=message(),background=message('report',{assistantTaskId:'task-one'});
  const snapshot=chat({messages:[foreground,background]});
  assert.equal(readChatTerminalSnapshot(snapshot,'chat-one')?.reply,foreground);
  assert.equal(readChatTerminalSnapshot(snapshot,'chat-one','reply')?.conversation,snapshot);
  for(const value of [undefined,chat({id:'foreign'}),chat({mode:'codex'}),chat({messages:{}}),chat({messages:[message('',{})]}),chat({messages:[message('reply',{status:'streaming'})]}),chat({messages:[background]})])assert.equal(readChatTerminalSnapshot(value,'chat-one'),null);
  assert.equal(readChatTerminalSnapshot(snapshot,'chat-one','missing'),null);
  for(const status of ['error','cancelled'])assert.equal(readChatTerminalSnapshot(chat({messages:[message('reply',{status})]}),'chat-one').reply.status,status);
});

test('completion releases ownership synchronously and speaks a completed reply at most once',()=>{
  const calls=[];let current=true;
  const completion=createChatCompletion({isCurrent:()=>current,release:()=>calls.push('release'),speak:reply=>calls.push(reply.id)});
  assert.equal(completion.finish(message(),true),true);assert.deepEqual(calls,['release','reply']);
  assert.equal(completion.finish(message(),true),false);assert.deepEqual(calls,['release','reply']);
  const interrupted=createChatCompletion({isCurrent:()=>current,release:()=>calls.push('interrupted'),speak:()=>assert.fail('partial/error replies cannot be spoken')});
  interrupted.finish(message('partial',{status:'error'}),true);assert.equal(calls.at(-1),'interrupted');
  current=false;const stale=createChatCompletion({isCurrent:()=>current,release:()=>assert.fail('stale completion cannot release a newer task'),speak(){}});
  assert.equal(stale.finish(message(),true),false);
});

test('completion rechecks request ownership after release before starting speech',()=>{
  let current=true;
  const completion=createChatCompletion({isCurrent:()=>current,release(){current=false;},speak(){assert.fail('old speech cannot start after a new request takes ownership');}});
  completion.finish(message(),true);
});

test('targeted snapshot merge preserves other state, local organization and completed background reports',()=>{
  const oldReply=message('old'),report=message('report',{assistantTaskId:'task-one'});
  const before=chat({title:'新名称',customTitle:'新名称',projectId:'new-project',archivedAt:'2026-10-22',messages:[oldReply,report],assistantTasks:[{id:'task-one',status:'completed'}]});
  const settings={},other=chat({id:'other'}),state={settings,providers:[],conversations:[before,other]};
  const incoming=chat({messages:[oldReply,message('new')],assistantTasks:[{id:'task-one',status:'running'}]});
  const next=mergeChatCompletionSnapshot(state,incoming,{conversationId:'chat-one',isCurrent:()=>true,preserveOrganization:true});
  assert.equal(next.settings,settings);assert.equal(next.conversations[1],other);assert.equal(next.conversations[0].title,'新名称');assert.equal(next.conversations[0].projectId,'new-project');
  assert.equal(next.conversations[0].archivedAt,'2026-10-22');assert.deepEqual(next.conversations[0].messages.map(value=>value.id),['old','new','report']);
  assert.equal(next.conversations[0].messages[0],oldReply);assert.equal(next.conversations[0].assistantTasks[0].status,'completed');
});

test('targeted recovery cannot resurrect deleted conversations, update another target or cross a generation',()=>{
  const state={conversations:[chat()]},incoming=chat({messages:[message('new')]});
  for(const options of [{isCurrent:()=>false},{deletedIds:new Set(['chat-one'])},{conversationId:'other'}])assert.equal(mergeChatCompletionSnapshot(state,incoming,{conversationId:'chat-one',isCurrent:()=>true,...options}),state);
  assert.equal(mergeChatCompletionSnapshot({conversations:[]},incoming,{conversationId:'chat-one',isCurrent:()=>true}).conversations.length,0);
});

function recoveryFixture(extra={}){
  const pending=deferred(),timers=new Map(),snapshots=[],errors=[];let id=0,current=true,signal;
  const recovery=startChatRecovery({read:input=>{signal=input;return pending.promise;},onConversation:(value,guard)=>snapshots.push({value,guard}),onError:(error,guard)=>errors.push({error,guard}),isCurrent:()=>current,
    schedule(callback){const key=++id;timers.set(key,callback);return key;},cancelTimer:key=>timers.delete(key),...extra});
  return{pending,recovery,snapshots,errors,timers,get signal(){return signal;},setCurrent(value){current=value;},expire(){for(const[id,callback]of[...timers]){timers.delete(id);callback();}}};
}

test('recovery has a bounded deadline even when the reader ignores abort and resolves much later',async()=>{
  const f=recoveryFixture();await flush();f.expire();await f.recovery.finished;
  assert.equal(f.signal.aborted,true);assert.equal(f.errors.length,1);assert.match(f.errors[0].error.message,/同步这段对话超时/);assert.equal(f.timers.size,0);
  f.pending.resolve(chat());await flush();assert.equal(f.snapshots.length,0);assert.equal(f.errors.length,1);
});

test('cancelled recovery settles immediately without publishing an error or waiting for its reader',async()=>{
  const f=recoveryFixture();await flush();f.recovery.cancel();await f.recovery.finished;
  assert.equal(f.signal.aborted,true);assert.equal(f.errors.length,0);assert.equal(f.timers.size,0);
  f.pending.reject(new Error('late transport error'));await flush();assert.equal(f.snapshots.length,0);
});

test('the callback guard remains invalidatable after successful reads and deferred state updates',async()=>{
  const f=recoveryFixture();f.pending.resolve(chat());await f.recovery.finished;
  assert.equal(f.snapshots.length,1);assert.equal(f.snapshots[0].guard(),true);
  f.recovery.cancel();assert.equal(f.snapshots[0].guard(),false);assert.equal(f.timers.size,0);
});

test('account or request changes while recovery waits discard both data and errors',async()=>{
  for(const failure of [false,true]){
    const f=recoveryFixture();await flush();f.setCurrent(false);
    if(failure)f.pending.reject(new Error('old request failed'));else f.pending.resolve(chat());
    await f.recovery.finished;assert.equal(f.snapshots.length,0);assert.equal(f.errors.length,0);assert.equal(f.timers.size,0);
  }
});

test('inactive recovery never starts a request or leaves a timer',async()=>{
  let calls=0;const f=recoveryFixture({isCurrent:()=>false,read(){calls++;return Promise.resolve(chat());}});
  await f.recovery.finished;assert.equal(calls,0);assert.equal(f.timers.size,0);
});
