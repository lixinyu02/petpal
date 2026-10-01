import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { ComputerUseMcpManager } from '../server/computer-use-mcp.mjs';
import { createPetServer } from '../server/app.mjs';
import { JsonStore, defaultSettings } from '../server/store.mjs';
import { defaultVoiceSettings } from '../server/voice.mjs';
import { newSession } from '../server/auth.mjs';
import { createDesktopTools } from '../server/desktop-tools.mjs';
import { DesktopExecutor, createComputerUseMcpHandlers } from '../desktop/executor.mjs';
import { listenFixture } from './helpers/loopback.mjs';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const prefix = '/api/desktop-tools/computer-use';
async function routes(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'petpal-computer-routes-')), store = await new JsonStore(directory).init();
  const memberId = randomUUID(), ownerSession = newSession(store.state.ownerId), memberSession = newSession(memberId);
  store.state.users.push({ id: memberId, username: 'computer-fixture-member', displayName: 'Computer route fixture', role: 'member', agentAccess: 'full', disabled: false, providerIds: [], password: null, settings: defaultSettings(), voice: defaultVoiceSettings(), createdAt: new Date().toISOString() });
  store.state.sessions.push(ownerSession.session, memberSession.session); await store.save();
  const calls = { config: 0, status: 0, configure: 0, connect: 0, disconnect: 0 }; let spawned = 0;
  const manager = new ComputerUseMcpManager({ dataDir: directory, scope: `${store.state.instanceId}:${store.state.ownerId}`, platform: 'win32', arch: 'x64', transportFactory: () => { spawned++; throw new Error('HTTP fixtures must not access actual desktop'); } });
  for (const method of ['config', 'status', 'configure']) { const original = manager[method].bind(manager); manager[method] = async (...args) => { calls[method]++; return original(...args); }; }
  for (const method of ['connect', 'disconnect']) manager[method] = async () => { calls[method]++; return { privateResult: 'must-not-be-returned' }; };
  const service = await createPetServer({ dataDir: directory, token: 'computer-fixture-bootstrap', codex: { status: async () => ({ available: false }), close: async () => {} }, desktopTools: { computerUseMcp: manager, status: async () => ({ busy: false }), close: () => manager.close() } });
  await listenFixture(service.server); const releases = new Set();
  t.after(async () => { for (const release of releases) release(); await service.close(); await manager.close(); assert.equal(path.dirname(directory), path.resolve(os.tmpdir())); assert.ok(path.basename(directory).startsWith('petpal-computer-routes-')); await rm(directory, { recursive: true, force: true }); });
  const request = (route, { token = ownerSession.token, method = 'GET', body, signal } = {}) => fetch(`http://127.0.0.1:${service.server.address().port}${route}`, { method, signal, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { manager, request, calls, releases, service, directory, ownerSession, memberSession, spawned: () => spawned };
}
function holdAction(f, action, { ignoresAbort = false } = {}) {
  const started = deferred(), aborted = deferred(), release = deferred(); let signal;
  f.releases.add(() => release.resolve());
  f.manager[action] = async options => {
    f.calls[action]++; signal = options.signal; started.resolve();
    if (ignoresAbort) { signal.addEventListener('abort', () => aborted.resolve(), { once: true }); await release.promise; return { privateResult: 'must-not-be-returned' }; }
    await new Promise((resolve, reject) => { signal.addEventListener('abort', () => { aborted.resolve(); reject(signal.reason); }, { once: true }); f.releases.add(resolve); });
  };
  return { started: started.promise, aborted: aborted.promise, release: release.resolve, signal: () => signal };
}

test('real server denies anonymous and even full-Agent members before passive read or connection side effects', async t => {
  const f = await routes(t), guarded = [[`${prefix}/config`, 'GET'], [`${prefix}/status`, 'GET'], [`${prefix}/config`, 'PATCH', { revision: 'untrusted' }], ...['connect', 'disconnect'].map(action => [`${prefix}/${action}`, 'POST', {}])];
  for (const [token, expected] of [['', 401], [f.memberSession.token, 403]]) for (const [route, method, body] of guarded) { const response = await f.request(route, { token, method, body }); assert.equal(response.status, expected); await response.arrayBuffer(); }
  assert.deepEqual(f.calls, { config: 0, status: 0, configure: 0, connect: 0, disconnect: 0 }); assert.equal(f.spawned(), 0);
});

test('owner config/status are passive, default enabled, and API preserves strict manager CAS without arbitrary startup fields', async t => {
  const f = await routes(t); const initial = await (await f.request(`${prefix}/config`)).json(); const status = await (await f.request(`${prefix}/status`)).json();
  assert.equal(initial.enabled, true); assert.equal(status.connected, false); assert.equal(status.toolsCount, 0); assert.equal(f.spawned(), 0);
  const changed = await f.request(`${prefix}/config`, { method: 'PATCH', body: { revision: initial.revision, enabled: false, profile: 'ax' } }); assert.equal(changed.status, 200); const saved = await changed.json(); assert.equal(saved.profile, 'ax'); assert.equal(saved.enabled, false); assert.notEqual(saved.revision, initial.revision);
  const stale = await f.request(`${prefix}/config`, { method: 'PATCH', body: { revision: initial.revision, profile: 'core' } }); assert.equal(stale.status, 409); await stale.arrayBuffer();
  for (const body of [{ enabled: true }, { revision: saved.revision, command: 'npx' }, { revision: saved.revision, env: {} }, { revision: saved.revision, nativeModulePath: '/anything' }]) { const response = await f.request(`${prefix}/config`, { method: 'PATCH', body }); assert.equal(response.status, 400); await response.arrayBuffer(); }
  assert.deepEqual(await (await f.request(`${prefix}/config`)).json(), saved); assert.equal(f.spawned(), 0);
});

test('connection endpoints accept no caller configuration and return only passive public status', async t => {
  const f = await routes(t);
  for (const action of ['connect', 'disconnect']) {
    for (const body of [{ command: 'npx' }, { profile: 'full' }, { env: {} }, [], null]) { const response = await f.request(`${prefix}/${action}`, { method: 'POST', body }); assert.equal(response.status, 400); await response.arrayBuffer(); }
    const response = await f.request(`${prefix}/${action}`, { method: 'POST', body: {} }); assert.equal(response.status, 200); const result = await response.json(); assert.equal(result.connected, false); assert.equal(JSON.stringify(result).includes('must-not-be-returned'), false);
  }
  assert.equal(f.calls.connect, 1); assert.equal(f.calls.disconnect, 1); assert.equal(f.spawned(), 0);
});

test('logout aborts active connection probes, waits for cleanup, and revokes future management', { timeout: 10000 }, async t => {
  const f = await routes(t), held = holdAction(f, 'connect');
  const connecting = f.request(`${prefix}/connect`, { method: 'POST', body: {} }); await held.started; const statusBefore = f.calls.status;
  const loggingOut = f.request('/api/auth/logout', { method: 'POST', body: {} }); await held.aborted; const response = await connecting; assert.notEqual(response.status, 200); assert.match((await response.json()).error, /停止/);
  assert.equal((await loggingOut).status, 200); assert.equal(held.signal().aborted, true); assert.equal(f.calls.status, statusBefore);
  const revoked = await f.request(`${prefix}/status`); assert.equal(revoked.status, 401); await revoked.arrayBuffer();
  const state = JSON.parse(await readFile(path.join(f.directory, 'state.json'), 'utf8')); assert.equal(state.sessions.some(session => session.tokenHash === f.ownerSession.session.tokenHash), false);
});

test('HTTP request cancellation stops owned MCP probe and does not run follow-up status', { timeout: 10000 }, async t => {
  const f = await routes(t), held = holdAction(f, 'connect'), controller = new AbortController();
  const connecting = f.request(`${prefix}/connect`, { method: 'POST', body: {}, signal: controller.signal }); const rejected = assert.rejects(connecting, { name: 'AbortError' }); await held.started;
  controller.abort(); await rejected; await held.aborted; assert.equal(held.signal().aborted, true); assert.equal(f.calls.status, 0);
});

test('late disconnect after logout cannot read status or publish private configuration', { timeout: 10000 }, async t => {
  const f = await routes(t), held = holdAction(f, 'disconnect', { ignoresAbort: true });
  const disconnecting = f.request(`${prefix}/disconnect`, { method: 'POST', body: {} }); await held.started; const loggingOut = f.request('/api/auth/logout', { method: 'POST', body: {} }); await held.aborted; held.release();
  const response = await disconnecting; assert.notEqual(response.status, 200); assert.equal((await response.json()).config, undefined); assert.equal((await loggingOut).status, 200); assert.equal(f.calls.status, 0);
});

test('logout while status is pending cannot return its late result', { timeout: 10000 }, async t => {
  const f = await routes(t), started = deferred(), release = deferred(); f.releases.add(release.resolve);
  f.manager.status = async () => { started.resolve(); await release.promise; return { config: { privateMarker: 'late-private-result' } }; };
  const reading = f.request(`${prefix}/status`); await started.promise; const loggedOut = await f.request('/api/auth/logout', { method: 'POST', body: {} }); assert.equal(loggedOut.status, 200); release.resolve();
  const response = await reading; assert.equal(response.status, 401); assert.equal((await response.text()).includes('late-private-result'), false);
});

class ExecutorFixture extends DesktopExecutor {
  async _register(ctx) { ctx.hostId = 'owned-computer'; ctx.connectionId = 'owned-connection'; }
  _start() {}
  async _unregister() {}
}
const identity = extra => ({ instanceId: 'instance-one', user: { id: 'user-one', canUseCodex: true, agentAccess: 'full', ...extra } });
const connection = extra => ({ url: 'https://central.example', token: 'synthetic-session', instanceId: 'instance-one', userId: 'user-one', ...extra });
async function executor(t, options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'petpal-computer-executor-'));
  const manager = new ExecutorFixture({ dataDir: directory, fetchImpl: async () => Response.json(identity()), resolveCommand: async () => ({ file: 'synthetic-codex' }), ...options });
  t.after(async () => { await manager.close(); await rm(directory, { recursive: true, force: true }); }); return manager;
}

