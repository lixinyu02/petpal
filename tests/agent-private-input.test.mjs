import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { JsonStore } from '../server/store.mjs';
import { createAgentTasks } from '../server/agent-tasks.mjs';
import { createAgentUserInputs } from '../server/agent-user-inputs.mjs';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
async function until(check){for(let i=0;i<200;i++){if(check())return;await delay(2);}assert.fail('Private-input write did not start');}
async function fixture(t){
  const directory=await mkdtemp(path.join(tmpdir(),'petpal-private-input-')),store=await new JsonStore(directory).init(),userId=store.state.ownerId,id=randomUUID(),runId=randomUUID(),submissionId=randomUUID();
  const auth={userId,sessionHash:'private-input-fixture-session',bootstrap:false,generation:0};
  const entry={id:runId,conversationId:id,auth,permissions:{access:'read-only',approval:'auto'}};
  const conversation={id,userId,mode:'codex',title:'Synthetic privacy fixture',messages:[],codexRevision:randomUUID(),threadId:'old-private-thread',threadHostId:'central',updatedAt:new Date().toISOString(),agent:{revision:5,queueRevision:0,paused:false,queue:[],run:{id:runId,submissionId,status:'running',permissions:entry.permissions},submissions:[{entryId:runId,submissionId,fingerprint:'a'.repeat(64),status:'running'}]}};
  store.state.conversations.push(conversation);await store.save();const active=new Map(),deliveries=[];let authorized=true;
  const task={controller:new AbortController(),userId,sessionHash:auth.sessionHash,agentEntry:entry,approvalIds:new Set(),bridge:{async replyUserInput(...args){deliveries.push(args);return{ok:true};}}};active.set(id,task);
  const manager=createAgentTasks({store,active,approvals:new Map(),getBridge:()=>task.bridge,resolveModel:()=>({}),authorize:()=>{if(!authorized)throw Object.assign(new Error('Revoked fixture'),{status:401});}});
  const registry=createAgentUserInputs({active,protectPrivateInput:()=>manager.protectPrivateInput(conversation,task)}),inputId=randomUUID();
  registry.receive(task,userId,id,{id:inputId,requestedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),questions:[{id:'private',header:'私密输入',question:'输入仅发送到原执行任务。',isSecret:true,options:[]}]});
  const reply=()=>registry.reply(inputId,{answers:{private:{answers:['synthetic confidential value']}}},userId);
  const disk=async()=>JSON.parse(await readFile(store.file,'utf8')).conversations.find(item=>item.id===id);
  t.after(async()=>{active.clear();await manager.close();assert.ok(directory.startsWith(path.join(tmpdir(),'petpal-private-input-')));await rm(directory,{recursive:true,force:true});});
  return{store,conversation,task,active,deliveries,reply,disk,revoke:()=>{authorized=false;}};
}

test('private-input durable barrier precedes delivery and defeats a late snapshot containing the old thread',async t=>{
  const f=await fixture(t),gate=deferred();let entered=false;
  f.store.automationPersistence={commit(){},async prepare(_snapshot,operation){if(operation?.agentRecovery?.kind==='private-context'){entered=true;await gate.promise;}}};
  const answering=f.reply();await until(()=>entered);assert.equal(f.deliveries.length,0);assert.equal(f.conversation.threadId,'old-private-thread');
  const ordinary=f.store.save();gate.resolve();await answering;await ordinary;
  assert.equal(f.deliveries.length,1);assert.equal(f.conversation.threadId,undefined);assert.equal((await f.disk()).threadId,undefined);assert.equal((await f.disk()).agent.contextGeneration,1);
  assert.equal(f.conversation.agent.run.status,'running');assert.equal(f.conversation.agent.paused,false);
  // The next explicit turn inherits the new generation and can keep its own thread.
  f.conversation.threadId='next-explicit-thread';await f.store.save();assert.equal((await f.disk()).threadId,'next-explicit-thread');
});

test('a failed private-input write plus a normal save never delivers the secret',async t=>{
  const f=await fixture(t),gate=deferred();let entered=false;
  f.store.automationPersistence={commit(){},async prepare(_snapshot,operation){if(operation?.agentRecovery?.kind==='private-context'){entered=true;await gate.promise;}}};
  const answering=f.reply();await until(()=>entered);const ordinary=f.store.save();gate.reject(new Error('Injected private protection failure'));
  await assert.rejects(answering,{status:500});await ordinary;assert.equal(f.deliveries.length,0);assert.equal((await f.disk()).threadId,'old-private-thread');
});

test('revocation during the private barrier blocks answer delivery and preserves the prior binding',async t=>{
  const f=await fixture(t),gate=deferred();let entered=false;
  f.store.automationPersistence={commit(){},async prepare(_snapshot,operation){if(operation?.agentRecovery?.kind==='private-context'){entered=true;await gate.promise;}}};
  const answering=f.reply();await until(()=>entered);f.revoke();gate.resolve();await assert.rejects(answering,{status:500});
  assert.equal(f.deliveries.length,0);assert.equal((await f.disk()).threadId,'old-private-thread');
});
