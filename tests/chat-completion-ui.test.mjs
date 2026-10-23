import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import * as completion from '../src/chat-completion.mjs';
import {createChatDisplay} from '../src/chat-display.mjs';
import {foregroundAssistantMessage} from '../src/chat-assistant-preferences.mjs';
import {mergeConversationOrganization} from '../src/conversation-organization-sync.mjs';

// Execute App's actual submit function with isolated UI/transport collaborators.
// This catches a finally block waiting for /state without booting a business app.
const appSource=await readFile(new URL('../src/App.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('App.tsx',appSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const app=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='App');
const send=app.body.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='send');
const stop=app.body.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='stop');
const compiled=ts.transpileModule(send.getText(ast)+'\n'+stop.getText(ast)+'\nglobalThis.submit=send;globalThis.stopCurrent=stop;',{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None},
}).outputText;
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const flush=async()=>{for(let index=0;index<8;index++)await new Promise(resolve=>setImmediate(resolve));};
const chat=(extra={})=>({id:'chat-one',mode:'chat',title:'原名称',providerId:'provider-one',messages:[],...extra});

function fixture({events,streamError,readSnapshot}={}){
  let epoch=1,state={settings:{},providers:[],codex:{},conversations:[chat()]},busy=false,spoken=[],error='',draft='下一条消息',readWait=deferred(),stateWait=deferred();
  const calls=[],timers=new Map(),queued=[];let timerId=0,deferState=false;
  const schedule=(callback,delay)=>{const id=++timerId;timers.set(id,{callback,delay});return id;},cancel=id=>timers.delete(id);
  const apply=update=>{state=typeof update==='function'?update(state):update;};
  const context={console,AbortController,DOMException,crypto,Date,Promise,setTimeout:schedule,clearTimeout:cancel,
    currentMode:'chat',conversation:state.conversations[0],draft,attachments:{items:[],uploading:false,clear(){}},busyRef:{current:false},switchingModelRef:{current:false},
    connected:true,provider:{id:'provider-one'},chatAssistant:{snapshot(){}},chatScroll:{latest(){}},stopPresentation(){},
    setBusy(value){busy=value;},setError(value){error=typeof value==='function'?value(error):value;},setApprovals(){},setStatus(){},
    speech:{prepare(){},speakIfEnabled(text,id){spoken.push({text,id});}},speechRef:{current:{speakIfEnabled(text,id){spoken.push({text,id});}}},
    abortRef:{current:null},requestSequence:{current:0},organizationRevision:{current:0},activeRef:{current:null},activeChatRequest:{current:null},displayRef:{current:null},responseTimer:{current:null},
    chatRecoveryRef:{current:null},approvalAlive:{current:true},deletedConversationIds:{current:new Set()},
    setSelected(){},setState(update){if(deferState)queued.push(update);else apply(update);},setDraft(value){draft=value;},
    performancePhase(){},finishResponse(){},getSessionEpoch:()=>epoch,accountEpoch:1,isSessionChanged:()=>false,
    createChatDisplay,foregroundAssistantMessage,mergeConversationOrganization,...completion,
    startChatRecovery:options=>completion.startChatRecovery({...options,schedule,cancelTimer:cancel}),
    api:async(path,{signal}={})=>{
      calls.push(path);
      if(path==='/state')return stateWait.promise;
      if(path==='/conversations/chat-one')return readSnapshot?readSnapshot(signal):readWait.promise;
      throw new Error('Unexpected isolated API request '+path);
    },
    async streamMessage(_id,_content,_signal,onEvent){
      const canonical=chat({messages:[{id:'canonical-user',role:'user',content:'下一条消息'},{id:'canonical-reply',role:'assistant',status:'complete',content:'完整回复'}]});
      for(const event of events||[{type:'meta',data:{assistantMessageId:'canonical-reply'}},{type:'delta',data:{text:'完整回复'}},{type:'done',data:{conversation:canonical,assistantMessageId:'canonical-reply'}}])onEvent(event);
      if(streamError)throw streamError;
    },
  };
  context.refresh=()=>context.api('/state');
  vm.runInNewContext(compiled,context);
  return {context,calls,spoken,timers,get state(){return state;},get busy(){return busy;},get error(){return error;},
    submit:()=>context.submit(),flush,
    recover(value){readWait.resolve(value);},failRecovery(cause){readWait.reject(cause);},
    switchAccount(){epoch++;},replaceRequest(){context.requestSequence.current++;},
    queueUpdates(){deferState=true;},applyQueued(){deferState=false;for(const update of queued.splice(0))apply(update);},
    mutateConversation(update){state={...state,conversations:state.conversations.map(value=>value.id==='chat-one'?update(value):value)};context.conversation=state.conversations[0];},
    expire(){for(const[id,timer]of[...timers]){timers.delete(id);timer.callback();}},
    async close(){stateWait.resolve(state);readWait.resolve(chat());context.chatRecoveryRef.current?.cancel();context.abortRef.current?.abort();for(const timer of timers.keys())cancel(timer);await flush();},
  };
}

