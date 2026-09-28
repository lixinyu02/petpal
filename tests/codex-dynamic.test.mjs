import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CodexBridge } from '../server/codex.mjs';
import { defaultCodexConfig, patchCodexConfig } from '../server/codex-config.mjs';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const fixture = String.raw`
import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';
const log=process.argv[2],send=x=>process.stdout.write(JSON.stringify(x)+'\n');
const reply=(x,result)=>send({id:x.id,result}),notify=(method,params)=>send({method,params});
let turn=0,active;
const receivedResponses=new Set(),responseWaiters=new Map();
const finish=status=>{if(active){notify('turn/completed',{threadId:'thread-fixture',turn:{id:active,status}});active=null;}};
createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line),p=m.params||{};appendFileSync(log,line+'\n');
 if(!m.method){
   receivedResponses.add(m.id);
   for(const waiter of responseWaiters.get(m.id)||[])reply(waiter,{received:true});
   responseWaiters.delete(m.id);
   if(m.id==='call-main'){notify('item/agentMessage/delta',{threadId:'thread-fixture',turnId:active,delta:JSON.stringify(m.result)});finish('completed');}return;
 }
 if(m.method==='initialize'){reply(m,{userAgent:'dynamic-fixture'});return;}
 if(m.method==='initialized')return;
 if(m.method==='fixture/receipt'){reply(m,{});return;}
 if(m.method==='fixture/await-response'){
   if(receivedResponses.has(p.responseId))reply(m,{received:true});
   else responseWaiters.set(p.responseId,[...(responseWaiters.get(p.responseId)||[]),m]);
   return;
 }
 if(m.method==='account/read'){reply(m,{account:{type:'chatgpt'},requiresOpenaiAuth:true});return;}
 if(m.method==='thread/start'||m.method==='thread/resume'){reply(m,{thread:{id:'thread-fixture'}});return;}
 if(m.method==='turn/interrupt'){reply(m,{});finish('interrupted');return;}
 if(m.method==='turn/start'){
   active='turn-'+(++turn);const mode=p.input[0].text;
   if(mode==='leak'){
     notify('turn/started',{threadId:'thread-fixture',turn:{id:active,status:'inProgress'}});reply(m,{turn:{id:active}});
     for(const delta of ['before arbitrary-sec','ret-value after'])notify('item/agentMessage/delta',{threadId:'thread-fixture',turnId:active,delta});
     finish('completed');return;
   }
   const params={threadId:'thread-fixture',turnId:active,callId:'unique-call',namespace:null,tool:mode==='status'?'petpal_status':'petpal_action',arguments:{}};
   if(mode==='stale')params.turnId='old-turn';
   if(mode==='namespace')params.namespace='foreign';
   if(mode==='unregistered')params.tool='shell';
   if(mode==='invalid-args')params.arguments={bad:true};
   if(mode!=='early')notify('turn/started',{threadId:'thread-fixture',turn:{id:active,status:'inProgress'}});
   send({id:'call-main',method:mode==='command'?'item/commandExecution/requestApproval':'item/tool/call',params:{...params,command:'dangerous command'}});
   if(mode==='double')send({id:'call-duplicate',method:'item/tool/call',params});
   reply(m,{turn:{id:active,status:'inProgress'}});
   if(mode==='stale')setTimeout(()=>finish('completed'),20);
 }
});
`;

async function setup(t, execute = async () => ({ ok: true }), mode = 'api') {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-codex-dynamic-'));
  const file = path.join(directory, 'fixture.mjs'), log = path.join(directory, 'rpc.jsonl');
  await writeFile(file, fixture);
  const tools = {
    specs: ['petpal_status', 'petpal_action'].map(name => ({ type: 'function', name, description: name, inputSchema: { type: 'object', properties: {}, additionalProperties: false } })),
    describe(name, args) { if (Object.keys(args).length) throw new Error('参数不合法'); return { description: `执行 ${name}`, approvalRequired: name === 'petpal_action' }; }, execute,
  };
  const config = mode === 'api' ? patchCodexConfig(defaultCodexConfig(), { mode: 'api', baseUrl: 'http://127.0.0.1:9999/v1', model: 'fixture', apiKey: 'arbitrary-secret-value' }) : undefined;
  const bridge = new CodexBridge({ workspaceRoot: path.join(directory, 'work'), dataDir: directory, config, desktopTools: tools, command: [process.execPath, file, log] });
  t.after(async () => { await bridge.close(); await rm(directory, { recursive: true, force: true }); });
  return { bridge, config, async messages() { await bridge._rpc('fixture/receipt', {}); return (await readFile(log, 'utf8')).trim().split('\n').map(JSON.parse); } };
}

test('dynamic specs use actual app-server shape and status tools run without approval', { timeout: 15000 }, async t => {
  let count = 0; const { bridge, messages } = await setup(t, async () => { count++; return { ok: true }; });
  const events = []; const result = await bridge.run({ prompt: 'status', onEvent: (event, data) => events.push({ event, data }) });
  assert.match(result.text, /success.*true/); assert.equal(count, 1); assert.equal(events.some(x => x.event === 'approval'), false);
  const rpc = await messages(); assert.equal(rpc.find(x => x.method === 'initialize').params.capabilities.experimentalApi, true);
  assert.equal(rpc.find(x => x.method === 'thread/start').params.dynamicTools[0].type, 'function');
  assert.equal(rpc.find(x => x.method === 'thread/start').params.modelProvider, 'petpal');
  assert.deepEqual(rpc.find(x => x.id === 'call-main' && x.result).result, { contentItems: [{ type: 'inputText', text: '{"ok":true}' }], success: true });
});

