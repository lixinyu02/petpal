import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { JsonStore } from '../server/store.mjs';
import { createAgentTasks } from '../server/agent-tasks.mjs';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
async function until(check) { for (let i = 0; i < 200; i++) { if (await check()) return; await delay(5); } assert.fail('Agent recovery fixture did not settle'); }
const permissions = { access: 'workspace-write', approval: 'ask' };
const receipt = (id, status) => ({ submissionId: randomUUID(), entryId: id, fingerprint: 'a'.repeat(64), status, content: 'synthetic task', attachmentIds: [], createdAt: new Date().toISOString() });
async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-agent-recovery-'));
  const store = await new JsonStore(directory).init(), userId = store.state.ownerId;
  const auth = { userId, sessionHash: 'synthetic-recovery-session', bootstrap: false };
  const conversation = { id: randomUUID(), userId, title: 'Recovery fixture', mode: 'codex', messages: [{ id: randomUUID(), role: 'assistant', content: 'Existing history', status: 'error' }], projectId: null, archivedAt: null, updatedAt: new Date().toISOString() };
  const runId = randomUUID(), extraId = randomUUID(), queuedId = randomUUID();
  const main = receipt(runId, 'uncertain'), extra = receipt(extraId, 'uncertain'), pending = receipt(queuedId, 'queued');
  conversation.agent = { revision: 8, queueRevision: 2, paused: true, run: { id: runId, submissionId: main.submissionId, status: 'unknown', permissions, turnId: 'old-turn', model: 'fixture-model', providerId: null, effort: '', startedAt: new Date().toISOString(), error: 'Connection lost' },
    queue: [{ id: queuedId, submissionId: pending.submissionId, revision: 1, conversationId: conversation.id, content: pending.content, attachmentIds: [], permissions, providerId: null, model: 'fixture-model', effort: '', codexRevision: randomUUID(), auth: { ...auth, generation: 0 }, createdAt: pending.createdAt }], submissions: [main, extra, pending] };
  store.state.conversations.push(conversation); await store.save();
  const active = new Map(), calls = []; let authorized = true;
  const manager = createAgentTasks({ store, active, approvals: new Map(), getBridge: () => ({ run(args) { return new Promise((resolve, reject) => { calls.push({ args, resolve, reject }); args.onEvent('turn', { turnId: `new-turn-${calls.length}` }); args.signal.addEventListener('abort', () => reject(args.signal.reason), { once: true }); }); } }), authorize: () => { throw Object.assign(new Error('Model/host permission revoked'), { status: 403 }); }, authorizeRemoval: entry => { if (!authorized || entry.auth.userId !== userId) throw Object.assign(new Error('Session expired'), { status: 401 }); } });
  const body = id => ({ runId: id, revision: conversation.agent.revision, confirmedStopped: true });
  const disk = async () => JSON.parse(await readFile(store.file, 'utf8')).conversations.find(item => item.id === conversation.id);
  t.after(async () => { store.automationPersistence = undefined; await manager.close(); await store.queue; await rm(directory, { recursive: true, force: true }); });
  return { directory, store, conversation, auth, active, calls, manager, body, disk, runId, extraId, setAuthorized(value) { authorized = value; } };
}

test('recovery confirms only the specified unknown run and leaves queue/history paused without execution', async t => {
  const f = await fixture(t), before = structuredClone(f.conversation), body = f.body(f.runId);
  await f.manager.recover(f.conversation, body, f.auth);
  assert.equal(f.conversation.agent.run.status, 'cancelled');
  assert.match(f.conversation.agent.run.error, /用户已确认.*未自动重派/);
  assert.equal(f.conversation.agent.submissions[0].status, 'cancelled');
  assert.equal(f.conversation.agent.submissions[1].status, 'uncertain');
  assert.deepEqual(f.conversation.agent.queue, before.agent.queue); assert.deepEqual(f.conversation.messages, before.messages);
  assert.equal(f.conversation.agent.queueRevision, before.agent.queueRevision); assert.equal(f.conversation.agent.paused, true); assert.equal(f.conversation.agent.revision, body.revision + 1);
  assert.equal((await f.disk()).agent.run.status, 'cancelled'); assert.equal(f.calls.length, 0);
  await assert.rejects(f.manager.recover(f.conversation, body, f.auth), { status: 409 });
  await assert.rejects(f.manager.resume(f.conversation, f.auth), { code: 'agent_execution_uncertain' });
  await assert.rejects(f.manager.submit(f.conversation, { submissionId: randomUUID(), content: 'do not run' }, f.auth), { code: 'agent_execution_uncertain' });
  f.conversation.agent.paused = false; f.manager.kick(f.conversation); await delay(20); assert.equal(f.calls.length, 0); f.conversation.agent.paused = true;
});

test('individual uncertain steering can be confirmed after the main run ended, without rewriting the main result', async t => {
  const f = await fixture(t); f.conversation.agent.run.status = 'completed'; f.conversation.agent.submissions[0].status = 'completed';
  await f.store.save(); const run = structuredClone(f.conversation.agent.run);
  await f.manager.recover(f.conversation, f.body(f.extraId), f.auth);
  assert.deepEqual(f.conversation.agent.run, run); assert.equal(f.conversation.agent.submissions[1].status, 'cancelled');
  assert.equal(f.conversation.agent.paused, true); assert.equal(f.calls.length, 0);
});

