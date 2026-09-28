import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { DesktopUpdateManager, createDesktopUpdateHandlers, validateDesktopAssetUrl, desktopUpdateTarget, verifyDownloadedUpdate } from '../desktop/updates.mjs';

const payload = Buffer.from('test-only verified update bytes; never executable');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const standardRelease = { id: 'release-061-windows', target: 'windows-x64', version: '0.6.1', url: 'https://github.com/test-owner/petpal/releases/download/v0.6.1/PetPal.exe', sha256: digest(payload), bytes: payload.length, format: 'portable-exe', notes: 'Test only', revision: 'revision-1', repository: 'test-owner/petpal', manifestHash: 'manifest-1', sequence: 1 };

async function fixture(t, options = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'petpal-update-test-'));
  const config = { repository: 'test-owner/petpal', revision: 'revision-1', configured: true };
  const calls = [], launches = [], reveals = [];
  const release = { ...standardRelease, ...options.release };
  const service = {
    statusConfig: () => ({ ...config }),
    check: async args => { calls.push({ action: 'check', target: args.target, currentVersion: args.currentVersion }); return { ...config, available: config.configured, release: config.configured ? { ...release } : null }; },
    resolveRelease: async (id, args) => { calls.push({ action: 'resolve', id, target: args.target, currentVersion: args.currentVersion }); return { ...release }; },
  };
  const requests = [];
  const manager = new DesktopUpdateManager({ dataDir, service, currentVersion: '0.6.0', platform: options.platform || 'win32', arch: options.arch || 'x64', stallTimeoutMs: options.stallTimeoutMs || 1000, downloadTimeoutMs: options.downloadTimeoutMs || 2000,
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      assert.equal(init.redirect, 'manual'); assert.equal(init.credentials, 'omit');
      assert.equal(Object.keys(init.headers).some(key => /authorization|cookie/i.test(key)), false);
      return options.fetch ? options.fetch(url, init) : new Response(payload, { headers: { 'content-length': String(payload.length) } });
    },
    launchPortable: async prepared => { launches.push(prepared); },
    revealArchive: async file => { reveals.push(file); },
  });
  t.after(async () => { await manager.close(); await rm(dataDir, { recursive: true, force: true }); });
  return { manager, config, release, service, requests, calls, launches, reveals, dataDir };
}

test('runtime target and version are fixed by main; unsigned URLs, other repos and excessive sizes are rejected', async t => {
  assert.equal(desktopUpdateTarget('win32', 'x64'), 'windows-x64');
  assert.equal(desktopUpdateTarget('linux', 'arm64'), 'ubuntu-arm64');
  for (const url of ['http://github.com/test-owner/petpal/releases/download/v1/a.exe', 'https://github.com/other/petpal/releases/download/v1/a.exe', 'https://github.com/test-owner/petpal/raw/main/a.exe', 'https://user@github.com/test-owner/petpal/releases/download/v1/a.exe', 'https://release-assets.githubusercontent.com/a']) assert.throws(() => validateDesktopAssetUrl(url, 'test-owner/petpal'));
  assert.equal(validateDesktopAssetUrl('https://release-assets.githubusercontent.com/github-production-release-asset/test?sig=test', 'test-owner/petpal', { cdn: true }), 'https://release-assets.githubusercontent.com/github-production-release-asset/test?sig=test');
  const f = await fixture(t, { release: { bytes: 2 * 1024 ** 3 + 1 } });
  assert.equal((await f.manager.check()).phase, 'error');
  assert.equal(f.requests.length, 0);
  const wrong = await fixture(t, { release: { target: 'ubuntu-x64' } });
  assert.equal((await wrong.manager.check()).phase, 'error');
  const downgrade = await fixture(t, { release: { version: '0.5.9' } });
  assert.equal((await downgrade.manager.check()).phase, 'error');
});

test('check reports not configured/current and never downloads by itself', async t => {
  const f = await fixture(t);
  f.config.configured = false;
  assert.equal((await f.manager.check()).phase, 'not-configured');
  f.config.configured = true;
  f.service.check = async () => ({ ...f.config, available: false, release: null });
  assert.equal((await f.manager.check()).phase, 'current');
  assert.equal(f.manager.status().currentVersion, '0.6.0');
  assert.equal(f.requests.length, 0);
  assert.throws(() => f.manager.download('unchecked'), /已检查/);
});