test('App releases a complete authoritative reply and reads it once without requesting /state',async t=>{
  const f=fixture();t.after(()=>f.close());let settled=false;
  const sending=f.submit().then(()=>{settled=true;});await f.flush();
  assert.equal(settled,true,'authoritative completion must not wait for full-state refresh');
  assert.equal(f.busy,false);assert.equal(f.context.busyRef.current,false);
  assert.equal(f.calls.length,0);assert.deepEqual(f.spoken.map(value=>value.text),['完整回复']);
  assert.equal(f.state.conversations[0].messages.at(-1).status,'complete');
  await sending;
});

test('App recovers only the target after an interrupted response without locking the composer',async t=>{
  const f=fixture({events:[{type:'delta',data:{text:'部分回复'}}],streamError:new Error('连接提前断开')});t.after(()=>f.close());
  const sending=f.submit();await f.flush();
  assert.equal(f.busy,false);assert.deepEqual(f.calls,['/conversations/chat-one']);
  assert.equal(f.state.conversations[0].messages.at(-1).content,'部分回复');assert.equal(f.spoken.length,0);
  await sending;
  f.recover(chat({messages:[{id:'canonical-reply',role:'assistant',content:'已保存的部分回复',status:'error'}]}));await f.flush();
  assert.equal(f.state.conversations[0].messages.at(-1).content,'已保存的部分回复');
});

for(const cause of ['new-request','account-change','delete'])test(`App ignores a late targeted recovery after ${cause}`,async t=>{
  const f=fixture({events:[{type:'delta',data:{text:'部分回复'}}],streamError:new Error('连接提前断开')});t.after(()=>f.close());
  const sending=f.submit();await f.flush();assert.equal(f.busy,false);await sending;
  if(cause==='new-request')f.replaceRequest();
  if(cause==='account-change')f.switchAccount();
  if(cause==='delete')f.context.deletedConversationIds.current.add('chat-one');
  const before=f.state;
  f.recover(chat({messages:[{id:'late-reply',role:'assistant',content:'过时的恢复',status:'complete'}]}));await f.flush();
  assert.equal(f.state,before);assert.equal(f.spoken.length,0);
});

test('App preserves a rename and project move made while targeted recovery waits',async t=>{
  const f=fixture({events:[{type:'delta',data:{text:'部分回复'}}],streamError:new Error('连接提前断开')});t.after(()=>f.close());
  const sending=f.submit();await f.flush();assert.equal(f.busy,false);await sending;
  f.context.organizationRevision.current++;f.mutateConversation(value=>({...value,title:'新名称',customTitle:'新名称',projectId:'project-new',archivedAt:'2026-10-22T00:00:00.000Z'}));
  f.recover(chat({projectId:'project-old',messages:[{id:'saved-reply',role:'assistant',content:'恢复的回复',status:'complete'}]}));await f.flush();
  assert.equal(f.state.conversations[0].title,'新名称');assert.equal(f.state.conversations[0].projectId,'project-new');
  assert.equal(f.state.conversations[0].messages.at(-1).content,'恢复的回复');
});

test('App rechecks ownership inside an already queued recovery state updater',async t=>{
  const f=fixture({events:[{type:'delta',data:{text:'部分回复'}}],streamError:new Error('连接提前断开')});t.after(()=>f.close());
  const sending=f.submit();await f.flush();assert.equal(f.busy,false);await sending;const before=f.state;f.queueUpdates();
  f.recover(chat({messages:[{id:'late-reply',role:'assistant',content:'过时的恢复',status:'complete'}]}));await f.flush();
  f.replaceRequest();f.applyQueued();assert.equal(f.state,before);
});

test('a newly submitted Chat cancels old recovery and its late result cannot replace the next reply',async t=>{
  const f=fixture({events:[{type:'delta',data:{text:'部分回复'}}],streamError:new Error('连接提前断开')});t.after(()=>f.close());
  await f.submit();await f.flush();const oldRecovery=f.context.chatRecoveryRef.current;
  f.context.draft='立即继续';f.context.conversation=f.state.conversations[0];
  f.context.streamMessage=async(_id,_content,_signal,onEvent)=>onEvent({type:'done',data:{conversation:chat({messages:[{id:'new-reply',role:'assistant',content:'新任务回复',status:'complete'}]}),assistantMessageId:'new-reply'}});
  await f.submit();await f.flush();await oldRecovery.finished;
  assert.equal(f.busy,false);assert.deepEqual(f.spoken.map(value=>value.text),['新任务回复']);
  f.recover(chat({messages:[{id:'late-reply',role:'assistant',content:'过时的恢复',status:'complete'}]}));await f.flush();
  assert.equal(f.state.conversations[0].messages.at(-1).id,'new-reply');
});

