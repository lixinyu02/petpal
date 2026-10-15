import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { CodexBridge } from '../server/codex.mjs';

const question = (extra = {}) => ({ id: 'color', header: '配色', question: '请选择配色。', isOther: true, isSecret: false, options: [{ label: '奶油白', description: '明亮。' }, { label: '浅橘', description: '温暖。' }], ...extra });
const body = value => ({ answers: { color: { answers: [value] } } });
function fixture(t, options = {}) {
  const bridge = new CodexBridge({ workspaceRoot: path.resolve('.tools/unused-user-input-unit-workspace'), ...options });
  const child = {}, writes = [], events = [];
  bridge.child = child; bridge._terminate = async () => {};
  bridge._send = value => { writes.push(structuredClone(value)); };
  bridge._rpc = async (method, params) => { writes.push({ method, params }); if (method === 'turn/interrupt') queueMicrotask(() => bridge._message({ method: 'turn/completed', params: { threadId: params.threadId, turn: { id: params.turnId, status: 'interrupted' } } })); return {}; };
  const newRun = () => {
    let resolve, reject; const completion = new Promise((yes, no) => { resolve = yes; reject = no; }); completion.catch(() => {});
    const run = { threadId: 'owned-thread', turnId: 'owned-turn', child, text: '', permissions: { access: 'full-access', approval: 'auto' }, requestController: new AbortController(), nativeReviews: new Set(), items: new Map(), dynamicCalls: new Map(), streamedItems: new Set(), toolTasks: new Set(), onEvent: (type, data) => events.push({ type, data }), resolve, reject, completion };
    bridge.runs.set(run.threadId, run); return run;
  };
  const run = newRun();
  const ask = (extra = {}, rpcId = 0) => bridge._serverRequest({ id: rpcId, method: 'item/tool/requestUserInput', params: { threadId: run.threadId, turnId: run.turnId, itemId: 'owned-item', questions: [question()], ...extra } });
  const approval = (extra = {}, rpcId = 1) => bridge._serverRequest({ id: rpcId, method: 'item/commandExecution/requestApproval', params: { threadId: run.threadId, turnId: run.turnId, itemId: 'owned-command', command: 'echo synthetic-only', ...extra } });
  t.after(async () => { await bridge.close(); });
  return { bridge, child, writes, events, run, newRun, ask, approval, input: () => events.findLast(event => event.type === 'user-input')?.data };
}

test('numeric native RPC 0 waits for explicit input even under auto and only writes one identical answer', t => {
  const f = fixture(t); f.ask(); const request = f.input();
  assert.ok(request.id); assert.deepEqual(request.questions, [question()]); assert.ok(Date.parse(request.expiresAt) > Date.parse(request.requestedAt)); assert.equal(f.writes.length, 0);
  assert.deepEqual(f.bridge.replyUserInput(request.id, body('奶油白')), { ok: true });
  assert.deepEqual(f.bridge.replyUserInput(request.id, body('奶油白')), { ok: true });
  assert.equal(f.writes.length, 1); assert.deepEqual(f.writes[0], { id: 0, result: body('奶油白') });
  assert.throws(() => f.bridge.replyUserInput(request.id, body('浅橘')), { code: 'user_input_answer_conflict' });
  assert.equal(f.events.filter(event => event.type === 'user-input-resolved').length, 1);
  assert.equal(JSON.stringify([...f.bridge.userInputReceipts.values()]).includes('奶油白'), true, 'question option is public; submitted bodies are not retained');
  assert.equal(Object.hasOwn([...f.bridge.userInputReceipts.values()][0], 'answer'), false);
});

test('only explicit skip yields an empty native answers map', t => {
  const f = fixture(t); f.ask(); const request = f.input();
  assert.throws(() => f.bridge.replyUserInput(request.id, { answers: {} }), { code: 'user_input_invalid' });
  f.bridge.replyUserInput(request.id, { skip: true }); assert.deepEqual(f.writes, [{ id: 0, result: { answers: {} } }]);
});

test('resolved notification uses typed RPC identity and invalidates an unanswered card without answering', t => {
  const f = fixture(t); f.ask(); const request = f.input();
  f.bridge._message({ method: 'serverRequest/resolved', params: { threadId: f.run.threadId, requestId: '0' } }); assert.equal(f.bridge.userInputs.size, 1);
  f.bridge._message({ method: 'serverRequest/resolved', params: { threadId: 'foreign-thread', requestId: 0 } }); assert.equal(f.bridge.userInputs.size, 1);
  f.bridge._message({ method: 'serverRequest/resolved', params: { threadId: f.run.threadId, requestId: 0 } }); assert.equal(f.bridge.userInputs.size, 0);
  assert.throws(() => f.bridge.replyUserInput(request.id, body('奶油白')), { code: 'user_input_expired' }); assert.equal(f.writes.length, 0);
});

