import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { OpenCliManager } from '../server/opencli-manager.mjs';

async function setup(t, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-opencli-manager-'));
  const launches = [], children = []; let browserClose = 0, browserExecute = 0;
  const browser = { status: async () => ({ available: true, version: '1.8.8', ready: false }), close: async () => { browserClose++; }, execute: async args => { browserExecute++; return args; } };
  const launch = (runtime, args, settings) => {
    launches.push({ runtime, args, settings });
    const child = Object.assign(new EventEmitter(), { pid: 1001, exitCode: null, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), signals: [] });
    child.finish = code => { if (child.exitCode !== null) return; child.exitCode = code; child.emit('close', code); };
    child.kill = signal => { child.signals.push(signal); if (!options.delayExit) child.finish(1); return true; };
    const input = []; child.stdin.on('data', chunk => input.push(chunk)); child.stdin.on('end', () => {
      child.request = JSON.parse(Buffer.concat(input).toString());
      if (options.run) options.run(child);
      else { child.stdout.write(JSON.stringify({ site: child.request.site, command: child.request.command, version: '1.8.8', rows: [{ title: 'Public result' }], count: 1 })); child.finish(0); }
    });
    children.push(child); return child;
  };
  const manager = new OpenCliManager({ dataDir: directory, browser, launch, timeoutMs: options.timeoutMs ?? 1000, shutdownTimeoutMs: 15, ...options.manager });
  t.after(async () => { await manager.close(); await rm(directory, { recursive: true, force: true }); });
  return { manager, directory, launches, children, browserClose: () => browserClose, browserExecute: () => browserExecute };
}
const query = { site: 'npm', command: 'package', arguments: { name: 'react' } };
const waitForChild = async f => { for (let i = 0; i < 50 && !f.children.length; i++) await new Promise(resolve => setTimeout(resolve, 2)); assert.equal(f.children.length, 1); return f.children[0]; };

