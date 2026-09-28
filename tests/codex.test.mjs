import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CodexBridge, resolveCodexCommand, resolveBundledCodex } from '../server/codex.mjs';

const fixture = String.raw`
import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';
const log = process.argv[2];
const mode = process.argv[3];
const send = (m) => process.stdout.write(JSON.stringify(m) + '\n');
const reply = (m, result) => send({id:m.id,result});
const notify = (method,params) => send({method,params});
let initialized = false, threadNumber = 0, turnNumber = 0, pendingStart = null;
const active = new Map();
const approvals = new Map();
function complete(threadId,turnId,status='completed') {
  notify('turn/completed',{threadId,turn:{id:turnId,status}});
  active.delete(threadId);
}
function answer(threadId,turnId) {
  notify('item/agentMessage/delta',{threadId,turnId,itemId:'answer-'+turnId,delta:'你好，'});
  notify('item/agentMessage/delta',{threadId,turnId,itemId:'answer-'+turnId,delta:'小猫！'});
  notify('item/completed',{threadId,turnId,item:{id:'answer-'+turnId,type:'agentMessage',text:'你好，小猫！'}});
  complete(threadId,turnId);
}
createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);
 appendFileSync(log,JSON.stringify(m)+'\n');
 if(!m.method){const a=approvals.get(m.id);if(a){approvals.delete(m.id);notify('serverRequest/resolved',{threadId:a.threadId,requestId:m.id});answer(a.threadId,a.turnId);}return;}
 const p=m.params||{};
 if(m.method==='initialize'){reply(m,{userAgent:'fixture/1.0'});return;}
 if(m.method==='initialized'){initialized=true;return;}
 if(!initialized){send({id:m.id,error:{code:-1,message:'Not initialized'}});return;}
 if(m.method==='fixture/receipt'){reply(m,{received:true});return;}
 if(m.method==='fixture/release-turn-start'){
   if(pendingStart){reply(pendingStart.message,{turn:{id:pendingStart.turnId,status:'inProgress'}});pendingStart=null;}
   reply(m,{});return;
 }
 if(m.method==='account/read'){
   if(mode==='hang-account')return;
   reply(m,{account:mode==='unauth'?null:{type:'chatgpt',email:'private@example.com',accessToken:'do-not-expose'},requiresOpenaiAuth:true});return;
 }
 if(m.method==='thread/start'){reply(m,{thread:{id:'thread-'+(++threadNumber)}});return;}
 if(m.method==='thread/resume'){reply(m,{thread:{id:p.threadId}});return;}
 if(m.method==='turn/start'){
   const threadId=p.threadId,turnId='turn-'+(++turnNumber),prompt=p.input[0].text;
   active.set(threadId,turnId);
   if(prompt==='early-approval'){
     pendingStart={message:m,turnId};
     const id='approve-'+turnId;approvals.set(id,{threadId,turnId});
     send({id,method:'item/commandExecution/requestApproval',params:{threadId,turnId,itemId:'early-cmd',command:'echo test'}});
     return;
   }
   notify('turn/started',{threadId,turn:{id:turnId,status:'inProgress'}});
   if(prompt==='early-completion'){answer(threadId,turnId);reply(m,{turn:{id:turnId}});return;}
   if(prompt==='crash'){process.stderr.write('Authorization: Bearer supersecret');process.exit(17);return;}
   reply(m,{turn:{id:turnId,status:'inProgress'}});
   if(prompt==='wait')return;
   if(prompt==='approval'||prompt==='file-approval'||prompt==='missing-approval-details'){
     const id='approve-'+turnId;
     approvals.set(id,{threadId,turnId});
     if(prompt==='file-approval')notify('item/started',{threadId,turnId,item:{id:'file-1',type:'fileChange',changes:[{path:'/work/a.txt',diff:'-before\n+after'}]}});
     send({id,method:prompt==='file-approval'?'item/fileChange/requestApproval':'item/commandExecution/requestApproval',params:{threadId,turnId,itemId:prompt==='approval'?'cmd-1':'file-1',command:prompt==='approval'?'echo API_KEY=supersecret':undefined,cwd:'/work',reason:'需要许可'}});
     return;
   }
   if(prompt==='failure'){
     notify('error',{threadId,turnId,error:{message:'unauthorized Bearer supersecret'},willRetry:false});
     complete(threadId,turnId,'failed');return;
   }
   if(prompt==='permission'){
     send({id:'permission',method:'item/permissions/requestApproval',params:{threadId,turnId,itemId:'perm-1',permissions:{network:{enabled:true}}}});
     setTimeout(()=>answer(threadId,turnId),30);return;
   }
   if(prompt==='final-only'){
     notify('item/completed',{threadId,turnId,item:{id:'final',type:'agentMessage',text:'完整回复'}});complete(threadId,turnId);return;
   }
   setTimeout(()=>answer(threadId,turnId),10);return;
 }
 if(m.method==='turn/interrupt'){reply(m,{});complete(p.threadId,p.turnId,'interrupted');return;}
 send({id:m.id,error:{code:-32601,message:'unsupported'}});
});
`;

