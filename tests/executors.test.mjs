import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createExecutors, validateExecutionHosts } from '../server/executors.mjs';

const deferred = () => { let resolve; const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve}; };
async function until(fn){for(let i=0;i<100;i++){if(fn())return;await delay(2);}assert.fail('Executor did not settle');}
function fixture(t, options={}) {
  const userId=randomUUID(), otherUserId=randomUUID(), auth={userId,sessionHash:'session-first',bootstrap:false};
  const valid=new Set([auth.sessionHash,'session-second']), config={mode:'api',model:'model-1',revision:randomUUID(),baseUrl:'https://central-model.example/v1',apiKey:'never-send-this-key'};
  const store={state:{users:[{id:userId},{id:otherUserId}],executionHosts:[]},save:async()=>{}};
  const authorization=[];
  const manager=createExecutors({store,getConfig:()=>config,authorizeSession:value=>{if(!valid.has(value.sessionHash))throw Object.assign(new Error('expired'),{status:401});},authorizeEntry:entry=>{authorization.push(entry.id);if(!valid.has(entry.auth.sessionHash))throw Object.assign(new Error('revoked'),{status:401});},readAttachment:async(_userId,id)=>({record:{id,mimeType:'image/png'},bytes:Buffer.from('fixture-image')}),pollMs:5,commandMs:100,stopMs:15,...options});
  t.after(()=>manager.close());
  const registration=(extra={})=>manager.register(auth,{deviceId:randomUUID(),name:'My Windows PC',platform:'win32',arch:'x64',...extra});
  const entry=hostId=>({id:randomUUID(),conversationId:randomUUID(),auth,hostId,model:config.model,effort:'high',codexRevision:config.revision,attachmentIds:[]});
  const begin=async registered=>{
    const item=entry(registered.hostId),bridge=manager.bind(item),controller=new AbortController(),events=[];
    const completion=bridge.run({conversationId:item.conversationId,prompt:'do fixture work',permissions:{access:'read-only',approval:'ask'},signal:controller.signal,onEvent:(name,data)=>events.push({name,data})});completion.catch(()=>{});
    const command=(await manager.poll(registered.connectionId,auth)).commands[0];assert.equal(command.type,'run');
    let sequence=0;
    const event=(event,data={})=>manager.events(registered.connectionId,auth,{runId:item.id,sequence:++sequence,event,data});
    return {item,bridge,controller,events,completion,command,event};
  };
  return {manager,registration,begin,auth,valid,config,store,userId,otherUserId,entry};
}

test('registration is scoped to account, stable device identity, and rotated connection',async t=>{
  const f=fixture(t),deviceId=randomUUID(),first=await f.registration({deviceId}),second=await f.registration({deviceId});
  assert.equal(first.hostId,second.hostId);assert.notEqual(first.connectionId,second.connectionId);
  assert.throws(()=>f.manager.heartbeat(first.connectionId,f.auth),{status:404});
  assert.equal(f.manager.list(f.userId).length,2);assert.equal(f.manager.list(f.otherUserId).length,1);
  assert.throws(()=>f.manager.target(f.otherUserId,first.hostId),{status:404});
  assert.throws(()=>f.manager.heartbeat(second.connectionId,{...f.auth,userId:f.otherUserId}),{status:404});
  assert.throws(()=>f.manager.heartbeat(second.connectionId,{...f.auth,sessionHash:'session-second'}),{status:404});
  assert.doesNotMatch(JSON.stringify(f.manager.list(f.userId)),/session-first|deviceId|never-send-this-key/);
});

test('registration validates fields, platform and persisted ownership',async t=>{
  const f=fixture(t);
  await assert.rejects(f.registration({command:'arbitrary shell'}),{status:400});
  await assert.rejects(f.registration({name:'bad\nname'}),{status:400});
  await assert.rejects(f.registration({platform:'browser'}),{status:400});
  await f.registration();assert.equal(validateExecutionHosts(f.store.state),false);
  const corrupt=structuredClone(f.store.state);corrupt.executionHosts[0].userId='foreign';assert.throws(()=>validateExecutionHosts(corrupt));
});

test('run command contains no central credentials and is delivered once',async t=>{
  const f=fixture(t),registered=await f.registration(),run=await f.begin(registered);
  assert.equal(run.command.model,'model-1');assert.equal(run.command.relayToken.length,43);
  assert.doesNotMatch(JSON.stringify(run.command),/never-send-this-key|baseUrl|session-first/);
  assert.deepEqual((await f.manager.poll(registered.connectionId,f.auth)).commands,[]);
  run.event('started');run.event('thread',{threadId:'native-thread'});run.event('delta',{text:'hello'});run.event('complete',{threadId:'native-thread',text:''});
  assert.deepEqual(await run.completion,{threadId:'native-thread',text:''});assert.equal(run.events[1].data.text,'hello');
});