test('default configuration, status and inventory read without writing or spawning', async t => {
  const f = await setup(t);
  const config = await f.manager.config(); assert.equal(config.enabled, true);
  assert.match(config.revision, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  const status = await f.manager.status(); assert.equal(status.queryReady, true); assert.equal(status.catalog.querySites, 12);
  assert.equal((await f.manager.sites()).summary.queryCommands, 23);
  assert.equal(f.launches.length, 0); assert.deepEqual(await readdir(f.directory), []);
});

test('saved disable persists, CAS rejects stale updates and inventories remain readable', async t => {
  const f = await setup(t); const initial = await f.manager.config();
  const disabled = await f.manager.configure({ ...initial, enabled: false });
  assert.equal(disabled.enabled, false); assert.notEqual(disabled.revision, initial.revision);
  await assert.rejects(f.manager.configure({ ...initial, enabled: true }), error => error.status === 409);
  await assert.rejects(f.manager.query(query), error => error.code === 'disabled');
  await assert.rejects(f.manager.executeBrowser({ action: 'connect' }), error => error.code === 'disabled');
  assert.equal((await f.manager.sites()).summary.querySites, 12); assert.equal(f.launches.length, 0); assert.equal(f.browserExecute(), 0);
  const other = new OpenCliManager({ dataDir: f.directory, browser: { close: async () => {} } });
  assert.deepEqual(await other.config(), disabled); await other.close();
  await f.manager.configure({ ...disabled, enabled: true });
  assert.equal((await f.manager.query(query)).count, 1);
});

test('hashed scopes keep different account preferences and worker homes separate', async t => {
  const f = await setup(t); const b = new OpenCliManager({ dataDir: f.directory, scope: '../owner/../test', browser: { close: async () => {} } });
  t.after(() => b.close());
  assert.notEqual(f.manager.scopeDir, b.scopeDir); assert.equal(path.dirname(b.scopeDir), path.join(f.directory, 'opencli-scopes'));
  await f.manager.configure({ ...await f.manager.config(), enabled: false }); assert.equal((await b.config()).enabled, true);
  await writeFile(b.configFile, '{"enabled":true}').catch(async error => { assert.equal(error.code, 'ENOENT'); });
});

test('queries use pinned worker and isolated environment, no shell or model keys', async t => {
  const f = await setup(t, { manager: { env: { PATH: 'safe-path', NODE_OPTIONS: '--require bad', OPENAI_API_KEY: 'secret', PETPAL_TOKEN: 'secret', HTTPS_PROXY: 'http://user:password@proxy', OPENCLI_PROFILE: 'private-profile' } } });
  const result = await f.manager.query(query); assert.equal(result.rows[0].title, 'Public result');
  const run = f.launches[0]; assert.equal(run.settings.shell, false); assert.equal(run.settings.windowsHide, true);
  assert.equal(run.args.length, 1); assert.match(run.args[0], /opencli-worker\.mjs$/);
  assert.equal(run.settings.env.PATH, 'safe-path'); assert.equal(run.settings.env.CI, '1'); assert.equal(run.settings.env.ELECTRON_RUN_AS_NODE, '1');
  for (const key of ['NODE_OPTIONS', 'OPENAI_API_KEY', 'PETPAL_TOKEN', 'HTTPS_PROXY', 'OPENCLI_PROFILE']) assert.equal(run.settings.env[key], undefined);
  assert.ok(run.settings.env.HOME.startsWith(f.manager.scopeDir));
  assert.equal(f.children[0].request.arguments.name, 'react');
});

test('worker outputs are redacted and invalid envelopes fail closed', async t => {
  const f = await setup(t, { run: child => { child.stdout.write(JSON.stringify({ site: 'npm', command: 'package', version: '1.8.8', rows: [{ title: 'Bearer private123 password=private456' }], count: 1 })); child.finish(0); } });
  assert.doesNotMatch(JSON.stringify(await f.manager.query(query)), /private123|private456/);
  const g = await setup(t, { run: child => { child.stdout.write('{"site":"evil"}'); child.finish(0); } });
  await assert.rejects(g.manager.query(query), error => error.code === 'invalid_response');
});

test('timeout and cancellation wait for actual child exit, do not overlap or retry', async t => {
  const f = await setup(t, { timeoutMs: 25, delayExit: true, run: () => {} });
  let settled = false; const pending = f.manager.query(query).catch(error => { settled = true; return error; });
  const child = await waitForChild(f); await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(settled, false); assert.deepEqual(child.signals, ['SIGTERM', 'SIGKILL']);
  await assert.rejects(f.manager.query(query), error => error.code === 'busy');
  child.finish(1); assert.equal((await pending).code, 'timeout'); assert.equal(f.launches.length, 1);
  const g = await setup(t, { delayExit: true, run: () => {} }); const controller = new AbortController();
  const cancelled = g.manager.query(query, { signal: controller.signal }).catch(error => error);
  const cancelChild = await waitForChild(g); controller.abort();
  await new Promise(resolve => setTimeout(resolve, 5)); assert.notEqual(g.manager.operation, null);
  cancelChild.finish(1); assert.equal((await cancelled).name, 'AbortError'); assert.equal(g.manager.operation, null);
});

test('disable stops running child before resolving and leaves future queries disabled', async t => {
  const f = await setup(t, { delayExit: true, run: () => {} });
  const pending = f.manager.query(query).catch(error => error); const child = await waitForChild(f);
  let configured = false; const disabled = f.manager.configure({ ...await f.manager.config(), enabled: false }).then(value => { configured = true; return value; });
  await new Promise(resolve => setTimeout(resolve, 15)); assert.equal(configured, false);
  child.finish(1); assert.equal((await pending).name, 'AbortError'); assert.equal((await disabled).enabled, false);
  await assert.rejects(f.manager.query(query), error => error.code === 'disabled');
});

test('output overflow kills child and pre-aborted calls never spawn', async t => {
  const f = await setup(t, { manager: { maxOutputBytes: 64 }, run: child => child.stdout.write('x'.repeat(100)) });
  await assert.rejects(f.manager.query(query), error => error.code === 'output_limit'); assert.deepEqual(f.children[0].signals, ['SIGTERM']);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(f.manager.query(query, { signal: controller.signal }), error => error.name === 'AbortError'); assert.equal(f.launches.length, 1);
});

test('unknown persisted config is refused and never silently enabled', async t => {
  const f = await setup(t); await f.manager.configure({ ...await f.manager.config(), enabled: false });
  await writeFile(f.manager.configFile, JSON.stringify({ enabled: true }));
  await assert.rejects(f.manager.config(), error => error.code === 'invalid_config');
  await assert.rejects(f.manager.query(query), error => error.code === 'invalid_config'); assert.equal(f.launches.length, 0);
  assert.ok((await readFile(f.manager.configFile, 'utf8')).includes('true'));
});

test('unconfirmed shutdown has finite failure and retains ownership until close', async t => {
  const f = await setup(t, { timeoutMs: 10, delayExit: true, run: () => {} });
  const pending = f.manager.query(query).catch(error => error); const child = await waitForChild(f);
  assert.equal((await pending).code, 'shutdown_failed'); assert.equal(f.manager.operation.retained, true);
  await assert.rejects(f.manager.query(query), error => error.code === 'busy');
  assert.equal(f.launches.length, 1); child.finish(1); assert.equal(f.manager.operation, null);
});

test('browser and query share an operation gate; disable cancels captured browser before completion', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-opencli-browser-'));
  let finish, started; const ready = new Promise(resolve => { started = resolve; }); let signalSeen, calls = 0;
  const browser = { close: async () => {}, status: async () => ({}), execute: async (args, { signal }) => { calls++; signalSeen = signal; started(); return new Promise(resolve => { finish = resolve; }); } };
  const manager = new OpenCliManager({ dataDir: directory, browser }); t.after(async () => { await manager.close(); await rm(directory, { recursive: true, force: true }); });
  const executing = manager.executeBrowser({ action: 'connect' }); await ready;
  await assert.rejects(manager.query(query), error => error.code === 'busy');
  let resolved = false; const disabling = manager.configure({ ...await manager.config(), enabled: false }).then(value => { resolved = true; return value; });
  for (let i = 0; i < 20 && !signalSeen.aborted; i++) await new Promise(resolve => setTimeout(resolve, 2));
  assert.equal(signalSeen.aborted, true); assert.equal(resolved, false); finish({ stopped: true });
  await executing; assert.equal((await disabling).enabled, false); assert.equal(calls, 1);
  await assert.rejects(manager.executeBrowser({ action: 'connect' }), error => error.code === 'disabled');
});

