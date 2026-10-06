import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { CodexBridge } from '../server/codex.mjs';
import { validApprovalReview } from '../server/approval-review.mjs';

function fixture(t, { approval = 'review', access = 'full-access', timeout = 300000 } = {}) {
  const executions = [], sent = [], events = [];
  const bridge = new CodexBridge({ approvalTimeoutMs: timeout, desktopTools: {
    specs: ['petpal_system_audio','petpal_system_settings','petpal_computer_use_call'].map(name => ({type:'function',name})),
    describe: () => ({description:'固定动作',approvalRequired:true}),
    execute: async (name,args) => { executions.push({name,args}); return {ok:true}; },
  } });
  bridge.child = {};
  bridge._send = value => sent.push(value);
  const run = { threadId:'thread',turnId:'turn',child:bridge.child,permissions:{access,approval},items:new Map(),dynamicCalls:new Map(),toolTasks:new Set(),onEvent:(name,data)=>events.push({name,data}),settled:false,aborted:false,text:'done',resolve(){},reject(){} };
  bridge.runs.set(run.threadId,run);
  t.after(async () => { for(const id of bridge.approvals.keys()) bridge._removeApproval(id); await Promise.allSettled([...bridge.dynamicTasks]); });
  const call = (tool,args,callId='call') => bridge._serverRequest({id:callId,method:'item/tool/call',params:{threadId:'thread',turnId:'turn',namespace:null,callId,tool,arguments:args}});
  return {bridge,run,events,sent,executions,call};
}

test('review only approves strict fixed audio actions; general tools still wait', async t => {
  const f=fixture(t);
  f.call('petpal_system_audio',{action:'adjust-volume',delta:2});
  await Promise.all([...f.bridge.dynamicTasks]);
  assert.equal(f.executions.length,1);
  assert.ok(f.events.some(event=>event.data.approvalReview?.source==='local-rule'));
  for(const args of [{action:'set-volume',volumePercent:101},{action:'adjust-volume',delta:0},{action:'set-muted',muted:true,command:'whoami'},{action:'set-volume',volumePercent:20,hostId:'other'}]) f.call('petpal_system_audio',args,JSON.stringify(args));
  assert.equal(f.executions.length,1); assert.equal(f.bridge.approvals.size,0);
  f.call('petpal_computer_use_call',{},'computer');
  f.call('petpal_system_settings',{section:'sound'},'settings');
  assert.equal(f.bridge.approvals.size,2);
});

test('review never removes full-access gate and ask still asks for audio', t => {
  for(const options of [{access:'read-only'},{access:'workspace-write'},{approval:'ask'}]) {
    const f=fixture(t,options); f.call('petpal_system_audio',{action:'set-volume',volumePercent:50});
    assert.equal(f.executions.length,0); assert.equal(f.bridge.approvals.size,options.approval==='ask'?1:0);
  }
});

for(const native of [false,true]) test(`approval expires and late acceptance cannot execute (${native?'native':'tool'})`, async t => {
  const f=fixture(t,{timeout:20});
  if(native) f.bridge._serverRequest({id:44,method:'item/commandExecution/requestApproval',params:{threadId:'thread',turnId:'turn',command:'echo test'}});
  else f.call('petpal_system_settings',{section:'sound'});
  const id=[...f.bridge.approvals.keys()][0]; assert.ok(id);
  await delay(35);
  assert.equal(f.bridge.approvals.size,0); assert.equal(f.executions.length,0);
  assert.throws(()=>f.bridge.approve(id,'accept'),/过期/);
  assert.ok(f.events.some(event=>event.name==='approval-resolved'&&event.data.id===id));
  assert.ok(f.sent.some(reply=>native?reply.result?.decision==='decline':reply.result?.success===false));
});

test('consuming approval cancels expiry and duplicate acceptance',async t=>{
  const f=fixture(t,{timeout:20,approval:'ask'}); f.call('petpal_system_audio',{action:'set-muted',muted:true});
  const id=[...f.bridge.approvals.keys()][0]; f.bridge.approve(id,'accept');
  await Promise.all([...f.bridge.dynamicTasks]); await delay(35);
  assert.equal(f.executions.length,1); assert.equal(f.sent.length,1); assert.throws(()=>f.bridge.approve(id,'accept'));
  assert.equal(f.events.filter(event=>event.name==='approval-resolved').length,1);
});

test('Guardian progress is turn-scoped, bounded, scrubbed and cannot approve a tool',t=>{
  const f=fixture(t); f.bridge.config={apiKey:'fixture-private-key'};
  const notify=(turnId,status,rationale)=>f.bridge._message({method:'item/autoApprovalReview/completed',params:{threadId:'thread',turnId,reviewId:'review',targetItemId:'item',review:{status,rationale,riskLevel:'low',userAuthorization:'high'}}});
  notify('old','approved','old'); notify('turn','invalid','bad'); assert.equal(f.events.length,0);
  notify('turn','denied','connection failure fixture-private-key Bearer abcsecret');
  const review=f.events.at(-1).data.approvalReview;
  assert.ok(validApprovalReview(review)); assert.equal(review.status,'denied');
  assert.doesNotMatch(JSON.stringify(review),/fixture-private-key|abcsecret/);
  assert.match(f.events.at(-1).data.message,/未放行/); assert.equal(f.executions.length,0);
  f.run.aborted=true; notify('turn','approved','late'); assert.equal(f.events.length,1);
});

test('finish clears pending expiry before a following task can receive a stale result',async t=>{
  const f=fixture(t,{timeout:20}); f.call('petpal_system_settings',{section:'sound'});
  f.bridge._finish(f.run); await delay(35);
  assert.equal(f.bridge.approvals.size,0); assert.equal(f.sent.length,1); assert.equal(f.sent[0].result.success,false); assert.equal(f.executions.length,0);
});

test('a failing approval event consumer interrupts once and clears the pending request',async t=>{
  const f=fixture(t); let interrupts=0;
  f.run.onEvent=()=>{throw Error('consumer no longer exists');};
  f.bridge._rpc=async method=>{assert.equal(method,'turn/interrupt');interrupts++;f.bridge._finish(f.run,Object.assign(Error('stopped'),{name:'AbortError'}));return {};};
  f.call('petpal_system_settings',{section:'sound'}); await Promise.resolve();
  assert.equal(interrupts,1); assert.equal(f.bridge.approvals.size,0); assert.equal(f.executions.length,0);
  assert.equal(f.sent.length,1); assert.equal(f.sent[0].result.success,false);
});