test('download follows only bounded official redirects, validates exact bytes/hash and reveals no cache path or URL', async t => {
  let count = 0;
  const f = await fixture(t, { fetch: () => ++count === 1 ? new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/github-production-release-asset/test?sig=test' } }) : new Response(payload) });
  const checked = await f.manager.check();
  assert.equal(checked.phase, 'available');
  assert.equal(checked.release.url, undefined);
  const done = await f.manager.download(checked.release.id);
  assert.equal(done.phase, 'downloaded'); assert.equal(done.canInstall, true);
  assert.equal(done.received, payload.length); assert.equal(done.total, payload.length);
  assert.equal(f.requests.length, 2);
  assert.doesNotMatch(JSON.stringify(done), /file:|petpal-update-test-|release-assets|https:\/\//);
  const files = await readdir(f.manager.directory);
  assert.equal(files.length, 1); assert.match(files[0], /\.exe$/);
  assert.deepEqual(await readFile(path.join(f.manager.directory, files[0])), payload);
  assert.equal(f.launches.length, 0);
});

test('untrusted redirect, redirect loops, short/long/corrupt payloads leave no partial or runnable file', async t => {
  const cases = [
    () => new Response(null, { status: 302, headers: { location: 'https://evil.example/update.exe' } }),
    () => new Response(null, { status: 302, headers: { location: standardRelease.url } }),
    () => new Response(payload.subarray(1)),
    () => new Response(Buffer.concat([payload, Buffer.from('extra')])),
    () => new Response(Buffer.alloc(payload.length)),
    () => new Response(payload, { headers: { 'content-length': '1' } }),
  ];
  for (const fetch of cases) {
    const f = await fixture(t, { fetch }); await f.manager.check();
    const result = await f.manager.download(standardRelease.id);
    assert.equal(result.phase, 'error'); assert.equal(result.canInstall, false);
    assert.deepEqual(await readdir(f.manager.directory), []);
    assert.ok(f.requests.length <= 5);
    assert.equal(f.launches.length, 0);
  }
});

test('cancel and close abort an active stream, wait for cleanup, and preserve unrelated files', async t => {
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const f = await fixture(t, { fetch: (_url, init) => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(payload.subarray(0, 5)); started();
      init.signal.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true });
    },
  })) });
  await f.manager.check();
  const pending = f.manager.download(standardRelease.id);
  await ready;
  await writeFile(path.join(f.manager.directory, 'user-note.txt'), 'keep');
  await f.manager.close();
  const result = await pending;
  assert.equal(result.canInstall, false);
  assert.deepEqual(await readdir(f.manager.directory), ['user-note.txt']);
  assert.equal(f.launches.length, 0);
});

test('download stall and overall timeout both cancel the stream and remove partial bytes', async t => {
  for (const deadlines of [{ stallTimeoutMs: 25, downloadTimeoutMs: 1000 }, { stallTimeoutMs: 1000, downloadTimeoutMs: 25 }]) {
    let aborted = false;
    const f = await fixture(t, { ...deadlines, fetch: (_url, init) => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(payload.subarray(0, 5));
        init.signal.addEventListener('abort', () => { aborted = true; controller.error(new DOMException('Aborted', 'AbortError')); }, { once: true });
      },
    })) });
    await f.manager.check();
    const result = await f.manager.download(standardRelease.id);
    assert.equal(result.phase, 'error'); assert.equal(result.canInstall, false);
    assert.equal(aborted, true); assert.deepEqual(await readdir(f.manager.directory), []);
    assert.equal(f.launches.length, 0);
  }
});

test('changed source invalidates checked and downloaded versions without removing cached user files', async t => {
  const f = await fixture(t); await f.manager.check(); await f.manager.download(standardRelease.id);
  f.config.revision = 'revision-2';
  const status = f.manager.status();
  assert.equal(status.canInstall, false); assert.equal(status.release, undefined);
  assert.throws(() => f.manager.install(standardRelease.id), /已检查/);
  assert.equal((await readdir(f.manager.directory)).length, 1);
  assert.equal(f.launches.length, 0);
});

test('install re-resolves signed release and rehashes cached payload before portable handoff', async t => {
  const f = await fixture(t); await f.manager.check(); await f.manager.download(standardRelease.id);
  const result = await f.manager.install(standardRelease.id);
  assert.equal(result.phase, 'downloaded'); assert.equal(result.canInstall, false);
  assert.equal(f.launches.length, 1);
  assert.equal(f.calls.filter(call => call.action === 'resolve').length, 2);
  assert.equal(f.launches[0].release.sha256, digest(payload));
  assert.match(result.message, /旧程序文件保留/);
  await f.manager.close({ preserveHandoff: true });
  assert.equal(f.launches[0].signal.aborted, false);
});

test('tampered cached bytes or a changed signed manifest never reach installation hooks', async t => {
  const f = await fixture(t); await f.manager.check(); await f.manager.download(standardRelease.id);
  await writeFile(f.manager.downloaded.file, Buffer.alloc(payload.length));
  assert.equal((await f.manager.install(standardRelease.id)).phase, 'error');
  assert.equal(f.launches.length, 0);
  const changed = await fixture(t); await changed.manager.check(); await changed.manager.download(standardRelease.id);
  changed.release.manifestHash = 'different';
  assert.equal((await changed.manager.install(standardRelease.id)).phase, 'error');
  assert.equal(changed.launches.length, 0);
});

