import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPetServer } from '../server/app.mjs';
import { JsonStore } from '../server/store.mjs';
import { createNotificationService } from '../server/notifications.mjs';
import { listenFixture } from './helpers/loopback.mjs';

const password = randomUUID();
async function temporaryDirectory(t, close = async () => {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-assistant-default-host-'));
  t.after(async () => {
    await close();
    assert.equal(path.dirname(directory), tmpdir());
    assert.ok(path.basename(directory).startsWith('petpal-assistant-default-host-'));
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

async function fixture(t) {
  let app;
  const directory = await temporaryDirectory(t, async () => { if (app) await app.close(); }), bootstrap = `fixture-bootstrap-${randomUUID()}`;
  const calls = [];
  const codex = { async status() { return { available: true, authenticated: true }; }, async run(args) { calls.push(args); throw new Error('Setting a preference must not run Codex'); }, async close() {} };
  async function start() { app = await createPetServer({ dataDir: directory, token: bootstrap, codex }); await listenFixture(app.server); }
  await start();
  const request = async (route, { token = bootstrap, method = 'GET', body } = {}) => {
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}/api${route}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  };
  const login = async username => {
    const result = await request('/auth/login', { token: '', method: 'POST', body: { username, password } });
    assert.equal(result.status, 200); return result.data.token;
  };
  const member = async (username, agentAccess = 'full') => {
    const result = await request('/admin/users', { method: 'POST', body: { username, password, agentAccess } });
    assert.equal(result.status, 201); return { user: result.data.user, token: await login(username), username };
  };
  const register = async (token = bootstrap) => {
    const result = await request('/agent/executors/register', { token, method: 'POST', body: { deviceId: randomUUID(), name: 'Default target fixture PC', platform: 'win32', arch: 'x64' } });
    assert.equal(result.status, 200); return result.data;
  };
  const patch = (chatAssistantHostId, token = bootstrap, extra = {}) => request('/settings', { token, method: 'PATCH', body: { ...extra, chatAssistantHostId } });
  const settings = async token => { const result = await request('/state', { token }); assert.equal(result.status, 200); return result.data.settings; };
  const restart = async mutate => {
    await app.close();
    if (mutate) { const file = path.join(directory, 'state.json'), state = JSON.parse(await readFile(file, 'utf8')); mutate(state); await writeFile(file, JSON.stringify(state)); }
    await start();
  };
  return { directory, request, login, member, register, patch, settings, restart, calls };
}

test('new and legacy owner/member profiles get an unset default without changing existing settings', async t => {
  const f = await fixture(t), alice = await f.member('migration-alice');
  assert.equal((await f.settings()).chatAssistantHostId, null);
  assert.equal((await f.settings(alice.token)).chatAssistantHostId, null);
  await f.request('/settings', { method: 'PATCH', body: { petName: 'Owner companion' } });
  await f.request('/settings', { token: alice.token, method: 'PATCH', body: { petName: 'Alice companion' } });
  await f.restart(state => {
    delete state.settings.chatAssistantHostId;
    delete state.users.find(user => user.id === alice.user.id).settings.chatAssistantHostId;
  });
  assert.deepEqual([(await f.settings()).chatAssistantHostId, (await f.settings(alice.token)).chatAssistantHostId], [null, null]);
  assert.equal((await f.settings()).petName, 'Owner companion');
  assert.equal((await f.settings(alice.token)).petName, 'Alice companion');
});

test('default targets are account scoped, visible to a second session and durable across restart', async t => {
  const f = await fixture(t), alice = await f.member('scope-alice'), bob = await f.member('scope-bob');
  const ownerPC = await f.register(), alicePC = await f.register(alice.token);
  assert.equal((await f.patch(ownerPC.hostId)).status, 200);
  assert.equal((await f.patch(alicePC.hostId, alice.token)).status, 200);
  assert.equal((await f.patch('central', bob.token)).status, 200);
  const secondSession = await f.login(alice.username);
  assert.equal((await f.settings(secondSession)).chatAssistantHostId, alicePC.hostId);
  await f.restart();
  assert.equal((await f.settings()).chatAssistantHostId, ownerPC.hostId);
  assert.equal((await f.settings(alice.token)).chatAssistantHostId, alicePC.hostId);
  assert.equal((await f.settings(secondSession)).chatAssistantHostId, alicePC.hostId);
  assert.equal((await f.settings(bob.token)).chatAssistantHostId, 'central');
  assert.deepEqual(f.calls, []);
  const state = (await f.request('/state', { token: alice.token })).data;
  assert.deepEqual(state.conversations, []);
  assert.equal(Object.hasOwn(state.settings, 'enabled'), false);
  assert.equal(Object.hasOwn(state.settings, 'permissions'), false);
});

test('foreign and unregistered targets cannot replace a valid default or mutate other patch fields', async t => {
  const f = await fixture(t), alice = await f.member('ownership-alice'), bob = await f.member('ownership-bob');
  const alicePC = await f.register(alice.token), bobPC = await f.register(bob.token), ownerPC = await f.register();
  assert.equal((await f.patch(alicePC.hostId, alice.token)).status, 200);
  const before = await f.settings(alice.token);
  for (const id of [bobPC.hostId, ownerPC.hostId, randomUUID()]) {
    const result = await f.patch(id, alice.token, { petName: 'Must not save' });
    assert.equal(result.status, 404);
    assert.deepEqual(await f.settings(alice.token), before);
  }
  assert.equal((await f.patch(alicePC.hostId)).status, 404, 'owner cannot select another account computer');
});

test('malformed default host IDs are rejected without coercion', async t => {
  const f = await fixture(t);
  assert.equal((await f.patch('central')).status, 200);
  const before = await f.settings();
  for (const value of [false, true, 0, 1, [], {}, ' ', ' central', 'central ', 'central\n', 'unknown-host', randomUUID().toUpperCase(), 'a'.repeat(200)]) {
    assert.equal((await f.patch(value)).status, 400, JSON.stringify(value));
    assert.deepEqual(await f.settings(), before);
  }
});

test('a registered offline target remains saved and never falls back to the online central host', async t => {
  const f = await fixture(t), alice = await f.member('offline-alice'), pc = await f.register(alice.token);
  assert.equal((await f.request(`/agent/executors/${pc.connectionId}`, { token: alice.token, method: 'DELETE' })).status, 200);
  const hosts = (await f.request('/agent/hosts', { token: alice.token })).data.hosts;
  assert.equal(hosts.find(host => host.id === pc.hostId).online, false);
  assert.equal(hosts.find(host => host.id === 'central').online, true);
  assert.equal((await f.patch(pc.hostId, alice.token)).status, 200);
  await f.restart();
  assert.equal((await f.settings(alice.token)).chatAssistantHostId, pc.hostId);
  assert.deepEqual(f.calls, []);
});

test('null and empty strings clear only the authenticated account default, while unauthenticated writes fail', async t => {
  const f = await fixture(t), alice = await f.member('clear-alice');
  assert.equal((await f.patch('central')).status, 200);
  for (const empty of [null, '']) {
    assert.equal((await f.patch('central', alice.token)).status, 200);
    const result = await f.patch(empty, alice.token);
    assert.equal(result.status, 200); assert.equal(result.data.chatAssistantHostId, null);
    assert.equal((await f.settings()).chatAssistantHostId, 'central');
  }
  assert.equal((await f.patch(null, '')).status, 401);
  assert.equal((await f.settings()).chatAssistantHostId, 'central');
});

test('accounts without Agent access cannot set a default, but may clear a preference after authorization is revoked', async t => {
  const f = await fixture(t), denied = await f.member('denied-alice', 'none');
  assert.equal((await f.patch('central', denied.token)).status, 403);
  assert.equal((await f.settings(denied.token)).chatAssistantHostId, null);
  for (const empty of [null, '']) assert.equal((await f.patch(empty, denied.token)).status, 200);
  const alice = await f.member('revoked-alice'), pc = await f.register(alice.token);
  assert.equal((await f.patch(pc.hostId, alice.token)).status, 200);
  assert.equal((await f.request(`/admin/users/${alice.user.id}`, { method: 'PATCH', body: { agentAccess: 'none' } })).status, 200);
  const replacementSession = await f.login(alice.username);
  assert.equal((await f.settings(replacementSession)).chatAssistantHostId, pc.hostId);
  assert.equal((await f.patch(pc.hostId, replacementSession)).status, 403);
  assert.equal((await f.patch(null, replacementSession)).status, 200);
  assert.equal((await f.settings(replacementSession)).chatAssistantHostId, null);
  assert.deepEqual(f.calls, []);
});

test('stored malformed preferences fail closed without replacing the existing state file', async t => {
  const directory = await temporaryDirectory(t), store = await new JsonStore(directory).init();
  for (const value of [false, 1, [], {}, '', 'central ', 'invalid', randomUUID().toUpperCase()]) {
    store.state.settings.chatAssistantHostId = value; await writeFile(store.file, JSON.stringify(store.state));
    const before = await readFile(store.file, 'utf8');
    await assert.rejects(new JsonStore(directory).init(), /默认执行电脑格式无效/);
    assert.equal(await readFile(store.file, 'utf8'), before);
  }
});

test('stored preferences require a registered host belonging to the profile owner', async t => {
  const directory = await temporaryDirectory(t), store = await new JsonStore(directory).init();
  store.state.settings.chatAssistantHostId = randomUUID(); await writeFile(store.file, JSON.stringify(store.state));
  await assert.rejects(new JsonStore(directory).init(), /默认执行电脑归属无效/);
  store.state.settings.chatAssistantHostId = 'central'; await writeFile(store.file, JSON.stringify(store.state));
  assert.equal((await new JsonStore(directory).init()).state.settings.chatAssistantHostId, 'central');
});

test('HTTP save failures never expose an uncommitted target through settings or a subsequent state read', async t => {
  const f = await fixture(t), pc = await f.register();
  assert.equal((await f.patch('central')).status, 200);
  const original = path.join(f.directory, 'state.json'), backup = path.join(f.directory, 'fixture-state-before-failure.json');
  assert.equal(path.dirname(original), f.directory); assert.equal(path.dirname(backup), f.directory);
  await rename(original, backup); await mkdir(original);
  try {
    for (const id of [pc.hostId, null, pc.hostId]) {
      assert.equal((await f.patch(id)).status, 500);
      assert.equal((await f.settings()).chatAssistantHostId, 'central');
      assert.equal(JSON.parse(await readFile(backup, 'utf8')).settings.chatAssistantHostId, 'central');
    }
  } finally { await rmdir(original); await rename(backup, original); }
  assert.equal((await f.patch(pc.hostId)).status, 200);
  await f.restart();
  assert.equal((await f.settings()).chatAssistantHostId, pc.hostId);
  assert.deepEqual(f.calls, []);
});

test('an unrelated save captured before the default commits merges the latest durable default at queue execution', async t => {
  const directory = await temporaryDirectory(t), store = await new JsonStore(directory).init();
  let release; store.queue = new Promise(resolve => { release = resolve; });
  const explicit = store.save({ chatAssistantDefaultHost: { userId: store.state.ownerId, hostId: 'central' } });
  store.state.settings.petName = 'Concurrent companion';
  const unrelated = store.save();
  assert.equal(store.state.settings.chatAssistantHostId, null);
  release(); await Promise.all([explicit, unrelated]);
  const persisted = JSON.parse(await readFile(store.file, 'utf8'));
  assert.equal(persisted.settings.chatAssistantHostId, 'central');
  assert.equal(persisted.settings.petName, 'Concurrent companion');
  assert.equal(store.state.settings.chatAssistantHostId, 'central');
  const clear = store.save({ chatAssistantDefaultHost: { userId: store.state.ownerId, hostId: null } }), laterOrdinary = store.save();
  await Promise.all([clear, laterOrdinary]);
  assert.equal(JSON.parse(await readFile(store.file, 'utf8')).settings.chatAssistantHostId, null);
  assert.equal(store.state.settings.chatAssistantHostId, null);
});

test('multiple queued replacement failures retain the last committed default and do not leak into a later ordinary save', async t => {
  const directory = await temporaryDirectory(t), store = await new JsonStore(directory).init();
  await store.save({ chatAssistantDefaultHost: { userId: store.state.ownerId, hostId: 'central' } });
  const original = store.file, failureTarget = path.join(directory, 'replacement-is-a-directory'); await mkdir(failureTarget);
  store.file = failureTarget;
  try {
    const first = store.save({ chatAssistantDefaultHost: { userId: store.state.ownerId, hostId: null } });
    const second = store.save({ chatAssistantDefaultHost: { userId: store.state.ownerId, hostId: 'central' } });
    const third = store.save({ chatAssistantDefaultHost: { userId: store.state.ownerId, hostId: null } });
    assert.deepEqual((await Promise.allSettled([first, second, third])).map(result => result.status), ['rejected', 'rejected', 'rejected']);
    assert.equal(store.state.settings.chatAssistantHostId, 'central');
    assert.equal(JSON.parse(await readFile(original, 'utf8')).settings.chatAssistantHostId, 'central');
  } finally { store.file = original; }
  await store.save();
  assert.equal((await new JsonStore(directory).init()).state.settings.chatAssistantHostId, 'central');
});

test('notification registration and an older ordinary snapshot preserve the committed default and notification data', async t => {
  const directory = await temporaryDirectory(t), store = await new JsonStore(directory).init();
  const notifications = createNotificationService({ store, authorize: () => ({ sourceCreatedAt: 0 }) });
  t.after(() => notifications.close());
  let release; store.queue = new Promise(resolve => { release = resolve; });
  const explicit = store.save({ chatAssistantDefaultHost: { userId: store.state.ownerId, hostId: 'central' } });
  const registration = notifications.register({ userId: store.state.ownerId, sessionHash: 'f'.repeat(64), bootstrap: true }, { deviceId: randomUUID() });
  const unrelated = store.save();
  release(); const [, device] = await Promise.all([explicit, registration, unrelated]);
  const persisted = JSON.parse(await readFile(store.file, 'utf8'));
  assert.equal(persisted.settings.chatAssistantHostId, 'central');
  assert.equal(persisted.notifications.devices.length, 1);
  assert.equal(persisted.notifications.devices[0].deviceId, device.deviceId);
  assert.equal(store.state.settings.chatAssistantHostId, 'central');
  assert.equal(store.state.notifications.devices.length, 1);
});

test('queued default operations recheck authorization before writing a preference', async t => {
  const directory = await temporaryDirectory(t), store = await new JsonStore(directory).init();
  let release; store.queue = new Promise(resolve => { release = resolve; });
  let authorized = true;
  const explicit = store.save({ chatAssistantDefaultHost: { userId: store.state.ownerId, hostId: 'central', authorize: () => { if (!authorized) throw Object.assign(new Error('Fixture authorization revoked'), { status: 401 }); } } });
  const unrelated = store.save();
  authorized = false; release();
  await assert.rejects(explicit, { status: 401 }); await unrelated;
  assert.equal(store.state.settings.chatAssistantHostId, null);
  assert.equal(JSON.parse(await readFile(store.file, 'utf8')).settings.chatAssistantHostId, null);
});
