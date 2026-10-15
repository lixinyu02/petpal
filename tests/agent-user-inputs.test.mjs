import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createAgentUserInputs } from '../server/agent-user-inputs.mjs';

const question = { id: 'choice', header: '执行范围', question: '选择这次任务的范围。', isOther: true, isSecret: false, options: [{ label: '当前项目', description: '仅处理当前项目。' }] };
const answer = text => ({ answers: { choice: { answers: [text] } } });
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
function fixture() {
  const id = randomUUID(), conversationId = randomUUID(), userId = randomUUID(), active = new Map(), calls = [];
  let revisions = 0, permitted = true;
  const task = { controller: new AbortController(), bridge: { async replyUserInput(...args) { calls.push(args); } } }; active.set(conversationId, task);
  const registry = createAgentUserInputs({ active, changed: () => revisions++, authorize: () => { if (!permitted) throw Object.assign(new Error('Authorization ended'), { status: 401 }); } });
  const data = { id, questions: [question], requestedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString() };
  const receive = (value = data) => registry.receive(task, userId, conversationId, value);
  return { registry, task, active, id, conversationId, userId, calls, data, receive, revisions: () => revisions, revoke: () => { permitted = false; } };
}

test('questions restore without answer data and only the current owning task can answer', async () => {
  const f = fixture(); f.receive(); const snapshot = f.registry.snapshot(f.conversationId);
  assert.equal(snapshot.length, 1); assert.equal(snapshot[0].questions[0].id, 'choice');
  await assert.rejects(f.registry.reply(f.id, answer('当前项目'), randomUUID()), { status: 404 });
  await assert.rejects(f.registry.reply(f.id, { answers: {} }, f.userId), { status: 400 }); assert.equal(f.calls.length, 0);
  assert.deepEqual(await f.registry.reply(f.id, answer('当前项目'), f.userId), { ok: true });
  assert.equal(f.calls.length, 1); assert.deepEqual(f.registry.snapshot(f.conversationId), []); assert.equal(f.revisions(), 2);
  assert.deepEqual(await f.registry.reply(f.id, answer('当前项目'), f.userId), { ok: true }); assert.equal(f.calls.length, 1);
  await assert.rejects(f.registry.reply(f.id, answer('其他范围'), f.userId), { status: 409 });
  f.active.delete(f.conversationId); await assert.rejects(f.registry.reply(f.id, answer('当前项目'), f.userId), { status: 404 });
});

test('concurrent identical answers share one delivery even when native resolution is synchronous', async () => {
  const f = fixture(), gate = deferred(); f.receive();
  f.task.bridge.replyUserInput = async (...args) => { f.calls.push(args); f.registry.resolve(f.task, f.id); await gate.promise; };
  const first = f.registry.reply(f.id, answer('当前项目'), f.userId), second = f.registry.reply(f.id, answer('当前项目'), f.userId);
  await Promise.resolve(); assert.equal(f.calls.length, 1); gate.resolve(); await Promise.all([first, second]);
  assert.equal(f.calls.length, 1); assert.equal(f.registry.snapshot(f.conversationId).length, 0);
});

test('unknown answer delivery never retries and public state never retains plaintext answers', async () => {
  const f = fixture(); f.receive({ ...f.data, questions: [{ ...question, isSecret: true, options: [] }] });
  const secret = 'private-input-answer'; f.task.bridge.replyUserInput = async (...args) => { f.calls.push(args); throw new Error(secret); };
  for (let attempt = 0; attempt < 2; attempt++) await assert.rejects(f.registry.reply(f.id, answer(secret), f.userId), error => { assert.equal(error.code, 'user_input_delivery_uncertain'); assert.ok(!error.message.includes(secret)); return true; });
  assert.equal(f.calls.length, 1); const snapshot = f.registry.snapshot(f.conversationId);
  assert.equal(snapshot[0].deliveryUncertain, true); assert.ok(!JSON.stringify(snapshot).includes(secret));
  f.registry.clear(f.task); assert.equal(f.registry.snapshot(f.conversationId).length, 0);
});

test('explicit skip, expiration, stop, revocation and stale task replacement have distinct boundaries', async () => {
  const f = fixture(); f.receive(); await f.registry.reply(f.id, { skip: true }, f.userId); assert.deepEqual(f.calls[0][1], { skip: true });
  for (const mode of ['expired', 'stopped', 'replaced', 'revoked']) {
    const g = fixture(); if (mode === 'expired') g.data.expiresAt = new Date(Date.now() - 1).toISOString(), g.data.requestedAt = new Date(Date.now() - 60000).toISOString(); g.receive();
    if (mode === 'stopped') g.task.controller.abort(); if (mode === 'replaced') g.active.set(g.conversationId, {}); if (mode === 'revoked') g.revoke();
    await assert.rejects(g.registry.reply(g.id, answer('当前项目'), g.userId), { status: mode === 'revoked' ? 401 : 404 }); assert.equal(g.calls.length, 0);
  }
});

test('untrusted question identifiers and durations are rejected before publication', () => {
  const f = fixture();
  assert.throws(() => f.receive({ ...f.data, expiresAt: 'invalid' }), { status: 400 });
  assert.throws(() => f.receive({ ...f.data, expiresAt: new Date(Date.now() + 3600000).toISOString() }), { status: 400 });
  assert.throws(() => f.receive({ ...f.data, questions: [{ ...question, id: '__proto__' }] }), { status: 400 });
  f.receive(); assert.throws(() => f.receive(), { status: 409 }); assert.equal(f.registry.snapshot(f.conversationId).length, 1);
});

test('a late failed answer cannot advance a replacement task revision or restore its old prompt', async () => {
  const f = fixture(); f.receive(); let reject;
  f.task.bridge.replyUserInput = () => new Promise((_resolve,no) => { reject=no; });
  const pending=f.registry.reply(f.id,answer('当前项目'),f.userId);await Promise.resolve();
  f.registry.clear(f.task);f.active.set(f.conversationId,{controller:new AbortController()});const before=f.revisions();
  reject(new Error('late synthetic failure'));await assert.rejects(pending,{code:'user_input_delivery_uncertain'});
  assert.equal(f.revisions(),before);assert.deepEqual(f.registry.snapshot(f.conversationId),[]);
});
