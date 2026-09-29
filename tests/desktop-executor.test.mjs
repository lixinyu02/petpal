import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { DesktopExecutor, createExecutorHandlers, loadExecutorDeviceId, validateExecutorConnection } from '../desktop/executor.mjs';

const input = extra => ({ url: 'https://central.example', token: 'central-session-secret', instanceId: 'instance-one', userId: 'user-one', ...extra });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
async function directory(t) { const dir = await mkdtemp(path.join(os.tmpdir(), 'petpal-executor-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; }
class SessionFixture extends DesktopExecutor {
  registrations = []; removals = [];
  async _register(ctx) { this.registrations.push(ctx); ctx.hostId = 'host-one'; ctx.connectionId = 'connection-one'; }
  _start() {}
  async _unregister(ctx) { this.removals.push(ctx.connectionId); }
}
async function fixture(t, options = {}) {
  const dataDir = await directory(t);
  const manager = new SessionFixture({ dataDir, resolveCommand: async () => ({ file: 'codex' }),
    fetchImpl: async () => Response.json({ instanceId: 'instance-one', user: { id: 'user-one', canUseCodex: true, agentAccess: 'full' } }), ...options });
  t.after(() => manager.close()); return manager;
}

test('executor session accepts secure exact service addresses and rejects credential-bearing or ambiguous inputs', () => {
  assert.equal(validateExecutorConnection(input({ url: 'https://central.example/petpal/' })).url, 'https://central.example/petpal');
  assert.equal(validateExecutorConnection(input({ url: 'http://127.0.0.1:4318' })).url, 'http://127.0.0.1:4318');
  for (const url of ['http://remote.example', 'https://me:secret@central.example', 'https://central.example?x=1', 'https://central.example#x', 'https://central.example?', 'https://central.example#', 'file:///local', 'https://central.example\\path']) assert.throws(() => validateExecutorConnection(input({ url })));
  for (const extra of [{ token: 'secret\n' }, { userId: '../other' }, { instanceId: '' }, { hostname: 'fake' }, { cwd: 'C:\\Windows' }]) assert.throws(() => validateExecutorConnection(input(extra)));
});

test('device identity is stable and contains no account or session credential', async t => {
  const dir = await directory(t), id = await loadExecutorDeviceId(dir);
  assert.equal(await loadExecutorDeviceId(dir), id);
  assert.deepEqual(JSON.parse(await readFile(path.join(dir, 'device.json'), 'utf8')), { version: 1, deviceId: id });
});

test('verified login registers once and keeps credentials only in memory', async t => {
  let requests = 0;
  const manager = await fixture(t, { name: 'REAL-PC', fetchImpl: async (url, init) => {
    requests++; assert.equal(url, 'https://central.example/api/auth/me');
    assert.equal(init.headers.Authorization, 'Bearer central-session-secret'); assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit');
    return Response.json({ instanceId: 'instance-one', user: { id: 'user-one', canUseCodex: true } });
  } });
  const first = await manager.connect(input()), again = await manager.connect(input());
  assert.equal(first.state, 'online'); assert.equal(first.name, 'REAL-PC'); assert.deepEqual(again, first); assert.equal(requests, 1);
  const ctx = manager.current; assert.equal(manager.registrations.length, 1);
  assert.doesNotMatch(JSON.stringify(manager.status()), /central-session-secret|deviceId/);
  assert.deepEqual(await readdir(path.join(ctx.directory, 'receipts')), []);
  await manager.disconnect(); assert.equal(ctx.connection.token, ''); assert.equal(manager.status().state, 'disconnected');
  assert.deepEqual(manager.removals, ['connection-one']);
});

test('claimed identity and Agent entitlement must match server verification before registration', async t => {
  for (const identity of [{ instanceId: 'another', user: { id: 'user-one', canUseCodex: true } }, { instanceId: 'instance-one', user: { id: 'other', canUseCodex: true } }, { instanceId: 'instance-one', user: { id: 'user-one', canUseCodex: false } }]) {
    let resolved = false;
    const manager = await fixture(t, { fetchImpl: async () => Response.json(identity), resolveCommand: async () => { resolved = true; } });
    await assert.rejects(manager.connect(input())); assert.equal(manager.registrations.length, 0); assert.equal(resolved, false);
  }
});

test('logout while identity verification is pending prevents a late connection from registering', async t => {
  const started = deferred(), response = deferred();
  const manager = await fixture(t, { fetchImpl: async () => { started.resolve(); return response.promise; } });
  const connecting = manager.connect(input()); const rejected = assert.rejects(connecting);
  await started.promise; const disconnected = manager.disconnect();
  response.resolve(Response.json({ instanceId: 'instance-one', user: { id: 'user-one', canUseCodex: true } }));
  await rejected; await disconnected;
  assert.equal(manager.registrations.length, 0); assert.equal(manager.status().state, 'disconnected');
});

test('disconnect waits for owned Codex process closure and leaves the independent local backend alone', async t => {
  const manager = await fixture(t); await manager.connect(input());
  const closed = deferred(), called = deferred(); let finished = false;
  manager.current.run = { controller: new AbortController(), bridge: { close: () => { called.resolve(); return closed.promise; } } };
  const disconnected = manager.disconnect().then(() => { finished = true; }); await called.promise;
  assert.equal(finished, false); assert.equal(manager.status().state, 'disconnected'); closed.resolve(); await disconnected; assert.equal(finished, true);
});

test('account switch changes private runtime directory without changing stable device ID', async t => {
  const manager = await fixture(t, { fetchImpl: async (_url, init) => Response.json({ instanceId: 'instance-one', user: { id: init.headers.Authorization.endsWith('other-secret') ? 'user-two' : 'user-one', canUseCodex: true } }) });
  await manager.connect(input()); const first = manager.current;
  await manager.connect(input({ token: 'other-secret', userId: 'user-two' }));
  assert.equal(first.deviceId, manager.current.deviceId); assert.notEqual(first.directory, manager.current.directory); assert.equal(first.connection.token, '');
});

test('only trusted main-window IPC can connect, inspect or disconnect the worker', async () => {
  const trusted = {}, calls = [];
  const handlers = createExecutorHandlers({ connect: value => calls.push(['connect', value]), disconnect: () => calls.push(['disconnect']), status: () => ({ state: 'online' }) }, event => event === trusted);
  for (const handler of Object.values(handlers)) assert.throws(() => handler({}, input()), /可信主窗口/);
  handlers['petpal:executor:connect'](trusted, input()); handlers['petpal:executor:disconnect'](trusted);
  assert.equal(handlers['petpal:executor:status'](trusted).state, 'online'); assert.equal(calls.length, 2);
});

test('preload exposes only the fixed executor facade and pagehide does not disconnect a tray worker', async () => {
  const calls = [], listeners = {}; let bridge;
  const context = { require: () => ({ contextBridge: { exposeInMainWorld: (_name, value) => { bridge = value; } }, ipcRenderer: { invoke: (...args) => { calls.push(args); return Promise.resolve(); }, on() {} } }), addEventListener: (name, callback) => { listeners[name] = callback; } };
  vm.runInNewContext(await readFile(new URL('../desktop/preload.cjs', import.meta.url), 'utf8'), context);
  await bridge.executor.connect(input()); await bridge.executor.status(); listeners.pagehide();
  assert.equal(calls[0][0], 'petpal:executor:connect'); assert.equal(calls[1][0], 'petpal:executor:status'); assert.equal(calls.length, 2);
  assert.deepEqual(Object.keys(bridge.executor), ['connect', 'disconnect', 'status']);
});

class ProtocolFixture extends DesktopExecutor { _start() {} }
const runCommand = extra => ({ id: 'command-one', type: 'run', runId: 'run-one', conversationId: 'conversation-one', prompt: 'Look around', permissions: { access: 'read-only', approval: 'ask' }, model: 'test-model', effort: '', codexRevision: '0d57d07e-5908-48b8-82f9-7cc2e1012a3a', relayToken: 'run-only-secret', attachments: [], ...extra });
async function protocolFixture(t, options = {}) {
  const dataDir = await directory(t), events = [], requests = [], toolOptions = [];
  const manager = new ProtocolFixture({ dataDir, resolveCommand: async () => ({ file: 'codex' }),
    toolsFactory: opts => { toolOptions.push(opts); return { close: async () => {} }; },
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      if (url.endsWith('/auth/me')) return Response.json({ instanceId: 'instance-one', user: { id: 'user-one', canUseCodex: true, agentAccess: 'full' } });
      if (url.endsWith('/register')) return Response.json({ hostId: 'host-one', connectionId: 'connection-one', leaseMs: 30000, pollMs: 20000 });
      if (url.endsWith('/events')) { const event = JSON.parse(init.body); events.push(event); await options.onEvent?.(event); return Response.json({ ok: true }); }
      if (init.method === 'DELETE') return Response.json({ ok: true });
      return options.otherFetch?.(url, init) ?? new Response('Not found', { status: 404 });
    }, ...Object.fromEntries(Object.entries(options).filter(([key]) => !['onEvent', 'otherFetch'].includes(key))) });
  t.after(() => manager.close()); await manager.connect(input()); return { manager, events, requests, toolOptions };
}

test('a durable run receipt precedes execution; exact replay never starts a second CLI and central keys are absent', async t => {
  let runs = 0, bridgeOptions;
  const f = await protocolFixture(t, { bridgeFactory: options => {
    bridgeOptions = options;
    return { async run({ onEvent }) { runs++; assert.equal((await readdir(path.join(f.manager.current.directory, 'receipts'))).length, 1); onEvent('thread', { threadId: 'thread-one' }); onEvent('turn', { turnId: 'turn-one' }); onEvent('delta', { text: 'Hello' }); return { threadId: 'thread-one', text: 'Hello' }; }, async close() {} };
  } });
  const ctx = f.manager.current, command = runCommand(); await f.manager._command(ctx, command); await ctx.run.done;
  await f.manager._command(ctx, command);
  assert.equal(runs, 1); assert.deepEqual(f.events.map(item => item.event), ['started', 'thread', 'turn', 'delta', 'complete']);
  assert.deepEqual(f.events.map(item => item.sequence), [1, 2, 3, 4, 5]);
  assert.equal(bridgeOptions.config.apiKey, 'run-only-secret');
  assert.equal(bridgeOptions.config.baseUrl, 'https://central.example/api/agent/executors/connection-one/runs/run-one/model');
  assert.equal(bridgeOptions.config.mode, 'api'); assert.ok(bridgeOptions.dataDir.startsWith(f.manager.dataDir));
  assert.doesNotMatch(JSON.stringify(f.events), /central-session-secret|run-only-secret/);
  const receipts = await readdir(path.join(ctx.directory, 'receipts'));
  assert.doesNotMatch(await readFile(path.join(ctx.directory, 'receipts', receipts[0]), 'utf8'), /central-session-secret|run-only-secret|Look around/);
  assert.ok(f.requests.filter(item => item.url.endsWith('/events')).every(item => item.init.headers.Authorization === 'Bearer central-session-secret'));
  await assert.rejects(f.manager._command(ctx, { ...command, prompt: 'changed replay' })); assert.equal(runs, 1);
});

test('steer and approval stay on the active bridge and stop is reported only after it really closes', async t => {
  const running = deferred(), closeCalled = deferred(), exited = deferred(); let steers = 0, approvals = 0;
  const f = await protocolFixture(t, { bridgeFactory: () => ({
    async run({ signal, onEvent }) { onEvent('turn', { turnId: 'turn-one' }); running.resolve(); return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('stopped')), { once: true })); },
    async steer(value) { assert.equal(value.conversationId, 'conversation-one'); assert.equal(value.expectedTurnId, 'turn-one'); steers++; return { turnId: 'turn-one' }; },
    approve(id, decision) { assert.equal(id, 'approval-one'); assert.equal(decision, 'accept'); approvals++; return { ok: true }; },
    close() { closeCalled.resolve(); return exited.promise; },
  }) });
  const ctx = f.manager.current; await f.manager._command(ctx, runCommand()); await running.promise;
  const steer = { id: 'steer-one', type: 'steer', runId: 'run-one', expectedTurnId: 'turn-one', content: 'Continue', attachments: [] };
  await f.manager._command(ctx, steer); await f.manager._command(ctx, steer);
  await f.manager._command(ctx, { id: 'approval-command', type: 'approve', runId: 'run-one', approvalId: 'approval-one', decision: 'accept' });
  const stopping = f.manager._command(ctx, { id: 'stop-one', type: 'stop', runId: 'run-one' }); await closeCalled.promise;
  assert.equal(f.events.some(item => item.event === 'stopped'), false); exited.resolve(); await stopping;
  assert.equal(steers, 1); assert.equal(approvals, 1); assert.equal(f.events.at(-1).event, 'stopped'); assert.equal(f.events.some(item => item.event === 'complete'), false);
  assert.deepEqual(f.events.filter(item => item.event === 'command-result').map(item => item.data.commandId), ['steer-one', 'approval-command']);
});