async function setup(t, mode = 'normal') {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-codex-test-'));
  const file = path.join(directory, 'fixture.mjs');
  const log = path.join(directory, 'rpc.jsonl');
  await writeFile(file, fixture);
  const bridge = new CodexBridge({ workspaceRoot: path.join(directory, 'work'), command: [process.execPath, file, log, mode] });
  t.after(async () => { await bridge.close(); await rm(directory, { recursive: true, force: true }); });
  const messages = async () => (await readFile(log, 'utf8')).trim().split('\n').map(JSON.parse);
  // Stdio writes enqueue messages; a fixture reply proves it consumed all preceding lines.
  const receipt = async () => { await bridge._rpc('fixture/receipt', {}); return messages(); };
  return { bridge, messages, receipt };
}

test('initialization is shared, account status excludes identity and secrets', { timeout: 10_000 }, async (t) => {
  const { bridge, messages } = await setup(t);
  const statuses = await Promise.all([bridge.status(), bridge.status()]);
  assert.equal(statuses[0].available, true);
  assert.equal(statuses[0].authenticated, true);
  assert.equal(statuses[0].sandbox, 'read-only');
  assert.doesNotMatch(JSON.stringify(statuses), /private@|do-not-expose/);
  assert.equal((await messages()).filter(m => m.method === 'initialize').length, 1);
});

test('streams one response, resumes same thread, overrides unsafe inherited settings', { timeout: 10_000 }, async (t) => {
  const { bridge, messages } = await setup(t);
  const events = [];
  const first = await bridge.run({ prompt: 'hello', model: 'owner-selected-model', onEvent: (type, data) => events.push({ type, ...data }) });
  assert.equal(first.text, '你好，小猫！');
  assert.equal(events.filter(event => event.type === 'delta').map(event => event.text).join(''), first.text);
  const second = await bridge.run({ prompt: 'early-completion', threadId: first.threadId });
  assert.equal(second.threadId, first.threadId);
  assert.equal(second.text, first.text);
  const rpc = await messages();
  assert.equal(rpc.filter(m => m.method === 'thread/start').length, 1);
  assert.equal(rpc.find(m => m.method === 'thread/resume').params.threadId, first.threadId);
  for (const message of rpc.filter(m => ['thread/start', 'thread/resume', 'turn/start'].includes(m.method))) {
    assert.equal(message.params.approvalPolicy, 'on-request');
    assert.equal(message.params.approvalsReviewer, 'user');
    assert.equal(message.params.cwd, bridge.workspaceRoot);
    if (message.method === 'turn/start') assert.deepEqual(message.params.sandboxPolicy, { type: 'readOnly', networkAccess: false });
    else assert.equal(message.params.sandbox, 'read-only');
  }
});

test('final-only messages are surfaced without requiring a delta notification', { timeout: 10_000 }, async (t) => {
  const { bridge } = await setup(t);
  assert.equal((await bridge.run({ prompt: 'final-only' })).text, '完整回复');
});

for (const [prompt, kind, decision] of [['approval', 'command', 'accept'], ['file-approval', 'fileChange', 'decline']]) {
  test(`${kind} approval only runs after explicit ${decision}`, { timeout: 10_000 }, async (t) => {
    const { bridge, messages } = await setup(t);
    let approval;
    let reached;
    const ready = new Promise(resolve => { reached = resolve; });
    const task = bridge.run({ prompt, onEvent: (type, data) => { if (type === 'approval') { approval = data; reached(); } } });
    await ready;
    assert.equal(approval.kind, kind);
    assert.doesNotMatch(approval.description, /supersecret/);
    if (kind === 'fileChange') assert.match(approval.description, /a.txt[\s\S]*before[\s\S]*after/);
    assert.equal((await bridge.status()).pendingApprovals, 1);
    assert.throws(() => bridge.approve(approval.id, 'acceptForSession'));
    assert.deepEqual(bridge.approve(approval.id, decision), { ok: true });
    assert.throws(() => bridge.approve(approval.id, decision), /过期/);
    await task;
    assert.deepEqual((await messages()).find(m => m.id === 'approve-turn-1' && m.result).result, { decision });
  });
}

