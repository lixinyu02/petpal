import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createReplyMemoryJobs, replyMemoryPrivacyGuard } from '../server/reply-memory-jobs.mjs';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const input = id => ({ id, conversationId: `conversation-${id}`, source: 'chat', userText: '喜欢绿茶', assistantText: '我记住了', sensitive: false });
async function until(check) { for (let i = 0; i < 500; i++) { if (check()) return; await delay(2); } assert.fail('Reply memory job did not settle'); }

test('reply jobs freeze bounded input, preserve account identity and deduplicate completed messages', async () => {
  const gate = deferred(), calls = [];
  const jobs = createReplyMemoryJobs({ memory: { async remember(userId, value, control) { calls.push({ userId, value, control }); await gate.promise; await control.authorize(); return { queued: true }; } } });
  const body = input('stable-id');
  assert.deepEqual(jobs.enqueue('account-a', body), { queued: true });
  body.userText = 'later mutation'; body.id = 'changed-id';
  await until(() => calls.length === 1);
  assert.equal(calls[0].userId, 'account-a'); assert.equal(calls[0].value.userText, '喜欢绿茶'); assert.ok(Object.isFrozen(calls[0].value));
  assert.equal(jobs.enqueue('account-a', input('stable-id')).reason, 'duplicate');
  gate.resolve(); await jobs.close();
  assert.equal(jobs.status().completed, 1); assert.equal(jobs.status().duplicates, 1);
  assert.doesNotMatch(JSON.stringify(jobs.status()), /account-a|stable-id|绿茶/);
});

test('reply jobs bound pending work and concurrency and consume journal failures', async () => {
  const gate = deferred(); let concurrent = 0, maximum = 0;
  const jobs = createReplyMemoryJobs({ concurrency: 2, maxPending: 3, memory: { async remember(_user, value) { concurrent++; maximum = Math.max(maximum, concurrent); await gate.promise; concurrent--; if (value.id === 'failing-id') throw new Error('untrusted journal detail'); return { queued: true }; } } });
  for (const id of ['first-id', 'failing-id', 'queued-id']) assert.equal(jobs.enqueue('one', input(id)).queued, true);
  assert.equal(jobs.enqueue('one', input('overflow-id')).reason, 'capacity');
  await until(() => concurrent === 2); assert.equal(jobs.status().queued, 1);
  gate.resolve(); await jobs.close();
  assert.equal(maximum, 2); assert.equal(jobs.status().completed, 2); assert.equal(jobs.status().failed, 1); assert.equal(jobs.status().capacityRejected, 1);
});

test('cancelling one account removes queued jobs without cancelling another account', async () => {
  const written = [], calls = [];
  const jobs = createReplyMemoryJobs({ concurrency: 1, memory: { async remember(userId, value, { signal, authorize }) { calls.push(value.id); if (userId === 'cancelled-account') await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); await authorize(); written.push(value.id); return { queued: true }; } } });
  jobs.enqueue('cancelled-account', input('active-id')); jobs.enqueue('cancelled-account', input('never-start-id')); jobs.enqueue('other-account', input('other-id'));
  await until(() => calls.length === 1); jobs.cancelUser('cancelled-account'); await jobs.close();
  assert.deepEqual(calls, ['active-id', 'other-id']); assert.deepEqual(written, ['other-id']); assert.equal(jobs.status().cancelled, 2); assert.equal(jobs.status().failed, 0);
});

test('deleted conversations and changed eligibility are rechecked during a journal job', async () => {
  const gate = deferred(); let present = true, written = false;
  const jobs = createReplyMemoryJobs({ authorize: () => present, memory: { async remember(_user, _value, control) { await gate.promise; await control.authorize(); written = true; } } });
  jobs.enqueue('one', input('deleted-id')); await until(() => jobs.status().active === 1);
  present = false; gate.resolve(); await jobs.close(); assert.equal(written, false); assert.equal(jobs.status().cancelled, 1);
});

test('shutdown is bounded, aborts non-cooperative work and rejects further enqueue', async () => {
  const gate = deferred(); let signal;
  const jobs = createReplyMemoryJobs({ closeGraceMs: 30, memory: { async remember(_user, _value, control) { signal = control.signal; await gate.promise; await control.authorize(); } } });
  jobs.enqueue('one', input('hanging-id')); await until(() => signal);
  const begin = Date.now(); const first = jobs.close(); assert.equal(first, jobs.close());
  await first; assert.ok(Date.now() - begin < 500); assert.equal(signal.aborted, true);
  assert.equal(jobs.enqueue('one', input('late-id')).reason, 'closed');
  assert.equal(jobs.status().cancelled, 1); assert.equal(jobs.status().closedRejected, 1);
  gate.resolve(); await until(() => jobs.status().pending === 0); assert.equal(jobs.status().completed, 0);
});

test('timeouts retain their physical concurrency slot until non-cooperative work exits', async () => {
  const gate = deferred(), calls = [];
  const jobs = createReplyMemoryJobs({ concurrency: 1, timeoutMs: 30, memory: { async remember(_user, value, control) { calls.push(value.id); if (value.id === 'timed-out-id') await gate.promise; await control.authorize(); return { queued: true }; } } });
  jobs.enqueue('one', input('timed-out-id')); jobs.enqueue('one', input('next-id'));
  await until(() => jobs.status().timedOut === 1); assert.deepEqual(calls, ['timed-out-id']); assert.equal(jobs.status().active, 1);
  gate.resolve(); await jobs.close(); assert.deepEqual(calls, ['timed-out-id', 'next-id']); assert.equal(jobs.status().completed, 1);
});

test('sensitive or invalid replies are never scheduled', async () => {
  let calls = 0; const jobs = createReplyMemoryJobs({ memory: { async remember() { calls++; } } });
  assert.equal(jobs.enqueue('one', { ...input('sensitive-id'), sensitive: true }).reason, 'sensitive');
  assert.equal(jobs.enqueue('one', { ...input('invalid-id'), source: 'foreign' }).reason, 'invalid');
  await jobs.close(); assert.equal(calls, 0); assert.equal(jobs.status().skipped, 1); assert.equal(jobs.status().rejected, 1);
});

test('a small live privacy fence cancels a queued journal if either sensitive flag changes', async () => {
  for (const flag of ['sensitiveInput', 'privateInputProtected']) {
    const gate = deferred(), privacy = { sensitiveInput: false, privateInputProtected: false }; let written = false;
    const jobs = createReplyMemoryJobs({ memory: { async remember(_user, _input, control) { await gate.promise; await control.authorize(); written = true; } } });
    jobs.enqueue('one', input(`privacy-${flag}`), { authorize: replyMemoryPrivacyGuard(privacy) });
    await until(() => jobs.status().active === 1); privacy[flag] = true; gate.resolve(); await jobs.close();
    assert.equal(written, false); assert.equal(jobs.status().cancelled, 1);
  }
});
