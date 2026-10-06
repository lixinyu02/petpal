import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createAgentTasks, restoreAgentState } from '../server/agent-tasks.mjs';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
async function until(predicate) { for (let i = 0; i < 300; i++) { if (predicate()) return; await delay(5); } assert.fail('Task state did not settle'); }
const payload = (id, content = id) => ({ submissionId: `submission-${id}`, content });
function fixture(t, options = {}) {
  const conversation = options.conversation ?? { id: 'conversation-fixture', userId: 'user-fixture', mode: 'codex', messages: [] };
  const auth = { userId: conversation.userId, sessionHash: 'session-fixture', bootstrap: false };
  const calls = [], active = new Map(), approvals = new Map(), valid = new Set([auth.sessionHash]);
  const model = { model: 'fixture-model', effort: 'high', codexRevision: 'revision-fixture' };
  let saved, saving, online = true, steer = async () => ({ turnId: 'turn-fixture' });
  const store = { state: { conversations: [conversation] }, async save() { saved = structuredClone(this.state); await saving?.(); } };
  const bridge = {
    run(args) { const work = deferred(), call = { args, work }; calls.push(call); args.onEvent('turn', { turnId: `turn-${calls.length}` }); args.signal.addEventListener('abort', () => { if (!options.delayedAbort) work.reject(args.signal.reason); }, { once: true }); return work.promise; },
    steer: args => steer(args),
  };
  const authorizeIdentity = entry => {
    if (!valid.has(entry.auth.sessionHash)) throw Object.assign(new Error('Session expired'), { status: 401 });
    return options.expiresAt;
  };
  const manager = createAgentTasks({ store, active, approvals, getBridge: () => bridge, redact: options.redact, resolveModel: () => ({ ...model }), resolveReview: options.resolveReview, getReviewConfig: options.getReviewConfig, authorizeRemoval: authorizeIdentity, authorize: entry => {
    authorizeIdentity(entry);
    if (!online) throw Object.assign(new Error('Executor offline'), { status: 409, code: 'executor_offline' });
    if (entry.model !== model.model || entry.codexRevision !== model.codexRevision) throw Object.assign(new Error('Model changed'), { status: 409 });
    return options.expiresAt;
  } });
  t.after(async () => { saving = undefined; for (const call of calls) call.work.resolve({ text: 'cleanup' }); await manager.stop(conversation); await manager.close(); });
  return { conversation, auth, calls, active, approvals, valid, model, store, manager, saved: () => saved,
    saveWith: callback => { saving = callback; }, steerWith: callback => { steer = callback; }, setOnline: value => { online = value; },
    submit: (body, kind = 'submit') => manager.submit(conversation, body, auth, kind),
    snapshot: () => manager.snapshot(conversation),
    finish: async (index = calls.length - 1) => { calls[index].work.resolve({ text: 'done' }); await until(() => !active.has(conversation.id) || calls.length > index + 1); },
  };
}

test('concurrent duplicate submissions execute exactly once and receipts survive completion', async t => {
  const f = fixture(t); const body = payload('duplicate');
  const replies = await Promise.all(Array.from({ length: 12 }, () => f.submit(body)));
  assert.equal(new Set(replies.map(item => item.entryId)).size, 1);
  await until(() => f.calls.length === 1); await f.finish();
  assert.equal((await f.submit(body)).status, 'completed'); assert.equal(f.calls.length, 1);
  await assert.rejects(f.submit({ ...body, content: 'changed' }), { status: 409 });
  assert.equal(f.conversation.messages.filter(item => item.role === 'user').length, 1);
  assert.equal(f.saved().conversations[0].agent.submissions.length, 1);
});

test('persisted independent review thread restarts safely and local follow-up resumes only its current runtime binding', async t => {
  const permissions = { access: 'read-only', approval: 'review', reviewProviderId: 'review-runtime-provider' }, reviewFingerprint = '1'.repeat(64);
  const conversation = { id: 'conversation-fixture', userId: 'user-fixture', mode: 'codex', threadId: 'restored-native-thread', threadReviewFingerprint: reviewFingerprint, messages: [{ role: 'user', content: 'prior context', status: 'complete' }] };
  const reviewConfig = { providerId: permissions.reviewProviderId, model: 'review-runtime-model', baseUrl: 'https://review.example/v1', apiKey: 'synthetic-task-review-secret' };
  const f = fixture(t, { conversation, resolveReview: () => ({ reviewModel: reviewConfig.model, reviewFingerprint }), getReviewConfig: () => reviewConfig });
  await f.submit({ ...payload('runtime-first'), permissions }); await until(() => f.calls.length === 1);
  const first = f.calls[0]; assert.equal(first.args.threadId, undefined); assert.match(first.args.prompt, /prior context/); assert.equal(first.args.authorizeReview(), true);
  first.args.onEvent('thread', { threadId: 'current-native-thread' }); await f.finish();
  await f.submit({ ...payload('runtime-next'), permissions }); await until(() => f.calls.length === 2); assert.equal(f.calls[1].args.threadId, 'current-native-thread');
  assert.equal(JSON.stringify(f.saved()).includes(reviewConfig.apiKey), false); assert.equal(JSON.stringify(f.snapshot()).includes(reviewFingerprint), false);
});

