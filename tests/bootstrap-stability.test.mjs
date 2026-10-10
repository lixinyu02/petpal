import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { createPetServer } from '../server/app.mjs';
import { JsonStore, defaultSettings } from '../server/store.mjs';
import { defaultVoiceSettings } from '../server/voice.mjs';
import { defaultCodexConfig } from '../server/codex-config.mjs';
import { hashPassword, newSession } from '../server/auth.mjs';
import { listenFixture } from './helpers/loopback.mjs';

const token = 'isolated-bootstrap-stability-owner';
const stamp = () => new Date().toISOString();
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function until(check) { for (let i = 0; i < 200; i++) { if (await check()) return; await delay(5); } assert.fail('Fixture did not reach its barrier'); }
const mockBridge = () => ({ status: async () => ({ available: true, authenticated: true, running: true, workspaceRoot: '/private-fixture-workspace' }), close: async () => {} });

// Load the unchanged production HTTP application with a gate at an imported
// dependency boundary. Only these imports are remapped; routes, authentication,
// store, shutdown, real scrypt and loopback provider streaming still execute.
async function gatedApp(overrides) {
  const key = `petpal-gate-${randomUUID()}`, appUrl = `${new URL('../server/app.mjs', import.meta.url).href}?fixture=${randomUUID()}`;
  const wrappers = new Map();
  for (const [specifier, functions] of Object.entries(overrides)) {
    const original = new URL(`../server/${specifier.slice(2)}`, import.meta.url).href;
    const imports = Object.keys(functions).map(name => `${name} as original_${name}`).join(',');
    const source = `export * from ${JSON.stringify(original)};import {${imports}} from ${JSON.stringify(original)};const gate=globalThis[${JSON.stringify(key)}][${JSON.stringify(specifier)}];\n` + Object.keys(functions).map(name => `export const ${name}=(...args)=>gate.${name}(original_${name},...args);`).join('\n');
    wrappers.set(specifier, `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  }
  globalThis[key] = overrides;
  const hooks = registerHooks({ resolve(specifier, context, next) { return next(context.parentURL === appUrl && wrappers.has(specifier) ? wrappers.get(specifier) : specifier, context); } });
  try { return (await import(appUrl)).createPetServer; }
  finally { hooks.deregister(); delete globalThis[key]; }
}

async function fixture(t, { create = createPetServer, codex = mockBridge(), codexFactory, seed, tools } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-bootstrap-stability-'));
  let app;
  t.after(async () => { await app?.close(); assert.ok(directory.startsWith(path.join(tmpdir(), 'petpal-bootstrap-stability-'))); await rm(directory, { recursive: true, force: true }); });
  const store = await new JsonStore(directory).init(), ownerId = store.state.ownerId;
  store.state.codexConfig = { ...defaultCodexConfig(), mode: 'api', baseUrl: 'https://fixture-agent.example/v1', model: 'fixture-agent', apiKey: 'private-fixture-agent-key' };
  const providers = ['assigned', 'private'].map(name => ({ id: randomUUID(), name, protocol: 'responses', baseUrl: 'https://fixture-agent.example/v1', model: name, reasoningEffort: '', apiKey: `private-key-${name}` }));
  store.state.providers = providers;
  store.state.conversations.push({ id: randomUUID(), userId: ownerId, mode: 'chat', title: 'owner-private-history', providerId: providers[0].id, messages: [{ id: randomUUID(), role: 'user', content: 'owner-private-body', status: 'complete', createdAt: stamp() }], createdAt: stamp(), updatedAt: stamp() });
  await seed?.({ store, ownerId, providers }); await store.save();
  app = await create({ dataDir: directory, token, codex, ...(codexFactory ? { codexFactory } : {}), desktopTools: tools ?? { specs: [], close: async () => {} }, automationOptions: { autoStart: false } });
  await listenFixture(app.server);
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const request = (route, { credential = token, method = 'GET', body } = {}) => fetch(`${base}/api${route}`, { method, signal: AbortSignal.timeout(5000), headers: { ...(credential ? { Authorization: `Bearer ${credential}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return { app, directory, ownerId, providers, base, request, disk: async () => JSON.parse(await readFile(path.join(directory, 'state.json'), 'utf8')) };
}

test('bootstrap and deferred history complete while real detailed Codex status is held; reads share only in-flight work', { timeout: 10000 }, async t => {
  const gate = deferred(); let calls = 0, requests = 0;
  const f = await fixture(t, { codex: { status: async () => { calls++; await gate.promise; return { available: true, running: true, authenticated: true }; }, close: async () => gate.resolve() } });
  f.app.server.on('request', req => { if (['/api/state', '/api/codex/status', '/api/agent/hosts'].includes(req.url)) requests++; });
  const detailed = ['/state', '/codex/status', '/agent/hosts'].map(route => f.request(route));
  await until(() => requests === 3); assert.equal(calls, 1);
  const boot = await f.request('/bootstrap').then(r => r.json()), history = await f.request('/state?runtime=deferred').then(r => r.json());
  assert.deepEqual(boot.conversations, []); assert.equal(history.conversations.length, 1); assert.equal(history.conversations[0].messages[0].content, 'owner-private-body');
  for (const value of [boot, history]) { assert.equal(value.codex.pending, true); assert.equal(value.codex.available, false); assert.equal(value.codex.running, false); assert.equal(value.codex.authenticated, false); assert.equal(value.codex.configured, true); assert.match(value.codex.message, /尚未检测/); assert.doesNotMatch(JSON.stringify(value), /private-fixture-agent-key|private-key-/); }
  assert.equal(calls, 1); gate.resolve();
  const responses = await Promise.all(detailed); assert.ok(responses.every(r => r.status === 200));
  const [state, status, hosts] = await Promise.all(responses.map(r => r.json()));
  assert.equal(state.codex.available, true); assert.equal(status.available, true); assert.equal(hosts.hosts[0].codex.available, true); assert.equal(calls, 1);
  assert.equal((await f.request('/codex/status').then(r => r.json())).available, true); assert.equal(calls, 2, 'Completed status is not cached');
});

test('bootstrap never refreshes tasks; deferred state keeps task refresh and history semantics', async t => {
  let refreshes = 0;
  const create = await gatedApp({ './chat-assistant.mjs': { createChatAssistant: (original, ...args) => { const manager = original(...args); return { ...manager, refresh: (...values) => { refreshes++; return manager.refresh(...values); } }; } } });
  const f = await fixture(t, { create, seed: ({ store }) => {
    store.state.conversations[0].assistantTasks = [{ id: randomUUID(), submissionId: randomUUID(), fingerprint: 'a'.repeat(64), codexRevision: store.state.codexConfig.revision, hostId: 'central', hostName: 'Central fixture', providerId: null, permissions: { access: 'read-only', approval: 'ask' }, attachmentIds: [], status: 'error', message: 'No dispatch occurred.', createdAt: stamp() }];
  } });
  assert.equal((await f.request('/bootstrap')).status, 200); assert.equal(refreshes, 0);
  const history = await f.request('/state?runtime=deferred'); assert.equal(history.status, 200); assert.equal(refreshes, 1); assert.equal((await history.json()).conversations[0].assistantTasks.length, 1);
});

test('bootstrap and state validate query modes, preserve auth and isolate member models/history', async t => {
  let memberSession, deniedSession, memberId, expiredSession;
  const f = await fixture(t, { seed: ({ store, providers }) => {
    const expired = newSession(store.state.ownerId); expired.session.expiresAt = Date.now() - 1000; store.state.sessions.push(expired.session); expiredSession = expired.token;
    for (const access of ['full', 'none']) {
      const id = randomUUID(), session = newSession(id), user = { id, username: access === 'full' ? 'member' : 'denied', displayName: access, role: 'member', agentAccess: access, disabled: false, providerIds: [providers[0].id], password: null, settings: defaultSettings(), voice: defaultVoiceSettings(), createdAt: stamp() };
      store.state.users.push(user); store.state.sessions.push(session.session);
      if (access === 'full') { memberId = id; memberSession = session.token; store.state.conversations.push({ id: randomUUID(), userId: id, mode: 'chat', title: 'member-history', providerId: providers[0].id, messages: [], createdAt: stamp(), updatedAt: stamp() }); }
      else deniedSession = session.token;
    }
  } });
  for (const route of ['/bootstrap', '/state?runtime=deferred']) for (const credential of ['', 'unknown', expiredSession]) assert.equal((await f.request(route, { credential })).status, 401);
  for (const route of ['/bootstrap?runtime=deferred', '/bootstrap?unknown=1', '/state?runtime=full', '/state?runtime=', '/state?runtime=deferred&runtime=deferred', '/state?unknown=1']) assert.equal((await f.request(route)).status, 400, route);
  const boot = await f.request('/bootstrap', { credential: memberSession }).then(r => r.json()), history = await f.request('/state?runtime=deferred', { credential: memberSession }).then(r => r.json());
  assert.equal(boot.user.id, memberId); assert.deepEqual(boot.providers.map(p => p.id), [f.providers[0].id]); assert.deepEqual(boot.codex.eligibleProviderIds, [f.providers[0].id]); assert.deepEqual(history.conversations.map(c => c.title), ['member-history']); assert.doesNotMatch(JSON.stringify({ boot, history }), /owner-private|private-fixture-workspace|private-key-/);
  const denied = await f.request('/bootstrap', { credential: deniedSession }).then(r => r.json()); assert.equal(denied.codex.disabled, true); assert.equal(denied.codex.available, false); assert.deepEqual(denied.codex.eligibleProviderIds, []); assert.equal((await f.request('/codex/status', { credential: deniedSession })).status, 403);
  assert.equal((await f.request(`/admin/users/${memberId}`, { method: 'PATCH', body: { disabled: true } })).status, 200);
  assert.equal((await f.request('/bootstrap', { credential: memberSession })).status, 401);
});

test('shared status is reshaped per identity and rejects revoked readers without exposing a shared owner result', async t => {
  const gate = deferred(); let calls = 0, memberSession, memberId;
  const f = await fixture(t, { codex: { status: async () => { calls++; await gate.promise; return { available: true, authenticated: true, workspaceRoot: '/private-fixture-workspace', pid: 12345 }; }, close: async () => gate.resolve() }, seed: ({ store, providers }) => {
    memberId = randomUUID(); const session = newSession(memberId); memberSession = session.token;
    store.state.users.push({ id: memberId, username: 'status-member', displayName: 'Member', role: 'member', agentAccess: 'full', disabled: false, providerIds: [providers[0].id], password: null, settings: defaultSettings(), voice: defaultVoiceSettings(), createdAt: stamp() }); store.state.sessions.push(session.session);
  } });
  let requests = 0; f.app.server.on('request', req => { if (req.url === '/api/codex/status') requests++; });
  const owner = f.request('/codex/status'), member = f.request('/codex/status', { credential: memberSession });
  await until(() => requests === 2); assert.equal(calls, 1);
  assert.equal((await f.request(`/admin/users/${memberId}`, { method: 'PATCH', body: { disabled: true } })).status, 200);
  gate.resolve(); assert.equal((await owner).status, 200); const rejected = await member; assert.equal(rejected.status, 401); assert.doesNotMatch(await rejected.text(), /private-fixture-workspace|12345/);
});

test('configuration switching rejects active shared readers and the next probe belongs to the replacement bridge', async t => {
  const gate = deferred(); let originalCalls = 0, replacements = 0;
  const f = await fixture(t, { codex: { status: async () => { originalCalls++; await gate.promise; return { available: true }; }, close: async () => gate.resolve() }, codexFactory: options => { replacements++; return { status: async () => ({ available: false, error: `replacement:${options.config.model}` }), close: async () => {} }; } });
  const probe = f.request('/codex/status'); await until(() => originalCalls === 1);
  const rejected = await f.request('/codex/config', { method: 'PATCH', body: { model: 'next-agent' } }); assert.equal(rejected.status, 409); assert.equal(replacements, 0);
  gate.resolve(); assert.equal((await probe).status, 200);
  assert.equal((await f.request('/codex/config', { method: 'PATCH', body: { model: 'next-agent' } })).status, 200); assert.equal(replacements, 1);
  const fresh = await f.request('/codex/status').then(r => r.json()); assert.equal(fresh.available, false); assert.match(fresh.error, /replacement:next-agent/); assert.equal(originalCalls, 1);
});

test('a failed shared status is released and a later detailed read can retry without affecting bootstrap', async t => {
  const gate = deferred(); let calls = 0;
  const f = await fixture(t, { codex: { status: async () => { if (++calls === 1) { await gate.promise; throw new Error('isolated status failure'); } return { available: true }; }, close: async () => gate.resolve() } });
  let requests = 0; f.app.server.on('request', req => { if (req.url === '/api/codex/status') requests++; });
  const first = f.request('/codex/status'), second = f.request('/codex/status'); await until(() => requests === 2);
  assert.equal((await f.request('/bootstrap')).status, 200); assert.equal(calls, 1); gate.resolve();
  assert.equal((await first).status, 500); assert.equal((await second).status, 500);
  assert.equal((await f.request('/codex/status').then(r => r.json())).available, true); assert.equal(calls, 2);
});

test('close retains shared status ownership until it settles and refuses late successful status', async t => {
  const gate = deferred(), closeEntered = deferred(); let calls = 0, closed = false;
  t.after(() => gate.resolve());
  const f = await fixture(t, { codex: { status: async () => { calls++; await gate.promise; return { available: true }; }, close: async () => closeEntered.resolve() } });
  const pending = f.request('/codex/status').catch(() => null); await until(() => calls === 1);
  const closing = f.app.close().then(() => { closed = true; }); await closeEntered.promise; await delay(20); assert.equal(closed, false);
  gate.resolve(); const response = await pending; if (response) { assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /"available":true/); }
  await closing; assert.equal(closed, true); assert.equal(calls, 1);
});

test('model connection-test shutdown waits for cancellation cleanup before releasing the service', { timeout: 10000 }, async t => {
  const upstreamSeen = deferred(), cancelled = deferred(), cleanup = deferred();
  t.after(() => cleanup.resolve());
  const upstream = http.createServer((_req, res) => { upstreamSeen.resolve(); res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write('data: {"choices":[{"delta":{"content":"partial fixture"}}]}\n\n'); });
  await listenFixture(upstream);
  t.after(async () => { upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)); });
  const create = await gatedApp({ './providers.mjs': { testProvider: async (original, ...args) => { try { return await original(...args); } finally { cancelled.resolve(args[1].aborted); await cleanup.promise; } } } });
  const f = await fixture(t, { create });
  const provider = await f.request('/providers', { method: 'POST', body: { name: 'loopback delayed model', protocol: 'chat-completions', baseUrl: `http://127.0.0.1:${upstream.address().port}/v1`, model: 'fixture', apiKey: '' } }).then(r => r.json());
  const testing = f.request(`/providers/${provider.id}/test`, { method: 'POST', body: {} }).catch(() => null); await upstreamSeen.promise;
  let closed = false; const closing = f.app.close().then(() => { closed = true; });
  assert.equal(await cancelled.promise, true); await delay(20); assert.equal(closed, false, 'Provider probe owns its async finally, not just its abort signal');
  cleanup.resolve(); const response = await testing; if (response) assert.notEqual((await response.json()).ok, true);
  await closing; assert.equal(closed, true);
});