function tinyPng() {
  const chunk = (name, data) => { const result = Buffer.alloc(12 + data.length); result.writeUInt32BE(data.length); result.write(name, 4); data.copy(result, 8); let crc = 0xffffffff; for (const byte of result.subarray(4, -4)) { crc ^= byte; for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1; } result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4); return result; };
  const header = Buffer.alloc(13); header.writeUInt32BE(1); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([0, 255, 0, 0, 255]))), chunk('IEND', Buffer.alloc(0))]);
}

test('run images use only scoped relay credentials, validate bytes and are removed after CLI close', async t => {
  const bytes = tinyPng(), sha256 = createHash('sha256').update(bytes).digest('hex'); let imagePath;
  const f = await protocolFixture(t, {
    otherFetch: (url, init) => { assert.equal(url, 'https://central.example/api/agent/executors/connection-one/runs/run-one/attachments/image-one'); assert.equal(init.headers.Authorization, 'Bearer run-only-secret'); assert.equal(init.redirect, 'error'); return new Response(bytes, { headers: { 'content-type': 'image/png' } }); },
    bridgeFactory: () => ({ async run({ images }) { imagePath = images[0].path; assert.deepEqual(await readFile(imagePath), bytes); return { threadId: 'thread-one', text: 'Picture' }; }, async close() { assert.deepEqual(await readFile(imagePath), bytes); } }),
  });
  const ctx = f.manager.current; await f.manager._command(ctx, runCommand({ attachments: [{ id: 'image-one', mimeType: 'image/png', size: bytes.length, sha256 }] })); await ctx.run.done;
  await assert.rejects(readFile(imagePath), { code: 'ENOENT' });
  assert.equal(f.events.find(item => item.event === 'delta').data.text, 'Picture'); assert.equal(f.events.at(-1).event, 'complete');
});

