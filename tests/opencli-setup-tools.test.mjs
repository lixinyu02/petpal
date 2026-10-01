import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDesktopTools } from '../server/desktop-tools.mjs';
import { OpenCliManager } from '../server/opencli-manager.mjs';

const tool = 'petpal_opencli_setup';
const actions = ['status', 'install-browser', 'open-extension'];
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const abortError = () => Object.assign(new Error('fixture setup cancelled'), { name: 'AbortError' });

function fixture(t, options = {}) {
  const calls = [], lookups = [], otherCalls = [];
  const manager = {
    status: async () => ({ ready: false }),
    close: async () => { otherCalls.push('close'); },
    sites: async () => { otherCalls.push('sites'); return { sites: [] }; },
    query: async () => { otherCalls.push('query'); return { ok: true, rows: [] }; },
    executeBrowser: async () => { otherCalls.push('browser'); return { ok: true }; },
    setup: async () => { throw new Error('legacy setup fallback must not execute'); },
    executeSetup: async function (args, context) {
      assert.equal(this, manager); calls.push({ args, context });
      if (options.executeSetup) return options.executeSetup(args, context);
      return { ok: true, action: args.action, marker: 'scoped setup response' };
    },
  };
  const tools = createDesktopTools({
    dataDir: '.unused-setup-fixture',
    opencliManager: manager,
    musicMcpScope: 'instance:owner',
    scopeForConversation: id => {
      lookups.push(id);
      return options.scopeForConversation ? options.scopeForConversation(id) : id === 'owned-conversation' ? 'instance:owner' : null;
    },
    computerUseMcp: { status: async () => ({ enabled: false }), close: async () => {} },
    musicMcp: { status: async () => ({ servers: [] }), close: async () => {} },
    music: { status: async () => ({ players: [] }), execute: async () => { otherCalls.push('music'); return { ok: true }; } },
  });
  t.after(() => tools.close());
  return { tools, manager, calls, lookups, otherCalls };
}

test('setup registry exposes three fixed actions with passive status and reviewable installation or extension opening', t => {
  const f = fixture(t);
  const specs = f.tools.specs.filter(spec => spec.name === tool);
  assert.equal(specs.length, 1);
  assert.equal(specs[0].type, 'function');
  assert.deepEqual([...specs[0].inputSchema.properties.action.enum].sort(), [...actions].sort());
  assert.deepEqual(specs[0].inputSchema.required, ['action']);
  assert.equal(specs[0].inputSchema.additionalProperties, false);
  for (const action of actions) {
    const approval = f.tools.describe(tool, { action });
    assert.equal(approval.approvalRequired, action !== 'status');
    assert.equal(typeof approval.description, 'string'); assert.ok(approval.description.trim());
    assert.match(approval.description, /Chrome|浏览器|OpenCLI|扩展/);
  }
  assert.deepEqual(f.calls, []); assert.deepEqual(f.lookups, []); assert.deepEqual(f.otherCalls, []);
});

test('setup rejects missing or arbitrary actions, installer URLs, commands and profile arguments before touching scoped runtime', async t => {
  const f = fixture(t);
  for (const args of [undefined, null, [], {}, { action: true }, { action: 'install' }, { action: 'shell' },
    { action: 'install-browser', command: 'winget' }, { action: 'install-browser', url: 'https://untrusted.example.com/setup.exe' },
    { action: 'install-browser', args: ['--silent'] }, { action: 'install-browser', path: 'C:/installer.exe' },
    { action: 'install-browser', runtime: 'powershell' }, { action: 'open-extension', extensionId: 'untrusted' },
    { action: 'open-extension', profileId: 'other-account' }, { action: 'open-extension', browser: 'edge' },
    { action: 'status', token: 'private' }, { action: 'status', force: true },
  ]) {
    assert.throws(() => f.tools.describe(tool, args));
    await assert.rejects(f.tools.execute(tool, args, { conversationId: 'owned-conversation' }));
  }
  assert.equal(f.calls.length, 0); assert.equal(f.lookups.length, 0); assert.equal(f.otherCalls.length, 0);
});

