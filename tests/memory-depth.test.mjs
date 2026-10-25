import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, lstat, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createMemoryService } from '../server/memory-service.mjs';

// Real journals and atomic filesystem writes; no upstream, real account,
// production data directory, model request or runtime process is used here.
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const event = (id, marker) => ({ id, conversationId: 'depth-fixture-conversation', source: 'chat', userText: `fixture preference ${marker}`, assistantText: 'fixture acknowledged', createdAt: '2026-01-01T00:00:00.000Z' });
const digest = text => createHash('sha256').update(text).digest('hex');
const codes = settled => settled.filter(item => item.status === 'rejected').map(item => item.reason?.code);

async function fixture(t) {
  const parent = await realpath(tmpdir());
  const directory = await mkdtemp(path.join(parent, 'petpal-memory-depth-'));
  let requests = 0, service;
  const open = () => createMemoryService({ dataDir: directory, instanceId: 'depth-fixture-central', autoPoll: false, autoStart: false,
    clock: () => Date.parse('2026-01-01T00:00:00.000Z'), fetchImpl: async () => { requests++; throw new Error('UNEXPECTED_UPSTREAM_REQUEST'); } });
  service = await open();
  t.after(async () => {
    await service.close();
    const actual = await realpath(directory), info = await lstat(directory);
    assert.equal(info.isSymbolicLink(), false, 'UNSAFE_FIXTURE_DIRECTORY');
    assert.equal(path.dirname(actual).toLowerCase(), parent.toLowerCase(), 'UNSAFE_FIXTURE_PARENT');
    assert.ok(path.basename(actual).startsWith('petpal-memory-depth-'), 'UNSAFE_FIXTURE_NAME');
    await rm(actual, { recursive: true, force: true });
    assert.equal(requests, 0, 'UNEXPECTED_UPSTREAM_REQUEST');
  });
  return { directory, get service() { return service; }, async reopen() { await service.close(); service = await open(); } };
}

const snapshot = (service, user, epoch = 1) => service.exportSync(user, { epoch, cursor: 0, limit: 200 });
function denseSequence(page, count) {
  assert.equal(page.events.length, count, 'EVENT_COUNT');
  assert.equal(new Set(page.events.map(item => item.id)).size, count, 'DUPLICATE_EVENT_ID');
  assert.equal(new Set(page.events.map(item => item.seq)).size, count, 'DUPLICATE_SEQUENCE');
  assert.ok(page.events.every((item, index) => item.seq === index + 1 && item.epoch === page.epoch), 'SEQUENCE_OR_EPOCH_GAP');
  assert.equal(page.nextCursor, count, 'CURSOR_COUNT');
}
async function noTemporaryFiles(directory) {
  assert.equal((await readdir(path.join(directory, 'memory'))).filter(name => name.endsWith('.tmp')).length, 0, 'ORPHANED_TEMPORARY_FILE');
}

test('multi-account cold-load duplicate bursts remain isolated and recover densely after reopen', { timeout: 15000 }, async t => {
  const f = await fixture(t), users = Array.from({ length: 6 }, (_, index) => `depth-user-${index}`);
  const jobs = [];
  for (let duplicate = 0; duplicate < 3; duplicate++) for (let index = 0; index < 12; index++) for (let account = 0; account < users.length; account++) {
    jobs.push(f.service.remember(users[account], event(`shared-${index}`, `account-${account}-item-${index}`)));
  }
  const results = await Promise.all(jobs);
  assert.equal(results.filter(item => !item.duplicate).length, 72, 'UNIQUE_COMMIT_COUNT');
  assert.equal(results.filter(item => item.duplicate).length, 144, 'DUPLICATE_COMMIT_COUNT');
  const verify = async () => {
    const pages = await Promise.all(users.map(user => snapshot(f.service, user)));
    assert.equal(new Set(pages.map(page => page.scope.memobaseUserId)).size, users.length, 'ACCOUNT_NAMESPACE_COLLISION');
    for (let account = 0; account < users.length; account++) {
      denseSequence(pages[account], 12);
      assert.ok(pages[account].events.every(item => item.userText === `fixture preference account-${account}-item-${item.id.slice('shared-'.length)}`), 'CROSS_ACCOUNT_CONTENT');
    }
  };
  await verify(); await noTemporaryFiles(f.directory); await f.reopen(); await verify();
  const duplicates = await Promise.all(users.map((user, account) => f.service.remember(user, event('shared-3', `account-${account}-item-3`))));
  assert.ok(duplicates.every(item => item.duplicate), 'REOPEN_LOST_DEDUPLICATION');
  await noTemporaryFiles(f.directory);
});

