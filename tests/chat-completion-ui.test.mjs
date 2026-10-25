import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import * as completion from '../src/chat-completion.mjs';
import {createChatDisplay} from '../src/chat-display.mjs';
import {foregroundAssistantMessage} from '../src/chat-assistant-preferences.mjs';
import {mergeConversationOrganization,conversationHistoryScope,creationProjectId} from '../src/conversation-organization-sync.mjs';
import {createChatRuns} from '../src/chat-runs.mjs';

// Execute App's actual submit function with isolated UI/transport collaborators.
// This catches a finally block waiting for /state without booting a business app.
const appSource=await readFile(new URL('../src/App.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('App.tsx',appSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const app=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='App');
const send=app.body.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='send');
const stop=app.body.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='stop');
const project=app.body.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='projectChatRun');
const navigationNames=['navigationBlocked','requestNavigation','performNavigation','confirmNavigation','startNewChat','newChat','switchConversation'];
const navigation=navigationNames.map(name=>app.body.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name).getText(ast)).join('\n');
const compiled=ts.transpileModule(project.getText(ast)+'\n'+send.getText(ast)+'\n'+stop.getText(ast)+'\n'+navigation+'\nglobalThis.submit=send;globalThis.stopCurrent=stop;globalThis.navigate=requestNavigation;',{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None},
}).outputText;
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const flush=async()=>{for(let index=0;index<8;index++)await new Promise(resolve=>setImmediate(resolve));};
const chat=(extra={})=>({id:'chat-one',mode:'chat',title:'原名称',providerId:'provider-one',messages:[],...extra});