test('native Computer Use exposes exactly fixed trusted-window IPC actions and account-scoped local settings', async t => {
  const options = [], calls = [], mcp = { config: async () => ({ revision: 'synthetic' }), status: async () => ({ connected: false }), connect: async ({ signal }) => { assert.equal(signal.aborted, false); calls.push('connect'); } };
  const manager = await executor(t, { toolsFactory: value => { options.push(value); return { computerUseMcp: mcp, close: async () => {} }; } });
  await assert.rejects(manager.manageComputerUseMcp('status'), /登录/); await manager.connect(connection());
  const trusted = {}, handlers = createComputerUseMcpHandlers(manager, event => event === trusted); assert.equal(Object.keys(handlers).length, 6);
  for (const handler of Object.values(handlers)) assert.throws(() => handler({}, {}), /可信主窗口/);
  const result = await handlers['petpal:computer-use:connect'](trusted); assert.equal(result.connected, false); assert.deepEqual(calls, ['connect']); assert.equal(options[0].musicMcpScope, 'instance-one:user-one');
  assert.ok(options[0].dataDir.startsWith(manager.current.directory));
  for (const action of ['tools', 'call', 'prepare', 'run_script']) await assert.rejects(manager.manageComputerUseMcp(action));
  await assert.rejects(manager.manageComputerUseMcp('connect', { env: {} })); await assert.rejects(manager.manageComputerUseMcp('status', { token: 'fake' }));
});

