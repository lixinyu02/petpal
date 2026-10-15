import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { JsonStore } from '../server/store.mjs';
import { defaultCodexConfig } from '../server/codex-config.mjs';
import { createAgentTasks, restoreAgentState } from '../server/agent-tasks.mjs';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
async function until(check) { for (let i = 0; i < 200; i++) { if (await check()) return; await delay(5); } assert.fail('Context repair fixture did not settle'); }
const permissions = { access: 'workspace-write', approval: 'ask' };
async function fixture(t, { fresh = false } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-agent-context-')), store = await new JsonStore(directory).init();
  store.state.codexConfig = { ...defaultCodexConfig(), model: 'fixture-model' };
  const userId = store.state.ownerId, auth = { userId, sessionHash: 'context-fixture-session', bootstrap: false };
  const runId = randomUUID(), submissionId = randomUUID();
  const conversation = { id: randomUUID(), userId, title: 'Context repair fixture', customTitle: 'Preserved custom name', mode: 'codex', codexRevision: randomUUID(), agentHostId: 'central', agentProjectDirectory: directory, threadId: 'old-native-thread', threadHostId: 'central', threadCodexRevision: randomUUID(), threadReviewFingerprint: 'a'.repeat(64), threadProjectDirectory: directory, threadFutureBinding: 'clear-future-binding', projectId: null, archivedAt: new Date().toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messages: [{ id: randomUUID(), role: 'user', content: 'Preserve user history', status: 'complete' }, { id: randomUUID(), role: 'assistant', content: 'Partial previous output', status: 'error', error: 'Original missing context failure' }],
    agent: { revision: 5, queueRevision: 2, paused: true, queue: [], run: { id: runId, submissionId, status: 'error', permissions, turnId: null, model: 'fixture-model', providerId: null, effort: '', error: 'Old native context missing', errorCode: 'thread_context_missing', startedAt: new Date().toISOString() }, submissions: [{ submissionId, entryId: runId, fingerprint: 'b'.repeat(64), status: 'error', content: 'previous task', attachmentIds: [], createdAt: new Date().toISOString() }] } };
  if (fresh) { delete conversation.agent; for (const key of Object.keys(conversation)) if (key.startsWith('thread')) delete conversation[key]; conversation.codexRevision = store.state.codexConfig.revision; }
  store.state.conversations.push(conversation); await store.save();
  const active = new Map(), calls = []; let allowed = true, repairAllowed = true, injectedError;
  const manager = createAgentTasks({ store, active, approvals: new Map(), getConfigRevision: () => store.state.codexConfig.revision,
    authorizeRemoval: () => { if (!allowed) throw Object.assign(new Error('Expired session'), { status: 401 }); },
    authorizeContextRepair: () => { if (!allowed) throw Object.assign(new Error('Expired session'), { status: 401 }); if (!repairAllowed) throw Object.assign(new Error('Agent grant revoked'), { status: 403 }); },
    authorize: () => { if (!allowed) throw Object.assign(new Error('Expired session'), { status: 401 }); },
    resolveModel: () => ({ model: 'fixture-model', effort: '', codexRevision: store.state.codexConfig.revision }),
    resolveReview: (_id, value) => value.approval === 'review' ? { reviewModel: 'review-fixture', reviewFingerprint: 'c'.repeat(64) } : {},
    getBridge: () => ({ async run(args) { calls.push(args); if (injectedError) throw injectedError; const threadId = args.threadId || `new-native-${calls.length}`; args.onEvent('thread', { threadId }); args.onEvent('turn', { turnId: `new-turn-${calls.length}` }); return { threadId, text: 'Synthetic completed output' }; } }),
  });
  const body = () => ({ revision: conversation.agent?.revision ?? 0, confirmed: true });
  const disk = async () => JSON.parse(await readFile(store.file, 'utf8')).conversations.find(item => item.id === conversation.id);
  const submit = async (extra = {}) => { const submissionId = randomUUID(); await manager.submit(conversation, { submissionId, content: 'Explicit new user task', permissions, ...extra }, auth); await until(() => !active.has(conversation.id) && conversation.agent.run?.submissionId === submissionId && conversation.agent.run.finishedAt); };
  t.after(async () => { store.automationPersistence = undefined; await manager.close(); await store.queue; await rm(directory, { recursive: true, force: true }); });
  return { directory, store, conversation, auth, active, manager, body, disk, calls, submit, allow(value) { allowed = value; }, allowRepair(value) { repairAllowed = value; }, failRun(error) { injectedError = error; } };
}

