import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { createPetServer } from '../server/app.mjs';
import { JsonStore } from '../server/store.mjs';
import { defaultCodexConfig } from '../server/codex-config.mjs';
import { listenFixture } from './helpers/loopback.mjs';

async function until(callback) { for (let i=0;i<200;i++) { const value=await callback(); if(value)return value; await delay(5); } assert.fail('Question fixture did not settle'); }
async function fixture(t) {
  const directory=await mkdtemp(path.join(tmpdir(),'petpal-question-api-')),token=randomUUID(),calls=[],answers=[],decisions=[];
  const store=await new JsonStore(directory).init(); store.state.codexConfig={...defaultCodexConfig(),mode:'api',baseUrl:'https://question.invalid/v1',model:'fixture-question-model',apiKey:'synthetic-key'}; await store.save();
  const codex={async status(){return{available:true,authenticated:true};},run(args){return new Promise((resolve,reject)=>{const call={args,resolve,reject,inputId:randomUUID(),approvalId:randomUUID(),threadId:args.threadId||`fixture-thread-${calls.length+1}`};calls.push(call);args.onEvent('thread',{threadId:call.threadId});args.onEvent('turn',{turnId:`turn-${calls.length}`});args.signal.addEventListener('abort',()=>reject(args.signal.reason),{once:true});});},
    async replyUserInput(id,body){answers.push({id,body});const call=calls.find(item=>item.inputId===id);call.args.onEvent('user-input-resolved',{id});return{ok:true};},async approve(id,decision){decisions.push({id,decision});return{ok:true};},async close(){for(const call of calls)call.reject(new Error('Fixture closed'));}};
  const app=await createPetServer({dataDir:directory,token,codex});await listenFixture(app.server);const origin=`http://127.0.0.1:${app.server.address().port}`;
  const request=async(route,{method='GET',body,authorization=token}={})=>{const response=await fetch(`${origin}/api${route}`,{method,headers:{'Content-Type':'application/json',...(authorization?{Authorization:`Bearer ${authorization}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:response.status,data:await response.json()};};
  const create=async()=> (await request('/conversations',{method:'POST',body:{mode:'codex'}})).data;
  const start=async conversation=>{const before=calls.length;await request(`/conversations/${conversation.id}/agent/submit`,{method:'POST',body:{submissionId:randomUUID(),content:'Hold a synthetic question task'}});return until(()=>calls.slice(before).find(item=>item.args.conversationId===conversation.id));};
  const ask=(call,{secret=false,expiresAt=new Date(Date.now()+60000).toISOString()}={})=>call.args.onEvent('user-input',{id:call.inputId,requestedAt:new Date(Date.now()-1).toISOString(),expiresAt,questions:[{id:'scope',header:'任务选择',question:'请选择本次处理范围。',isOther:true,isSecret:secret,options:secret?[]:[{label:'当前项目',description:'只处理当前项目。'}]}]});
  t.after(async()=>{await app.close();assert.ok(directory.startsWith(path.join(tmpdir(),'petpal-question-api-')));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
  return{request,create,start,ask,calls,answers,decisions,directory,origin,token,codex};
}
const answer=text=>({answers:{scope:{answers:[text]}}});

test('pending questions survive browser reads and answers are never persisted in normal history',async t=>{
  const f=await fixture(t),conversation=await f.create(),call=await f.start(conversation);f.ask(call,{secret:true});
  const first=(await f.request(`/conversations/${conversation.id}`)).data;assert.equal(first.agent.userInputs[0].id,call.inputId);
  assert.deepEqual((await f.request(`/conversations/${conversation.id}`)).data.agent.userInputs,first.agent.userInputs);
  const secret='only-the-selected-agent-receives-this';const route=`/codex/user-inputs/${call.inputId}`;
  assert.equal((await f.request(route,{method:'POST',body:answer(secret),authorization:''})).status,401);
  const result=await f.request(route,{method:'POST',body:answer(secret)});assert.equal(result.status,200);assert.deepEqual(result.data,{ok:true});
  assert.equal((await f.request(route,{method:'POST',body:answer(secret)})).status,200);assert.equal(f.answers.length,1);
  assert.equal((await f.request(route,{method:'POST',body:answer('different')})).status,409);
  const after=(await f.request(`/conversations/${conversation.id}`)).data;assert.deepEqual(after.agent.userInputs,[]);assert.ok(after.agent.revision>first.agent.revision);assert.ok(!JSON.stringify(after).includes(secret));
  call.resolve({text:'A synthetic task completed.'});await until(async()=>!(await f.request(`/conversations/${conversation.id}`)).data.agent.run.status.includes('running'));
  assert.ok(!(await readFile(path.join(f.directory,'state.json'),'utf8')).includes(secret));
  assert.equal((await f.request(route,{method:'POST',body:answer(secret)})).status,404);
});

test('foreign users, malformed replies, explicit skip and stop preserve question ownership',async t=>{
  const f=await fixture(t),conversation=await f.create(),call=await f.start(conversation);f.ask(call);const route=`/codex/user-inputs/${call.inputId}`;
  await f.request('/admin/users',{method:'POST',body:{username:'question-other',password:'FixtureUser123a',agentAccess:'full'}});
  const login=await f.request('/auth/login',{method:'POST',authorization:'',body:{username:'question-other',password:'FixtureUser123a'}});
  assert.equal((await f.request(route,{method:'POST',authorization:login.data.token,body:answer('当前项目')})).status,404);
  assert.equal((await f.request(route,{method:'POST',body:{answers:{}}})).status,400);assert.equal(f.answers.length,0);
  assert.equal((await f.request(route,{method:'POST',body:{skip:true}})).status,200);assert.deepEqual(f.answers[0].body,{skip:true});
  const next={...call,inputId:randomUUID()};f.calls.push(next);f.ask(next);await f.request(`/conversations/${conversation.id}/stop`,{method:'POST',body:{}});
  assert.deepEqual((await f.request(`/conversations/${conversation.id}`)).data.agent.userInputs,[]);
  assert.equal((await f.request(`/codex/user-inputs/${next.inputId}`,{method:'POST',body:answer('当前项目')})).status,404);
});

test('approval metadata limits approval and expiration even before a delayed native timer fires',async t=>{
  const f=await fixture(t),conversation=await f.create(),call=await f.start(conversation);
  const data={id:call.approvalId,kind:'command',description:'Synthetic approval only.',canAccept:false,requestedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString()};call.args.onEvent('approval',data);
  const snapshot=(await f.request(`/conversations/${conversation.id}`)).data.agent.approvals[0];assert.equal(snapshot.canAccept,false);assert.equal(snapshot.expiresAt,data.expiresAt);
  assert.equal((await f.request(`/codex/approvals/${data.id}`,{method:'POST',body:{decision:'accept'}})).status,409);assert.equal(f.decisions.length,0);
  assert.equal((await f.request(`/codex/approvals/${data.id}`,{method:'POST',body:{decision:'decline'}})).status,200);
  call.args.onEvent('approval',{...data,id:randomUUID(),canAccept:true,expiresAt:new Date(Date.now()-1).toISOString()});
  assert.deepEqual((await f.request(`/conversations/${conversation.id}`)).data.agent.approvals,[]);
});

test('legacy streaming route removes resolved approvals and exposes only pending human questions',async t=>{
  const f=await fixture(t),conversation=await f.create();
  const response=await fetch(`${f.origin}/api/conversations/${conversation.id}/messages`,{method:'POST',headers:{Authorization:`Bearer ${f.token}`,'Content-Type':'application/json'},body:JSON.stringify({content:'legacy synthetic task'})});
  const call=await until(()=>f.calls[0]);call.args.onEvent('approval',{id:call.approvalId,kind:'command',description:'Synthetic operation'});call.args.onEvent('approval-resolved',{id:call.approvalId});f.ask(call,{secret:true});
  const snapshot=(await f.request(`/conversations/${conversation.id}`)).data;assert.deepEqual(snapshot.agent.approvals,[]);assert.equal(snapshot.agent.userInputs.length,1);
  assert.equal((await f.request(`/codex/user-inputs/${call.inputId}`,{method:'POST',body:answer('当前项目')})).status,200);
  call.resolve({text:'Legacy synthetic completed.'});const output=await response.text();assert.match(output,/event: approval-resolved/);assert.match(output,/event: user-input/);
  call.args.onEvent('approval',{id:randomUUID(),kind:'command',description:'A late event must not reappear.'});call.args.onEvent('thread',{threadId:'stale-thread'});
  const completed=(await f.request(`/conversations/${conversation.id}`)).data;
  assert.deepEqual(completed.agent.userInputs,[]);assert.deepEqual(completed.agent.approvals,[]);assert.equal(completed.threadId,undefined);
});

test('a secret answer is delivered only after durable thread detachment and later tasks never resume it',async t=>{
  const f=await fixture(t),conversation=await f.create(),call=await f.start(conversation);f.ask(call,{secret:true});
  f.codex.replyUserInput=async(id,body)=>{
    const disk=JSON.parse(await readFile(path.join(f.directory,'state.json'),'utf8')).conversations.find(item=>item.id===conversation.id);
    assert.equal(disk.threadId,undefined);assert.ok(disk.agent.contextGeneration>0);
    f.answers.push({id,body});call.args.onEvent('thread',{threadId:call.threadId});call.args.onEvent('user-input-resolved',{id});return{ok:true};
  };
  assert.equal((await f.request(`/codex/user-inputs/${call.inputId}`,{method:'POST',body:answer('A synthetic confidential reply')})).status,200);
  call.resolve({threadId:call.threadId,text:'The private-input run completed.'});
  await until(async()=>(await f.request(`/conversations/${conversation.id}`)).data.agent.run.status==='completed');
  const completed=(await f.request(`/conversations/${conversation.id}`)).data;assert.equal(completed.threadId,undefined);
  assert.equal(JSON.parse(await readFile(path.join(f.directory,'state.json'),'utf8')).conversations[0].threadId,undefined);
  const next=await f.start(conversation);assert.equal(next.args.threadId,undefined);assert.ok(!next.args.prompt.includes('confidential reply'));assert.equal(f.answers.length,1);
});