test('login and administrator writes paused after real password verification cannot mutate after closing', { timeout: 15000 }, async t => {
  for (const operation of ['login', 'create-user']) await t.test(operation, async t => {
    const entered = deferred(), resume = deferred(), closeEntered = deferred(), closeResume = deferred();
    t.after(() => { resume.resolve(); closeResume.resolve(); });
    const name = operation === 'login' ? 'verifyPassword' : 'hashPassword';
    const create = await gatedApp({ './auth.mjs': { [name]: async (original, ...args) => { const value = await original(...args); entered.resolve(); await resume.promise; return value; } } });
    const f = await fixture(t, { create, tools: { specs: [], close: async () => { closeEntered.resolve(); await closeResume.promise; } }, seed: async ({ store }) => { store.state.users[0].password = await hashPassword('isolated-login-password'); } });
    const before = await f.disk();
    const writing = f.request(operation === 'login' ? '/auth/login' : '/admin/users', { credential: operation === 'login' ? '' : token, method: 'POST', body: operation === 'login' ? { username: 'owner', password: 'isolated-login-password' } : { username: 'must-not-exist', password: 'isolated-new-password' } }).catch(() => null);
    await entered.promise; const closing = f.app.close(); await closeEntered.promise;
    resume.resolve(); const response = await writing; if (response) { assert.equal(response.status, 503); assert.equal((await response.json()).token, undefined); }
    closeResume.resolve(); await closing;
    const after = await f.disk(); assert.deepEqual(after.sessions, before.sessions); assert.deepEqual(after.users, before.users);
  });
});

