import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { DesktopExecutor } from '../desktop/executor.mjs';
import { MEMOBASE_RUNTIME_PUBLIC_MESSAGES } from '../server/memobase-runtime.mjs';
const { createMemoryRuntimeHandlers, memoryRuntimePublicStatus } = createRequire(import.meta.url)('../desktop/memory-ipc.cjs');
const connection = { url: 'https://central.example', token: 'private-login-token' };
const state = () => ({ supported: true, platform: 'win32', arch: 'arm64', version: '0.0.42', port: 8019, state: 'stopped', running: false, prepared: false, configured: false, needsModel: true, autoStart: true, dockerAvailable: null, daemonAvailable: null, error: '' });

function ipcFixture() {
  const trusted = {}, calls = [], context = { connection: { ...connection }, identity: { instanceId: 'central-one', userId: 'user-one' } };
  const manager = Object.fromEntries(['status', 'prepare', 'start', 'stop', 'preferences'].map(action => [action, async (...args) => { calls.push([action, ...args]); const guard = action === 'preferences' ? args[1] : args[0]; await guard?.authorize?.(); return { ...state(), privateKey: 'must-not-cross-ipc' }; }]));
  const handlers = createMemoryRuntimeHandlers({ manager, isAllowed: event => event === trusted, readConnection: async () => context.connection, verifyConnection: async () => context.identity, publicMessages: MEMOBASE_RUNTIME_PUBLIC_MESSAGES });
  return { trusted, calls, context, manager, handlers };
}

test('desktop runtime IPC requires a verified unchanged selected login and strips all private fields', async () => {
  const { handlers, trusted, calls } = ipcFixture();
  for (const handler of Object.values(handlers)) {
    await assert.rejects(handler({}, connection), /可信主窗口/); await assert.rejects(handler(trusted, null), /请先登录/);
    const result = await handler(trusted, connection); assert.equal(result.privateKey, undefined);
  }
  assert.equal(calls.length, 5);
  assert.throws(() => memoryRuntimePublicStatus({ ...state(), running: true }, new Set()), /状态不完整/);
});

test('desktop runtime IPC denies account switches/revocation during operations and sanitizes Docker errors', async () => {
  const fixture = ipcFixture();
  fixture.manager.start = async ({ authorize }) => { fixture.context.connection = { ...connection, token: 'another-token' }; await authorize(); return state(); };
  await assert.rejects(fixture.handlers['petpal:memory-runtime:start'](fixture.trusted, connection), /账号已变化/);
  fixture.context.connection = { ...connection };
  fixture.manager.start = async () => { throw Object.assign(new Error('private-docker-password'), { code: 'DOCKER_COMMAND' }); };
  await assert.rejects(fixture.handlers['petpal:memory-runtime:start'](fixture.trusted, connection), error => !error.message.includes('private-docker-password'));
  fixture.manager.prepare = async () => { throw Object.assign(new Error(MEMOBASE_RUNTIME_PUBLIC_MESSAGES[0]), { code: 'PETPAL_MEMOBASE_DOCKER_MISSING' }); };
  await assert.rejects(fixture.handlers['petpal:memory-runtime:prepare'](fixture.trusted, connection), /Docker/);
});

test('preload exposes runtime actions but never configureModel, API tokens or arbitrary commands', async () => {
  let bridge; const calls = [];
  vm.runInNewContext(await readFile(new URL('../desktop/preload.cjs', import.meta.url), 'utf8'), {
    require: () => ({ contextBridge: { exposeInMainWorld: (_name, value) => { bridge = value; } }, ipcRenderer: { invoke: (...args) => { calls.push(args); return Promise.resolve(state()); }, on() {} } }),
    sessionStorage: { getItem: () => JSON.stringify(connection) },
  });
  assert.deepEqual(Object.keys(bridge.memoryRuntime), ['status', 'prepare', 'start', 'stop', 'preferences']);
  await bridge.memoryRuntime.preferences({ autoStart: false });
  assert.equal(calls[0][0], 'petpal:memory-runtime:preferences'); assert.equal(calls[0][1].token, connection.token);
  assert.equal(bridge.memoryRuntime.connection, undefined); assert.equal(bridge.memoryRuntime.configureModel, undefined);
});

async function executorFixture(t, memory, identity = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'petpal-memory-executor-'));
  const executor = new DesktopExecutor({ dataDir, memory, resolveCommand: async () => ({}), fetchImpl: async (_url, init) => Response.json({ instanceId: 'central-one', user: { id: init.headers.Authorization.endsWith('other-token') ? 'user-two' : 'user-one', canUseCodex: true, ...identity } }) });
  executor._register = async ctx => { ctx.hostId = 'host-one'; ctx.connectionId = 'connection-one'; };
  executor._unregister = async () => {}; executor._start = () => {};
  t.after(() => executor.close()); return executor;
}
const login = (value = {}) => ({ ...connection, instanceId: 'central-one', userId: 'user-one', ...value });

test('only verified desktop account is bound; switches/logout serialize unbinding and remote task prompts are not locally enriched', async t => {
  const calls = [], memory = { bindRemote: async value => calls.push(['bind', value]), unbindRemote: async () => calls.push(['unbind']), getContext: async () => { throw new Error('must never inject PC owner memory into remote tasks'); } };
  const executor = await executorFixture(t, memory);
  await executor.connect(login()); assert.equal(executor.status().state, 'online');
  assert.deepEqual(calls.filter(call => call[0] === 'bind')[0][1], login());
  await executor.connect(login({ token: 'other-token', userId: 'user-two' }));
  assert.equal(calls.filter(call => call[0] === 'bind').length, 2);
  assert.equal(calls.at(-1)[0], 'bind'); assert.equal(calls.at(-1)[1].userId, 'user-two');
  await executor.disconnect(); assert.equal(calls.at(-1)[0], 'unbind');
  assert.equal(calls.some(call => call[0] === 'context'), false);
});

test('unverified identities are never bound and optional memory failure does not block the desktop Agent', async t => {
  const calls = [], memory = { bindRemote: async () => { calls.push('bind'); throw new Error('memory temporarily unavailable'); }, unbindRemote: async () => calls.push('unbind') };
  const rejected = await executorFixture(t, memory, { id: 'foreign-user' });
  await assert.rejects(rejected.connect(login()), /连接失败/); assert.equal(calls.includes('bind'), false);
  const available = await executorFixture(t, memory); await available.connect(login()); assert.equal(available.status().state, 'online');
});

test('native packages and final smoke source lists retain the memory IPC and official server assets', async () => {
  for (const file of ['desktop/electron-builder.yml', 'scripts/linux-package.mjs', 'scripts/windows-native-verify.mjs', 'scripts/windows-native-finalize.mjs', 'desktop/main.cjs']) {
    assert.ok((await readFile(new URL(`../${file}`, import.meta.url), 'utf8')).includes('desktop/memory-ipc.cjs'), `${file} omits the memory IPC`);
  }
  const main = await readFile(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
  assert.match(main, /manager: backend\.memory\.runtime/); assert.match(main, /memory: backend\.memory/);
  for (const file of ['env.py', 'open_telemetry.py', 'LICENSE', 'PROVENANCE.json']) assert.ok((await readFile(new URL(`../server/memobase-assets/${file}`, import.meta.url))).length > 0);
});