test('each remote independent reviewer task starts a new thread and never receives an upstream credential', async t => {
  const permissions = { access: 'read-only', approval: 'review', reviewProviderId: 'review-remote-provider' }, reviewFingerprint = '2'.repeat(64), hostId = 'remote-host-fixture';
  const conversation = { id: 'conversation-fixture', userId: 'user-fixture', mode: 'codex', threadId: 'old-remote-thread', threadHostId: hostId, threadReviewFingerprint: reviewFingerprint, messages: [{ role: 'user', content: 'remote history', status: 'complete' }] };
  const f = fixture(t, { conversation, resolveReview: (_user, value) => value.approval === 'review' && value.reviewProviderId ? { reviewModel: 'review-model', reviewFingerprint } : {}, getReviewConfig: () => { assert.fail('Remote must not resolve upstream credentials in agent-tasks'); } });
  await f.submit({ ...payload('remote-first'), hostId, permissions }); await until(() => f.calls.length === 1);
  f.calls[0].args.onEvent('thread', { threadId: 'remote-review-thread-1' }); assert.equal(f.calls[0].args.threadId, undefined); assert.equal(f.calls[0].args.reviewConfig, undefined); await f.finish();
  await f.submit({ ...payload('remote-second'), hostId, permissions }); await until(() => f.calls.length === 2); assert.equal(f.calls[1].args.threadId, undefined); assert.match(f.calls[1].args.prompt, /remote history/); await f.finish();
  await f.submit({ ...payload('remote-default'), hostId, permissions: { approval: 'review' } }); await until(() => f.calls.length === 3); assert.equal(f.calls[2].args.threadId, undefined);
});

test('review provider revocation matches queued and running reviewer identities', async t => {
  const permissions = { access: 'read-only', approval: 'review', reviewProviderId: 'review-revoke-provider' };
  const f = fixture(t, { resolveReview: () => ({ reviewModel: 'review-model', reviewFingerprint: '3'.repeat(64) }) });
  await f.submit({ ...payload('review-revoke-first'), permissions }); await until(() => f.calls.length === 1); await f.submit({ ...payload('review-revoke-queued'), permissions });
  await f.manager.revoke(task => task.reviewProviderId === permissions.reviewProviderId);
  assert.equal(f.calls[0].args.signal.aborted, true); assert.equal(f.snapshot().queue.length, 0); assert.equal(f.snapshot().run.status, 'cancelled'); assert.equal(f.calls.length, 1);
});

test('aggregated remote text cannot persist a credential reconstructed across events', async t => {
  const secret = ['synthetic', 'fragmented', 'credential'].join('-');
  const f = fixture(t, { redact: value => typeof value === 'string' ? value.replaceAll(secret, '[hidden]') : value });
  await f.submit(payload('credential-aggregation')); await until(() => f.calls.length === 1);
  f.calls[0].args.onEvent('delta', { text: secret.slice(0, 10) });
  f.calls[0].args.onEvent('delta', { text: secret.slice(10) });
  await f.finish();
  assert.equal(f.conversation.messages.at(-1).content, '[hidden]');
  assert.equal(JSON.stringify(f.saved()).includes(secret), false);
});

test('FIFO queue caps five waiting tasks and rejects stale edits or permission changes', async t => {
  const f = fixture(t); await f.submit(payload('first')); await until(() => f.calls.length === 1);
  for (let i = 0; i < 5; i++) await f.submit(payload(`queue-${i}`));
  await assert.rejects(f.submit(payload('overflow')), { status: 409 });
  const entry = f.snapshot().queue[0];
  await f.manager.edit(f.conversation, entry.id, { revision: 1, content: 'edited first waiting' }, f.auth);
  await assert.rejects(f.manager.edit(f.conversation, entry.id, { revision: 1, content: 'stale' }, f.auth), { status: 409 });
  await assert.rejects(f.manager.edit(f.conversation, entry.id, { revision: 2, content: 'bad', permissions: { access: 'full-access' } }, f.auth), { status: 400 });
  const last = f.snapshot().queue.at(-1);
  await f.manager.edit(f.conversation, last.id, { revision: 1 }, f.auth, true);
  assert.equal(f.snapshot().queue.length, 4);
  await f.finish(0); await until(() => f.calls.length === 2);
  assert.equal(f.calls[1].args.prompt, 'edited first waiting');
  assert.equal(f.snapshot().queue[0].content, 'queue-1');
});

