import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPetServer } from '../server/app.mjs';
import { JsonStore } from '../server/store.mjs';
import { defaultCodexConfig } from '../server/codex-config.mjs';
import { listenFixture } from './helpers/loopback.mjs';

test('HTTP review relay isolates concurrent selected providers and prevents credential or task reuse',async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'petpal-review-relay-'));
  const store=await new JsonStore(directory).init();
  const owner='synthetic-review-owner',parent={...defaultCodexConfig(),mode:'api',baseUrl:'https://parent.example/v1',model:'parent-model',apiKey:'parent-private-fixture'};
  const reviewers=[
    {id:'reviewer-one',name:'Reviewer one',protocol:'responses',baseUrl:'https://review-one.example/v1',model:'review-model-one',apiKey:'review-private-one',reasoningEffort:'low'},
    {id:'reviewer-two',name:'Reviewer two',protocol:'responses',baseUrl:'https://review-two.example/v1',model:'review-model-two',apiKey:'review-private-two',reasoningEffort:''},
  ];
  store.state.codexConfig=parent;store.state.providers=reviewers;await store.save();
  const requests=[];
  const app=await createPetServer({dataDir:directory,token:owner,codex:{async status(){return {available:true,authenticated:true};},async close(){},run(){throw Error('central must not execute');}},executorsOptions:{pollMs:5,stopMs:20,fetchImpl:async(url,init)=>{
    requests.push({url,key:init.headers.Authorization,body:JSON.parse(init.body)});
    const text=init.headers.Authorization.replace('Bearer ','');
    const frames=[{type:'response.output_text.delta',item_id:'fixture-msg',output_index:0,content_index:0,delta:text},{type:'response.output_text.done',item_id:'fixture-msg',output_index:0,content_index:0,text},{type:'response.completed',response:{id:'fixture-response',status:'completed',output:[]}}];
    return new Response(frames.map(frame=>`event: ${frame.type}\ndata: ${JSON.stringify(frame)}\n\n`).join(''),{headers:{'Content-Type':'text/event-stream'}});
  }}});
  t.after(async()=>{await app.close();assert.ok(directory.startsWith(path.join(tmpdir(),'petpal-review-relay-')));await rm(directory,{recursive:true,force:true});});
  await listenFixture(app.server);const origin=`http://127.0.0.1:${app.server.address().port}`;
  const request=async(route,{body,token=owner,method=body===undefined?'GET':'POST'}={})=>fetch(origin+'/api'+route,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(10000)});
  const state=await (await request('/state')).json();assert.deepEqual(state.codex.approvalReviewProviderIds,reviewers.map(item=>item.id));
  assert.doesNotMatch(JSON.stringify(state),/private-fixture|review-private/);
  const runs=[];
  for(const [index,reviewer] of reviewers.entries()){
    const registration=await (await request('/agent/executors/register',{body:{deviceId:randomUUID(),name:`Review PC ${index}`,platform:'win32',arch:'x64',capabilities:{projectDirectory:true,approvalReview:true,independentReviewModel:true}}})).json();
    const chat=await (await request('/conversations',{body:{mode:'codex'}})).json();
    assert.equal((await request(`/conversations/${chat.id}/agent/submit`,{body:{submissionId:randomUUID(),hostId:registration.hostId,content:'Isolated review fixture',permissions:{access:'read-only',approval:'review',reviewProviderId:reviewer.id}}})).status,200);
    let command;const deadline=Date.now()+10000;
    while(!command&&Date.now()<deadline)command=(await (await request(`/agent/executors/${registration.connectionId}/poll`)).json()).commands[0];
    assert.ok(command);assert.equal(command.reviewModel,reviewer.model);assert.doesNotMatch(JSON.stringify(command),/review-private|review-one\.example|review-two\.example/);
    const route=`/agent/executors/${registration.connectionId}/runs/${command.runId}`;
    assert.equal((await request(`/agent/executors/${registration.connectionId}/events`,{body:{runId:command.runId,sequence:1,event:'started',data:{}}})).status,200);
    runs.push({registration,command,route,reviewer});
  }
  for(const run of runs){
    assert.equal((await request(run.route+'/model/responses',{token:run.command.relayToken,body:{model:run.reviewer.model,stream:true}})).status,400);
    assert.equal((await request(run.route+'/review/responses',{token:run.command.relayToken,body:{model:parent.model,stream:true}})).status,400);
    assert.equal((await request(run.route+'/review/responses',{token:runs.find(item=>item!==run).command.relayToken,body:{model:run.reviewer.model,stream:true}})).status,401);
  }
  await Promise.all(runs.map(async run=>{
    const response=await request(run.route+'/review/responses',{token:run.command.relayToken,body:{model:run.reviewer.model,stream:true,reasoning:{effort:'max',summary:'auto'}}});
    assert.equal(response.status,200);const wire=await response.text();assert.doesNotMatch(wire,/review-private/);
  }));
  for(const reviewer of reviewers){const observed=requests.find(item=>item.body.model===reviewer.model);assert.equal(observed.url,reviewer.baseUrl+'/responses');assert.equal(observed.key,`Bearer ${reviewer.apiKey}`);assert.equal(observed.body.reasoning.effort,reviewer.reasoningEffort||undefined);assert.equal(observed.body.reasoning.summary,'auto');}
  const run=runs[0];
  assert.equal((await request(run.route+'/model/responses',{token:run.command.relayToken,body:{model:parent.model,stream:true}})).status,200);
  assert.equal(requests.at(-1).key,`Bearer ${parent.apiKey}`);
  assert.equal((await request(`/agent/executors/${run.registration.connectionId}/events`,{body:{runId:run.command.runId,sequence:2,event:'complete',data:{text:'done'}}})).status,200);
  assert.equal((await request(run.route+'/review/responses',{token:run.command.relayToken,body:{model:run.reviewer.model,stream:true}})).status,401);
  const active=runs[1];
  const removal=await request('/providers/'+active.reviewer.id,{method:'DELETE'});assert.equal(removal.status,409);
  const changed=await request('/providers',{body:{id:active.reviewer.id,apiKey:'rotated-private-fixture'}});assert.equal(changed.status,200);
  assert.equal((await request(active.route+'/review/responses',{token:active.command.relayToken,body:{model:active.reviewer.model,stream:true}})).status,409);
  const persisted=await import('node:fs/promises').then(fs=>fs.readFile(path.join(directory,'state.json'),'utf8'));
  const records=JSON.parse(persisted).conversations;
  assert.doesNotMatch(JSON.stringify(records),/review-private|apiKey|baseUrl/);
});