for (const decision of ['accept', 'decline']) test(`dynamic action awaits explicit ${decision}`, { timeout: 15000 }, async t => {
  let count = 0; const { bridge } = await setup(t, async () => { count++; return { ok: true }; });
  const pending = deferred();
  const run = bridge.run({ prompt: 'action', onEvent: (event, data) => { if (event === 'approval') pending.resolve(data); } });
  const approval = await pending.promise;
  assert.equal(count, 0); assert.equal(approval.kind, 'desktopTool');
  bridge.approve(approval.id, decision); await run;
  assert.equal(count, decision === 'accept' ? 1 : 0);
  assert.throws(() => bridge.approve(approval.id, 'accept'), /不存在|过期/);
});

for (const prompt of ['namespace', 'unregistered', 'invalid-args', 'early', 'stale', 'command']) test(`invalid API tool request is never executable: ${prompt}`, { timeout: 15000 }, async t => {
  let count = 0; const { bridge } = await setup(t, async () => { count++; return { ok: true }; });
  const approvals = [];
  await bridge.run({ prompt, onEvent: (type, data) => { if (type === 'approval') approvals.push(data); } });
  assert.equal(count, 0); assert.equal(approvals.length, 0);
});

test('duplicate callId is rejected while the original awaits approval', { timeout: 15000 }, async t => {
  let count = 0; const { bridge, messages } = await setup(t, async () => { count++; return { ok: true }; });
  const approval = deferred();
  const run = bridge.run({ prompt: 'double', onEvent: (type, data) => { if (type === 'approval') approval.resolve(data); } });
  const pending = await approval.promise;
  // An ordinary stdin receipt can overtake a reply enqueued by a later stdout
  // callback. Wait for this exact reply to be consumed and logged by the child.
  assert.deepEqual(await bridge._rpc('fixture/await-response', { responseId: 'call-duplicate' }), { received: true });
  const rpc = await messages();
  assert.equal(rpc.find(x => x.id === 'call-duplicate' && x.result).result.success, false);
  assert.equal(count, 0); assert.equal(bridge.approvals.size, 1);
  bridge.approve(pending.id, 'accept'); await run; assert.equal(count, 1);
});

test('stop declines waiting dynamic approval and never executes its late acceptance', { timeout: 15000 }, async t => {
  let count = 0; const { bridge } = await setup(t, async () => { count++; });
  const controller = new AbortController(), pending = deferred();
  const run = bridge.run({ prompt: 'action', signal: controller.signal, onEvent: (type, data) => { if (type === 'approval') pending.resolve(data); } });
  const approval = await pending.promise; const stopped = assert.rejects(run, error => error.name === 'AbortError');
  controller.abort(); assert.throws(() => bridge.approve(approval.id, 'accept'), /不存在|过期/); await stopped;
  assert.equal(count, 0);
});

test('stop waits for dynamic runner cleanup and suppresses its late successful output', { timeout: 15000 }, async t => {
  const started = deferred(), aborted = deferred(), released = deferred();
  const { bridge, messages } = await setup(t, async (name, args, { signal }) => {
    started.resolve(); await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })); aborted.resolve(); await released.promise; return { ok: true, late: 'MUST_NOT_SURFACE' };
  });
  const controller = new AbortController();
  const run = bridge.run({ prompt: 'action', signal: controller.signal, onEvent: (type, data) => { if (type === 'approval') bridge.approve(data.id, 'accept'); } });
  let finished = false; const rejected = assert.rejects(run, error => error.name === 'AbortError').then(() => { finished = true; });
  await started.promise; controller.abort(); await aborted.promise;
  assert.equal(finished, false); released.resolve(); await rejected;
  const replies = (await messages()).filter(x => x.id === 'call-main' && x.result);
  assert.equal(replies.length, 1); assert.equal(replies[0].result.success, false); assert.ok(!JSON.stringify(replies).includes('MUST_NOT_SURFACE'));
});

test('tool errors and output scrub the exact custom API secret', { timeout: 15000 }, async t => {
  const { bridge } = await setup(t, async () => { throw new Error('arbitrary-secret-value'); });
  const result = await bridge.run({ prompt: 'action', onEvent: (type, data) => { if (type === 'approval') bridge.approve(data.id, 'accept'); } });
  assert.ok(!result.text.includes('arbitrary-secret-value')); assert.match(result.text, /已隐藏/);
});

test('API secret split across streamed model deltas never reaches output', { timeout: 15000 }, async t => {
  const { bridge } = await setup(t); const chunks = [];
  const result = await bridge.run({ prompt: 'leak', onEvent: (type, data) => { if (type === 'delta') chunks.push(data.text); } });
  assert.equal(result.text, 'before [已隐藏] after'); assert.equal(chunks.join(''), result.text);
});