test('stop pauses pending tasks until explicit resume and retains their permissions', async t => {
  const f = fixture(t); await f.submit(payload('first')); await until(() => f.calls.length === 1);
  const permissions = { access: 'workspace-write', approval: 'review' };
  await f.submit({ ...payload('second'), permissions });
  await f.manager.stop(f.conversation);
  assert.equal(f.calls[0].args.signal.aborted, true); assert.equal(f.snapshot().run.status, 'cancelled');
  assert.equal(f.snapshot().paused, true); assert.equal(f.snapshot().queue.length, 1);
  await delay(20); assert.equal(f.calls.length, 1);
  await f.manager.resume(f.conversation, f.auth); await until(() => f.calls.length === 2);
  assert.deepEqual(f.calls[1].args.permissions, permissions);
});

for (const unavailable of ['offline', 'model-changed']) test(`queued work can be removed when ${unavailable} without resuming it`, async t => {
  const f = fixture(t); await f.manager.stop(f.conversation); await f.submit(payload('remove-unavailable'));
  const entry = f.snapshot().queue[0], beforeRevision = f.snapshot().revision;
  if (unavailable === 'offline') f.setOnline(false); else f.model.model = 'replacement-model';
  await assert.rejects(f.manager.resume(f.conversation, f.auth), { status: 409 });
  await assert.rejects(f.manager.edit(f.conversation, entry.id, { revision: entry.revision, content: 'still cannot edit' }, f.auth), { status: 409 });
  await f.manager.edit(f.conversation, entry.id, { revision: entry.revision }, f.auth, true);
  assert.equal(f.snapshot().queue.length, 0); assert.equal(f.snapshot().submissions[0].status, 'cancelled');
  assert.equal(f.snapshot().paused, true); assert.equal(f.snapshot().revision, beforeRevision + 1);
  assert.equal(f.saved().conversations[0].agent.queue.length, 0); assert.equal(f.calls.length, 0);
});

test('queue removal keeps current-session ownership and revision checks even when execution is unavailable', async t => {
  const f = fixture(t); await f.manager.stop(f.conversation); await f.submit(payload('remove-authenticated'));
  const entry = f.snapshot().queue[0]; f.setOnline(false);
  await assert.rejects(f.manager.edit(f.conversation, entry.id, { revision: entry.revision + 1 }, f.auth, true), { status: 409 });
  await assert.rejects(f.manager.edit(f.conversation, entry.id, { revision: entry.revision }, { ...f.auth, userId: 'other-user' }, true), { status: 404 });
  f.valid.delete(f.auth.sessionHash);
  await assert.rejects(f.manager.edit(f.conversation, entry.id, { revision: entry.revision }, f.auth, true), { status: 401 });
  assert.equal(f.snapshot().queue.length, 1); assert.equal(f.snapshot().submissions[0].status, 'queued');
  const current = { ...f.auth, sessionHash: 'replacement-session' }; f.valid.add(current.sessionHash);
  await f.manager.edit(f.conversation, entry.id, { revision: entry.revision }, current, true);
  assert.equal(f.snapshot().queue.length, 0); assert.equal(f.calls.length, 0);
});

test('steer receipts stay idempotent after inherited permissions and active turn disappear', async t => {
  const f = fixture(t), permissions = { access: 'full-access', approval: 'auto' };
  await f.submit({ ...payload('first'), permissions }); await until(() => f.calls.length === 1);
  let deliveries = 0; f.steerWith(async () => { deliveries++; return { turnId: 'turn-1' }; });
  const body = { ...payload('steered'), expectedTurnId: 'turn-1' };
  assert.equal((await f.submit(body, 'steer')).status, 'steered');
  await f.finish();
  assert.equal((await f.submit(body, 'steer')).status, 'steered'); assert.equal(deliveries, 1);
  assert.equal(f.conversation.messages.filter(item => item.steered).length, 1);
});

