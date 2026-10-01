import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { OpenCliManager } from '../server/opencli-manager.mjs';
import { OPENCLI_QUERY_POLICIES } from '../server/opencli-sites.mjs';
import { OPENCLI_BROWSER_POLICIES } from '../server/opencli-browser-policies.mjs';

async function setup(t, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-opencli-manager-'));
  const launches = [], children = []; let browserClose = 0, browserExecute = 0;
  const browser = { status: async () => ({ available: true, version: '1.8.8', ready: false }), close: async () => { browserClose++; }, execute: async args => { browserExecute++; return args; }, ...options.browser };
  const launch = (runtime, args, settings) => {
    launches.push({ runtime, args, settings });
    const child = Object.assign(new EventEmitter(), { pid: 1001, exitCode: null, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), signals: [] });
    child.finish = code => { if (child.exitCode !== null) return; child.exitCode = code; child.emit('close', code); };
    child.kill = signal => { child.signals.push(signal); child.emit('kill', signal); if (!options.delayExit) child.finish(1); return true; };
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
const waitForSignal = (child, expected) => child.signals.includes(expected) ? Promise.resolve() : new Promise(resolve => {
  const onSignal = signal => { if (signal === expected) { child.removeListener('kill', onSignal); resolve(); } };
  child.on('kill', onSignal);
});

test('default configuration, status and inventory read without writing or spawning', async t => {
  const f = await setup(t);
  const config = await f.manager.config(); assert.equal(config.enabled, true);
  assert.match(config.revision, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  const status = await f.manager.status(); assert.equal(status.queryReady, true); assert.equal(status.browserQueryReady, false);
  assert.equal(status.catalog.publicQueryCommands, 23);
  assert.equal((await f.manager.sites()).summary.queryCommands, OPENCLI_QUERY_POLICIES.length + OPENCLI_BROWSER_POLICIES.length);
  assert.equal(f.launches.length, 0); assert.deepEqual(await readdir(f.directory), []);
});

test('saved disable persists, CAS rejects stale updates and inventories remain readable', async t => {
  const f = await setup(t); const initial = await f.manager.config();
  const disabled = await f.manager.configure({ ...initial, enabled: false });
  assert.equal(disabled.enabled, false); assert.notEqual(disabled.revision, initial.revision);
  await assert.rejects(f.manager.configure({ ...initial, enabled: true }), error => error.status === 409);
  await assert.rejects(f.manager.query(query), error => error.code === 'disabled');
  await assert.rejects(f.manager.executeBrowser({ action: 'connect' }), error => error.code === 'disabled');
  assert.equal((await f.manager.sites()).summary.publicQueryCommands, 23); assert.equal(f.launches.length, 0); assert.equal(f.browserExecute(), 0);
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
  const child = await waitForChild(f); await waitForSignal(child, 'SIGKILL');
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

const browserQuery = { site: 'baidu-search', command: 'search', arguments: { query: '小猫' } };
const browserResult = (args, rows = [{ title: 'Browser result' }]) => ({ site: args.site, command: args.command, version: '1.8.8', rows, count: rows.length });

test('browser queries preserve selected profile and captured scoped origins without launching a public worker', async t => {
  const calls = [], selectedProfileId = 'explicit-work-profile';
  const f = await setup(t, { browser: { selectedProfileId, executeAdapter: async (args, options) => { calls.push({ args, options }); return browserResult(args); } } });
  const initial = await f.manager.config();
  const configured = await f.manager.configure({ ...initial, siteOrigins: { dyyj: ['https://film.example.com'] } });
  const request = { site: 'dyyj', command: 'read', arguments: { url: 'https://film.example.com/article/1' } };
  assert.equal((await f.manager.query(request)).count, 1);
  assert.equal(f.manager.browser.selectedProfileId, selectedProfileId);
  assert.equal(calls.length, 1); assert.equal(calls[0].options.policy.engine, 'configured');
  assert.equal(calls[0].options.policy.site, 'dyyj');
  assert.deepEqual(calls[0].options.siteOrigins, configured.siteOrigins);
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.equal(calls[0].args.arguments.limit, 5);
  assert.equal(f.launches.length, 0); assert.equal(f.browserExecute(), 0);
  await assert.rejects(f.manager.query({ ...request, arguments: { url: 'https://bbs.dyyjmax.org/article/1' } }), error => error.code === 'invalid_arguments');
  assert.equal(calls.length, 1);
});

test('origin overrides share account-scoped CAS and legacy two-field clients preserve saved websites', async t => {
  const f = await setup(t);
  const initial = await f.manager.config();
  const configured = await f.manager.configure({ ...initial, siteOrigins: { dyyj: ['https://film.example.com'], wlgo: ['https://forum.example.com'] } });
  assert.notEqual(configured.revision, initial.revision);
  await assert.rejects(f.manager.configure({ ...initial, siteOrigins: { wlgo: ['https://other.example.com'] } }), error => error.code === 'config_changed');
  assert.deepEqual(await f.manager.configure({ revision: configured.revision, enabled: true }), configured);
  const disabled = await f.manager.configure({ revision: configured.revision, enabled: false });
  assert.deepEqual(disabled.siteOrigins, configured.siteOrigins);
  const peer = new OpenCliManager({ dataDir: f.directory, scope: 'another-account', browser: { close: async () => {} } });
  t.after(() => peer.close());
  assert.equal((await peer.config()).siteOrigins, undefined);
  const peerConfig = await peer.configure({ ...await peer.config(), siteOrigins: { wlgo: ['https://peer.example.com'] } });
  assert.deepEqual((await f.manager.config()).siteOrigins, configured.siteOrigins);
  assert.deepEqual((await peer.config()).siteOrigins, peerConfig.siteOrigins);
  await assert.rejects(f.manager.configure({ ...disabled, siteOrigins: { wlgo: ['http://private.invalid'] } }), error => error.status === 400);
  assert.deepEqual(await f.manager.config(), disabled);
  const reset = await f.manager.configure({ ...disabled, enabled: true, siteOrigins: {} });
  assert.equal(reset.siteOrigins, undefined);
  assert.deepEqual((await f.manager.sites({ site: 'wlgo' })).sites[0].domains, ['www.wlgooo.com', 'wlgooo.com']);
});

test('old persisted enabled/revision configurations remain readable and acquire origins only on explicit update', async t => {
  const f = await setup(t);
  const disabled = await f.manager.configure({ ...await f.manager.config(), enabled: false });
  await writeFile(f.manager.configFile, JSON.stringify({ revision: disabled.revision, enabled: false }));
  assert.deepEqual(await f.manager.config(), disabled);
  assert.equal((await f.manager.sites()).notebookSites.length, 13);
  await assert.rejects(f.manager.query(browserQuery), error => error.code === 'disabled');
  assert.equal(f.launches.length, 0);
});

test('browser query owns the shared gate immediately and disabling waits for the captured adapter to finish', async t => {
  let finish, started, observeAbort; let calls = 0;
  const ready = new Promise(resolve => { started = resolve; });
  const aborted = new Promise(resolve => { observeAbort = resolve; });
  const f = await setup(t, { browser: { executeAdapter: async (args, { signal }) => {
    calls++; signal.addEventListener('abort', observeAbort, { once: true }); started();
    return new Promise(resolve => { finish = () => resolve(browserResult(args)); });
  } } });
  const pending = f.manager.query(browserQuery); const rejected = assert.rejects(pending, error => error.name === 'AbortError');
  await assert.rejects(f.manager.query(query), error => error.code === 'busy');
  await ready;
  await assert.rejects(f.manager.executeBrowser({ action: 'connect' }), error => error.code === 'busy');
  let resolved = false;
  const disabling = f.manager.configure({ ...await f.manager.config(), enabled: false }).then(value => { resolved = true; return value; });
  await aborted; assert.equal(resolved, false); assert.equal(f.browserClose(), 0);
  finish(); await rejected;
  assert.equal((await disabling).enabled, false); assert.equal(f.browserClose(), 1); assert.equal(calls, 1);
  assert.equal(f.manager.operation, null);
  await assert.rejects(f.manager.query(browserQuery), error => error.code === 'disabled');
  assert.equal(calls, 1); assert.equal(f.launches.length, 0);
});

test('changing origins cancels only the captured query and future requests use the new snapshot', async t => {
  let finish, started, observeAbort; const seen = [];
  const ready = new Promise(resolve => { started = resolve; });
  const aborted = new Promise(resolve => { observeAbort = resolve; });
  const f = await setup(t, { browser: { executeAdapter: async (args, options) => {
    seen.push(options.siteOrigins);
    if (seen.length === 1) { options.signal.addEventListener('abort', observeAbort, { once: true }); started(); return new Promise(resolve => { finish = () => resolve(browserResult(args)); }); }
    return browserResult(args);
  } } });
  const configured = await f.manager.configure({ ...await f.manager.config(), siteOrigins: { wlgo: ['https://old.example.com'] } });
  const pending = f.manager.query({ site: 'wlgo', command: 'read', arguments: { url: 'https://old.example.com/article/1' } });
  const rejected = assert.rejects(pending, error => error.name === 'AbortError'); await ready;
  const updating = f.manager.configure({ ...configured, siteOrigins: { wlgo: ['https://new.example.com'] } });
  await aborted; assert.deepEqual(seen[0], { wlgo: ['https://old.example.com'] });
  finish(); await rejected; await updating;
  await f.manager.query({ site: 'wlgo', command: 'read', arguments: { url: 'https://new.example.com/article/1' } });
  assert.deepEqual(seen[1], { wlgo: ['https://new.example.com'] });
  assert.equal(f.browserClose(), 0); assert.equal(f.launches.length, 0);
});

test('saving unchanged normalized origins is a no-op and does not cancel an active browser query', async t => {
  let finish, started, observeAbort, capturedSignal;
  const ready = new Promise(resolve => { started = resolve; });
  const aborted = new Promise(resolve => { observeAbort = () => resolve('aborted'); });
  const f = await setup(t, { browser: { executeAdapter: async (args, { signal }) => {
    capturedSignal = signal; signal.addEventListener('abort', observeAbort, { once: true }); started();
    return new Promise(resolve => { finish = () => resolve(browserResult(args)); });
  } } });
  const config = await f.manager.configure({ ...await f.manager.config(), siteOrigins: { wlgo: ['https://forum.example.com'] } });
  const pending = f.manager.query({ site: 'wlgo', command: 'read', arguments: { url: 'https://forum.example.com/article/1' } }).catch(error => error);
  await ready;
  const saving = f.manager.configure({ ...config, siteOrigins: { wlgo: ['https://FORUM.example.com/'] } });
  try {
    const outcome = await Promise.race([saving.then(() => 'saved'), aborted]);
    assert.equal(outcome, 'saved'); assert.equal(capturedSignal.aborted, false);
    assert.deepEqual(await saving, config);
  } finally { finish(); await pending; await saving.catch(() => {}); }
  assert.equal(f.manager.operation, null); assert.equal(f.launches.length, 0);
});

test('browser query responses strip credentials and require exact bounded response envelopes', async t => {
  let response;
  const f = await setup(t, { browser: { executeAdapter: async args => response ?? browserResult(args) } });
  response = browserResult(browserQuery, [{ title: 'Bearer privateBearer password=privatePassword', cookie: 'privateCookie', access_token: 'privateAccess', api_key: 'privateApiKey', apiKey: 'privateCamelApiKey', nested: { token: 'privateToken', passcode: 'privatePasscode', url: 'https://example.com?pwd=privatePwd&token=privateUrlToken' } }]);
  assert.doesNotMatch(JSON.stringify(await f.manager.query(browserQuery)), /privateBearer|privatePassword|privateCookie|privateAccess|privateApiKey|privateCamelApiKey|privateToken|privatePasscode|privatePwd|privateUrlToken/);
  for (const invalid of [null, [], { ...browserResult(browserQuery), site: 'bing' }, { ...browserResult(browserQuery), command: 'hot' }, { ...browserResult(browserQuery), version: '1.9.0' }, { ...browserResult(browserQuery), count: 2 }, { ...browserResult(browserQuery), rows: {} }, browserResult(browserQuery, Array.from({ length: 51 }, () => ({ title: 'too many' }))), browserResult(browserQuery, [{ title: 'x'.repeat(128 * 1024) }])]) {
    response = invalid;
    // null is intentionally passed to the fake adapter rather than treated as a default.
    f.manager.browser.executeAdapter = async () => response;
    await assert.rejects(f.manager.query(browserQuery), error => error.code === 'invalid_response');
    assert.equal(f.manager.operation, null);
  }
  assert.equal(f.launches.length, 0);
});

test('share adapter errors never echo URLs or extraction codes for any of the three cloud drives', async t => {
  const shares = { 'baidu-pan': 'https://pan.baidu.com/s/1abcdeFGH', quark: 'https://pan.quark.cn/s/abcdef12', 'xunlei-pan': 'https://pan.xunlei.com/s/abcdef12' };
  const f = await setup(t, { browser: { executeAdapter: async args => { throw new Error(`upstream echoed ${args.arguments.url} passcode S9pQ`); } } });
  for (const [site, url] of Object.entries(shares)) {
    await assert.rejects(f.manager.query({ site, command: 'share-tree', arguments: { url: `${url}?pwd=Y7gX`, passcode: 'S9pQ' } }), error => {
      assert.equal(error.code, 'browser_query_failed'); assert.doesNotMatch(error.message, /https:|Y7gX|S9pQ|abcdef12|1abcdeFGH/); return true;
    });
  }
  assert.equal(f.launches.length, 0);
});

test('pre-aborted browser queries do not connect, select profiles, launch workers or run an adapter', async t => {
  let adapters = 0;
  const f = await setup(t, { browser: { executeAdapter: async args => { adapters++; return browserResult(args); } } });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(f.manager.query(browserQuery, { signal: controller.signal }), error => error.name === 'AbortError');
  assert.equal(adapters, 0); assert.equal(f.launches.length, 0); assert.equal(f.browserExecute(), 0);
  assert.equal(f.manager.operation, null);
});