test('logout while checking install authorization prevents handoff; cancellation revokes a queued portable launch', async t => {
  const f = await fixture(t); await f.manager.check(); await f.manager.download(standardRelease.id);
  let checks = 0;
  const result = await f.manager.install(standardRelease.id, { authorize: async () => { if (++checks > 1) throw new Error('Logged out'); } });
  assert.equal(result.phase, 'error'); assert.equal(f.launches.length, 0);
  await f.manager.install(standardRelease.id);
  assert.equal(f.launches[0].signal.aborted, false);
  await f.manager.cancel();
  assert.equal(f.launches[0].signal.aborted, true);
});

test('Ubuntu hands the verified tar archive to reveal hook without launch or extraction', async t => {
  const f = await fixture(t, { platform: 'linux', arch: 'arm64', release: { id: 'linux-061', target: 'ubuntu-arm64', format: 'tar.gz', url: 'https://github.com/test-owner/petpal/releases/download/v0.6.1/PetPal.tar.gz' } });
  await f.manager.check(); await f.manager.download('linux-061');
  const status = await f.manager.install('linux-061');
  assert.equal(status.installMode, 'reveal-archive');
  assert.equal(f.launches.length, 0); assert.equal(f.reveals.length, 1);
  assert.match(status.message, /解压到新目录/);
  await assert.rejects(verifyDownloadedUpdate(path.join(f.dataDir, 'outside.exe'), standardRelease, { directory: f.manager.directory }), /缓存目录/);
});

test('IPC denies pet/foreign frames, checks owner for each action and accepts no arbitrary paths or arguments', async () => {
  const calls = [], main = {}, pet = {};
  const manager = Object.fromEntries(['status', 'check', 'download', 'install', 'cancel'].map(action => [action, async (...args) => { calls.push({ action, args }); return { phase: 'idle' }; }]));
  let authorized = true;
  const handlers = createDesktopUpdateHandlers(manager, event => event === main, async (_event, token) => { if (!authorized || token !== 'test-session') throw new Error('owner required'); });
  await assert.rejects(handlers['petpal:updates:check'](pet, 'test-session'), /可信主窗口/);
  await assert.rejects(handlers['petpal:updates:check'](main, '', 'https://example.test'), /owner/);
  await assert.rejects(handlers['petpal:updates:download'](main, 'test-session', { url: standardRelease.url }), /发布 ID/);
  await assert.rejects(handlers['petpal:updates:install'](main, 'test-session', 'C:\\evil.exe'), /发布 ID/);
  await assert.rejects(handlers['petpal:updates:status'](main, 'test-session', 'extra'), /不接受/);
  await handlers['petpal:updates:download'](main, 'test-session', 'release-061-windows');
  authorized = false;
  await assert.rejects(calls[0].args[1].authorize(), /owner/);
  await handlers['petpal:updates:cancel'](main, '');
  assert.equal(calls.at(-1).action, 'cancel');
});

test('preload exposes only fixed update methods and captures the current session token per call', async () => {
  const calls = []; let api, token = 'first-session';
  const source = await readFile(new URL('../desktop/preload.cjs', import.meta.url), 'utf8');
  vm.runInNewContext(source, { require: name => {
    assert.equal(name, 'electron');
    return { contextBridge: { exposeInMainWorld: (_name, value) => { api = value; } }, ipcRenderer: { invoke: async (...args) => { calls.push(args); } } };
  }, sessionStorage: { getItem: () => JSON.stringify({ token }) } });
  assert.deepEqual(Object.keys(api.updates), ['status', 'check', 'download', 'install', 'cancel']);
  await api.updates.download('release-061-windows'); token = ''; await api.updates.cancel();
  assert.deepEqual(calls[0], ['petpal:updates:download', 'first-session', 'release-061-windows']);
  assert.deepEqual(calls[1], ['petpal:updates:cancel', '']);
});