test('setup dispatch resolves conversation scope and uses executeSetup without browser or legacy fallbacks', async t => {
  const f = fixture(t);
  for (const action of actions) {
    const result = await f.tools.execute(tool, { action }, { conversationId: 'owned-conversation' });
    assert.deepEqual(result, { ok: true, action, marker: 'scoped setup response' });
    assert.deepEqual(f.calls.at(-1).args, { action });
    assert.ok(f.calls.at(-1).context.signal instanceof AbortSignal);
    assert.equal(f.calls.at(-1).context.signal.aborted, false);
  }
  assert.deepEqual(f.lookups, actions.map(() => 'owned-conversation'));
  assert.equal(f.calls.length, 3); assert.deepEqual(f.otherCalls, []);
});

test('missing or revoked conversation identity never falls back to owner installation privileges', async t => {
  for (const scope of [null, undefined, '', false, {}]) {
    const f = fixture(t, { scopeForConversation: () => scope });
    for (const action of actions) await assert.rejects(f.tools.execute(tool, { action }, { conversationId: 'unknown-conversation' }), /所属账号/);
    assert.equal(f.calls.length, 0); assert.equal(f.otherCalls.length, 0);
  }
  const f = fixture(t);
  for (const action of actions) await assert.rejects(f.tools.execute(tool, { action }), /所属账号/);
  assert.equal(f.calls.length, 0);
});

test('another owned account routes to its hashed manager instead of the injected owner manager', async t => {
  const seen = [], original = OpenCliManager.prototype.executeSetup;
  // Stub the scope-created manager in memory; no real setup, filesystem write,
  // Chrome launch or installation is performed by this fixture.
  OpenCliManager.prototype.executeSetup = async function (args, { signal }) {
    seen.push({ scopeHash: this.scopeHash, args, signal }); return { ok: true, marker: 'other-account' };
  };
  t.after(() => {
    if (original) OpenCliManager.prototype.executeSetup = original;
    else delete OpenCliManager.prototype.executeSetup;
  });
  const f = fixture(t, { scopeForConversation: id => id === 'other-conversation' ? 'instance:test' : null });
  assert.deepEqual(await f.tools.execute(tool, { action: 'status' }, { conversationId: 'other-conversation' }), { ok: true, marker: 'other-account' });
  assert.equal(f.calls.length, 0); assert.equal(seen.length, 1);
  assert.equal(seen[0].scopeHash, createHash('sha256').update('instance:test').digest('hex'));
  assert.deepEqual(seen[0].args, { action: 'status' }); assert.equal(seen[0].signal.aborted, false);
  assert.deepEqual(f.lookups, ['other-conversation']);
});

test('setup shares the desktop operation gate with queries, browser actions and music without duplicate dispatch', async t => {
  const entered = deferred(), release = deferred();
  const f = fixture(t, { executeSetup: async args => { entered.resolve(); await release.promise; return { ok: true, action: args.action }; } });
  const pending = f.tools.execute(tool, { action: 'install-browser' }, { conversationId: 'owned-conversation' });
  try {
    for (const [name, args] of [[tool, { action: 'status' }], [tool, { action: 'open-extension' }],
      ['petpal_opencli_query', { site: 'npm', command: 'package', arguments: { name: 'react' } }],
      ['petpal_browser', { action: 'connect' }], ['petpal_music_command', { player: 'qqmusic', action: 'pause' }],
    ]) await assert.rejects(f.tools.execute(name, args, { conversationId: 'owned-conversation' }), { status: 409 });
    await entered.promise; assert.equal((await f.tools.status()).busy, true);
    assert.equal(f.calls.length, 1); assert.equal(f.lookups.length, 1); assert.deepEqual(f.otherCalls, []);
  } finally { release.resolve(); await pending; }
  assert.equal((await f.tools.status()).busy, false);
});