test('invalid confirmation, stale revision, foreign identity and active tasks cannot change recovery state', async t => {
  const f = await fixture(t), before = structuredClone(f.conversation);
  for (const body of [{ ...f.body(f.runId), confirmedStopped: false }, { ...f.body(f.runId), hostId: 'central' }, { ...f.body(f.runId), revision: -1 }, { ...f.body(f.runId), runId: 'bad' }]) await assert.rejects(f.manager.recover(f.conversation, body, f.auth), { status: 400 });
  await assert.rejects(f.manager.recover(f.conversation, { ...f.body(f.runId), revision: 7 }, f.auth), { status: 409 });
  await assert.rejects(f.manager.recover(f.conversation, f.body(randomUUID()), f.auth), { status: 409 });
  await assert.rejects(f.manager.recover(f.conversation, f.body(f.runId), { ...f.auth, userId: randomUUID() }), { status: 404 });
  f.active.set(f.conversation.id, {}); await assert.rejects(f.manager.recover(f.conversation, f.body(f.runId), f.auth), { status: 409 }); f.active.clear();
  f.setAuthorized(false); await assert.rejects(f.manager.recover(f.conversation, f.body(f.runId), f.auth), { status: 401 });
  assert.deepEqual(f.conversation, before);
});

test('failed recovery plus a concurrent ordinary save never publishes or persists a temporary confirmation', async t => {
  const f = await fixture(t), gate = deferred(); let entered = false;
  f.store.automationPersistence = { commit() {}, async prepare(_snapshot, operation) { if (operation?.agentRecovery) { entered = true; await gate.promise; } } };
  const recovering = f.manager.recover(f.conversation, f.body(f.runId), f.auth); await until(() => entered);
  assert.equal(f.conversation.agent.run.status, 'unknown');
  const ordinary = f.store.save(); gate.reject(new Error('Injected durable write failure'));
  await assert.rejects(recovering, /Injected/); await ordinary;
  assert.equal(f.conversation.agent.run.status, 'unknown'); assert.equal(f.conversation.agent.submissions[0].status, 'uncertain');
  const saved = await f.disk(); assert.equal(saved.agent.run.status, 'unknown'); assert.equal(saved.agent.submissions[0].status, 'uncertain');
});

test('a late ordinary save captured during recovery cannot revert the committed confirmation', async t => {
  const f = await fixture(t), gate = deferred(); let entered = false;
  f.store.automationPersistence = { commit() {}, async prepare(_snapshot, operation) { if (operation?.agentRecovery) { entered = true; await gate.promise; } } };
  const recovering = f.manager.recover(f.conversation, f.body(f.runId), f.auth); await until(() => entered);
  const ordinary = f.store.save(); assert.equal(f.conversation.agent.run.status, 'unknown'); gate.resolve();
  await recovering; await ordinary;
  assert.equal(f.conversation.agent.run.status, 'cancelled'); assert.equal((await f.disk()).agent.run.status, 'cancelled');
  assert.equal((await f.disk()).agent.revision, 9); assert.equal((await f.disk()).agent.submissions[1].status, 'uncertain');
});

test('multiple committed confirmations overlay a stale snapshot without losing either cancellation', async t => {
  const f = await fixture(t); await f.manager.recover(f.conversation, f.body(f.runId), f.auth);
  const gate = deferred(); let entered = false;
  f.store.automationPersistence = { commit() {}, async prepare(_snapshot, operation) { if (operation?.agentRecovery) { entered = true; await gate.promise; } } };
  const recovering = f.manager.recover(f.conversation, f.body(f.extraId), f.auth); await until(() => entered);
  const ordinary = f.store.save(); gate.resolve(); await recovering; await ordinary;
  const saved = await f.disk(); assert.equal(saved.agent.submissions[0].status, 'cancelled'); assert.equal(saved.agent.submissions[1].status, 'cancelled'); assert.equal(saved.agent.revision, 10);
});

test('stop in the rename boundary cannot revive unknown through an equal-revision snapshot', async t => {
  const f = await fixture(t), original = f.store.agentRecoveryPersistence.beforeCommit;
  let stopped, injected = false;
  f.store.agentRecoveryPersistence.beforeCommit = snapshot => {
    original(snapshot);
    if (!injected) { injected = true; stopped = f.manager.stop(f.conversation); }
  };
  await f.manager.recover(f.conversation, f.body(f.runId), f.auth); await stopped;
  assert.equal(f.conversation.agent.revision, 9); assert.equal(f.conversation.agent.run.status, 'cancelled');
  const saved = await f.disk(); assert.equal(saved.agent.revision, 9); assert.equal(saved.agent.run.status, 'cancelled'); assert.equal(saved.agent.submissions[0].status, 'cancelled');
});

test('authorization or CAS changes during pending persistence abort recovery without disturbing newer state', async t => {
  for (const mode of ['identity', 'revision']) {
    const f = await fixture(t), gate = deferred(); let entered = false;
    f.store.automationPersistence = { commit() {}, async prepare(_snapshot, operation) { if (operation?.agentRecovery) { entered = true; await gate.promise; } } };
    const recovering = f.manager.recover(f.conversation, f.body(f.runId), f.auth); await until(() => entered);
    if (mode === 'identity') f.setAuthorized(false); else { f.conversation.agent.revision++; f.conversation.agent.queue = []; }
    const ordinary = f.store.save(); gate.resolve(); await assert.rejects(recovering, { status: mode === 'identity' ? 401 : 409 }); await ordinary;
    assert.equal(f.conversation.agent.run.status, 'unknown'); assert.equal((await f.disk()).agent.run.status, 'unknown');
    if (mode === 'revision') assert.equal((await f.disk()).agent.queue.length, 0);
  }
});