test('a terminal error with an authoritative partial snapshot releases immediately without recovery or speech',async t=>{
  const canonical=chat({messages:[{id:'failed-reply',role:'assistant',content:'已保存的部分回复',status:'error'}]});
  const f=fixture({events:[{type:'delta',data:{text:'部分回复'}},{type:'error',data:{message:'提供方中断',assistantMessageId:'failed-reply',conversation:canonical}}]});t.after(()=>f.close());
  await f.submit();assert.equal(f.busy,false);assert.equal(f.calls.length,0);assert.equal(f.spoken.length,0);
  assert.equal(f.state.conversations[0].messages.at(-1).content,'已保存的部分回复');assert.equal(f.error,'提供方中断');
});

test('missing or mismatched legacy terminal snapshots use only bounded target recovery',async t=>{
  for(const data of [{},{conversation:chat({id:'foreign'})}]){
    const f=fixture({events:[{type:'delta',data:{text:'部分回复'}},{type:'done',data}]});t.after(()=>f.close());
    await f.submit();await f.flush();assert.equal(f.busy,false);assert.deepEqual(f.calls,['/conversations/chat-one']);assert.equal(f.spoken.length,0);
    f.expire();await f.flush();assert.match(f.error,/暂时无法同步这段对话/);
    f.recover(chat({messages:[{id:'too-late',role:'assistant',content:'已过期',status:'complete'}]}));await f.flush();
    assert.equal(f.state.conversations[0].messages.at(-1).content,'部分回复');
  }
});

test('a late stop-request error cannot overwrite a subsequently completed Chat',async t=>{
  const f=fixture();t.after(()=>f.close());const stream=deferred(),stopping=deferred();
  f.context.streamMessage=async(_id,_content,signal,onEvent)=>{
    onEvent({type:'delta',data:{text:'部分回复'}});
    signal.addEventListener('abort',()=>stream.reject(new DOMException('用户已停止','AbortError')),{once:true});
    await stream.promise;
  };
  const baseApi=f.context.api;f.context.api=(path,options)=>path.endsWith('/stop')?stopping.promise:baseApi(path,options);
  const sending=f.submit();await f.flush();const stopped=f.context.stopCurrent();await sending;await f.flush();
  assert.equal(f.busy,false);f.context.conversation=f.state.conversations[0];f.context.draft='新的请求';
  f.context.streamMessage=async(_id,_content,_signal,onEvent)=>onEvent({type:'done',data:{conversation:chat({messages:[{id:'new-reply',role:'assistant',content:'新任务回复',status:'complete'}]}),assistantMessageId:'new-reply'}});
  await f.submit();stopping.reject(new Error('旧停止请求失败'));await stopped;
  assert.equal(f.error,'');assert.equal(f.state.conversations[0].messages.at(-1).id,'new-reply');
});

test('a pre-meta stop keeps its original request ID when the next Chat starts immediately',async t=>{
  const f=fixture();t.after(()=>f.close());const original=deferred(),stopping=deferred(),requests=[],stops=[];
  f.context.streamMessage=async(_id,_content,signal,_onEvent,_images,_assistant,clientRequestId)=>{
    requests.push(clientRequestId);
    signal.addEventListener('abort',()=>original.reject(signal.reason),{once:true});
    await original.promise;
  };
  const baseApi=f.context.api;
  f.context.api=(path,options)=>{
    if(path.endsWith('/stop')){stops.push(JSON.parse(options.body));return stopping.promise;}
    return baseApi(path,options);
  };
  const first=f.submit();await f.flush();assert.equal(requests.length,1);assert.ok(requests[0]);
  const stopped=f.context.stopCurrent();await first;assert.equal(f.busy,false);
  assert.equal(stops[0].expectedRequestId,requests[0],'stopping before meta does not need a server message ID');
  f.context.conversation=f.state.conversations[0];f.context.draft='立即继续';
  f.context.streamMessage=async(_id,_content,_signal,onEvent,_images,_assistant,clientRequestId)=>{
    requests.push(clientRequestId);
    onEvent({type:'done',data:{conversation:chat({messages:[{id:'new-reply',role:'assistant',content:'新的完整回复',status:'complete'}]}),assistantMessageId:'new-reply'}});
  };
  await f.submit();assert.notEqual(requests[1],requests[0]);assert.equal(stops[0].expectedRequestId,requests[0]);
  stopping.resolve({ok:true,stopped:false});await stopped;
  assert.equal(f.state.conversations[0].messages.at(-1).content,'新的完整回复');assert.equal(f.error,'');
});

test('a new-conversation result cannot update the page after request ownership changed',async t=>{
  const f=fixture();t.after(()=>f.close());const creating=deferred();
  f.context.conversation=undefined;f.context.creationProjectId=()=>null;f.context.projectFilter='all';f.context.projects=[];
  f.context.api=()=>creating.promise;
  const before=f.state,sending=f.submit();await f.flush();f.replaceRequest();
  creating.resolve(chat({id:'late-conversation'}));await sending;
  assert.equal(f.state,before);assert.equal(f.spoken.length,0);
});