test('explicit context repair clears all native bindings and adopts current config while preserving history and receipts', async t => {
  const f = await fixture(t), before = structuredClone(f.conversation), body = f.body();
  await f.manager.resetContext(f.conversation, body, f.auth);
  assert.equal(Object.keys(f.conversation).some(key => key.startsWith('thread')), false);
  for (const key of ['messages', 'agentHostId', 'agentProjectDirectory', 'projectId', 'archivedAt', 'customTitle']) assert.deepEqual(f.conversation[key], before[key]);
  assert.deepEqual(f.conversation.agent.submissions, before.agent.submissions); assert.equal(f.conversation.codexRevision, f.store.state.codexConfig.revision);
  assert.equal(f.conversation.agent.revision, body.revision + 1); assert.equal(f.conversation.agent.contextGeneration, 1); assert.equal(f.conversation.agent.paused, false);
  assert.equal(f.conversation.agent.run.error, undefined); assert.equal(f.conversation.agent.run.errorCode, undefined);
  assert.match(f.manager.snapshot(f.conversation).contextNotice, /历史已保留.*主动发送/); assert.equal(f.manager.snapshot(f.conversation).contextRepairNeeded, false); assert.equal(f.calls.length, 0);
  assert.equal((await f.disk()).threadId, undefined); assert.equal((await f.disk()).agent.contextGeneration, 1);
  await assert.rejects(f.manager.resetContext(f.conversation, body, f.auth), { status: 409 });
});

test('empty old conversations can repair without mutating live state before persistence', async t => {
  const f = await fixture(t, { fresh: true }), gate = deferred(); let entered = false;
  f.store.automationPersistence = { commit() {}, async prepare(_snapshot, action) { if (action?.agentRecovery) { entered = true; await gate.promise; } } };
  const repairing = f.manager.resetContext(f.conversation, f.body(), f.auth); await until(() => entered);
  assert.equal(f.conversation.agent, undefined); gate.reject(new Error('Synthetic write failure')); await assert.rejects(repairing, /Synthetic write failure/);
  assert.equal(f.conversation.agent, undefined); f.store.automationPersistence = undefined;
  await f.manager.resetContext(f.conversation, f.body(), f.auth); assert.equal(f.conversation.agent.contextGeneration, 1); assert.equal(f.calls.length, 0);
});

test('context repair rejects invalid confirmation, foreign identity, activity, queue and every unresolved state', async t => {
  const f = await fixture(t), initial = structuredClone(f.conversation);
  for (const change of [{ confirmed: false }, { confirmed: 'true' }, { revision: -1 }, { hostId: 'central' }]) await assert.rejects(f.manager.resetContext(f.conversation, { ...f.body(), ...change }, f.auth), { status: 400 });
  await assert.rejects(f.manager.resetContext(f.conversation, f.body(), { ...f.auth, userId: randomUUID() }), { status: 404 });
  f.active.set(f.conversation.id, {}); await assert.rejects(f.manager.resetContext(f.conversation, f.body(), f.auth), { status: 409 }); f.active.clear();
  for (const status of ['unknown', 'running', 'stopping']) { f.conversation.agent.run.status = status; await assert.rejects(f.manager.resetContext(f.conversation, f.body(), f.auth), { status: 409 }); } f.conversation.agent.run.status = 'error';
  f.conversation.agent.queue.push({ id: randomUUID() }); await assert.rejects(f.manager.resetContext(f.conversation, f.body(), f.auth), { status: 409 }); f.conversation.agent.queue = [];
  for (const status of ['uncertain', 'dispatching']) { f.conversation.agent.submissions[0].status = status; await assert.rejects(f.manager.resetContext(f.conversation, f.body(), f.auth), { status: 409 }); } f.conversation.agent.submissions[0].status = 'error';
  f.allowRepair(false); await assert.rejects(f.manager.resetContext(f.conversation, f.body(), f.auth), { status: 403 }); f.allowRepair(true);
  f.allow(false); await assert.rejects(f.manager.resetContext(f.conversation, f.body(), f.auth), { status: 401 }); f.allow(true);
  assert.deepEqual(f.conversation, initial);
});

test('failed context repair and a concurrent save cannot persist cleared native references', async t => {
  const f = await fixture(t), gate = deferred(); let entered = false;
  f.store.automationPersistence = { commit() {}, async prepare(_snapshot, action) { if (action?.agentRecovery) { entered = true; await gate.promise; } } };
  const repairing = f.manager.resetContext(f.conversation, f.body(), f.auth); await until(() => entered); const ordinary = f.store.save();
  gate.reject(new Error('Synthetic repair write failure')); await assert.rejects(repairing, /Synthetic repair write failure/); await ordinary;
  assert.equal(f.conversation.threadId, 'old-native-thread'); assert.equal((await f.disk()).threadId, 'old-native-thread'); assert.equal(f.conversation.agent.contextGeneration, undefined);
});