test('events enforce sequence, replay exact receipts, and reject foreign task events',async t=>{
  const f=fixture(t),registered=await f.registration(),run=await f.begin(registered);
  const packet={runId:run.item.id,sequence:1,event:'started',data:{}};
  assert.deepEqual(f.manager.events(registered.connectionId,f.auth,packet),{ok:true});
  assert.deepEqual(f.manager.events(registered.connectionId,f.auth,packet),{ok:true});
  assert.throws(()=>f.manager.events(registered.connectionId,f.auth,{...packet,event:'delta',data:{text:'injected'}}),{status:409});
  assert.throws(()=>f.manager.events(registered.connectionId,f.auth,{...packet,runId:randomUUID()}),{status:404});
  assert.throws(()=>f.manager.events(registered.connectionId,f.auth,{...packet,sequence:3,event:'complete',data:{}}),{status:409});
  f.manager.events(registered.connectionId,f.auth,{runId:run.item.id,sequence:2,event:'complete',data:{text:'done'}});await run.completion;
  assert.deepEqual(f.manager.events(registered.connectionId,f.auth,{runId:run.item.id,sequence:2,event:'complete',data:{text:'done'}}),{ok:true});
});

test('re-registration fences prior run without replay or stale completion',async t=>{
  const f=fixture(t),deviceId=randomUUID(),registered=await f.registration({deviceId}),run=await f.begin(registered);run.event('started');
  const renewed=await f.registration({deviceId});await assert.rejects(run.completion,{code:'execution_unknown'});
  assert.throws(()=>run.event('complete',{text:'late result'}),{status:404});
  assert.deepEqual((await f.manager.poll(renewed.connectionId,f.auth)).commands,[]);
});

test('expired lease marks offline and does not imply stopped',async t=>{
  let clock=1000;const f=fixture(t,{clock:()=>clock}),registered=await f.registration(),run=await f.begin(registered);run.event('started');clock+=30001;
  assert.equal(f.manager.list(f.userId).find(host=>host.id===registered.hostId).online,false);
  await assert.rejects(run.completion,{code:'execution_unknown'});assert.throws(()=>f.manager.target(f.userId,registered.hostId),{code:'executor_offline'});
});

test('stop waits for real stopped receipt; absent receipt becomes unknown',async t=>{
  const f=fixture(t),registered=await f.registration(),run=await f.begin(registered);run.event('started');run.controller.abort();
  const stop=(await f.manager.poll(registered.connectionId,f.auth)).commands[0];assert.equal(stop.type,'stop');
  let settled=false;void run.completion.finally(()=>{settled=true;}).catch(()=>{});await delay(2);assert.equal(settled,false);
  run.event('stopped');await assert.rejects(run.completion,{name:'AbortError'});
  const second=await f.begin(registered);second.event('started');second.controller.abort();await assert.rejects(second.completion,{code:'execution_unknown'});
});

test('steer and approval stay on their original connection with scoped acknowledgements',async t=>{
  const f=fixture(t),registered=await f.registration(),run=await f.begin(registered);run.event('started');
  const steering=run.bridge.steer({expectedTurnId:'turn-one',content:'follow-up'});
  const steer=(await f.manager.poll(registered.connectionId,f.auth)).commands[0];assert.equal(steer.type,'steer');
  run.event('command-result',{commandId:steer.id,ok:true,turnId:'turn-one'});assert.equal((await steering).turnId,'turn-one');
  run.event('approval',{id:'remote-approval',kind:'command',description:'write fixture\n目录：workspace\n命令：fixture command'});
  const approval=run.events.at(-1).data.id;assert.notEqual(approval,'remote-approval');
  const approving=run.bridge.approve(approval,'accept');const command=(await f.manager.poll(registered.connectionId,f.auth)).commands[0];assert.equal(command.approvalId,'remote-approval');
  await assert.rejects(run.bridge.approve(approval,'accept'),{status:404});
  run.event('command-result',{commandId:command.id,ok:true});await approving;
  run.event('complete',{text:'done'});await run.completion;
});

test('executor logout and submitter revocation both invalidate execution',async t=>{
  const f=fixture(t),registered=await f.registration(),run=await f.begin(registered);run.event('started');
  f.manager.revoke(auth=>auth.sessionHash===f.auth.sessionHash);await assert.rejects(run.completion,{code:'execution_unknown'});
  assert.throws(()=>f.manager.heartbeat(registered.connectionId,f.auth),{status:404});
});

test('attachments require run credential, ownership list and unchanged bytes',async t=>{
  const f=fixture(t),registered=await f.registration(),entry=f.entry(registered.hostId),attachmentId=randomUUID();entry.attachmentIds=[attachmentId];
  const bridge=f.manager.bind(entry),completion=bridge.run({conversationId:entry.conversationId,prompt:'image',permissions:{access:'read-only',approval:'ask'}});completion.catch(()=>{});
  const command=(await f.manager.poll(registered.connectionId,f.auth)).commands[0];assert.equal(command.attachments[0].sha256,createHash('sha256').update('fixture-image').digest('hex'));
  const authorization=`Bearer ${command.relayToken}`;
  assert.equal((await f.manager.attachment(registered.connectionId,entry.id,attachmentId,authorization)).bytes.toString(),'fixture-image');
  await assert.rejects(f.manager.attachment(registered.connectionId,entry.id,randomUUID(),authorization),{status:404});
  await assert.rejects(f.manager.attachment(registered.connectionId,entry.id,attachmentId,'Bearer invalid'),{status:401});
  f.manager.events(registered.connectionId,f.auth,{runId:entry.id,sequence:1,event:'started',data:{}});
  f.manager.events(registered.connectionId,f.auth,{runId:entry.id,sequence:2,event:'complete',data:{text:''}});await completion;
  await assert.rejects(f.manager.attachment(registered.connectionId,entry.id,attachmentId,authorization),{status:401});
});
