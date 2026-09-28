import test from 'node:test';
import assert from 'node:assert/strict';
import { createCompanionPreference, overlayCompanion } from '../src/avatar/preference-store.mjs';

const storage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test('denied storage keeps an immediately observable in-memory companion selection', async () => {
  const blocked = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  const preference = createCompanionPreference({ storage: blocked });
  const observed = [];
  const unsubscribe = preference.subscribe(() => observed.push(preference.snapshot().kind));
  const choice = preference.choose('cat');
  assert.equal(preference.snapshot().kind, 'cat');
  await choice;
  assert.equal(preference.snapshot().dirty, true);
  preference.refresh();
  assert.equal(preference.snapshot().kind, 'cat');
  assert.deepEqual(observed, ['cat']);
  unsubscribe();
});

test('avatar query overrides only independent overlay routes', () => {
  assert.equal(overlayCompanion('?avatar=cat'), null);
  assert.equal(overlayCompanion('?chat=1&avatar=cat'), null);
  assert.equal(overlayCompanion('?overlay=1&avatar=cat'), 'cat');
  assert.equal(overlayCompanion('?pet=1&avatar=anime'), 'anime');
  assert.equal(overlayCompanion('?overlay=1&avatar=invalid'), null);
});

test('offline dirty preference survives reload and is replayed before older server state', async () => {
  const disk = storage();
  const offline = createCompanionPreference({ storage: disk });
  await offline.choose('cat');
  const calls = [];
  const restored = createCompanionPreference({ storage: disk, connected: () => true, persist: async kind => { calls.push(kind); } });
  assert.equal(restored.snapshot().dirty, true);
  restored.remember('anime');
  assert.equal(restored.snapshot().kind, 'cat');
  await restored.hydrate('anime');
  assert.deepEqual(calls, ['cat']);
  assert.equal(restored.snapshot().kind, 'cat');
  assert.equal(restored.snapshot().dirty, false);
  assert.equal(JSON.parse(disk.getItem('petpal.companionPreference')).dirty, false);
  await restored.hydrate('anime');
  assert.equal(restored.snapshot().kind, 'anime');
});

test('rapid selections serialize writes and an old response cannot acknowledge the latest choice', async () => {
  const entered = deferred(), release = deferred(), secondEntered = deferred(), secondRelease = deferred();
  const calls = [];
  const preference = createCompanionPreference({ storage: storage(), connected: () => true, persist: async kind => {
    calls.push(kind);
    if (calls.length === 1) { entered.resolve(); await release.promise; }
    else { secondEntered.resolve(); await secondRelease.promise; }
  } });
  const first = preference.choose('cat');
  await entered.promise;
  const second = preference.choose('anime');
  assert.equal(preference.snapshot().kind, 'anime');
  assert.deepEqual(calls, ['cat']);
  release.resolve(); await secondEntered.promise;
  assert.equal(preference.snapshot().dirty, true);
  assert.deepEqual(calls, ['cat', 'anime']);
  secondRelease.resolve(); await Promise.all([first, second]);
  assert.equal(preference.snapshot().dirty, false);
  assert.equal(preference.snapshot().kind, 'anime');
});

test('network failure retains pending state and later hydration can retry the queue', async () => {
  let fail = true;
  const calls = [];
  const preference = createCompanionPreference({ storage: storage(), connected: () => true, persist: async kind => {
    calls.push(kind); if (fail) throw new Error('offline');
  } });
  await assert.rejects(preference.choose('cat'), /offline/);
  assert.equal(preference.snapshot().dirty, true);
  fail = false;
  await preference.hydrate('anime');
  assert.deepEqual(calls, ['cat', 'cat']);
  assert.equal(preference.snapshot().dirty, false);
  assert.equal(preference.snapshot().kind, 'cat');
});

test('legacy values and storage updates remain compatible; invalid selections do not mutate state', async () => {
  const disk = storage(); disk.setItem('petpal.companionKind', 'cat');
  const preference = createCompanionPreference({ storage: disk });
  assert.equal(preference.snapshot().kind, 'cat');
  disk.setItem('petpal.companionPreference', JSON.stringify({ kind: 'anime', dirty: true }));
  preference.refresh();
  assert.equal(preference.snapshot().kind, 'anime');
  assert.equal(preference.snapshot().dirty, true);
  const before = preference.snapshot();
  for (const invalid of ['Cat', '', null, {}, 1]) assert.throws(() => preference.choose(invalid), /must be/);
  assert.deepEqual(preference.snapshot(), before);
});

test('account and server scopes never inherit shared legacy preference or another account pending choice', async () => {
  const disk=storage();disk.setItem('petpal.companionKind','cat');
  const owner=createCompanionPreference({storage:disk,scope:'user:server-a:owner'});
  const member=createCompanionPreference({storage:disk,scope:'user:server-a:member'});
  const otherServer=createCompanionPreference({storage:disk,scope:'user:server-b:owner'});
  assert.equal(owner.snapshot().kind,'anime');
  await owner.choose('cat');member.refresh();otherServer.refresh();
  assert.equal(member.snapshot().kind,'anime');assert.equal(otherServer.snapshot().kind,'anime');
  member.remember('anime');
  const restored=createCompanionPreference({storage:disk,scope:'user:server-a:owner'});
  assert.equal(restored.snapshot().kind,'cat');assert.equal(restored.snapshot().dirty,true);
  assert.equal(disk.getItem('petpal.companionPreference'),null);
});

test('disposal prevents a pending old-account acknowledgment and stops queued writes', async () => {
  const disk=storage(),entered=deferred(),release=deferred(),calls=[];
  const first=createCompanionPreference({storage:disk,scope:'owner',connected:()=>true,persist:async kind=>{calls.push(kind);entered.resolve();await release.promise;}});
  const pending=first.choose('cat');await entered.promise;
  const queued=first.choose('anime');first.dispose();
  const member=createCompanionPreference({storage:disk,scope:'member'});await member.choose('cat');
  release.resolve();await Promise.all([pending,queued]);
  assert.deepEqual(calls,['cat']);assert.equal(first.snapshot().dirty,true);
  assert.equal(member.snapshot().kind,'cat');assert.equal(member.snapshot().dirty,true);
  assert.deepEqual(JSON.parse(disk.getItem('petpal.companionPreference:owner')),{kind:'anime',dirty:true});
  await assert.rejects(first.choose('cat'),/disposed/);
});