test('a session committed before shutdown still cannot return a late login token', async t => {
  const committed = deferred(), resume = deferred(), closeEntered = deferred(), closeResume = deferred();
  t.after(() => { resume.resolve(); closeResume.resolve(); });
  const f = await fixture(t, { tools: { specs: [], close: async () => { closeEntered.resolve(); await closeResume.promise; } }, seed: async ({ store }) => { store.state.users[0].password = await hashPassword('isolated-login-password'); } });
  const originalSave = JsonStore.prototype.save;
  t.mock.method(JsonStore.prototype, 'save', async function (...args) {
    await originalSave.apply(this, args);
    if (this.directory === f.directory && this.state.sessions.length) { committed.resolve(); await resume.promise; }
  });
  const login = f.request('/auth/login', { credential: '', method: 'POST', body: { username: 'owner', password: 'isolated-login-password' } }).catch(() => null);
  await committed.promise; assert.equal((await f.disk()).sessions.length, 1);
  const closing = f.app.close(); await closeEntered.promise; resume.resolve();
  const response = await login; if (response) { assert.equal(response.status, 503); assert.equal((await response.json()).token, undefined); }
  closeResume.resolve(); await closing;
  assert.equal((await f.disk()).sessions.length, 1, 'The valid pre-close commit is preserved without a later write');
});