test('only a definitive inactive turn falls back to the next queued task', async t => {
  const f = fixture(t); await f.submit(payload('first')); await until(() => f.calls.length === 1);
  f.steerWith(async () => { throw Object.assign(new Error('ended'), { code: 'turn_not_active' }); });
  const body = { ...payload('fallback'), expectedTurnId: 'turn-1' };
  const result = await f.submit(body, 'steer'); assert.equal(result.status, 'queued');
  assert.equal((await f.submit(body, 'steer')).entryId, result.entryId); assert.equal(f.snapshot().queue.length, 1);
  await f.finish(); await until(() => f.calls.length === 2); assert.equal(f.calls[1].args.prompt, 'fallback');
});

test('uncertain steer delivery persists its text and is never resent on a retry', async t => {
  const f = fixture(t); await f.submit(payload('first')); await until(() => f.calls.length === 1);
  let deliveries = 0; f.steerWith(async () => { deliveries++; throw Object.assign(new Error('connection lost'), { code: 'steer_delivery_uncertain' }); });
  const body = { ...payload('uncertain', 'inspect delivery before retry'), expectedTurnId: 'turn-1' };
  assert.equal((await f.submit(body, 'steer')).status, 'uncertain');
  await f.finish(); assert.equal((await f.submit(body, 'steer')).status, 'uncertain');
  assert.equal(deliveries, 1); assert.equal(f.snapshot().queue.length, 0); assert.equal(f.snapshot().paused, true);
  assert.equal(f.snapshot().submissions.at(-1).content, body.content);
});

test('inactive fallback into a full queue creates an explicit failed receipt', async t => {
  const f = fixture(t); await f.submit(payload('first')); await until(() => f.calls.length === 1);
  for (let i = 0; i < 5; i++) await f.submit(payload(`queue-${i}`));
  f.steerWith(async () => { throw Object.assign(new Error('ended'), { code: 'turn_not_active' }); });
  const body = { ...payload('full-fallback'), expectedTurnId: 'turn-1' };
  const result = await f.submit(body, 'steer'); assert.equal(result.status, 'error'); assert.match(result.error, /5/);
  assert.equal((await f.submit(body, 'steer')).status, 'error'); assert.equal(f.snapshot().queue.length, 5);
});

test('revocation aborts the current task and removes only its session queue entries', async t => {
  const f = fixture(t); await f.submit(payload('first')); await until(() => f.calls.length === 1);
  await f.submit(payload('same-session'));
  const otherAuth = { ...f.auth, sessionHash: 'other-session' }; f.valid.add(otherAuth.sessionHash);
  await f.manager.submit(f.conversation, payload('other-session'), otherAuth);
  f.valid.delete(f.auth.sessionHash); await f.manager.revoke(task => task.sessionHash === f.auth.sessionHash);
  assert.equal(f.calls[0].args.signal.aborted, true); assert.deepEqual(f.snapshot().queue.map(item => item.content), ['other-session']);
  assert.equal(f.snapshot().paused, true);
  await f.manager.resume(f.conversation, otherAuth); await until(() => f.calls.length === 2);
  assert.equal(f.calls[1].args.prompt, 'other-session');
});

test('expiration cancels a running task without needing another HTTP request', async t => {
  const f = fixture(t, { expiresAt: Date.now() + 40 }); await f.submit(payload('expiry')); await until(() => f.calls.length === 1);
  await until(() => f.snapshot().run.status === 'cancelled'); assert.equal(f.calls[0].args.signal.aborted, true);
});

test('restart pauses pending work, invalidates in-flight status and preserves duplicate receipts', async t => {
  const f = fixture(t); await f.submit(payload('first')); await until(() => f.calls.length === 1); await f.submit(payload('pending'));
  const recovered = structuredClone(f.saved().conversations[0]); recovered.agent.queue[0].auth.generation = 4;
  assert.equal(restoreAgentState(recovered), true); assert.equal(recovered.agent.run.status, 'error'); assert.equal(recovered.agent.paused, true);
  assert.equal(recovered.agent.queue[0].auth.generation, 0);
  const restarted = fixture(t, { conversation: recovered });
  restarted.manager.kick(recovered); await delay(20); assert.equal(restarted.calls.length, 0);
  assert.equal((await restarted.submit(payload('first'))).status, 'error');
  await restarted.manager.resume(recovered, restarted.auth); await until(() => restarted.calls.length === 1);
  assert.equal(restarted.calls[0].args.prompt, 'pending');
});