test('equal-revision stop snapshots captured at rename cannot restore an old native thread', async t => {
  const f = await fixture(t), beforeCommit = f.store.agentRecoveryPersistence.beforeCommit; let stopping, injected = false;
  f.store.agentRecoveryPersistence.beforeCommit = snapshot => { beforeCommit(snapshot); if (!injected) { injected = true; stopping = f.manager.stop(f.conversation); } };
  await f.manager.resetContext(f.conversation, f.body(), f.auth); await stopping;
  assert.equal(f.conversation.agent.revision, 6); assert.equal(f.conversation.threadId, undefined);
  const disk = await f.disk(); assert.equal(disk.threadId, undefined); assert.equal(disk.threadReviewFingerprint, undefined); assert.equal(disk.agent.contextGeneration, 1);
});

test('new native threads retain the committed generation and survive future unrelated saves and a second repair', async t => {
  const f = await fixture(t); await f.manager.resetContext(f.conversation, f.body(), f.auth); await f.submit();
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].threadId, undefined); assert.equal(f.calls[0].prompt, 'Explicit new user task'); assert.equal(f.conversation.threadId, 'new-native-1'); assert.equal(f.conversation.agent.contextGeneration, 1);
  await f.store.save(); assert.equal((await f.disk()).threadId, 'new-native-1');
  await f.submit(); assert.equal(f.calls[1].threadId, 'new-native-1'); assert.equal((await f.disk()).threadId, 'new-native-1');
  await f.manager.resetContext(f.conversation, f.body(), f.auth); assert.equal(f.conversation.agent.contextGeneration, 2); assert.equal((await f.disk()).threadId, undefined); assert.equal(f.calls.length, 2);
});

test('authorization, configuration and revision changes before commit keep original context intact', async t => {
  for (const mode of ['identity', 'permission', 'configuration', 'revision']) {
    const f = await fixture(t), gate = deferred(); let entered = false;
    f.store.automationPersistence = { commit() {}, async prepare(_snapshot, action) { if (action?.agentRecovery) { entered = true; await gate.promise; } } };
    const repairing = f.manager.resetContext(f.conversation, f.body(), f.auth); await until(() => entered);
    if (mode === 'identity') f.allow(false); else if (mode === 'permission') f.allowRepair(false); else if (mode === 'configuration') f.store.state.codexConfig.revision = randomUUID(); else f.conversation.agent.revision++;
    const ordinary = f.store.save(); gate.resolve(); await assert.rejects(repairing, { status: mode === 'identity' ? 401 : mode === 'permission' ? 403 : 409 }); await ordinary;
    assert.equal(f.conversation.threadId, 'old-native-thread'); assert.equal((await f.disk()).threadId, 'old-native-thread'); assert.equal(f.calls.length, 0);
  }
});

test('precise missing-context errors alone produce a persisted public repair classification', async t => {
  for (const code of ['thread_context_missing', 'ECONNRESET']) {
    const f = await fixture(t, { fresh: true }); f.failRun(Object.assign(new Error('Synthetic task failure'), { code })); await f.submit();
    assert.equal(f.calls.length, 1); assert.equal(f.manager.snapshot(f.conversation).contextRepairNeeded, code === 'thread_context_missing');
    assert.equal(f.conversation.agent.run.errorCode, code === 'thread_context_missing' ? code : undefined);
    assert.equal((await f.disk()).agent.run.errorCode, code === 'thread_context_missing' ? code : undefined);
  }
  const f = await fixture(t), malformed = structuredClone(f.conversation); malformed.agent.run.errorCode = 'provider_raw_error'; assert.throws(() => restoreAgentState(malformed), /错误分类/);
  malformed.agent.run.errorCode = 'thread_context_missing'; malformed.agent.contextGeneration = -1; assert.throws(() => restoreAgentState(malformed), /上下文代次/);
});

test('failed repair preserves the known independent-review thread binding for a subsequent authorized run', async t => {
  const f = await fixture(t, { fresh: true }), reviewPermissions = { access: 'workspace-write', approval: 'review', reviewProviderId: 'review-fixture-provider' };
  await f.submit({ permissions: reviewPermissions }); const first = f.conversation.threadId;
  f.store.automationPersistence = { commit() {}, async prepare(_snapshot, operation) { if (operation?.agentRecovery) throw new Error('Synthetic failed repair'); } };
  await assert.rejects(f.manager.resetContext(f.conversation, f.body(), f.auth), /Synthetic failed repair/); f.store.automationPersistence = undefined;
  await f.submit({ permissions: reviewPermissions }); assert.equal(f.calls[1].threadId, first);
  await f.manager.resetContext(f.conversation, f.body(), f.auth); await f.submit({ permissions: reviewPermissions }); assert.equal(f.calls[2].threadId, undefined);
});