test('invalid commands and image hash mismatch never reach the CLI', async t => {
  let runs = 0; const bytes = tinyPng();
  const f = await protocolFixture(t, { otherFetch: () => new Response(bytes, { headers: { 'content-type': 'image/png' } }), bridgeFactory: () => { runs++; return {}; } });
  const ctx = f.manager.current;
  for (const extra of [{ cwd: 'C:\\Windows' }, { executable: 'powershell.exe' }, { permissions: { access: 'full-access', approval: 'bypass' } }, { relayToken: 'unsafe\nvalue' }, { attachments: [{ id: '../private', mimeType: 'image/png', size: 1, sha256: 'a'.repeat(64) }] }]) await assert.rejects(f.manager._command(ctx, runCommand(extra)));
  await f.manager._command(ctx, runCommand({ attachments: [{ id: 'image-one', mimeType: 'image/png', size: bytes.length, sha256: 'a'.repeat(64) }] })); await ctx.run.done;
  assert.equal(runs, 0); assert.equal(f.events.at(-1).event, 'error');
});

test('full host access is checked against the verified desktop account, before bridge construction', async t => {
  let constructions = 0;
  const f = await protocolFixture(t, { bridgeFactory: () => { constructions++; return {}; } });
  f.manager.current.account = { id: 'user-one', canUseCodex: true, agentAccess: 'workspace', isOwner: false };
  await assert.rejects(f.manager._command(f.manager.current, runCommand({ permissions: { access: 'full-access', approval: 'auto' } })));
  assert.equal(constructions, 0); assert.equal(f.events.length, 0);
});