test('failed owned-browser shutdown remains disabled until actual close permits a fresh runner', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-opencli-shutdown-'));
  const manager = new OpenCliManager({ dataDir: directory });
  t.after(async () => { await manager.close(); await rm(directory, { recursive: true, force: true }); });
  const runner = manager.browser;
  runner.shutdownTimeoutMs = 5;
  const child = Object.assign(new EventEmitter(), { pid: 1234, exitCode: null, signalCode: null, killed: false, signals: [] });
  child.kill = signal => { child.signals.push(signal); return true; };
  runner.child = child; runner.sharedPid = 9876;
  await assert.rejects(manager.configure({ ...await manager.config(), enabled: false }), error => error.code === 'browser_shutdown_failed');
  const disabled = await manager.config();
  assert.equal(disabled.enabled, false); assert.equal(manager.browser, runner); assert.equal(runner.child, child);
  assert.deepEqual(child.signals, ['SIGTERM', 'SIGKILL']); assert.equal(runner.sharedPid, null);
  await assert.rejects(manager.configure({ ...disabled, enabled: true }), error => error.code === 'browser_shutdown_pending');
  assert.deepEqual(await manager.config(), disabled); assert.equal(manager.browser, runner);
  child.exitCode = 1; child.emit('close', 1);
  assert.equal(manager.browserRecovery.confirmed, true);
  const enabled = await manager.configure({ ...disabled, enabled: true });
  assert.equal(enabled.enabled, true); assert.notEqual(manager.browser, runner); assert.equal(manager.browser.closed, false);
  assert.equal(manager.browserRecovery, null); assert.equal(child.listenerCount('close'), 0);
});