function fixture({events,streamError,readSnapshot}={}){
  let epoch=1,state={settings:{},providers:[],codex:{},conversations:[chat()]},busy=false,spoken=[],error='',draft='下一条消息',notice='',readWait=deferred(),stateWait=deferred();
  const calls=[],timers=new Map(),queued=[];let timerId=0,deferState=false;
  const schedule=(callback,delay)=>{const id=++timerId;timers.set(id,{callback,delay});return id;},cancel=id=>timers.delete(id);
  const apply=update=>{state=typeof update==='function'?update(state):update;context.state=state;context.conversation=state.conversations.find(c=>c.id===context.selectedChatRef.current);};
  const context={console,AbortController,DOMException,crypto,Date,Promise,document:{hidden:false},setTimeout:schedule,clearTimeout:cancel,
    state,view:'chat',currentMode:'chat',conversation:state.conversations[0],draft,draftRef:{current:draft},attachments:{items:[],uploading:false,clear(){context.attachments.items=[];}},busyRef:{current:false},switchingModelRef:{current:false},
    connected:true,provider:{id:'provider-one'},chatAssistant:{snapshot(){}},chatScroll:{latest(){}},stopPresentation(){},
    setBusy(value){busy=value;},setError(value){error=typeof value==='function'?value(error):value;},setApprovals(){},setStatus(){},
    speech:{prepare(){},speakIfEnabled(text,id){spoken.push({text,id});}},speechRef:{current:{speakIfEnabled(text,id){spoken.push({text,id});}}},
    abortRef:{current:null},requestSequence:{current:0},organizationRevision:{current:0},activeRef:{current:null},activeChatRequest:{current:null},displayRef:{current:null},responseTimer:{current:null},
    chatRecoveryRef:{current:null},approvalAlive:{current:true},deletedConversationIds:{current:new Set()},
    selectedChatRef:{current:'chat-one'},chatVisibleRef:{current:true},workspaceViewRef:{current:'chat'},setChatRevision(){},
    setSelected(id){context.selectedChatRef.current=id;context.conversation=state.conversations.find(c=>c.id===id);},setState(update){if(deferState)queued.push(update);else apply(update);},setDraft(value){draft=value;context.draft=value;context.draftRef.current=value;},
    automationEditingRef:{current:{busy:false,dirty:false}},agentSendLock:{current:false},agentSubmitting:false,unconfirmed:false,agentSubmissionRef:{current:null},projectFilter:'all',projects:[],hostScope:'synthetic-host',defaultAgentPermissions:{},creationProjectId,
    pendingNavigation:null,setPendingNavigation(value){context.pendingNavigation=value;},setNotice(value){notice=value;},setMobileNav(){},setSettingsTab(){},setConnectionOpen(){},setView(value){context.view=value;},cacheAutomationConversation(){},setPermissions(){},setAgentProviderId(){},setAgentHostId(){},setProjectFilter(){},setHistoryArchived(){},setMode(value){context.currentMode=value;},setProviderId(){},conversationHistoryScope,
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
  context.attachmentsRef={current:context.attachments};
  context.chatRunsRef={current:createChatRuns({isCurrent:()=>context.approvalAlive.current&&epoch===1})};
  context.refresh=()=>context.api('/state');
  vm.runInNewContext(compiled,context);
  return {context,calls,spoken,timers,get state(){return state;},get busy(){return busy;},get error(){return error;},get draft(){return draft;},get notice(){return notice;},
    submit:()=>context.submit(),flush,
    recover(value){readWait.resolve(value);},failRecovery(cause){readWait.reject(cause);},
    switchAccount(){epoch++;},replaceRequest(){context.requestSequence.current++;context.chatRunsRef.current.discard(context.conversation?.id??null);},
    addConversation(value){apply({...state,conversations:[...state.conversations,value]});},
    select(id){context.navigate({kind:'conversation',id,conversation:state.conversations.find(c=>c.id===id)});},
    queueUpdates(){deferState=true;},applyQueued(){deferState=false;for(const update of queued.splice(0))apply(update);},
    mutateConversation(update){state={...state,conversations:state.conversations.map(value=>value.id==='chat-one'?update(value):value)};context.conversation=state.conversations[0];},
    expire(){for(const[id,timer]of[...timers]){timers.delete(id);timer.callback();}},
    async close(){stateWait.resolve(state);readWait.resolve(chat());context.approvalAlive.current=false;context.chatRunsRef.current.close();context.chatRecoveryRef.current?.cancel();context.abortRef.current?.abort();for(const timer of timers.keys())cancel(timer);await flush();},
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

function controlledStreams(f){
 const streams=new Map();
 f.context.streamMessage=(id,content,signal,onEvent,_images,_assistant,clientRequestId)=>{
  const gate=deferred(),replyId='reply-'+id;
  signal.addEventListener('abort',()=>gate.reject(new DOMException('Stopped','AbortError')),{once:true});
  const snapshot=(text,status='complete')=>chat({id,messages:[{id:'user-'+id,role:'user',content},{id:replyId,role:'assistant',content:text,status}]});
  streams.set(id,{signal,clientRequestId,onEvent,snapshot,delta:text=>onEvent({type:'delta',data:{text}}),meta:()=>onEvent({type:'meta',data:{assistantMessageId:replyId}}),finish(text){onEvent({type:'done',data:{conversation:snapshot(text),assistantMessageId:replyId}});gate.resolve();},fail(text){onEvent({type:'error',data:{message:text,conversation:snapshot('已保存部分','error'),assistantMessageId:replyId}});gate.resolve();}});
  return gate.promise;
 };
 return streams;
}

test('actual navigation keeps A alive, allows a parallel B and routes terminal releases and speech to their owner',async t=>{
 const f=fixture();t.after(()=>f.close());f.addConversation(chat({id:'chat-two'}));const streams=controlledStreams(f);
 const a=f.submit();await f.flush();streams.get('chat-one').meta();streams.get('chat-one').delta('A 开始');
 f.select('chat-two');assert.equal(f.context.selectedChatRef.current,'chat-two');assert.equal(f.busy,false);assert.equal(streams.get('chat-one').signal.aborted,false);
 f.context.setDraft('B 的问题');const b=f.submit();await f.flush();streams.get('chat-two').meta();assert.equal(f.busy,true);
 streams.get('chat-one').finish('A 完整回复');await a;
 assert.equal(f.busy,true,'A cannot unlock B');assert.equal(f.context.activeChatRequest.current.conversationId,'chat-two');assert.equal(streams.get('chat-two').signal.aborted,false);assert.equal(f.spoken.length,0);
 assert.equal(f.state.conversations.find(c=>c.id==='chat-one').messages.at(-1).content,'A 完整回复');assert.equal(f.context.chatRunsRef.current.activity()['chat-one'],'complete');
 f.select('chat-one');assert.equal(f.busy,false);assert.equal(f.context.chatRunsRef.current.activity()['chat-one'],undefined);
 f.select('chat-two');assert.equal(f.busy,true);streams.get('chat-two').finish('B 完整回复');await b;
 assert.equal(f.busy,false);assert.deepEqual(f.spoken.map(v=>v.text),['B 完整回复']);
});

test('late A metadata, status and failure never consume B draft images, overwrite B error or speak in B',async t=>{
 const f=fixture();t.after(()=>f.close());f.addConversation(chat({id:'chat-two'}));const streams=controlledStreams(f),a=f.submit();await f.flush();f.select('chat-two');
 f.context.setDraft('B 尚未发送的草稿');f.context.attachments.items=[{id:'draft-image-b'}];
 streams.get('chat-one').meta();streams.get('chat-one').onEvent({type:'status',data:{message:'A 后台状态'}});streams.get('chat-one').fail('A 出现错误');await a;
 assert.equal(f.draft,'B 尚未发送的草稿');assert.equal(f.context.attachments.items[0].id,'draft-image-b');assert.equal(f.error,'');assert.equal(f.spoken.length,0);assert.equal(f.context.selectedChatRef.current,'chat-two');assert.equal(f.context.chatRunsRef.current.activity()['chat-one'],'error');
});

test('stopping selected B preserves A and uses only B client request ID',async t=>{
 const f=fixture();t.after(()=>f.close());f.addConversation(chat({id:'chat-two'}));const streams=controlledStreams(f),stops=[];
 const api=f.context.api;f.context.api=(path,options)=>{if(path.endsWith('/stop')){stops.push({path,...JSON.parse(options.body)});return Promise.resolve({ok:true});}if(path==='/conversations/chat-two')return Promise.resolve(streams.get('chat-two').snapshot('','cancelled'));return api(path,options);};
 const a=f.submit();await f.flush();f.select('chat-two');f.context.setDraft('B');const b=f.submit();await f.flush();
 await f.context.stopCurrent();await b;await f.flush();assert.equal(streams.get('chat-two').signal.aborted,true);assert.equal(streams.get('chat-one').signal.aborted,false);
 assert.deepEqual(stops,[{path:'/conversations/chat-two/stop',expectedRequestId:streams.get('chat-two').clientRequestId}]);
 streams.get('chat-one').finish('A 仍然完成');await a;assert.equal(f.state.conversations.find(c=>c.id==='chat-one').messages.at(-1).content,'A 仍然完成');
});

test('new-thread navigation and settings do not cancel an accepted Chat; provisional creation alone blocks a switch',async t=>{
 const f=fixture();t.after(()=>f.close());const streams=controlledStreams(f),a=f.submit();await f.flush();
 f.context.navigate({kind:'page',view:'settings'});assert.equal(f.context.view,'settings');assert.equal(streams.get('chat-one').signal.aborted,false);
 f.context.navigate({kind:'new',mode:'chat'});assert.equal(f.context.selectedChatRef.current,null);assert.equal(f.busy,false);
 f.addConversation(chat({id:'chat-two'}));f.context.setDraft('新对话');const gate=deferred(),api=f.context.api;f.context.api=(path,options)=>path==='/conversations'?gate.promise:api(path,options);
 const created=f.submit();await f.flush();f.select('chat-two');assert.equal(f.context.selectedChatRef.current,null);assert.match(f.notice,/确认本次提交/);
 gate.resolve(chat({id:'created-chat'}));await f.flush();f.select('chat-two');assert.equal(f.context.selectedChatRef.current,'chat-two');
 streams.get('created-chat').finish('新对话完成');streams.get('chat-one').finish('原对话完成');await Promise.all([a,created]);assert.equal(f.context.selectedChatRef.current,'chat-two');assert.equal(f.spoken.length,0);
});

test('all background streams and queued deltas obey the account fence',async t=>{
 const f=fixture();t.after(()=>f.close());f.addConversation(chat({id:'chat-two'}));const streams=controlledStreams(f),a=f.submit();await f.flush();f.select('chat-two');f.context.setDraft('B');const b=f.submit();await f.flush();
 const before=f.state;f.queueUpdates();streams.get('chat-one').delta('旧账号 A');streams.get('chat-two').delta('旧账号 B');f.switchAccount();f.applyQueued();assert.equal(f.state,before);
 streams.get('chat-one').finish('旧账号 A 终态');streams.get('chat-two').finish('旧账号 B 终态');await Promise.all([a,b]);assert.equal(f.state,before);assert.equal(f.spoken.length,0);
 const calls=f.calls.length;await f.submit();await f.context.stopCurrent();assert.equal(f.calls.length,calls,'captured old-account controls cannot dispatch again');
});

test('Agent running state permits switching but unknown submissions and unsent drafts keep their existing guards',async t=>{
 const f=fixture();t.after(()=>f.close());f.context.setDraft('');f.context.agentRunning=true;f.context.currentMode='codex';f.addConversation(chat({id:'chat-two'}));
 f.select('chat-two');assert.equal(f.context.selectedChatRef.current,'chat-two');
 f.context.unconfirmed=true;f.select('chat-one');assert.equal(f.context.selectedChatRef.current,'chat-two');assert.match(f.notice,/确认本次提交/);
 f.context.unconfirmed=false;f.context.setDraft('还没发送');f.select('chat-one');assert.equal(f.context.selectedChatRef.current,'chat-two');assert.equal(f.context.pendingNavigation.kind,'conversation');
});

test('a background recovery survives sending B and cannot replace B state or play delayed audio',async t=>{
 const gate=deferred(),f=fixture({events:[{type:'delta',data:{text:'A 的部分回复'}}],streamError:Error('网络断开'),readSnapshot:()=>gate.promise});t.after(()=>{gate.resolve(chat());return f.close();});
 f.addConversation(chat({id:'chat-two'}));await f.submit();await f.flush();const recovery=f.context.chatRunsRef.current.get('chat-one').recovery;assert.ok(recovery);
 f.select('chat-two');f.context.setDraft('B 的问题');const streams=controlledStreams(f),b=f.submit();await f.flush();
 gate.resolve(chat({messages:[{id:'a-saved',role:'assistant',content:'A 已完整保存',status:'complete'}]}));await recovery.finished;await f.flush();
 assert.equal(f.busy,true);assert.equal(f.error,'');assert.equal(f.context.activeChatRequest.current.conversationId,'chat-two');assert.equal(f.state.conversations.find(c=>c.id==='chat-one').messages.at(-1).content,'A 已完整保存');assert.equal(f.spoken.length,0);
 streams.get('chat-two').finish('B 完整完成');await b;assert.deepEqual(f.spoken.map(v=>v.text),['B 完整完成']);
});

test('a failed background send restores text only to its own conversation and respects later discard',async t=>{
 const f=fixture();t.after(()=>f.close());f.addConversation(chat({id:'chat-two'}));const network=deferred();f.context.streamMessage=()=>network.promise;
 const a=f.submit();await f.flush();f.select('chat-two');network.reject(Error('Not accepted'));await a;assert.equal(f.draft,'');
 f.select('chat-one');assert.equal(f.draft,'下一条消息');f.select('chat-two');assert.ok(f.context.pendingNavigation);f.context.confirmNavigation();assert.equal(f.draft,'');
 f.select('chat-one');assert.equal(f.draft,'','discarded retry text must not reappear on every visit');
});