test('conflicting same-id bursts have one durable payload winner without poisoning the write queue', { timeout: 15000 }, async t => {
  const f = await fixture(t), user = 'depth-conflict-user';
  const left = event('contended', 'left-variant'), right = event('contended', 'right-variant');
  const outcomes = await Promise.allSettled(Array.from({ length: 24 }, (_, index) => f.service.remember(user, index % 2 ? right : left)));
  const fulfilled = outcomes.filter(item => item.status === 'fulfilled');
  assert.equal(fulfilled.length, 12, 'WINNING_VARIANT_COUNT');
  assert.equal(fulfilled.filter(item => !item.value.duplicate).length, 1, 'WINNER_COMMITTED_MORE_THAN_ONCE');
  assert.equal(codes(outcomes).length, 12, 'CONFLICT_REJECTION_COUNT');
  assert.ok(codes(outcomes).every(code => code === 'MEMORY_EVENT_CONFLICT'), 'WRONG_CONFLICT_CODE');
  const page = await snapshot(f.service, user); denseSequence(page, 1);
  const winner = page.events[0].userText === left.userText ? left : right;
  assert.ok(page.events[0].userText === winner.userText, 'MIXED_WINNING_PAYLOAD');
  await f.service.remember(user, event('after-conflict', 'queue-still-works'));
  await f.reopen(); denseSequence(await snapshot(f.service, user), 2);
  assert.equal((await f.service.remember(user, winner)).duplicate, true, 'DURABLE_WINNER_CHANGED');
  await assert.rejects(f.service.remember(user, winner === left ? right : left), { code: 'MEMORY_EVENT_CONFLICT' });
  await f.service.remember(user, event('after-reopen', 'queue-still-works'));
  denseSequence(await snapshot(f.service, user), 3); await noTemporaryFiles(f.directory);
});

test('overlapping imports and local writes deduplicate while a late batch conflict rolls back every earlier row', { timeout: 15000 }, async t => {
  const f = await fixture(t), user = 'depth-mixed-user', other = 'depth-unrelated-user';
  const events = Array.from({ length: 20 }, (_, index) => event(`mixed-${index}`, `mixed-item-${index}`));
  const writes = await Promise.all([
    ...events.slice(0, 12).map(item => f.service.remember(user, item)),
    f.service.importSync(user, { epoch: 1, events: events.slice(6).map(item => ({ ...item, epoch: 1 })) }),
    f.service.importSync(user, { epoch: 1, events: events.slice(0, 8).map(item => ({ ...item, epoch: 1 })) }),
  ]);
  const committed = writes.reduce((count, item) => count + (Object.hasOwn(item, 'accepted') ? item.accepted : Number(!item.duplicate)), 0);
  assert.equal(committed, 20, 'OVERLAP_DOUBLE_COUNT'); denseSequence(await snapshot(f.service, user), 20);
  const rejectedRows = Array.from({ length: 4 }, (_, index) => ({ ...event(`rolled-back-${index}`, 'must-not-persist'), epoch: 1 }));
  const outcomes = await Promise.allSettled([
    f.service.importSync(user, { epoch: 1, events: [...rejectedRows, { ...event('mixed-0', 'conflicting-payload'), epoch: 1 }] }),
    f.service.remember(user, event('after-batch-conflict', 'queue-progress')),
    f.service.remember(other, event('mixed-0', 'different-account-progress')),
  ]);
  assert.equal(outcomes[0].status, 'rejected', 'FAILED_BATCH_ACCEPTED');
  assert.equal(outcomes[0].reason?.code, 'MEMORY_EVENT_CONFLICT', 'WRONG_BATCH_CONFLICT_CODE');
  assert.ok(outcomes.slice(1).every(item => item.status === 'fulfilled'), 'FAILURE_LEAKED_TO_ANOTHER_WRITE');
  await f.reopen();
  const page = await snapshot(f.service, user); denseSequence(page, 21);
  assert.ok(page.events.every(item => !item.id.startsWith('rolled-back-')), 'PARTIAL_BATCH_PERSISTED');
  denseSequence(await snapshot(f.service, other), 1); await noTemporaryFiles(f.directory);
});