test('stop sends turn/interrupt, rejects AbortError, and clears pending approvals', { timeout: 10_000 }, async (t) => {
  const { bridge, receipt } = await setup(t);
  const controller = new AbortController();
  let ready;
  const pending = new Promise(resolve => { ready = resolve; });
  const task = bridge.run({ prompt: 'approval', signal: controller.signal, onEvent: type => { if (type === 'approval') ready(); } });
  await pending;
  const rejected = assert.rejects(task, error => error.name === 'AbortError');
  controller.abort();
  await rejected;
  const rpc = await receipt();
  assert.equal(rpc.find(m => m.method === 'turn/interrupt').params.turnId, 'turn-1');
  assert.equal(rpc.find(m => m.id === 'approve-turn-1' && m.result).result.decision, 'decline');
  assert.equal((await bridge.status()).pendingApprovals, 0);
});

test('abort before turn/start never sends a model request', { timeout: 10_000 }, async (t) => {
  const { bridge, messages } = await setup(t);
  const controller = new AbortController();
  await assert.rejects(bridge.run({ prompt: 'hello', signal: controller.signal, onEvent: type => { if (type === 'thread') controller.abort(); } }), error => error.name === 'AbortError');
  assert.equal((await messages()).some(m => m.method === 'turn/start'), false);
});

test('abort rejects and declines approvals received before the turn/start acknowledgement', { timeout: 10_000 }, async t => {
  const { bridge, receipt } = await setup(t);
  const controller = new AbortController();
  let reached;
  const ready = new Promise(resolve => { reached = resolve; });
  const task = bridge.run({ prompt: 'early-approval', signal: controller.signal, onEvent: (type, data) => { if (type === 'approval') reached(data); } });
  const rejection = assert.rejects(task, error => error.name === 'AbortError');
  const approval = await ready;
  assert.equal(bridge.runs.get('thread-1').turnId, null);
  controller.abort();
  assert.throws(() => bridge.approve(approval.id, 'accept'), /过期/);
  const rpc = await receipt();
  const decisions = rpc.filter(message => message.id === 'approve-turn-1' && message.result).map(message => message.result.decision);
  assert.deepEqual(decisions, ['decline']);
  assert.equal(bridge.approvals.size, 0);
  await bridge._rpc('fixture/release-turn-start', {});
  await rejection;
});

test('same thread cannot start two active turns', { timeout: 10_000 }, async (t) => {
  const { bridge } = await setup(t);
  const controller = new AbortController();
  let ready;
  const pending = new Promise(resolve => { ready = resolve; });
  const task = bridge.run({ prompt: 'wait', threadId: 'existing', signal: controller.signal, onEvent: (type, data) => { if (type === 'status' && data.state === 'working') ready(); } });
  await pending;
  await assert.rejects(bridge.run({ prompt: 'duplicate', threadId: 'existing' }), /运行中/);
  const rejected = assert.rejects(task, error => error.name === 'AbortError');
  controller.abort();
  await rejected;
});

test('unsupported permission requests are declined without broader access', { timeout: 10_000 }, async (t) => {
  const { bridge, messages } = await setup(t);
  await bridge.run({ prompt: 'permission' });
  assert.deepEqual((await messages()).find(m => m.id === 'permission' && m.result).result, { permissions: {}, scope: 'turn' });
});

test('approvals without concrete operation details fail closed', { timeout: 10_000 }, async (t) => {
  const { bridge, messages } = await setup(t);
  const events = [];
  await bridge.run({ prompt: 'missing-approval-details', onEvent: (type, data) => events.push({ type, ...data }) });
  assert.equal(events.some(event => event.type === 'approval'), false);
  assert.deepEqual((await messages()).find(m => m.id === 'approve-turn-1' && m.result).result, { decision: 'decline' });
});