test('malformed persisted ownership or missing queue receipts fails closed', async t => {
  const f = fixture(t); await f.manager.stop(f.conversation); await f.submit(payload('queued'));
  const badOwner = structuredClone(f.conversation); badOwner.agent.queue[0].auth.userId = 'another-user'; assert.throws(() => restoreAgentState(badOwner), /归属/);
  const badReceipt = structuredClone(f.conversation); badReceipt.agent.submissions = []; assert.throws(() => restoreAgentState(badReceipt), /不一致/);
  const duplicate = structuredClone(f.conversation); duplicate.agent.queue.push(structuredClone(duplicate.agent.queue[0])); assert.throws(() => restoreAgentState(duplicate), /归属/);
});

test('config changes after queuing prevent execution and projections contain no private auth', async t => {
  const f = fixture(t); await f.manager.stop(f.conversation); await f.submit(payload('queued'));
  const output = JSON.stringify(f.snapshot()); assert.doesNotMatch(output, /session-fixture|sessionHash|fingerprint|bootstrap|generation|user-fixture/);
  f.model.model = 'different-model'; await assert.rejects(f.manager.resume(f.conversation, f.auth), { status: 409 }); assert.equal(f.calls.length, 0);
});

test('approval resolution clears exactly the owned request while task is still running', async t => {
  const f = fixture(t); await f.submit(payload('first')); await until(() => f.calls.length === 1);
  f.calls[0].args.onEvent('approval', { id: 'approval-1', kind: 'command', description: 'confirm operation' });
  assert.equal(f.snapshot().approvals.length, 1);
  f.calls[0].args.onEvent('approval-resolved', { id: 'approval-1' }); assert.equal(f.snapshot().approvals.length, 0);
});

test('review outcome and rationale reach the public run and survive persistence without granting approval',async t=>{
  const f=fixture(t); await f.submit(payload('review-state')); await until(()=>f.calls.length===1);
  const review={status:'denied',source:'native',reviewId:'native-review',rationale:'upstream unavailable'};
  f.calls[0].args.onEvent('status',{message:'not allowed',approvalReview:review});
  assert.deepEqual(f.snapshot().run.approvalReview,review); assert.equal(f.snapshot().approvals.length,0);
  f.calls[0].args.onEvent('status',{message:'bad metadata',approvalReview:{...review,allow:true}});
  assert.deepEqual(f.snapshot().run.approvalReview,review);
  await f.finish(); assert.deepEqual(f.saved().conversations[0].agent.run.approvalReview,review);
  const bad=structuredClone(f.conversation); bad.agent.run.approvalReview.status='allow'; assert.throws(()=>restoreAgentState(bad),/审查状态/);
});

test('deletion fencing prevents an already-pending submission from reviving removed work', async t => {
  const f = fixture(t), saving = deferred(); f.saveWith(() => saving.promise);
  const submitting = f.submit(payload('pending')); await until(() => f.conversation.agent?.queue.length === 1);
  const stopping = f.manager.stop(f.conversation, { clear: true }); f.store.state.conversations = [];
  saving.resolve(); await stopping; await assert.rejects(submitting, { status: 404 }); assert.equal(f.calls.length, 0);
});

test('nonempty image hooks and changing permissions mid-turn are rejected before delivery', async t => {
  const f = fixture(t); await assert.rejects(f.submit({ ...payload('image'), attachmentIds: ['image-id'] }), { status: 400 });
  await f.submit(payload('first')); await until(() => f.calls.length === 1);
  await assert.rejects(f.submit({ ...payload('elevated'), expectedTurnId: 'turn-1', permissions: { access: 'full-access', approval: 'auto' } }, 'steer'), { status: 409 });
  assert.equal(f.snapshot().submissions.length, 1);
});

test('remote restart records unknown, preserves messages and never resumes its queue', async t => {
  const f = fixture(t); await f.submit({ ...payload('remote-first'), hostId: 'desktop-fixture' }); await until(() => f.calls.length === 1);
  await f.submit({ ...payload('remote-queued'), hostId: 'desktop-fixture' });
  const recovered = structuredClone(f.saved().conversations[0]), messages = structuredClone(recovered.messages);
  assert.equal(restoreAgentState(recovered), true); assert.equal(recovered.agent.run.status, 'unknown');
  assert.equal(recovered.agent.submissions[0].status, 'uncertain'); assert.equal(recovered.agent.queue.length, 1);
  assert.deepEqual(recovered.messages, messages);
  const restarted = fixture(t, { conversation: recovered });
  await assert.rejects(restarted.manager.resume(recovered, restarted.auth), { status: 409 });
  await assert.rejects(restarted.submit(payload('new-after-unknown')), { status: 409 });
  restarted.manager.kick(recovered); await delay(10); assert.equal(restarted.calls.length, 0);
});