test('unknown injected-browser shutdown cannot silently re-enable a permanently closed runner', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-opencli-unknown-close-'));
  let fail = true, closes = 0;
  const browser = { close: async () => { closes++; if (fail) throw new Error('unknown browser failure'); } };
  const manager = new OpenCliManager({ dataDir: directory, browser });
  t.after(async () => { fail = false; await manager.close(); await rm(directory, { recursive: true, force: true }); });
  await assert.rejects(manager.configure({ ...await manager.config(), enabled: false }), error => error.code === 'browser_shutdown_failed');
  const disabled = await manager.config();
  assert.equal(disabled.enabled, false);
  await assert.rejects(manager.configure({ ...disabled, enabled: true }), error => error.code === 'browser_shutdown_pending');
  assert.deepEqual(await manager.config(), disabled); assert.equal(manager.browser, browser); assert.equal(closes, 1);
});

test('lock write failure closes the owned handle and removes only its lock before retry', async t => {
  let failWrite = true, closes = 0;
  const f = await setup(t, { manager: { openLock: async (...args) => {
    const handle = await open(...args);
    return { stat: () => handle.stat(), writeFile: value => { if (failWrite) { failWrite = false; throw new Error('lock write failed'); } return handle.writeFile(value); }, close: async () => { closes++; await handle.close(); } };
  } } });
  const initial = await f.manager.config();
  await assert.rejects(f.manager.configure({ ...initial, enabled: false }), /lock write failed/);
  assert.equal(closes, 1); assert.equal(f.manager.failedLock, null);
  assert.ok(!(await readdir(f.manager.scopeDir)).includes('config.lock'));
  assert.deepEqual(await f.manager.config(), initial);
  assert.equal((await f.manager.configure({ ...initial, enabled: false })).enabled, false);
});

test('transient lock-close failure is retried without leaking a handle or lock', async t => {
  let closes = 0;
  const f = await setup(t, { manager: { openLock: async (...args) => {
    const handle = await open(...args);
    return { stat: () => handle.stat(), writeFile: value => handle.writeFile(value), close: async () => { closes++; if (closes === 1) throw new Error('temporary close failure'); await handle.close(); } };
  } } });
  const disabled = await f.manager.configure({ ...await f.manager.config(), enabled: false });
  assert.equal(disabled.enabled, false); assert.equal(closes, 2); assert.equal(f.manager.failedLock, null);
  assert.ok(!(await readdir(f.manager.scopeDir)).includes('config.lock'));
  assert.equal((await f.manager.configure({ ...disabled, enabled: true })).enabled, true);
});

test('unconfirmed lock closure retains ownership and a later retry releases it', async t => {
  let failClose = true, closes = 0;
  const f = await setup(t, { manager: { openLock: async (...args) => {
    const handle = await open(...args);
    return { stat: () => handle.stat(), writeFile: value => handle.writeFile(value), close: async () => { closes++; if (failClose) throw new Error('persistent close failure'); await handle.close(); } };
  } } });
  await assert.rejects(f.manager.configure({ ...await f.manager.config(), enabled: false }), error => error.code === 'config_lock_cleanup_failed');
  assert.equal(closes, 2); assert.ok(f.manager.failedLock); assert.ok((await readdir(f.manager.scopeDir)).includes('config.lock'));
  const disabled = await f.manager.config(); assert.equal(disabled.enabled, false);
  failClose = false;
  assert.equal((await f.manager.configure({ ...disabled, enabled: true })).enabled, true);
  assert.equal(f.manager.failedLock, null); assert.ok(!(await readdir(f.manager.scopeDir)).includes('config.lock'));
});

test('successful manager close is idempotent and repeated failed close keeps one recovery listener', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-opencli-close-idempotent-'));
  const child = new EventEmitter(); let fail = true, closes = 0;
  const browser = { child, close: async () => { closes++; if (fail) throw new Error('close failed'); } };
  const manager = new OpenCliManager({ dataDir: directory, browser });
  t.after(async () => { fail = false; await manager.close(); await rm(directory, { recursive: true, force: true }); });
  await assert.rejects(manager.close(), error => error.code === 'browser_shutdown_failed');
  assert.equal(child.listenerCount('close'), 1);
  await assert.rejects(manager.close(), error => error.code === 'browser_shutdown_failed');
  assert.equal(child.listenerCount('close'), 1);
  fail = false; await manager.close(); assert.equal(child.listenerCount('close'), 0);
  await manager.close(); assert.equal(closes, 3);
});