test('pre-aborted setup does nothing and caller cancellation reaches only the active setup then releases the gate', async t => {
  const entered = deferred(); let capturedSignal;
  const f = fixture(t, { executeSetup: async (_args, { signal }) => {
    capturedSignal = signal; entered.resolve();
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(abortError()), { once: true }));
  } });
  const preaborted = new AbortController(); preaborted.abort();
  await assert.rejects(f.tools.execute(tool, { action: 'install-browser' }, { conversationId: 'owned-conversation', signal: preaborted.signal }), { name: 'AbortError' });
  assert.equal(f.calls.length, 0); assert.equal(f.lookups.length, 0);
  const controller = new AbortController();
  const pending = f.tools.execute(tool, { action: 'open-extension' }, { conversationId: 'owned-conversation', signal: controller.signal });
  const cancelled = assert.rejects(pending, { name: 'AbortError' });
  await entered.promise; controller.abort(); await cancelled;
  assert.equal(capturedSignal.aborted, true); assert.equal(f.calls.length, 1);
  assert.equal((await f.tools.status()).busy, false); assert.deepEqual(f.otherCalls, []);
});

test('setup failures are reported without fallback or automatic retry and do not retain busy', async t => {
  const error = Object.assign(new Error('fixture official installer failed'), { code: 'fixture_install_failed' });
  const f = fixture(t, { executeSetup: async () => { throw error; } });
  await assert.rejects(f.tools.execute(tool, { action: 'install-browser' }, { conversationId: 'owned-conversation' }), cause => cause === error);
  assert.equal(f.calls.length, 1); assert.equal((await f.tools.status()).busy, false);
  assert.deepEqual(f.otherCalls, []);
});

test('closing registry aborts setup and waits for completion before permitting no further dispatch', async t => {
  const entered = deferred(), observedAbort = deferred(), releaseCleanup = deferred(); let capturedSignal;
  const f = fixture(t, { executeSetup: async (_args, { signal }) => {
    capturedSignal = signal; entered.resolve();
    signal.addEventListener('abort', () => observedAbort.resolve(), { once: true });
    await releaseCleanup.promise; throw abortError();
  } });
  const pending = f.tools.execute(tool, { action: 'install-browser' }, { conversationId: 'owned-conversation' });
  const cancelled = assert.rejects(pending, { name: 'AbortError' }); await entered.promise;
  let closed = false; const closing = f.tools.close().then(() => { closed = true; });
  try {
    await observedAbort.promise; assert.equal(capturedSignal.aborted, true); assert.equal(closed, false);
    await assert.rejects(f.tools.execute(tool, { action: 'status' }, { conversationId: 'owned-conversation' }), { name: 'AbortError' });
  } finally { releaseCleanup.resolve(); await closing; await cancelled; }
  assert.equal(f.calls.length, 1); assert.equal(f.lookups.length, 1);
});

async function managerFixture(t, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-opencli-setup-manager-'));
  const calls = [], browserCalls = [], launches = [];
  const setup = {
    status: async () => { calls.push({ kind: 'status' }); return { chromeInstalled: false, marker: 'passive setup' }; },
    execute: async (args, context) => {
      calls.push({ kind: 'execute', args, context });
      if (options.executeSetup) return options.executeSetup(args, context);
      return { state: 'prepared', installed: false, userActionRequired: true };
    },
    close: async () => { calls.push({ kind: 'close' }); },
  };
  const browser = {
    status: async () => { browserCalls.push('status'); return { ready: false }; },
    close: async () => { browserCalls.push('close'); },
    execute: async (args, context) => {
      browserCalls.push('execute');
      return options.executeBrowser ? options.executeBrowser(args, context) : { ok: true };
    },
  };
  const manager = new OpenCliManager({
    dataDir: directory,
    scope: options.scope ?? 'instance:owner',
    browser,
    browserSetup: setup,
    launch: (runtime, args, settings) => {
      launches.push({ runtime, args, settings });
      if (options.launch) return options.launch(runtime, args, settings);
      throw new Error('fixture must not launch real OpenCLI');
    },
  });
  t.after(async () => { await manager.close(); await rm(directory, { recursive: true, force: true }); });
  return { directory, manager, setup, calls, browserCalls, launches };
}