test('native settings recheck exact identity/full permission before creating any desktop runtime', async t => {
  let verified = identity(), created = 0; const manager = await executor(t, { fetchImpl: async () => Response.json(verified), toolsFactory: () => { created++; throw new Error('must not create desktop runtime'); } }); await manager.connect(connection());
  for (const user of [{ id: 'user-one', canUseCodex: true, agentAccess: 'workspace' }, { id: 'other', canUseCodex: true, agentAccess: 'full' }, { id: 'user-one', canUseCodex: false, agentAccess: 'full' }]) { verified = { instanceId: 'instance-one', user }; await assert.rejects(manager.manageComputerUseMcp('status')); assert.equal(created, 0); }
});

test('native logout cancels active Computer Use and waits for owned runtime closure', async t => {
  const started = deferred(), closing = deferred(), closed = deferred(); let signal;
  const manager = await executor(t, { toolsFactory: () => ({ computerUseMcp: { connect: async options => { signal = options.signal; started.resolve(); await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); } }, close: () => { closing.resolve(); return closed.promise; } }) });
  await manager.connect(connection()); const connecting = manager.manageComputerUseMcp('connect'), rejection = assert.rejects(connecting); await started.promise;
  await assert.rejects(manager.manageComputerUseMcp('status'), /正在处理/); let retired = false; const retiring = manager.disconnect().then(() => { retired = true; }); await closing.promise; assert.equal(signal.aborted, true); assert.equal(retired, false); closed.resolve(); await retiring; await rejection; assert.equal(retired, true);
});

test('native cancel stops settings operation while leaving same selected executor online', async t => {
  const started = deferred(); let signal;
  const manager = await executor(t, { toolsFactory: () => ({ computerUseMcp: { connect: async options => { signal = options.signal; started.resolve(); await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); }, status: async () => ({ connected: false, busy: false }) }, close: async () => {} }) });
  await manager.connect(connection()); const connecting = manager.manageComputerUseMcp('connect'), rejection = assert.rejects(connecting); await started.promise;
  const status = await manager.manageComputerUseMcp('cancel'); await rejection; assert.equal(status.busy, false); assert.equal(signal.aborted, true); assert.equal(manager.status().state, 'online');
});