test('wrong turn, stale process and invalid question fields cannot create an actionable prompt', t => {
  const f = fixture(t);
  f.ask({ turnId: 'foreign-turn' }); f.ask({ questions: [question({ unknown: 'private' })] }); f.run.child = {};
  f.ask(); assert.equal(f.bridge.userInputs.size, 0); assert.equal(f.events.some(event => event.type === 'user-input'), false);
  assert.equal(f.writes.filter(message => message.error).length, 3);
});

test('question deadline honors a shorter native auto-resolution window and stops without inventing answers', async t => {
  const f = fixture(t, { userInputTimeoutMs: 1000 }); f.ask({ autoResolutionMs: 15 }); const request = f.input();
  assert.equal(Date.parse(request.expiresAt) - Date.parse(request.requestedAt), 15);
  await assert.rejects(f.run.completion, { code: 'user_input_timeout' });
  assert.equal(f.bridge.userInputs.size, 0); assert.equal(f.writes.some(message => message.result?.answers), false);
  assert.ok(f.writes.some(message => message.id === 0 && message.error)); assert.ok(f.writes.some(message => message.method === 'turn/interrupt'));
  assert.throws(() => f.bridge.replyUserInput(request.id, body('奶油白')), { code: 'user_input_expired' });
});

test('stop and completion invalidate pending questions using RPC errors rather than skip', async t => {
  for (const stopped of [true, false]) {
    const f = fixture(t); f.ask(); const id = f.input().id;
    if (stopped) { f.run.aborted = true; await f.bridge._interrupt(f.run); }
    f.bridge._finish(f.run, new Error('fixture finished')); await f.run.completion.catch(() => {});
    assert.throws(() => f.bridge.replyUserInput(id, body('奶油白')), { code: 'user_input_expired' });
    assert.ok(f.writes.some(message => message.id === 0 && message.error)); assert.equal(f.writes.some(message => message.result?.answers), false);
  }
});

test('a failed answer write becomes uncertain and an exact retry never writes again', t => {
  const f = fixture(t); f.ask(); const id = f.input().id; let sends = 0;
  f.bridge._send = () => { sends++; throw new Error('private transport diagnostics'); };
  assert.throws(() => f.bridge.replyUserInput(id, body('奶油白')), { code: 'user_input_delivery_uncertain' });
  assert.throws(() => f.bridge.replyUserInput(id, body('奶油白')), { code: 'user_input_delivery_uncertain' }); assert.equal(sends, 1);
});

test('private answers never appear in normal events, split deltas or a resumed native thread', async t => {
  const f = fixture(t), secret = 'synthetic-private-answer-429e'; f.ask({ questions: [question({ isSecret: true, options: [] })] });
  f.bridge.replyUserInput(f.input().id, body(secret));
  f.bridge._appendText(f.run, `Before ${secret.slice(0, 12)}`); f.bridge._appendText(f.run, `${secret.slice(12)} after.`); f.bridge._finish(f.run);
  const first = await f.run.completion; assert.equal(first.text, 'Before [已隐藏] after.'); assert.doesNotMatch(JSON.stringify(f.events), new RegExp(secret));
  const resumed = f.newRun(); resumed.turnId = 'second-turn';
  f.bridge._appendText(resumed, secret.slice(0, 6)); f.bridge._appendText(resumed, secret.slice(6)); f.bridge._finish(resumed);
  assert.equal((await resumed.completion).text, '[已隐藏]'); assert.doesNotMatch(JSON.stringify(f.events), new RegExp(secret));
  assert.equal(f.bridge.userInputReceipts.size, 0); assert.equal(f.bridge.threadSecrets.get(resumed.threadId).has(secret), true);
  await f.bridge.close(); assert.equal(f.bridge.threadSecrets.size, 0);
});