test('authentication failure prevents thread and turn creation', { timeout: 10_000 }, async (t) => {
  const { bridge, messages } = await setup(t, 'unauth');
  assert.equal((await bridge.status()).authenticated, false);
  await assert.rejects(bridge.run({ prompt: 'hello' }), /codex login/);
  assert.equal((await messages()).some(m => m.method === 'thread/start' || m.method === 'turn/start'), false);
});

test('failed turns expose useful auth hint without raw diagnostics', { timeout: 10_000 }, async (t) => {
  const { bridge } = await setup(t);
  await assert.rejects(bridge.run({ prompt: 'failure' }), error => /codex login/.test(error.message) && !/supersecret/.test(error.message));
  assert.equal((await bridge.status()).activeRuns, 0);
});

test('child crash cleans runs and later request can start a fresh child', { timeout: 10_000 }, async (t) => {
  const { bridge } = await setup(t);
  await assert.rejects(bridge.run({ prompt: 'crash' }), error => /退出/.test(error.message) && !/supersecret/.test(error.message));
  assert.equal(bridge.runs.size, 0);
  assert.equal(bridge.pending.size, 0);
  assert.equal((await bridge.run({ prompt: 'after restart' })).text, '你好，小猫！');
});

test('close rejects in-flight RPC and does not restart a closed bridge', { timeout: 10_000 }, async (t) => {
  const { bridge } = await setup(t, 'hang-account');
  let started;
  const initialStart = bridge._readAccount.bind(bridge);
  const accountStarted = new Promise(resolve => { started = resolve; });
  bridge._readAccount = () => { started(); return initialStart(); };
  const status = bridge.status();
  await accountStarted;
  const child = bridge.child;
  let childClosed = false;
  child.once('close', () => { childClosed = true; });
  const closing = bridge.close();
  assert.equal(bridge.close(), closing, 'concurrent close calls share cleanup completion');
  await closing;
  assert.equal(childClosed, true, 'close waits for the owned process and its stdio');
  assert.equal((await status).available, false);
  assert.equal(bridge.child, null);
  assert.equal(bridge.pending.size, 0);
  assert.match((await bridge.status()).error, /关闭/);
});

test('missing CLI and shell command strings fail closed', async () => {
  await assert.rejects(resolveCodexCommand('codex; echo unsafe'), /未找到/);
  const bridge = new CodexBridge({ command: '/petpal/nonexistent/codex' });
  assert.equal((await bridge.status()).available, false);
  await bridge.close();
});

test('explicit custom executable is not replaced by an adjacent npm Codex installation', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-codex-resolution-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const executable = path.join(directory, 'custom-engine.exe');
  const packageRoot = path.join(directory, 'node_modules', '@openai', 'codex');
  const { mkdir, chmod } = await import('node:fs/promises');
  await mkdir(path.join(packageRoot, 'bin'), { recursive: true });
  await writeFile(executable, 'fixture');
  await chmod(executable, 0o700);
  await writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({ name: '@openai/codex' }));
  await writeFile(path.join(packageRoot, 'bin', 'codex.js'), 'fixture');
  assert.deepEqual(await resolveCodexCommand([executable, 'owner-argument']), { file: executable, args: ['owner-argument'] });
});

test('bundled native Codex is resolved outside Electron app.asar', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-codex-bundle-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const virtualPackage = path.join(directory, 'app.asar', 'node_modules', '@openai', 'codex', 'package.json');
  const packageRoot = path.dirname(virtualPackage.replace('app.asar', 'app.asar.unpacked'));
  const target = process.platform === 'win32' ? `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-pc-windows-msvc`
    : process.platform === 'linux' ? `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-unknown-linux-musl`
    : `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-apple-darwin`;
  const binary = path.join(packageRoot, 'vendor', target, 'bin', process.platform === 'win32' ? 'codex.exe' : 'codex');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(path.dirname(binary), { recursive: true });
  await writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({ name: '@openai/codex' }));
  await writeFile(binary, 'native fixture');
  assert.deepEqual(await resolveBundledCodex(virtualPackage), { file: binary, args: [] });
});

test('incomplete desktop bundle fails clearly instead of silently using machine PATH', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-codex-incomplete-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const packageRoot = path.join(directory, '@openai', 'codex');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(path.join(packageRoot, 'bin'), { recursive: true });
  await writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({ name: '@openai/codex' }));
  await writeFile(path.join(packageRoot, 'bin', 'codex.js'), 'wrapper fixture');
  await assert.rejects(resolveBundledCodex(path.join(packageRoot, 'package.json')), /缺少/);
});
