import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, readFile, writeFile, rm, unlink, lstat, symlink, utimes } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { JsonStore } from '../server/store.mjs';

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-state-performance-'));
  const store = await new JsonStore(directory).init();
  store.state.settings.petName = 'Alpha'; await store.save();
  const originalRename = fs.promises.rename;
  let physicalWrites = 0;
  t.mock.method(fs.promises, 'rename', async (...args) => {
    const result = await originalRename(...args);
    if (args[1] === store.file && args[0].endsWith('.tmp')) physicalWrites++;
    return result;
  });
  syncBuiltinESMExports();
  t.after(async () => {
    await store.queue.catch(() => {});
    t.mock.restoreAll(); syncBuiltinESMExports();
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('petpal-state-performance-'));
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, store, originalRename, writes: () => physicalWrites, disk: async () => JSON.parse(await readFile(store.file, 'utf8')) };
}

test('compact JSON retains Unicode, embedded newlines and restart compatibility', async t => {
  const f = await fixture(t);
  f.store.state.settings.persona = '中文 😀\n下一行'; await f.store.save();
  const raw = await readFile(f.store.file, 'utf8');
  assert.equal(raw, `${JSON.stringify(JSON.parse(raw))}\n`);
  assert.equal((await new JsonStore(f.directory).init()).state.settings.persona, '中文 😀\n下一行');
});

test('unchanged saves skip physical replacement but retain every prepare/check/commit', async t => {
  const f = await fixture(t), hooks = [];
  const organization = f.store.organizationPersistence;
  for (const name of ['prepare', 'beforeCommit', 'commit']) {
    const original = organization[name];
    organization[name] = (...args) => { hooks.push(name); return original(...args); };
  }
  await f.store.save();
  await Promise.all([f.store.save(), f.store.save()]);
  assert.equal(f.writes(), 0);
  assert.deepEqual(hooks, Array.from({ length: 3 }, () => ['prepare', 'beforeCommit', 'commit']).flat());
  let authorized = 0;
  await f.store.save({ chatAssistantDefaultHost: { userId: f.store.state.ownerId, hostId: null, authorize() { authorized++; } } });
  assert.equal(authorized, 1); assert.equal(f.writes(), 0);
});

test('distinct queued snapshots remain independent and do not publish later unsaved edits', async t => {
  const f = await fixture(t), observed = [], renameWithCounter = fs.promises.rename;
  t.mock.method(fs.promises, 'rename', async (...args) => {
    const result = await renameWithCounter(...args);
    if (args[1] === f.store.file) observed.push((await f.disk()).settings.petName);
    return result;
  });
  syncBuiltinESMExports();
  let release; f.store.queue = new Promise(resolve => { release = resolve; });
  const tasks = ['First', 'Second', 'Third'].map(value => { f.store.state.settings.petName = value; return f.store.save(); });
  f.store.state.settings.petName = 'Unsaved'; release(); await Promise.all(tasks); await f.store.queue;
  assert.deepEqual(observed, ['First', 'Second', 'Third']);
  assert.equal(f.writes(), 3); assert.equal((await f.disk()).settings.petName, 'Third');
  assert.equal(f.store.state.settings.petName, 'Unsaved');
});

test('an unchanged save still fails a beforeCommit authorization check and later retries', async t => {
  const f = await fixture(t), organization = f.store.organizationPersistence, beforeCommit = organization.beforeCommit;
  let revoked = true;
  organization.beforeCommit = snapshot => { beforeCommit(snapshot); if (revoked) throw Object.assign(new Error('revoked'), { status: 401 }); };
  await assert.rejects(f.store.save(), { status: 401 }); assert.equal(f.writes(), 0);
  revoked = false; await f.store.save(); assert.equal(f.writes(), 1);
});

test('deleting an unchanged durable file forces recreation', async t => {
  const f = await fixture(t);
  await unlink(f.store.file); await f.store.save();
  assert.equal(f.writes(), 1); assert.equal((await f.disk()).settings.petName, 'Alpha');
});

test('replacing a file with same-sized content and restored mtime cannot hide behind the cache', async t => {
  const f = await fixture(t), stamp = await lstat(f.store.file), original = await readFile(f.store.file, 'utf8');
  const external = path.join(f.directory, 'external.json');
  await writeFile(external, original.replace('"Alpha"', '"Omega"'));
  await utimes(external, stamp.atime, stamp.mtime); await f.originalRename(external, f.store.file);
  await f.store.save();
  assert.equal(f.writes(), 1); assert.equal((await f.disk()).settings.petName, 'Alpha');
});