test('outbound polling really dispatches; an unacknowledged event closes the owned process and never replays the run', async t => {
  const dataDir = await directory(t), closed = deferred(), started = deferred(); let dispatches = 0, runs = 0, stoppedEvents = 0;
  const manager = new DesktopExecutor({ dataDir, resolveCommand: async () => ({}), toolsFactory: () => ({ close: async () => {} }),
    fetchImpl: async (url, init) => {
      if (url.endsWith('/auth/me')) return Response.json({ instanceId: 'instance-one', user: { id: 'user-one', canUseCodex: true, agentAccess: 'workspace' } });
      if (url.endsWith('/register')) return Response.json({ hostId: 'host-one', connectionId: 'connection-one', leaseMs: 30000, pollMs: 20000 });
      if (url.endsWith('/poll')) {
        if (++dispatches === 1) return Response.json({ commands: [runCommand()] });
        return new Promise((_resolve, reject) => { if (init.signal.aborted) reject(new Error('aborted')); else init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }); });
      }
      if (url.endsWith('/events')) {
        const event = JSON.parse(init.body); if (event.event === 'stopped') stoppedEvents++;
        if (event.event === 'delta') throw new Error('Network failed after possible server delivery, secret diagnostics');
        return Response.json({ ok: true });
      }
      return Response.json({ ok: true });
    },
    bridgeFactory: () => ({
      run({ signal, onEvent }) { runs++; started.resolve(); onEvent('delta', { text: 'A' }); return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })); },
      async close() { closed.resolve(); },
    }),
  });
  t.after(() => manager.close()); await manager.connect(input()); const ctx = manager.current;
  await started.promise; await closed.promise; await ctx.retiring;
  assert.equal(runs, 1); assert.equal(manager.status().state, 'error'); assert.equal(ctx.connection.token, ''); assert.equal(stoppedEvents, 0);
  assert.match(manager.status().error, /状态需在工作台确认/); assert.doesNotMatch(JSON.stringify(manager.status()), /secret diagnostics|central-session-secret/);
});

