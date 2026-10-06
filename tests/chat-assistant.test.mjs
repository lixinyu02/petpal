import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createChatAssistant, normalizeChatAssistant, restoreAssistantTasks, assistantTasksSnapshot, assistantTaskContext } from '../server/chat-assistant.mjs';
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

test('Chat collaboration freezes the selected command reviewer and passes it to the child Agent',async t=>{
  const f=fixture(t),reviewProviderId=randomUUID(),options={...f.options,permissions:{access:'read-only',approval:'review',reviewProviderId}};
  const {record}=await f.manager.prepare(f.chat,f.auth,options,'检查电脑',[]);options.permissions.reviewProviderId=randomUUID();
  await f.manager.dispatch(record,'读取系统音量');
  assert.equal(f.submitted[0].body.permissions.reviewProviderId,reviewProviderId);
  assert.equal(record.permissions.reviewProviderId,reviewProviderId);
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

test('background reconciliation durably returns a final result without a foreground read or new dispatch',async t=>{
  const f=fixture(t,{reconcileIntervalMs:5}),{record}=await f.manager.prepare(f.chat,f.auth,f.options,'检查播放器',[]);
  await f.manager.dispatch(record,'只读检查播放器');const child=f.submitted[0].child,runId=randomUUID();
  child.agent={queue:[],submissions:[],run:{id:runId,submissionId:record.id,status:'completed',finishedAt:new Date().toISOString()}};
  child.messages.push({id:randomUUID(),role:'assistant',agentRunId:runId,content:'检测完成，播放器未启动。',status:'complete'});
  await until(()=>f.saves.at(-1)?.conversations.find(item=>item.id===f.chat.id)?.messages.some(message=>message.assistantTaskReport==='result'));
  const result=f.chat.messages[0];assert.equal(result.assistantTaskId,record.id);assert.equal(result.assistantTaskReport,'result');assert.match(result.content,/后台任务已完成/);
  await new Promise(resolve=>setTimeout(resolve,20));assert.equal(f.chat.messages.length,1);assert.equal(f.submitted.length,1);
});

test('long tasks report after thirty seconds, then at most once every two minutes with a persisted cap',async t=>{
  let taskTime=Date.parse('2026-10-06T00:00:00.000Z');
  const f=fixture(t,{clock:()=>taskTime,reconcileIntervalMs:60000}),{record}=await f.manager.prepare(f.chat,f.auth,f.options,'慢任务',[]);
  await f.manager.dispatch(record,'执行慢任务');taskTime+=29999;await f.manager.refresh(f.chat);assert.equal(f.chat.messages.length,0);
  taskTime++;await Promise.all([f.manager.refresh(f.chat),f.manager.refresh(f.chat)]);
  assert.equal(f.chat.messages.length,1);assert.equal(record.progressReports.length,1);assert.match(f.chat.messages[0].content,/等待执行.*尚未收到最终结果/u);
  assert.equal(f.chat.messages[0].assistantTaskReport,'progress');
  taskTime+=119999;await f.manager.refresh(f.chat);assert.equal(f.chat.messages.length,1);
  taskTime++;const child=f.submitted[0].child,runId=randomUUID();
  child.agent={queue:[],submissions:[],approvals:[{id:'approval'}],run:{id:runId,submissionId:record.id,status:'running',message:'工具工作中'}};
  await f.manager.refresh(f.chat);assert.equal(record.progressReports.length,2);assert.match(f.chat.messages[1].content,/等待你的确认/u);
  child.agent.run.status='stopping';taskTime+=120000;await f.manager.refresh(f.chat);assert.match(f.chat.messages[2].content,/正在停止/u);
  child.agent.approvals=[];child.agent.run.status='running';
  for(let index=0;index<8;index++){taskTime+=120000;await f.manager.refresh(f.chat);}
  assert.equal(record.progressReports.length,6);assert.equal(f.chat.messages.length,6);
  assert.equal(restoreAssistantTasks(f.chat,f.store.state.executionHosts,f.store.state.conversations),false);
  child.agent.run.status='completed';child.messages.push({role:'assistant',agentRunId:runId,content:'任务完成。'});
  await f.manager.refresh(f.chat);assert.equal(f.chat.messages.length,7);assert.equal(f.chat.messages.at(-1).assistantTaskReport,'result');assert.equal(f.submitted.length,1);
});

test('failed progress persistence retries the same message and never consumes another report slot',async t=>{
  let taskTime=Date.parse('2026-10-06T00:00:00.000Z');
  const f=fixture(t,{clock:()=>taskTime,reconcileIntervalMs:60000}),{record}=await f.manager.prepare(f.chat,f.auth,f.options,'慢任务',[]);
  await f.manager.dispatch(record,'执行慢任务');taskTime+=30000;
  let saves=0;f.store.save=async()=>{if(++saves===1)throw new Error('report disk unavailable');};
  await assert.rejects(f.manager.refresh(f.chat),/report disk unavailable/u);const messageId=f.chat.messages[0].id;
  await f.manager.refresh(f.chat);assert.equal(saves,2);assert.equal(f.chat.messages.length,1);assert.equal(f.chat.messages[0].id,messageId);assert.equal(record.progressReports.length,1);
});

test('restoration rejects corrupt progress metadata and accepts existing untagged final replies',async t=>{
  let taskTime=Date.parse('2026-10-06T00:00:00.000Z');
  const f=fixture(t,{clock:()=>taskTime,reconcileIntervalMs:60000}),{record}=await f.manager.prepare(f.chat,f.auth,f.options,'慢任务',[]);
  await f.manager.dispatch(record,'执行慢任务');taskTime+=30000;await f.manager.refresh(f.chat);
  const corrupt=change=>{const chat=structuredClone(f.chat);change(chat);assert.throws(()=>restoreAssistantTasks(chat,f.store.state.executionHosts,[chat,...f.store.state.conversations.filter(item=>item!==f.chat)]));};
  corrupt(chat=>{chat.assistantTasks[0].lastProgressAt='bad';});
  corrupt(chat=>{chat.assistantTasks[0].progressReports.push({...chat.assistantTasks[0].progressReports[0]});});
  corrupt(chat=>{chat.messages[0].assistantTaskId=randomUUID();});
  corrupt(chat=>{chat.messages[0].assistantTaskReport='result';});
  corrupt(chat=>{chat.assistantTasks[0].progressReports=[];});
  const child=f.submitted[0].child,runId=randomUUID();child.agent={queue:[],submissions:[],run:{id:runId,submissionId:record.id,status:'completed'}};
  await f.manager.refresh(f.chat);delete f.chat.messages.at(-1).assistantTaskReport;
  assert.equal(restoreAssistantTasks(f.chat,f.store.state.executionHosts,f.store.state.conversations),false);
});

test('current task context is bounded, excludes authorization secrets and tells Chat not to redispatch',async t=>{
  const f=fixture(t),{record}=await f.manager.prepare(f.chat,f.auth,f.options,'任务',[]);await f.manager.dispatch(record,'执行任务');
  const context=assistantTaskContext(f.chat);assert.match(context,/queued/u);assert.match(context,/尚未完成/u);assert.match(context,/不应再次派发/u);
  assert.doesNotMatch(context,/private-session|fingerprint|permissions|provider-one|attachmentIds|codexRevision/u);
  assert.equal(assistantTaskContext({messages:[]}), '');
  f.chat.assistantTasks.push(...Array.from({length:12},(_,index)=>({...record,id:randomUUID(),message:`known-${index}`})));
  const bounded=f.manager.context(f.chat);assert.doesNotMatch(bounded,/known-0"/u);assert.match(bounded,/known-11/u);
});

test('failed or cancelled output is labeled incomplete, and a later child run cannot replace the original result',async t=>{
  const f=fixture(t),{record}=await f.manager.prepare(f.chat,f.auth,f.options,'任务',[]);await f.manager.dispatch(record,'执行任务');
  const child=f.submitted[0].child,originalRunId=randomUUID();
  child.agent={queue:[],submissions:[{submissionId:record.id,entryId:originalRunId,status:'error',error:'执行中断。'}],run:{id:randomUUID(),submissionId:randomUUID(),status:'running'}};
  child.messages.push({role:'assistant',agentRunId:originalRunId,content:'只完成第一步。'},{role:'assistant',agentRunId:child.agent.run.id,content:'另一项任务的输出。'});
  await f.manager.refresh(f.chat);assert.match(f.chat.messages[0].content,/后台任务未完成/u);assert.match(f.chat.messages[0].content,/结束前的输出/u);assert.match(f.chat.messages[0].content,/只完成第一步/u);assert.doesNotMatch(f.chat.messages[0].content,/另一项任务/u);
  await f.manager.refresh(f.chat);assert.equal(f.chat.messages.length,1);
});

test('a restored unknown Agent is reported once and never replays model decisions or submissions',async t=>{
  const f=fixture(t,{reconcileIntervalMs:60000}),{record}=await f.manager.prepare(f.chat,f.auth,f.options,'任务',[]);await f.manager.dispatch(record,'执行任务');
  const restored=structuredClone(f.store.state),chat=restored.conversations.find(item=>item.id===f.chat.id),child=restored.conversations.find(item=>item.id===record.conversationId),runId=randomUUID();
  child.agent={queue:[],submissions:[],run:{id:runId,submissionId:record.id,status:'unknown',error:'服务中断，执行结果待确认。'}};
  child.messages.push({role:'assistant',agentRunId:runId,content:'处理中'});
  restoreAssistantTasks(chat,restored.executionHosts,restored.conversations);
  const manager=createChatAssistant({store:{state:restored,save:async()=>{}},agentTasks:f.agentTasks,authorize:()=>assert.fail('restoration cannot authorize work'),resolveHost:()=>assert.fail('restoration cannot pick a host'),revision:()=>f.revisionId,reconcileIntervalMs:5});t.after(()=>manager.close());
  await until(()=>chat.messages.some(message=>message.assistantTaskReport==='result'));
  assert.equal(chat.assistantTasks[0].status,'unknown');assert.match(chat.messages[0].content,/状态待确认.*不会自动重试/u);
  await manager.dispatch(chat.assistantTasks[0],'不能重试');assert.equal(f.submitted.length,1);assert.equal(chat.messages.length,1);
});
