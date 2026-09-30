import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { listenFixture } from './helpers/loopback.mjs';
import { mountMusicMcpRoutes } from '../server/music-mcp-routes.mjs';
import { MusicMcpManager } from '../server/music-mcp.mjs';
import { createPetServer } from '../server/app.mjs';
import { JsonStore, defaultSettings } from '../server/store.mjs';
import { newSession } from '../server/auth.mjs';
import { defaultVoiceSettings } from '../server/voice.mjs';

const prefix = '/api/desktop-tools/music-mcp';
const ownerToken = 'music-routes-fixture-owner';
const memberToken = 'music-routes-fixture-member';
const credential = 'isolated-qq-credential-must-never-be-returned';
const failure = (status, message) => Object.assign(new Error(message), { status });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

async function managerFixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'petpal-music-routes-'));
  let spawned = 0;
  const manager = new MusicMcpManager({ dataDir: directory, scope: 'route-fixture', spawn: () => { spawned++; throw new Error('route fixtures must never run Python'); } });
  const cleanup = new Set(), beforeClose = new Set();
  t.after(async () => {
    for (const release of cleanup) release();
    for (const close of beforeClose) await close();
    await manager.close();
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('petpal-music-routes-'));
    await rm(directory, { recursive: true, force: true });
  });
  return { manager, directory, cleanup, beforeClose, spawned: () => spawned };
}

