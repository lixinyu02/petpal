import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createChatAssistant, normalizeChatAssistant, restoreAssistantTasks, assistantTasksSnapshot } from '../server/chat-assistant.mjs';
import { createAgentTasks } from '../server/agent-tasks.mjs';

const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {resolve,promise};};
const until=async fn=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(resolve=>setTimeout(resolve,2));}assert.fail('Background task did not settle');};
function fixture(t,extra={}){
  const userId=randomUUID(),hostId=randomUUID(),revisionId=randomUUID(),auth={userId,sessionHash:'private-session',bootstrap:false};
  const chat={id:randomUUID(),userId,mode:'chat',messages:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  const hosts=[{id:hostId,userId,name:'Selected PC'}],saves=[],submitted=[],stopped=[];
  const store={state:{conversations:[chat],executionHosts:hosts},save:async()=>{saves.push(structuredClone(store.state));}};
  const options=normalizeChatAssistant({enabled:true,hostId,providerId:'provider-one',permissions:{access:'full-access',approval:'auto'}},randomUUID());
  const agentTasks={submit:async(child,body)=>{submitted.push({child,body});child.agent={paused:false,queue:[{...body}],run:null,submissions:[]};},snapshot:child=>child.agent??{queue:[],run:null,submissions:[]},stop:async(child,args)=>{stopped.push({child,args});child.agent={queue:[],run:child.agent?.run?{...child.agent.run,status:'cancelled'}:null,submissions:[{submissionId:child.agent?.queue[0]?.submissionId,status:'cancelled'}]};}};
  const manager=createChatAssistant({store,agentTasks,authorize:(_auth,_options,target)=>{assert.equal(target.userId,userId);},resolveHost:(owner,id)=>{assert.equal(owner,userId);if(id!==hostId)throw Object.assign(new Error('foreign'),{status:404});return {hostId,hostName:'Selected PC'};},revision:()=>revisionId,...extra});
  t.after(()=>manager.close());return {manager,store,agentTasks,chat,auth,options,hostId,revisionId,saves,submitted,stopped};
}

test('Chat assistant settings freeze the preselected computer, Agent model and permissions',()=>{
  const config={enabled:true,hostId:randomUUID(),providerId:'assigned-model',permissions:{access:'full-access',approval:'auto'}};
  const normalized=normalizeChatAssistant(config,randomUUID());config.permissions.access='read-only';
  assert.ok(Object.isFrozen(normalized));assert.ok(Object.isFrozen(normalized.permissions));assert.equal(normalized.permissions.access,'full-access');
  assert.equal(normalizeChatAssistant(undefined),null);assert.equal(normalizeChatAssistant({enabled:false}),null);
  for(const bad of [{...config,shell:'cmd'},{...config,hostId:'other'},{...config,permissions:{access:'root'}},{...config,providerId:3}])assert.throws(()=>normalizeChatAssistant(bad,randomUUID()),{status:400});
});

test('prepare persists a receipt before any model decision and retries reuse it without Agent work',async t=>{
  const f=fixture(t);const first=await f.manager.prepare(f.chat,f.auth,f.options,'请用 QQ 音乐放歌',[]);
  assert.equal(first.duplicate,false);assert.equal(first.record.status,'deciding');assert.equal(f.saves.length,1);assert.equal(f.submitted.length,0);
  const duplicate=await f.manager.prepare(f.chat,f.auth,f.options,'请用 QQ 音乐放歌',[]);
  assert.equal(duplicate.duplicate,true);assert.equal(duplicate.record,first.record);assert.equal(f.chat.assistantTasks.length,1);
  await assert.rejects(f.manager.prepare(f.chat,f.auth,f.options,'另一份内容',[]),{status:409});
  assert.doesNotMatch(JSON.stringify(assistantTasksSnapshot(f.chat)),/private-session|fingerprint|permissions|provider-one/);
});

test('concurrent identical foreground submissions reserve only one durable receipt',async t=>{
  const f=fixture(t),gate=deferred();let saved=false;
  f.store.save=async()=>{await gate.promise;saved=true;};
  const first=f.manager.prepare(f.chat,f.auth,f.options,'播放',[]),second=f.manager.prepare(f.chat,f.auth,f.options,'播放',[]);
  await new Promise(resolve=>setTimeout(resolve,2));assert.equal(saved,false);gate.resolve();
  const [a,b]=await Promise.all([first,second]);assert.equal(a.duplicate,false);assert.equal(b.duplicate,true);assert.equal(a.record,b.record);
});

test('dispatch reuses normal Agent submission with frozen settings and one independently saved child',async t=>{
  const f=fixture(t),{record}=await f.manager.prepare(f.chat,f.auth,f.options,'播放',[]);
  const [a,b]=await Promise.all([f.manager.dispatch(record,'用 QQ 音乐播放当前队列'),f.manager.dispatch(record,'第二次调用应复用任务')]);
  assert.equal(f.submitted.length,1);assert.equal(a.conversationId,b.conversationId);assert.equal(a.status,'queued');assert.equal(f.chat.mode,'chat');
  const {child,body}=f.submitted[0];assert.equal(child.mode,'codex');assert.equal(child.backgroundParentId,f.chat.id);assert.equal(child.codexRevision,f.revisionId);
  assert.ok(f.saves.some(state=>state.conversations.some(item=>item.id===child.id&&!item.agent)));
  assert.equal(body.content,'用 QQ 音乐播放当前队列');assert.equal(body.submissionId,record.id);assert.equal(body.hostId,f.hostId);assert.equal(body.providerId,'provider-one');
  assert.deepEqual(body.permissions,{access:'full-access',approval:'auto'});assert.equal(f.store.state.conversations.length,2);
});

test('receipt save failure prevents a provider decision reservation and any child or Agent action',async t=>{
  const f=fixture(t);f.store.save=async()=>{throw new Error('disk-full');};
  await assert.rejects(f.manager.prepare(f.chat,f.auth,f.options,'播放',[]),/disk-full/);
  assert.equal(f.chat.assistantTasks.length,0);assert.equal(f.submitted.length,0);assert.equal(f.store.state.conversations.length,1);
});

test('child persistence failure never invokes Agent and leaves no orphaned child',async t=>{
  const f=fixture(t),{record}=await f.manager.prepare(f.chat,f.auth,f.options,'播放',[]);
  f.store.save=async()=>{throw new Error('disk-full');};
  await assert.rejects(f.manager.dispatch(record,'播放音乐'),/disk-full/);
  assert.equal(f.submitted.length,0);assert.equal(f.store.state.conversations.length,1);assert.equal(record.status,'error');assert.equal(record.conversationId,undefined);
});

test('permission or configuration change during the Chat decision prevents Agent submission',async t=>{
  let allowed=true,revision=randomUUID();
  const f=fixture(t,{authorize:()=>{if(!allowed)throw Object.assign(new Error('revoked'),{status:401});},revision:()=>revision});
  const {record}=await f.manager.prepare(f.chat,f.auth,f.options,'播放',[]);allowed=false;
  await assert.rejects(f.manager.dispatch(record,'播放音乐'),{status:401});allowed=true;revision=randomUUID();
  await assert.rejects(f.manager.dispatch(record,'播放音乐'),{status:409});assert.equal(f.submitted.length,0);
});

test('an offline selected PC does not block normal Chat preparation and never silently changes the dispatch target',async t=>{
  const checks=[];
  const f=fixture(t,{resolveHost:(_user,id,options)=>{checks.push({id,options});if(options?.requireOnline!==false)throw Object.assign(new Error('selected PC offline'),{status:409,code:'executor_offline'});return {hostId:id,hostName:'Offline PC'};}});
  const {record}=await f.manager.prepare(f.chat,f.auth,f.options,'你好',[]);assert.equal(record.hostName,'Offline PC');
  await assert.rejects(f.manager.dispatch(record,'播放音乐'),{code:'executor_offline'});assert.equal(f.submitted.length,0);assert.equal(f.store.state.conversations.length,1);
  assert.equal(checks[0].options.requireOnline,false);assert.equal(checks[1].id,f.hostId);await f.manager.finishDecision(record,{error:'selected PC offline'});
});

test('completion is projected to the parent once as an ordinary readable assistant reply',async t=>{
  const f=fixture(t),{record}=await f.manager.prepare(f.chat,f.auth,f.options,'播放',[]);await f.manager.dispatch(record,'播放音乐');
  const child=f.submitted[0].child,runId=randomUUID();
  child.agent={queue:[],submissions:[],run:{id:runId,submissionId:record.id,status:'completed',finishedAt:new Date().toISOString()}};
  child.messages.push({id:randomUUID(),role:'assistant',agentRunId:runId,content:'QQ 音乐已接受播放指令。',status:'complete'});
  await Promise.all([f.manager.refresh(f.chat),f.manager.refresh(f.chat)]);
  assert.equal(record.status,'completed');assert.equal(f.chat.messages.length,1);assert.equal(f.chat.messages[0].role,'assistant');assert.match(f.chat.messages[0].content,/QQ 音乐已接受/);
  assert.equal(f.chat.messages[0].id,record.resultMessageId);await f.manager.refresh(f.chat);assert.equal(f.chat.messages.length,1);
  assert.equal(restoreAssistantTasks(f.chat,f.store.state.executionHosts,f.store.state.conversations),false);
});

test('deciding cancellation, logout and close prevent late dispatch without stopping ordinary Chat',async t=>{
  const f=fixture(t),{record}=await f.manager.prepare(f.chat,f.auth,f.options,'播放',[]);
  await f.manager.revoke(job=>job.sessionHash===f.auth.sessionHash);assert.equal(record.status,'cancelled');
  await f.manager.dispatch(record,'晚到的决定');assert.equal(f.submitted.length,0);assert.equal(f.chat.mode,'chat');
  assert.equal((await f.manager.stop(f.chat,record.id)).status,'cancelled');
});

test('background stop delegates to the normal Agent queue and clears unstarted work',async t=>{
  const f=fixture(t),{record}=await f.manager.prepare(f.chat,f.auth,f.options,'播放',[]);await f.manager.dispatch(record,'播放音乐');
  const result=await f.manager.stop(f.chat,record.id);assert.equal(result.status,'cancelled');assert.equal(f.stopped.length,1);assert.deepEqual(f.stopped[0].args,{clear:true});
});

test('a no-task decision ends only its receipt and never submits or adds a duplicate spoken reply',async t=>{
  const f=fixture(t),{record}=await f.manager.prepare(f.chat,f.auth,f.options,'你好',[]);
  await f.manager.finishDecision(record);assert.equal(record.status,'completed');assert.equal(f.submitted.length,0);assert.equal(f.chat.messages.length,0);
  assert.deepEqual(f.manager.snapshot(f.chat),[]);assert.equal(f.chat.assistantTasks.length,1);
  await f.manager.dispatch(record,'晚到的调用');assert.equal(f.submitted.length,0);
});

test('failed Chat decision preserves its error and a failed final result save is retried without duplicates',async t=>{
  const f=fixture(t),first=await f.manager.prepare(f.chat,f.auth,f.options,'你好',[]);
  await f.manager.finishDecision(first.record,{error:'模型决定未完成'});assert.equal(first.record.message,'模型决定未完成');assert.equal(f.manager.snapshot(f.chat)[0].status,'error');
  const next=normalizeChatAssistant({enabled:true,hostId:f.hostId,providerId:'provider-one'},randomUUID()),{record}=await f.manager.prepare(f.chat,f.auth,next,'执行',[]);
  await f.manager.dispatch(record,'执行音乐操作');const child=f.submitted[0].child,runId=randomUUID();
  child.agent={queue:[],submissions:[],run:{id:runId,submissionId:record.id,status:'completed',message:'正在执行桌面工具'}};child.messages.push({role:'assistant',agentRunId:runId,content:'成功'});
  let saves=0;f.store.save=async()=>{if(++saves===1)throw new Error('temporary disk failure');};
  await assert.rejects(f.manager.refresh(f.chat),/temporary disk failure/);assert.equal(f.chat.messages.length,1);
  await f.manager.refresh(f.chat);assert.equal(saves,2);assert.equal(f.chat.messages.length,1);assert.equal(record.message,'后台 Agent 已完成。');
});

test('restore checks child, computer and account ownership and fences interrupted decisions',async t=>{
  const f=fixture(t),{record}=await f.manager.prepare(f.chat,f.auth,f.options,'播放',[]);
  assert.equal(restoreAssistantTasks(f.chat,f.store.state.executionHosts,f.store.state.conversations),true);assert.equal(record.status,'unknown');
  const corrupt=structuredClone(f.chat);corrupt.assistantTasks[0].hostId=randomUUID();assert.throws(()=>restoreAssistantTasks(corrupt,f.store.state.executionHosts,[]));
  const badChild=structuredClone(f.chat);badChild.assistantTasks[0].conversationId=randomUUID();assert.throws(()=>restoreAssistantTasks(badChild,f.store.state.executionHosts,[]));
  await f.manager.dispatch(record,'晚到的调用');assert.equal(f.submitted.length,0);
});

test('real Agent queue runs behind Chat, preserves approvals and returns results through refresh',async t=>{
  const userId=randomUUID(),hostId=randomUUID(),revision=randomUUID(),chat={id:randomUUID(),userId,mode:'chat',messages:[]};
  const auth={userId,sessionHash:'valid',bootstrap:false},store={state:{conversations:[chat]},save:async()=>{}},active=new Map(),approvals=new Map(),done=deferred();
  let input;
  const bridge={run:async args=>{input=args;args.onEvent('turn',{turnId:'turn'});args.onEvent('approval',{id:'approval',kind:'command',description:'音乐操作'});await done.promise;args.onEvent('delta',{text:'已完成播放器操作。'});return {threadId:'thread',text:'已完成播放器操作。'};}};
  const agents=createAgentTasks({store,active,approvals,getBridge:()=>bridge,authorize:()=>{},resolveModel:()=>({model:'gpt-6.1-sol',effort:'max',codexRevision:revision}),resolveHost:()=>({hostId,hostName:'PC'})});
  const manager=createChatAssistant({store,agentTasks:agents,authorize:()=>{},resolveHost:()=>({hostId,hostName:'PC'}),revision:()=>revision});
  t.after(async()=>{done.resolve();await manager.close();await agents.close();});
  const options=normalizeChatAssistant({enabled:true,hostId,providerId:'assigned',permissions:{access:'full-access',approval:'auto'}},randomUUID());
  const {record}=await manager.prepare(chat,auth,options,'帮我放音乐',[]);await manager.dispatch(record,'打开 QQ 音乐并播放');await until(()=>input);
  assert.equal(active.has(chat.id),false);assert.equal(active.has(record.conversationId),true);assert.equal(agents.snapshot(store.state.conversations.find(item=>item.id===record.conversationId)).approvals.length,1);
  done.resolve();await until(()=>!active.size);await manager.refresh(chat);
  assert.equal(record.status,'completed');assert.match(chat.messages[0].content,/已完成播放器/);assert.equal(approvals.size,0);
});