async function mainHarness() {
  const source = await readFile(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
  const require = createRequire(new URL('../desktop/main.cjs', import.meta.url)), events = new Map(), scheduled = [], calls = [];
  let exited;
  const exit = new Promise(resolve => { exited = resolve; });
  const app = {
    requestSingleInstanceLock: () => true, whenReady: () => new Promise(() => {}), on: (name, handler) => events.set(name, handler),
    quit: () => calls.push({ action: 'quit' }), releaseSingleInstanceLock: () => calls.push({ action: 'unlock' }),
    exit: code => { calls.push({ action: 'exit', code }); exited(code); },
  };
  const context = vm.createContext({ Buffer, URL, __dirname: path.resolve('desktop'), console: { error: () => {} },
    process: { argv: [], env: { KEEP: 'yes', ELECTRON_RUN_AS_NODE: '1', PORTABLE_EXECUTABLE_DIR: 'old', PETPAL_SMOKE_PROFILE: 'smoke' } },
    setImmediate: fn => scheduled.push(fn),
    require: name => {
      if (name === 'electron') return { app };
      if (name === './media-permissions.cjs') return {};
      if (name === 'node:child_process') return { spawn: (file, args, options) => {
        calls.push({ action: 'spawn', file, args, options });
        const handlers = new Map();
        const child = { once: (event, fn) => handlers.set(event, fn), unref: () => calls.push({ action: 'unref' }) };
        queueMicrotask(() => handlers.get('spawn')?.());
        return child;
      } };
      return require(name);
    },
  });
  vm.runInContext(`${source}\nglobalThis.harness = {launchPreparedUpdate, queuePortableUpdate, pending: () => pendingUpdate, configure: values => {backend=values.backend; updates=values.updates; verifyDownloadedUpdate=values.verify;}};`, context);
  const config = { configured: true, revision: standardRelease.revision, repository: standardRelease.repository };
  const backend = { updates: { statusConfig: () => ({ ...config }) }, close: async () => { calls.push({ action: 'backend-close' }); } };
  const updates = { close: async options => { calls.push({ action: 'updates-close', options }); } };
  const verify = async () => { calls.push({ action: 'verify' }); };
  context.harness.configure({ backend, updates, verify });
  const controller = new AbortController();
  const prepared = { file: path.join(tmpdir(), 'fixture-never-executed.exe'), directory: tmpdir(), release: { ...standardRelease }, signal: controller.signal,
    authorize: async () => { calls.push({ action: 'authorize' }); } };
  return { ...context.harness, calls, events, scheduled, config, backend, updates, verify, prepared, controller, exit };
}

test('final main handoff rechecks source and cancellation after hash/authorization, then launches without inherited portable or smoke overrides', async () => {
  for (const key of ['configured', 'revision', 'repository', 'cancel']) {
    const f = await mainHarness();
    f.prepared.authorize = async () => {
      if (key === 'cancel') f.controller.abort();
      else f.config[key] = key === 'configured' ? false : 'changed';
    };
    await assert.rejects(f.launchPreparedUpdate(f.prepared));
    assert.equal(f.calls.some(call => ['unlock', 'spawn'].includes(call.action)), false);
  }
  const f = await mainHarness(); await f.launchPreparedUpdate(f.prepared);
  assert.deepEqual(f.calls.map(call => call.action), ['verify', 'authorize', 'unlock', 'spawn', 'unref']);
  const launch = f.calls.find(call => call.action === 'spawn');
  assert.equal(launch.file, f.prepared.file); assert.equal(launch.args.length, 0);
  assert.equal(launch.options.shell, false); assert.equal(launch.options.detached, true);
  assert.equal(launch.options.env.KEEP, 'yes'); assert.deepEqual(Object.keys(launch.options.env), ['KEEP']);
});

test('canceling a queued portable handoff leaves the application open and allows a later retry', async () => {
  const f = await mainHarness(); f.queuePortableUpdate(f.prepared); f.controller.abort();
  f.scheduled.shift()();
  assert.equal(f.pending(), null); assert.equal(f.calls.some(call => call.action === 'quit'), false);
  const retry = { ...f.prepared, signal: new AbortController().signal };
  f.queuePortableUpdate(retry); f.scheduled.shift()();
  assert.equal(f.pending(), retry); assert.equal(f.calls.filter(call => call.action === 'quit').length, 1);
});

test('main waits for both shutdowns before portable verification and skips launch on cleanup failure', async () => {
  for (const fail of [false, true]) {
    const f = await mainHarness(); let completeBackend;
    f.backend.close = () => new Promise((resolve, reject) => { completeBackend = () => {
      f.calls.push({ action: 'backend-closed' });
      if (fail) reject(new Error('test cleanup failure')); else resolve();
    }; });
    f.queuePortableUpdate(f.prepared);
    let prevented = false;
    f.events.get('before-quit')({ preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true); assert.equal(f.calls.some(call => call.action === 'spawn'), false);
    completeBackend();
    assert.equal(await f.exit, fail ? 1 : 0);
    const names = f.calls.map(call => call.action);
    if (fail) assert.equal(names.includes('verify') || names.includes('spawn'), false);
    else {
      assert.ok(names.indexOf('backend-closed') < names.indexOf('verify'));
      assert.ok(names.indexOf('updates-close') < names.indexOf('verify'));
      assert.ok(names.indexOf('spawn') < names.indexOf('exit'));
    }
  }
});