test('manager setup status is passive while disabled and preparation requires enabled configuration', async t => {
  const f = await managerFixture(t);
  assert.deepEqual(await f.manager.executeSetup({ action: 'status' }), { chromeInstalled: false, marker: 'passive setup' });
  assert.deepEqual(await readdir(f.directory), []);
  const initial = await f.manager.config();
  const disabled = await f.manager.configure({ ...initial, enabled: false });
  assert.deepEqual(await f.manager.executeSetup({ action: 'status' }), { chromeInstalled: false, marker: 'passive setup' });
  for (const action of ['install-browser', 'open-extension']) {
    await assert.rejects(f.manager.executeSetup({ action }), { code: 'disabled', status: 403 });
  }
  assert.equal(f.calls.filter(call => call.kind === 'execute').length, 0);
  await f.manager.configure({ ...disabled, enabled: true });
  assert.deepEqual(await f.manager.executeSetup({ action: 'install-browser' }), { state: 'prepared', installed: false, userActionRequired: true });
  const dispatched = f.calls.filter(call => call.kind === 'execute');
  assert.equal(dispatched.length, 1); assert.deepEqual(dispatched[0].args, { action: 'install-browser' });
  assert.ok(dispatched[0].context.signal instanceof AbortSignal); assert.equal(dispatched[0].context.signal.aborted, false);
  assert.equal(f.manager.operation, null); assert.deepEqual(f.launches, []);
});

test('manager pre-aborted setup is rejected before status checks, directory creation or runtime dispatch', async t => {
  const f = await managerFixture(t), controller = new AbortController(); controller.abort();
  for (const action of actions) await assert.rejects(f.manager.executeSetup({ action }, { signal: controller.signal }), { name: 'AbortError' });
  assert.deepEqual(f.calls, []); assert.deepEqual(f.browserCalls, []); assert.deepEqual(f.launches, []);
  assert.deepEqual(await readdir(f.directory), []); assert.equal(f.manager.operation, null);
});

test('manager running setup blocks queries, browser actions and other preparations while passive status remains available', async t => {
  const entered = deferred(), release = deferred();
  const f = await managerFixture(t, { executeSetup: async () => { entered.resolve(); await release.promise; return { state: 'prepared' }; } });
  const pending = f.manager.executeSetup({ action: 'install-browser' });
  try {
    await entered.promise;
    await assert.rejects(f.manager.query({ site: 'npm', command: 'package', arguments: { name: 'react' } }), { code: 'busy', status: 409 });
    await assert.rejects(f.manager.executeBrowser({ action: 'connect' }), { code: 'busy', status: 409 });
    await assert.rejects(f.manager.executeSetup({ action: 'open-extension' }), { code: 'busy', status: 409 });
    assert.equal((await f.manager.executeSetup({ action: 'status' })).marker, 'passive setup');
    assert.equal(f.calls.filter(call => call.kind === 'execute').length, 1); assert.deepEqual(f.launches, []); assert.deepEqual(f.browserCalls, []);
  } finally { release.resolve(); await pending; }
  assert.equal(f.manager.operation, null);
});

test('manager existing browser or query operations block setup without starting another runtime', async t => {
  const entered = deferred(), release = deferred();
  const f = await managerFixture(t, { executeBrowser: async () => { entered.resolve(); await release.promise; return { ok: true }; } });
  const browserPending = f.manager.executeBrowser({ action: 'connect' });
  try {
    await entered.promise;
    await assert.rejects(f.manager.executeSetup({ action: 'install-browser' }), { code: 'busy', status: 409 });
    assert.deepEqual(f.calls, []); assert.deepEqual(f.launches, []);
  } finally { release.resolve(); await browserPending; }

  const queryEntered = deferred(), queryFinished = deferred(); let child;
  const g = await managerFixture(t, { launch: () => {
    child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() });
    child.kill = () => { child.emit('close', 1); return true; };
    child.stdin.on('finish', () => { queryEntered.resolve(); });
    queryFinished.promise.then(() => {
      child.stdout.write(JSON.stringify({ site: 'npm', command: 'package', version: '1.8.8', rows: [], count: 0 }));
      child.emit('close', 0);
    });
    return child;
  } });
  const queryPending = g.manager.query({ site: 'npm', command: 'package', arguments: { name: 'react' } });
  try {
    await queryEntered.promise;
    await assert.rejects(g.manager.executeSetup({ action: 'open-extension' }), { code: 'busy', status: 409 });
    assert.deepEqual(g.calls, []); assert.equal(g.launches.length, 1);
  } finally { queryFinished.resolve(); await queryPending; }
  assert.equal(g.manager.operation, null);
});