test('a registration that finishes after account change is retired before the next identity starts', async t => {
  const firstStarted = deferred(), release = deferred(); let registrations = 0;
  const manager = await fixture(t);
  manager._register = async ctx => { registrations++; if (registrations === 1) { firstStarted.resolve(); await release.promise; } ctx.hostId = 'host-one'; ctx.connectionId = `connection-${registrations}`; };
  const first = manager.connect(input()), firstRejected = assert.rejects(first); await firstStarted.promise;
  const second = manager.connect(input({ token: 'replacement-session' })); release.resolve();
  await firstRejected; await second;
  assert.deepEqual(manager.removals, ['connection-1']); assert.equal(manager.current.connection.token, 'replacement-session'); assert.equal(manager.status().state, 'online');
});

test('Windows and Ubuntu packaging includes the dynamic executor module and its server imports', async () => {
  const windows = await readFile(new URL('../desktop/electron-builder.yml', import.meta.url), 'utf8');
  const linux = await readFile(new URL('../scripts/linux-package.mjs', import.meta.url), 'utf8');
  const linuxVerify = await readFile(new URL('../scripts/linux-verify.mjs', import.meta.url), 'utf8');
  const windowsVerify = await readFile(new URL('../scripts/windows-native-verify.mjs', import.meta.url), 'utf8');
  const finalize = await readFile(new URL('../scripts/windows-native-finalize.mjs', import.meta.url), 'utf8');
  const main = await readFile(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
  assert.match(windows, /desktop\/executor\.mjs/); assert.match(windows, /server\/\*\*/);
  assert.equal(linux.match(/'desktop\/executor\.mjs'/g)?.length, 2); assert.match(linux, /'server\/\*\*'/);
  assert.match(main, /path\.join\(__dirname, 'executor\.mjs'\)/); assert.match(main, /executor\?\.close\(\)/);
  const predicate = linuxVerify.match(/^const isApplicationSource = (.*);$/m)?.[1]; assert.ok(predicate);
  const selects = vm.runInNewContext(`(${predicate})`);
  for (const file of ['desktop/executor.mjs', 'server/executors.mjs', 'server/remote-codex.mjs']) {
    assert.equal(selects(file), true, `Linux hash verification excludes ${file}`);
    for (const source of [linux, linuxVerify, windowsVerify, finalize]) assert.ok(source.includes(`'${file}'`), `Required executor source absent: ${file}`);
    assert.ok(main.includes(file) || file.startsWith('server/'), `Native smoke hash inventory excludes ${file}`);
  }
});

test('oversized approval details are declined locally rather than presented as a truncated permission card', async t => {
  let declined = 0;
  const f = await protocolFixture(t, { bridgeFactory: () => ({
    async run({ onEvent }) { onEvent('approval', { id: 'approval-large', kind: 'fileChange', description: 'diff'.repeat(3000) }); onEvent('delta', { text: 'Done' }); return { threadId: 'thread-one', text: 'Done' }; },
    approve(id, decision) { assert.equal(id, 'approval-large'); assert.equal(decision, 'decline'); declined++; return { ok: true }; },
    async close() {},
  }) });
  const ctx = f.manager.current; await f.manager._command(ctx, runCommand()); await ctx.run.done;
  assert.equal(declined, 1); assert.equal(f.events.some(item => item.event === 'approval'), false);
  assert.match(f.events.find(item => item.event === 'status').data.message, /已拒绝/); assert.equal(f.manager.status().state, 'online');
});

test('long escaped Unicode deltas remain below central character and HTTP byte frame limits', async t => {
  const text = '\u0000'.repeat(20000) + '\u0000猫😀'.repeat(10000);
  const f = await protocolFixture(t, { bridgeFactory: () => ({ async run({ onEvent }) { onEvent('delta', { text }); return { threadId: 'thread-one', text }; }, async close() {} }) });
  const ctx = f.manager.current; await f.manager._command(ctx, runCommand()); await ctx.run.done;
  const deltas = f.events.filter(item => item.event === 'delta'); assert.equal(deltas.map(item => item.data.text).join(''), text);
  for (const event of f.events) { assert.ok(JSON.stringify(event).length <= 65536); assert.ok(Buffer.byteLength(JSON.stringify(event)) < 128 * 1024); }
});