async function routeFixture(t, { missingManager = false } = {}) {
  const f = await managerFixture(t);
  const app = express(), probes = new Set();
  const owner = { id: 'route-owner-id', role: 'owner' }, member = { id: 'route-member-id', role: 'member' };
  const sessions = new Map([[ownerToken, owner], [memberToken, member]]);
  const calls = { config: 0, status: 0, configure: 0, actions: [] };
  for (const method of ['config', 'status', 'configure']) {
    const original = f.manager[method].bind(f.manager);
    f.manager[method] = async (...args) => { calls[method]++; return original(...args); };
  }
  for (const action of ['prepare', 'connect', 'disconnect']) f.manager[action] = async (value, { signal } = {}) => { calls.actions.push({ action, value, signal }); return { ok: true }; };
  app.use(express.json({ strict: true }));
  app.use('/api', (req, res, next) => {
    const token = /^Bearer (.*)$/.exec(req.headers.authorization ?? '')?.[1], user = sessions.get(token);
    if (!user) return res.status(401).json({ error: 'fixture login required' });
    req.user = user; req.authToken = token; req.sessionHash = `${user.id}:fixture-session`; next();
  });
  const requireCurrentAuth = req => { if (sessions.get(req.authToken) !== req.user) throw failure(401, 'fixture login revoked'); };
  const requireAdmin = user => { if (user.role !== 'owner') throw failure(403, 'fixture owner required'); };
  app.post('/api/auth/logout', async (req, res) => {
    sessions.delete(req.authToken);
    const stopped = [...probes].filter(probe => probe.userId === req.user.id && probe.sessionHash === req.sessionHash);
    for (const probe of stopped) probe.controller.abort(new DOMException('fixture logout', 'AbortError'));
    await Promise.all(stopped.map(probe => probe.done));
    res.json({ ok: true });
  });
  mountMusicMcpRoutes({ app, manager: missingManager ? null : f.manager, requireAdmin, requireCurrentAuth, probes });
  app.use((req, res) => res.status(404).json({ error: 'fixture route missing' }));
  app.use((error, req, res, next) => { if (!res.destroyed) res.status(error.status ?? 500).json({ error: error.message }); });
  const server = http.createServer(app);
  await listenFixture(server);
  f.beforeClose.add(async () => { for (const probe of probes) probe.controller.abort(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (route, { token = ownerToken, method = 'GET', body, signal } = {}) => fetch(`${base}${route}`, {
    method, signal, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { ...f, probes, calls, sessions, request };
}

function holdAction(f, action) {
  const started = deferred(), aborted = deferred();
  f.manager[action] = (value, { signal }) => {
    f.calls.actions.push({ action, value, signal });
    return new Promise((resolve, reject) => {
      const stop = () => { aborted.resolve(); reject(signal.reason ?? new DOMException('fixture stopped', 'AbortError')); };
      signal.addEventListener('abort', stop, { once: true });
      f.cleanup.add(() => { signal.removeEventListener('abort', stop); resolve({ ok: true }); });
      started.resolve();
    });
  };
  return { started: started.promise, aborted: aborted.promise };
}

test('music MCP routes reject anonymous and member access before reading state or starting Python', async t => {
  const f = await routeFixture(t);
  const routes = [[`${prefix}/config`, 'GET'], [`${prefix}/status`, 'GET'], [`${prefix}/config`, 'PATCH', { revision: 'untrusted' }],
    ...['prepare', 'connect', 'disconnect'].map(action => [`${prefix}/${action}`, 'POST', { player: 'qqmusic' }])];
  for (const token of ['', memberToken]) for (const [route, method, body] of routes) {
    const response = await f.request(route, { token, method, body });
    assert.equal(response.status, token ? 403 : 401, `${method} ${route}`);
    assert.equal((await response.text()).includes(credential), false);
  }
  assert.deepEqual(f.calls, { config: 0, status: 0, configure: 0, actions: [] });
  assert.equal(f.probes.size, 0); assert.equal(f.spawned(), 0);
});

test('an authorized owner receives a clear unavailable status when no music MCP manager exists', async t => {
  const f = await routeFixture(t, { missingManager: true });
  const response = await f.request(`${prefix}/status`);
  assert.equal(response.status, 501); assert.match((await response.json()).error, /未提供音乐MCP管理/);
  assert.equal(f.calls.status, 0); assert.equal(f.spawned(), 0);
});

test('owner config and status expose credential presence only and never return its contents', async t => {
  const f = await routeFixture(t), profile = path.join(f.manager.profileRoot, 'qqmusic');
  await mkdir(profile, { recursive: true }); await writeFile(path.join(profile, 'credential.json'), JSON.stringify({ secret: credential }));
  const configResponse = await f.request(`${prefix}/config`); assert.equal(configResponse.status, 200);
  const config = await configResponse.json(); assert.equal(typeof config.revision, 'string'); assert.equal(config.qqmusicEnabled, false);
  const statusResponse = await f.request(`${prefix}/status`); assert.equal(statusResponse.status, 200);
  const status = await statusResponse.json(), qqmusic = status.servers.find(value => value.id === 'qqmusic');
  assert.equal(qqmusic.credentialConfigured, true); assert.equal(qqmusic.connected, false);
  assert.equal(JSON.stringify({ config, status }).includes(credential), false);
  assert.equal(qqmusic.credential, undefined); assert.equal(qqmusic.secret, undefined);
  const rawResponse = await f.request(`${prefix}/credential`); assert.equal(rawResponse.status, 404); assert.equal((await rawResponse.text()).includes(credential), false);
  assert.deepEqual(JSON.parse(await readFile(path.join(profile, 'credential.json'), 'utf8')), { secret: credential });
  assert.equal(f.spawned(), 0);
});

test('owner configuration keeps real manager CAS and rejects credential or arbitrary runtime fields', async t => {
  const f = await routeFixture(t), initial = await (await f.request(`${prefix}/config`)).json();
  const savedResponse = await f.request(`${prefix}/config`, { method: 'PATCH', body: { revision: initial.revision, qqmusicEnabled: true } });
  assert.equal(savedResponse.status, 200); const saved = await savedResponse.json(); assert.equal(saved.qqmusicEnabled, true); assert.notEqual(saved.revision, initial.revision);
  const stale = await f.request(`${prefix}/config`, { method: 'PATCH', body: { revision: initial.revision, neteaseEnabled: true } });
  assert.equal(stale.status, 409); await stale.arrayBuffer();
  for (const body of [{ qqmusicEnabled: false }, { revision: saved.revision, credential }, { revision: saved.revision, command: 'untrusted shell' }, { revision: saved.revision, cdpPort: 80 }]) {
    const response = await f.request(`${prefix}/config`, { method: 'PATCH', body }); assert.equal(response.status, 400); assert.equal((await response.text()).includes(credential), false);
  }
  assert.deepEqual(await (await f.request(`${prefix}/config`)).json(), saved); assert.equal(f.spawned(), 0);
});

test('prepare, connect and disconnect accept only a player and return public status with tracked cancellation', async t => {
  const f = await routeFixture(t);
  for (const action of ['prepare', 'connect', 'disconnect']) for (const player of ['netease', 'qqmusic']) {
    f.manager[action] = async (value, { signal }) => {
      assert.equal(f.probes.size, 1); const [probe] = f.probes;
      assert.equal(probe.mode, 'music-mcp'); assert.equal(probe.userId, 'route-owner-id'); assert.equal(probe.sessionHash, 'route-owner-id:fixture-session');
      assert.equal(probe.controller.signal, signal); assert.equal(signal.aborted, false);
      f.calls.actions.push({ action, value, signal });
      return { privateResult: credential };
    };
    const response = await f.request(`${prefix}/${action}`, { method: 'POST', body: { player } }); assert.equal(response.status, 200);
    const status = await response.json(); assert.ok(Array.isArray(status.servers)); assert.equal(JSON.stringify(status).includes(credential), false);
    assert.deepEqual(f.calls.actions.at(-1).value, action === 'prepare' ? { player } : player); assert.equal(f.probes.size, 0);
  }
  assert.equal(f.calls.actions.length, 6); assert.equal(f.spawned(), 0);
});

test('player operations reject unsupported names, extra credentials and shell fields before dispatch', async t => {
  const f = await routeFixture(t);
  const invalid = [{}, [], null, { player: 'other' }, { player: 'QQMUSIC' }, { player: 1 }, { player: 'qqmusic', credential },
    { player: 'netease', command: 'untrusted' }, { player: 'qqmusic', arguments: {} }, { player: 'qqmusic', requirements: ['untrusted'] }];
  for (const action of ['prepare', 'connect', 'disconnect']) for (const body of invalid) {
    const response = await f.request(`${prefix}/${action}`, { method: 'POST', body }); assert.equal(response.status, 400, `${action}: ${JSON.stringify(body)}`);
    assert.equal((await response.text()).includes(credential), false);
  }
  assert.equal(f.calls.actions.length, 0); assert.equal(f.probes.size, 0); assert.equal(f.spawned(), 0);
});

test('config and status recheck authorization after asynchronous manager reads', { timeout: 5000 }, async t => {
  for (const method of ['config', 'status']) await t.test(method, async child => {
    const f = await routeFixture(child), started = deferred(), release = deferred(); f.cleanup.add(() => release.resolve());
    const original = f.manager[method].bind(f.manager);
    f.manager[method] = async () => { const value = await original(); started.resolve(); await release.promise; return value; };
    const reading = f.request(`${prefix}/${method}`); await started.promise; f.sessions.delete(ownerToken); release.resolve();
    const response = await reading; assert.equal(response.status, 401); const body = await response.json();
    assert.equal(body.config, undefined); assert.equal(body.servers, undefined); assert.equal(body.revision, undefined);
  });
});

test('logout aborts every pending player operation and waits for probe cleanup', { timeout: 10000 }, async t => {
  for (const action of ['prepare', 'connect', 'disconnect']) await t.test(action, async child => {
    const f = await routeFixture(child), held = holdAction(f, action);
    const running = f.request(`${prefix}/${action}`, { method: 'POST', body: { player: 'qqmusic' } }); await held.started;
    const [probe] = f.probes; const loggingOut = f.request('/api/auth/logout', { method: 'POST', body: {} }); await held.aborted;
    const response = await running; assert.notEqual(response.status, 200); assert.deepEqual(await response.json(), { error: '音乐MCP操作已停止。' });
    assert.equal((await loggingOut).status, 200); await probe.done;
    assert.equal(f.probes.size, 0); assert.equal(f.calls.status, 0); assert.equal(f.calls.actions[0].signal.aborted, true);
    assert.equal((await f.request(`${prefix}/status`)).status, 401);
  });
});

test('a closed HTTP request aborts its player operation and removes the probe', { timeout: 5000 }, async t => {
  const f = await routeFixture(t), held = holdAction(f, 'prepare'), controller = new AbortController();
  const running = f.request(`${prefix}/prepare`, { method: 'POST', body: { player: 'netease' }, signal: controller.signal });
  const rejected = assert.rejects(running, { name: 'AbortError' }); await held.started; const [probe] = f.probes;
  controller.abort(); await rejected; await held.aborted; await probe.done;
  assert.equal(f.probes.size, 0); assert.equal(f.calls.status, 0); assert.equal(f.calls.actions[0].signal.aborted, true);
});

test('a disconnect that finishes after logout cannot perform a follow-up status read', { timeout: 5000 }, async t => {
  const f = await routeFixture(t), started = deferred(), release = deferred(); f.cleanup.add(() => release.resolve());
  f.manager.disconnect = async () => { started.resolve(); await release.promise; return { ok: true }; };
  const running = f.request(`${prefix}/disconnect`, { method: 'POST', body: { player: 'qqmusic' } }); await started.promise;
  const [probe] = f.probes, aborted = deferred(); probe.controller.signal.addEventListener('abort', () => aborted.resolve(), { once: true });
  const loggingOut = f.request('/api/auth/logout', { method: 'POST', body: {} }); await aborted.promise; release.resolve();
  const response = await running; assert.notEqual(response.status, 200); assert.deepEqual(await response.json(), { error: '音乐MCP操作已停止。' });
  assert.equal((await loggingOut).status, 200); await probe.done; assert.equal(f.probes.size, 0); assert.equal(f.calls.status, 0);
});

test('logout during the final status read cannot publish success or private configuration', { timeout: 5000 }, async t => {
  const f = await routeFixture(t), started = deferred(), release = deferred(); f.cleanup.add(() => release.resolve());
  const originalStatus = f.manager.status.bind(f.manager);
  f.manager.status = async () => { const status = await originalStatus(); started.resolve(); await release.promise; return status; };
  const running = f.request(`${prefix}/connect`, { method: 'POST', body: { player: 'qqmusic' } }); await started.promise;
  const [probe] = f.probes, aborted = deferred(); probe.controller.signal.addEventListener('abort', () => aborted.resolve(), { once: true });
  const loggingOut = f.request('/api/auth/logout', { method: 'POST', body: {} }); await aborted.promise; release.resolve();
  const response = await running; assert.notEqual(response.status, 200); const body = await response.json();
  assert.equal(body.config, undefined); assert.equal(body.servers, undefined); assert.equal((await loggingOut).status, 200);
  await probe.done; assert.equal(f.probes.size, 0);
});

test('createPetServer mounts music MCP behind real account authorization and revokes probes on logout', { timeout: 10000 }, async t => {
  const f = await managerFixture(t), store = await new JsonStore(f.directory).init(), memberId = randomUUID();
  const ownerSession = newSession(store.state.ownerId), memberSession = newSession(memberId);
  store.state.users.push({ id: memberId, username: 'music-fixture-member', displayName: 'Music route fixture member', role: 'member', disabled: false,
    providerIds: [], password: null, settings: defaultSettings(), voice: defaultVoiceSettings(), createdAt: new Date().toISOString() });
  store.state.sessions.push(ownerSession.session, memberSession.session); await store.save();
  const held = holdAction({ ...f, calls: { actions: [] } }, 'prepare');
  let statusCalls = 0; const originalStatus = f.manager.status.bind(f.manager); f.manager.status = async () => { statusCalls++; return originalStatus(); };
  const service = await createPetServer({ dataDir: f.directory, token: 'music-mount-fixture-bootstrap', codex: { status: async () => ({ available: false }), close: async () => {} },
    desktopTools: { musicMcp: f.manager, status: async () => ({ busy: false }), close: async () => {} } });
  await listenFixture(service.server); f.beforeClose.add(() => service.close());
  const base = `http://127.0.0.1:${service.server.address().port}`;
  const request = (route, { token = ownerSession.token, method = 'GET', body } = {}) => fetch(`${base}${route}`, {
    method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const guardedRoutes = [[`${prefix}/config`, 'GET'], [`${prefix}/status`, 'GET'], [`${prefix}/config`, 'PATCH', { revision: 'untrusted' }],
    ...['prepare', 'connect', 'disconnect'].map(action => [`${prefix}/${action}`, 'POST', { player: 'qqmusic' }])];
  for (const [token, status] of [['', 401], [memberSession.token, 403]]) for (const [route, method, body] of guardedRoutes) {
    const response = await request(route, { token, method, body }); assert.equal(response.status, status); await response.arrayBuffer();
  }
  const config = await request(`${prefix}/config`); assert.equal(config.status, 200); assert.equal(typeof (await config.json()).revision, 'string');
  const running = request(`${prefix}/prepare`, { method: 'POST', body: { player: 'qqmusic' } }); await held.started;
  const loggingOut = request('/api/auth/logout', { method: 'POST', body: {} }); await held.aborted;
  const stopped = await running; assert.notEqual(stopped.status, 200); assert.deepEqual(await stopped.json(), { error: '音乐MCP操作已停止。' });
  const loggedOut = await loggingOut; assert.equal(loggedOut.status, 200); assert.equal((await loggedOut.json()).ok, true);
  const revoked = await request(`${prefix}/status`); assert.equal(revoked.status, 401); await revoked.arrayBuffer();
  assert.equal(statusCalls, 0); assert.equal(f.spawned(), 0);
  assert.equal(JSON.parse(await readFile(path.join(f.directory, 'state.json'), 'utf8')).sessions.some(session => session.tokenHash === ownerSession.session.tokenHash), false);
});