test('a short secret cannot corrupt later question identities or ISO clocks and masks may not echo the secret', t => {
  const f = fixture(t); f.ask({ questions: [question({ isSecret: true, options: [] })] });
  f.bridge.replyUserInput(f.input().id, body('color'));
  f.ask({ questions: [question({ question: 'Pick color for the next view.' })] }, 2);
  const request = f.input(); assert.equal(request.questions[0].id, 'color'); assert.ok(Number.isFinite(Date.parse(request.requestedAt))); assert.ok(Number.isFinite(Date.parse(request.expiresAt)));
  assert.equal(request.questions[0].question.includes('color'), false); f.bridge.replyUserInput(request.id, body('奶油白'));
  f.bridge.threadSecrets.get(f.run.threadId).add('已隐藏'); assert.equal(f.bridge._redact('已隐藏', f.run), '[redacted]');
  assert.equal(f.bridge._redact('color', { threadId: 'another-account-thread' }), 'color', 'a private answer must not alter another account or thread output');
});

test('custom CLI and host commands never receive the built-in-only Default-mode feature flag', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-user-input-feature-'));
  const script = path.join(directory, 'external-fixture.mjs');
  await writeFile(script, `import {writeFileSync} from 'node:fs';import{createInterface}from'node:readline';writeFileSync(process.argv[2],JSON.stringify(process.argv.slice(3)));createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.method==='initialize')process.stdout.write(JSON.stringify({id:m.id,result:{userAgent:'external-fixture'}})+'\\n');else if(m.method==='account/read')process.stdout.write(JSON.stringify({id:m.id,result:{requiresOpenaiAuth:false,account:null}})+'\\n');});`);
  t.after(async () => { assert.ok(directory.startsWith(path.join(tmpdir(), 'petpal-user-input-feature-'))); await rm(directory, { recursive: true, force: true }); });
  for (const api of [false, true]) {
    const log = path.join(directory, `argv-${api}.json`);
    const bridge = new CodexBridge({ command: [process.execPath, script, log], workspaceRoot: path.join(directory, `workspace-${api}`), ...(api ? { dataDir: path.join(directory, 'data'), config: { mode: 'api', apiKey: 'synthetic-private-only', baseUrl: 'http://127.0.0.1:1/v1', model: 'gpt-5.4', revision: randomUUID() } } : {}) });
    try { assert.equal((await bridge.status()).available, true); assert.equal((await readFile(log, 'utf8')).includes('default_mode_request_user_input'), false); }
    finally { await bridge.close(); }
  }
});

test('approval metadata never grants session permissions and decline maps to the supported cancel', t => {
  const f = fixture(t); f.run.permissions.approval = 'ask';
  f.approval({ availableDecisions: ['accept', 'acceptForSession', 'cancel'] }); const request = f.events.findLast(event => event.type === 'approval').data;
  assert.equal(request.canAccept, true); assert.equal(Date.parse(request.expiresAt) - Date.parse(request.requestedAt), 300000);
  f.bridge.approve(request.id, 'decline'); assert.deepEqual(f.writes.at(-1), { id: 1, result: { decision: 'cancel' } });
  f.approval({ availableDecisions: ['acceptForSession', 'cancel'] }, 2); const restricted = f.events.findLast(event => event.type === 'approval').data;
  assert.equal(restricted.canAccept, false); assert.throws(() => f.bridge.approve(restricted.id, 'accept'), /不支持/); f.bridge.approve(restricted.id, 'decline');
  assert.equal(f.writes.at(-1).result.decision, 'cancel');
});

test('future writeStdin approvals use cancel on auto or expiry without publishing raw terminal input', async t => {
  const f = fixture(t, { approvalTimeoutMs: 15 });
  f.approval({ kind: 'writeStdin', stdin: 'synthetic-terminal-secret' }); assert.equal(f.writes.at(-1).result.decision, 'cancel');
  f.run.permissions.approval = 'ask'; f.approval({ kind: 'writeStdin', stdin: 'synthetic-terminal-secret' }, 2);
  assert.doesNotMatch(JSON.stringify(f.events), /synthetic-terminal-secret/); await delay(25);
  assert.deepEqual(f.writes.at(-1), { id: 2, result: { decision: 'cancel' } });
  f.approval({ kind: 'unknown-future-permission' }, 3); assert.ok(f.writes.at(-1).error);
});

test('an approval resolved callback cannot revoke the task and still allow its operation', t => {
  const f = fixture(t); f.run.permissions.approval = 'ask'; f.approval({ availableDecisions: ['accept', 'cancel'] });
  const request = f.events.findLast(event => event.type === 'approval').data;
  f.run.onEvent = type => { if (type === 'approval-resolved') f.run.aborted = true; };
  assert.throws(() => f.bridge.approve(request.id, 'accept'), /未允许/);
  assert.deepEqual(f.writes.at(-1), { id: 1, result: { decision: 'cancel' } });
});