test('native action returning after logout does not call status under revoked identity', async t => {
  const started = deferred(), release = deferred(); let statusCalls = 0;
  const manager = await executor(t, { toolsFactory: () => ({ computerUseMcp: { disconnect: async () => { started.resolve(); await release.promise; }, status: async () => { statusCalls++; return { connected: false }; } }, close: async () => {} }) });
  await manager.connect(connection()); const disconnecting = manager.manageComputerUseMcp('disconnect'), rejection = assert.rejects(disconnecting); await started.promise; const retiring = manager.disconnect(); release.resolve(); await retiring; await rejection; assert.equal(statusCalls, 0);
});

test('native cancel cannot publish status after full permission changes during asynchronous read', async t => {
  const started = deferred(), release = deferred(); let verified = identity();
  const manager = await executor(t, { fetchImpl: async () => Response.json(verified), toolsFactory: () => ({ computerUseMcp: { status: async () => { started.resolve(); await release.promise; return { config: { secret: 'late' } }; } }, close: async () => {} }) });
  await manager.connect(connection()); const checking = manager.manageComputerUseMcp('cancel'), rejected = assert.rejects(checking, /完整 Agent 权限/); await started.promise; verified = identity({ agentAccess: 'workspace' }); release.resolve(); await rejected;
});

test('preload facade is frozen and never exposes arbitrary MCP invocation or child launch parameters', async () => {
  const calls = []; let bridge;
  vm.runInNewContext(await readFile(new URL('../desktop/preload.cjs', import.meta.url), 'utf8'), { require: () => ({ contextBridge: { exposeInMainWorld: (name, value) => { bridge = value; } }, ipcRenderer: { invoke: (...args) => { calls.push(args); return Promise.resolve(); }, on() {} } }), addEventListener() {} });
  assert.equal(Object.isFrozen(bridge.computerUse), true); assert.deepEqual(Object.keys(bridge.computerUse), ['config', 'status', 'configure', 'connect', 'disconnect', 'cancel']); await bridge.computerUse.connect(); await bridge.computerUse.cancel();
  assert.deepEqual(calls, [['petpal:computer-use:connect'], ['petpal:computer-use:cancel']]);
});

function desktopFixture(mcp, extra = {}) { return createDesktopTools({ dataDir: '.unused-computer-fixture', computerUseMcp: mcp, musicMcp: { close: async () => {} }, music: {}, opencli: { close: async () => {} }, ...extra }); }
test('desktop discovery and every Computer Use call require reviewable approvals with exact bounded parameters', async () => {
  const tools = desktopFixture({ close: async () => {} });
  assert.equal(tools.describe('petpal_computer_use_tools', {}).approvalRequired, true);
  for (const tool of ['screenshot', 'read_clipboard', 'run_script']) { const args = tool === 'run_script' ? { language: 'powershell', script: 'Get-Date' } : { target_window_id: 44 }; const approval = tools.describe('petpal_computer_use_call', { tool, arguments: args }); assert.equal(approval.approvalRequired, true); assert.ok(approval.description.includes(tool)); assert.ok(approval.description.includes(JSON.stringify(args))); }
  assert.throws(() => tools.describe('petpal_computer_use_call', { tool: 'type', arguments: { text: 'x'.repeat(8000) } }), /完整展示审批/); await tools.close();
});

test('missing conversation scope never falls back to owner Computer Use runtime', async () => {
  let calls = 0; const tools = desktopFixture({ tools: async () => { calls++; }, call: async () => { calls++; }, close: async () => {} }, { scopeForConversation: () => null });
  await assert.rejects(tools.execute('petpal_computer_use_tools', {}, { conversationId: 'missing' }), /所属账号/); await assert.rejects(tools.execute('petpal_computer_use_call', { tool: 'screenshot', arguments: {} }, { conversationId: 'missing' }), /所属账号/); assert.equal(calls, 0); await tools.close();
});

test('closing desktop registry propagates cancellation to owned Computer Use call and awaits it', async () => {
  const started = deferred(); let signal;
  const tools = desktopFixture({ call: async (body, options) => { signal = options.signal; started.resolve(); return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('stopped'), { name: 'AbortError' })), { once: true })); }, close: async () => {} });
  const running = tools.execute('petpal_computer_use_call', { tool: 'type', arguments: { text: 'synthetic' } }), rejected = assert.rejects(running, { name: 'AbortError' }); await started.promise; await tools.close(); await rejected; assert.equal(signal.aborted, true);
  await assert.rejects(tools.execute('petpal_computer_use_tools', {}), { name: 'AbortError' });
});