test('same-sized in-place external edits are rewritten', async t => {
  const f = await fixture(t), stamp = await lstat(f.store.file), original = await readFile(f.store.file, 'utf8');
  await writeFile(f.store.file, original.replace('"Alpha"', '"Omega"')); await utimes(f.store.file, stamp.atime, stamp.mtime);
  await f.store.save(); assert.equal(f.writes(), 1); assert.equal((await f.disk()).settings.petName, 'Alpha');
});

test('a symbolic link is replaced without modifying its target', async t => {
  const f = await fixture(t), retained = path.join(f.directory, 'retained.json'), original = await readFile(f.store.file, 'utf8');
  await f.originalRename(f.store.file, retained);
  try { await symlink(retained, f.store.file, 'file'); }
  catch (error) {
    await f.originalRename(retained, f.store.file);
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.skip('File symlinks require host permissions.'); return; }
    throw error;
  }
  await f.store.save();
  assert.equal(f.writes(), 1); assert.equal((await lstat(f.store.file)).isSymbolicLink(), false);
  assert.equal(await readFile(retained, 'utf8'), original);
});

test('a cache-read error falls back to an atomic write', async t => {
  const f = await fixture(t), originalLstat = fs.promises.lstat;
  let fail = true;
  t.mock.method(fs.promises, 'lstat', (...args) => {
    if (fail && args[0] === f.store.file) { fail = false; return Promise.reject(Object.assign(new Error('synthetic stat failure'), { code: 'EACCES' })); }
    return originalLstat(...args);
  }); syncBuiltinESMExports();
  await f.store.save(); assert.equal(f.writes(), 1); assert.equal((await f.disk()).settings.petName, 'Alpha');
});

test('failure to cache after replacement never rejects a durable save or skips commit', async t => {
  const f = await fixture(t), originalLstat = fs.promises.lstat, organization = f.store.organizationPersistence, originalCommit = organization.commit;
  let fail = true, committed = 0;
  organization.commit = (...args) => { committed++; return originalCommit(...args); };
  t.mock.method(fs.promises, 'lstat', (...args) => {
    if (fail && args[0] === f.store.file) { fail = false; return Promise.reject(new Error('synthetic post-write stat failure')); }
    return originalLstat(...args);
  }); syncBuiltinESMExports();
  f.store.state.settings.petName = 'Changed'; await f.store.save();
  assert.equal(committed, 1); assert.equal((await f.disk()).settings.petName, 'Changed');
  await f.store.save(); assert.equal(f.writes(), 2);
  await f.store.save(); assert.equal(f.writes(), 2);
});

test('a failed replacement invalidates the cache even after restoring previous state', async t => {
  const f = await fixture(t), renameWithCounter = fs.promises.rename;
  let fail = true;
  t.mock.method(fs.promises, 'rename', (...args) => {
    if (fail && args[1] === f.store.file) { fail = false; return Promise.reject(new Error('synthetic rename failure')); }
    return renameWithCounter(...args);
  }); syncBuiltinESMExports();
  f.store.state.settings.petName = 'Changed'; await assert.rejects(f.store.save(), /synthetic rename failure/);
  assert.equal((await f.disk()).settings.petName, 'Alpha');
  f.store.state.settings.petName = 'Alpha'; await f.store.save(); assert.equal(f.writes(), 1);
});

test('external replacement during the post-write probe is never cached as our content', async t => {
  const f = await fixture(t), renameWithCounter = fs.promises.rename;
  let replace = true;
  t.mock.method(fs.promises, 'rename', async (...args) => {
    const result = await renameWithCounter(...args);
    if (replace && args[1] === f.store.file) {
      replace = false;
      const external = path.join(f.directory, 'external.json'), raw = await readFile(f.store.file, 'utf8');
      await writeFile(external, raw.replace('"Changed"', '"Foreign"'));
      await f.originalRename(external, f.store.file);
    }
    return result;
  }); syncBuiltinESMExports();
  f.store.state.settings.petName = 'Changed'; await f.store.save();
  assert.equal((await f.disk()).settings.petName, 'Foreign');
  await f.store.save(); assert.equal(f.writes(), 2); assert.equal((await f.disk()).settings.petName, 'Changed');
});