test('manager disable aborts preparation and waits for its cleanup before resolving the persisted disable', async t => {
  const entered = deferred(), aborted = deferred(), cleanup = deferred(); let capturedSignal;
  const f = await managerFixture(t, { executeSetup: async (_args, { signal }) => {
    capturedSignal = signal; signal.addEventListener('abort', () => aborted.resolve(), { once: true });
    entered.resolve(); await cleanup.promise; return { state: 'prepared' };
  } });
  const pending = f.manager.executeSetup({ action: 'install-browser' });
  const cancelled = assert.rejects(pending, { name: 'AbortError' });
  await entered.promise;
  let disabled = false;
  const disabling = f.manager.configure({ ...await f.manager.config(), enabled: false }).then(value => { disabled = true; return value; });
  try {
    await aborted.promise; assert.equal(capturedSignal.aborted, true); assert.equal(disabled, false);
    assert.notEqual(f.manager.operation, null); assert.deepEqual(f.browserCalls, []);
    await assert.rejects(f.manager.executeSetup({ action: 'open-extension' }), { code: 'busy' });
  } finally { cleanup.resolve(); await cancelled; assert.equal((await disabling).enabled, false); }
  assert.equal(f.manager.operation, null); assert.deepEqual(f.browserCalls, ['close']);
  await assert.rejects(f.manager.executeSetup({ action: 'install-browser' }), { code: 'disabled' });
});

test('manager close aborts preparation and waits for runtime cleanup before closing setup and browser', async t => {
  const entered = deferred(), aborted = deferred(), cleanup = deferred(); let capturedSignal;
  const f = await managerFixture(t, { executeSetup: async (_args, { signal }) => {
    capturedSignal = signal; signal.addEventListener('abort', () => aborted.resolve(), { once: true });
    entered.resolve(); await cleanup.promise; throw abortError();
  } });
  const pending = f.manager.executeSetup({ action: 'open-extension' });
  const cancelled = assert.rejects(pending, { name: 'AbortError' }); await entered.promise;
  let closed = false; const closing = f.manager.close().then(() => { closed = true; });
  try {
    await aborted.promise; assert.equal(capturedSignal.aborted, true); assert.equal(closed, false);
    assert.deepEqual(f.browserCalls, []); assert.equal(f.calls.filter(call => call.kind === 'close').length, 0);
    await assert.rejects(f.manager.executeSetup({ action: 'status' }), { code: 'closed' });
  } finally { cleanup.resolve(); await cancelled; await closing; }
  assert.equal(f.manager.operation, null); assert.equal(f.calls.filter(call => call.kind === 'close').length, 1); assert.deepEqual(f.browserCalls, ['close']);
});

test('manager failure releases preparation gate without retries, browser fallback or leaked setup state', async t => {
  const failure = new Error('fixture signature validation rejected');
  const f = await managerFixture(t, { executeSetup: async () => { throw failure; } });
  await assert.rejects(f.manager.executeSetup({ action: 'install-browser' }), cause => cause === failure);
  assert.equal(f.calls.filter(call => call.kind === 'execute').length, 1); assert.deepEqual(f.browserCalls, []); assert.deepEqual(f.launches, []);
  assert.equal(f.manager.operation, null);
  assert.equal((await f.manager.executeSetup({ action: 'status' })).marker, 'passive setup');
});

test('default browser setup directories stay within independent hashed account scopes and never include the raw scope', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-opencli-setup-scope-'));
  const managers = ['instance:owner', '../owner/../test'].map(scope => new OpenCliManager({ dataDir: directory, scope, browser: { close: async () => {} } }));
  t.after(async () => { await Promise.all(managers.map(manager => manager.close())); await rm(directory, { recursive: true, force: true }); });
  for (const [index, scope] of ['instance:owner', '../owner/../test'].entries()) {
    const manager = managers[index], hash = createHash('sha256').update(scope).digest('hex');
    assert.equal(manager.scopeDir, path.join(directory, 'opencli-scopes', hash));
    assert.equal(manager.setup.dataDir, path.join(manager.scopeDir, 'browser-setup'));
    assert.equal(path.relative(manager.scopeDir, manager.setup.dataDir), 'browser-setup');
  }
  assert.notEqual(managers[0].setup.dataDir, managers[1].setup.dataDir);
  assert.deepEqual(await readdir(directory), []);
});