test('two clear epochs reject multi-account delayed writes and old replay without affecting the spared account', { timeout: 15000 }, async t => {
  const release = deferred(), arrived = deferred(); t.after(() => release.resolve());
  const f = await fixture(t), users = ['depth-clear-a', 'depth-clear-b', 'depth-spared'];
  await Promise.all(users.flatMap((user, account) => Array.from({ length: 6 }, (_, index) => f.service.remember(user, event(`before-${index}`, `before-account-${account}`)))));
  const original = await Promise.all(users.map(user => snapshot(f.service, user)));
  let count = 0;
  const late = users.flatMap((user, account) => Array.from({ length: 8 }, (_, index) => {
    let first = true;
    return f.service.remember(user, event(`delayed-${index}`, `delayed-account-${account}`), { authorize: async () => {
      if (first) { first = false; if (++count === 24) arrived.resolve(); }
      await release.promise; return true;
    } });
  }));
  const settled = Promise.allSettled(late);
  try {
    await arrived.promise;
    for (let round = 0; round < 2; round++) {
      const cleared = await Promise.all(users.slice(0, 2).map(user => f.service.clear(user)));
      assert.ok(cleared.every(item => item.epoch === round + 2), 'CLEAR_EPOCH_NOT_ADVANCED');
    }
    await Promise.all(users.slice(0, 2).flatMap((user, account) => Array.from({ length: 4 }, (_, index) => f.service.remember(user, event(`fresh-${index}`, `fresh-account-${account}`)))));
  } finally { release.resolve(); }
  const outcomes = await settled;
  assert.equal(codes(outcomes).length, 16, 'LATE_OLD_WRITE_REJECTION_COUNT');
  assert.ok(codes(outcomes).every(code => code === 'MEMORY_EPOCH_CONFLICT'), 'WRONG_LATE_WRITE_CODE');
  assert.ok(outcomes.slice(16).every(item => item.status === 'fulfilled'), 'SPARED_ACCOUNT_BLOCKED');
  await f.reopen();
  for (let account = 0; account < 2; account++) {
    const page = await snapshot(f.service, users[account], 3); denseSequence(page, 4);
    assert.equal(page.epoch, 3, 'REOPEN_LOST_CLEAR_EPOCH');
    assert.ok(page.events.every(item => item.id.startsWith('fresh-')), 'OLD_EPOCH_RESURRECTED');
  }
  denseSequence(await snapshot(f.service, users[2]), 14);
  const replayed = await Promise.allSettled(users.map((user, account) => f.service.importSync(user, { epoch: 1, events: original[account].events })));
  assert.equal(replayed[0].reason?.code, 'MEMORY_EPOCH_CONFLICT', 'FIRST_OLD_REPLAY_ACCEPTED');
  assert.equal(replayed[1].reason?.code, 'MEMORY_EPOCH_CONFLICT', 'SECOND_OLD_REPLAY_ACCEPTED');
  assert.equal(replayed[2].status, 'fulfilled', 'SPARED_REPLAY_REJECTED');
  assert.equal(replayed[2].value.accepted, 0, 'SPARED_REPLAY_DUPLICATED');
  await noTemporaryFiles(f.directory);
});

test('a damaged account journal stays contained after reopen while healthy account writes remain durable', { timeout: 15000 }, async t => {
  const f = await fixture(t), bad = 'depth-damaged-user', good = 'depth-healthy-user';
  await Promise.all([f.service.remember(bad, event('same-id', 'damaged-fixture')), f.service.remember(good, event('same-id', 'healthy-fixture'))]);
  await f.service.close();
  let badFile;
  for (const name of await readdir(path.join(f.directory, 'memory'))) {
    if (!name.endsWith('.json') || name === 'config.json') continue;
    const file = path.join(f.directory, 'memory', name), value = JSON.parse(await readFile(file, 'utf8'));
    if (value.scope.userId === bad) badFile = file;
  }
  assert.ok(badFile, 'FIXTURE_JOURNAL_NOT_FOUND');
  assert.equal(path.dirname(badFile), path.join(f.directory, 'memory'), 'UNSAFE_CORRUPTION_TARGET');
  const damaged = '{"version":1,"scope":'; await writeFile(badFile, damaged);
  await f.reopen(); await assert.rejects(f.service.status(bad), { code: 'MEMORY_STORAGE_INVALID' });
  denseSequence(await snapshot(f.service, good), 1);
  await f.service.remember(good, event('healthy-next', 'healthy-progress'));
  assert.equal(digest(await readFile(badFile, 'utf8')), digest(damaged), 'DAMAGED_JOURNAL_OVERWRITTEN');
  await f.reopen(); denseSequence(await snapshot(f.service, good), 2);
  await assert.rejects(f.service.exportSync(bad, { epoch: 1 }), { code: 'MEMORY_STORAGE_INVALID' });
  assert.equal(digest(await readFile(badFile, 'utf8')), digest(damaged), 'DAMAGED_JOURNAL_SILENTLY_REPAIRED');
  await noTemporaryFiles(f.directory);
});
