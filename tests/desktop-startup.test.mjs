import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const { createStartupDiagnostics, startupFailureMessage } = createRequire(import.meta.url)('../desktop/startup-diagnostics.cjs');
const source = await readFile(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('main.cjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'petpal-startup-test-'));
  t.after(async () => {
    assert.ok(path.resolve(root).startsWith(path.join(tmpdir(), 'petpal-startup-test-')));
    await rm(root, { recursive: true, force: true });
  });
  return { root, userData: path.join(root, '用户 data'), tempRoot: path.join(root, 'temporary') };
}
const metadata = { appVersion: '0.9.1', electronVersion: '39.8.10', platform: 'win32', arch: 'x64', osVersion: '10.0.26100' };

test('startup diagnostics never serialize exception text, stack, arbitrary names, codes or extra fields', async t => {
  const f = await fixture(t), secret = 'sk-fixture-private-token-in-a-url-and-config';
  const diagnostics = createStartupDiagnostics({ ...f, ...metadata });
  const error = Object.assign(new SyntaxError(secret), { name: secret, code: secret, token: secret, config: { apiKey: secret }, stack: secret });
  await diagnostics.milestone('backend-create');
  const result = await diagnostics.failure(error, secret);
  const text = await readFile(result.logPath, 'utf8');
  assert.ok(!text.includes(secret));
  const records = text.trim().split('\n').map(JSON.parse);
  assert.equal(records[1].phase, 'unknown');
  assert.equal(records[1].errorType, 'SyntaxError');
  assert.equal(records[1].code, 'UNKNOWN');
  assert.deepEqual(Object.keys(records[1]).sort(), ['time', 'event', 'phase', 'elapsedMs', 'app', 'appVersion', 'electronVersion', 'os', 'arch', 'osVersion', 'code', 'errorType'].sort());
  assert.ok(!startupFailureMessage(error, result.logPath).includes(secret));
  assert.match(startupFailureMessage(error, result.logPath), /数据已保留/);
  const statValue = await stat(result.logPath);
  if (process.platform !== 'win32') assert.equal(statValue.mode & 0o777, 0o600);
});

test('an inaccessible primary log directory falls back to a bounded private temp log', async t => {
  const f = await fixture(t);
  await mkdir(f.userData, { recursive: true });
  await writeFile(path.join(f.userData, 'logs'), 'Do not remove or replace this existing data');
  const diagnostics = createStartupDiagnostics({ ...f, ...metadata });
  const result = await diagnostics.failure(Object.assign(new Error('private file data'), { code: 'EACCES' }), 'backend-create');
  assert.ok(result.logPath.startsWith(f.tempRoot + path.sep));
  assert.equal((JSON.parse((await readFile(result.logPath, 'utf8')).trim())).code, 'EACCES');
  assert.equal(await readFile(path.join(f.userData, 'logs'), 'utf8'), 'Do not remove or replace this existing data');
  assert.match(startupFailureMessage({ code: 'EACCES' }, result.logPath), /目录权限/);
  assert.ok(startupFailureMessage({ code: 'EACCES' }, result.logPath).includes(result.logPath));
});

test('repeated startup records retain complete recent JSON lines within their byte budget', async t => {
  const f = await fixture(t), diagnostics = createStartupDiagnostics({ ...f, ...metadata, maxBytes: 2048 });
  for (let index = 0; index < 30; index++) await diagnostics.milestone('backend-create');
  const result = await diagnostics.failure(Object.assign(new Error('secret'), { code: 'ENOSPC' }), 'window-load');
  const bytes = await readFile(result.logPath);
  assert.ok(bytes.length <= 2048);
  const entries = bytes.toString('utf8').trim().split('\n').map(JSON.parse);
  assert.ok(entries.length > 1 && entries.length < 30);
  assert.equal(entries.at(-1).event, 'failure');
  assert.equal(entries.at(-1).code, 'ENOSPC');
});

test('only an explicit smoke run creates sanitized error.json evidence', async t => {
  const f = await fixture(t), smokeDir = path.join(f.root, 'smoke evidence'), secret = 'private-smoke-error';
  const normal = createStartupDiagnostics({ ...f, ...metadata, smokeDir });
  assert.equal((await normal.failure(new Error(secret), 'smoke-cat')).smokeErrorPath, null);
  await assert.rejects(stat(smokeDir), { code: 'ENOENT' });
  const smoke = createStartupDiagnostics({ ...f, ...metadata, smokeDir, isSmoke: true });
  const result = await smoke.failure(Object.assign(new TypeError(secret), { code: 'ERR_FAILED' }), 'smoke-cat-gestures');
  const text = await readFile(result.smokeErrorPath, 'utf8'), evidence = JSON.parse(text);
  assert.ok(!text.includes(secret));
  assert.equal(evidence.phase, 'smoke-cat-gestures');
  assert.equal(evidence.code, 'ERR_FAILED');
  assert.equal(evidence.errorType, 'TypeError');
  assert.equal(evidence.logPath, result.logPath);
});

test('diagnostics remain best effort when neither primary nor fallback directories can be written', async t => {
  const f = await fixture(t);
  await writeFile(f.userData, 'preserved application path');
  await writeFile(f.tempRoot, 'preserved temp path');
  const result = await createStartupDiagnostics({ ...f, ...metadata }).failure(new Error('private'), 'workspace');
  assert.equal(result.logPath, null);
  assert.match(startupFailureMessage(new Error('private'), result.logPath), /日志无法写入/);
});

function declaration(name) {
  const node = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(node, `Missing startup function ${name}`);
  return node.getText(parsed);
}
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }

async function bootHarness(t, { args = [], loadError, deferredLoads = false } = {}) {
  const f = await fixture(t), dialogs = [], diagnostics = [], windows = [], logs = [], loads = [deferred(), deferred()];
  const app = { quitCount: 0, getPath: () => f.userData, getVersion: () => metadata.appVersion,
    whenReady: () => Promise.resolve(), quit() { this.quitCount++; } };
  class Window extends EventEmitter {
    constructor() { super(); this.webContents = new EventEmitter(); this.index = windows.length; windows.push(this); }
    show() {} focus() {} showInactive() {} setAlwaysOnTop() {} setVisibleOnAllWorkspaces() {}
    loadURL() {
      if (loadError && this.index === 0) return Promise.reject(loadError);
      return deferredLoads ? loads[this.index].promise : Promise.resolve();
    }
  }
  const desktopTools = { music: { platform: 'win32', players: [] }, opencli: { available: true, version: '1.8.8', runtime: 'bundled', daemon: { state: 'stopped' } } };
  const backendStub = { token: 'private-pairing-token', server: {}, updates: {} };
  const context = vm.createContext({ app, path, process: { argv: args, env: { PETPAL_SMOKE_DIR: path.join(f.root, 'smoke') }, platform: 'win32', arch: 'x64', execPath: process.execPath, versions: { electron: metadata.electronVersion } },
    fs: { mkdir, writeFile }, crypto: { randomBytes: () => ({ toString: () => 'private-pairing-token' }) },
    console: { error: (...args) => logs.push(args), log: (...args) => logs.push(args) },
    dialog: { showErrorBox: (...args) => dialogs.push(args) },
    createStartupDiagnostics(options) {
      const reporter = createStartupDiagnostics({ ...options, tempRoot: f.tempRoot });
      return { milestone: async phase => { diagnostics.push(phase); return reporter.milestone(phase); }, failure: reporter.failure };
    }, startupFailureMessage, BrowserWindow: Window,
    mainWindowLayout: () => ({}), petWindowLayout: () => ({}), screen: { getPrimaryDisplay: () => ({ workArea: {} }) },
    trackWindowDisplay() {}, secureWindow() {}, isTrusted: () => true,
    ipcMain: { handle() {} }, session: { defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} } },
    Tray: class { setToolTip() {} setContextMenu() {} on() {} },
    nativeImage: { createFromPath: () => ({ resize: () => ({}) }) }, Menu: { buildFromTemplate: value => value },
    readDesktopServiceSettings: async () => ({ codexHttpOrigins: '' }),
    serverModule: { createPetServer: async () => backendStub },
    executorModuleStub: { DesktopExecutor: class { async disconnect() {} }, createExecutorHandlers: () => ({}) },
    updaterModuleStub: { DesktopUpdateManager: class {}, createDesktopUpdateHandlers: () => ({}) },
    createDesktopRemoteHttp: () => ({}), listenDesktopBackend: async () => 50000,
    launchPreparedUpdate() {}, queuePortableUpdate() {}, requireUpdateOwner() {}, showMain() {}, shell: { showItemInFolder() {} },
    loginSmokeMain: async () => ({ loginVisible: true, explicitOwnerLogin: true }),
    fetch: async url => ({ json: async () => url.endsWith('/health') ? { ok: true } : url.endsWith('/hosts') ? { hosts: [{ id: 'desktop-fixture', online: true, kind: 'desktop', platform: 'win32' }] } : url.endsWith('/codex/status') ? { available: true } : desktopTools, ok: true }),
    inspectAvatarWindow: () => { throw new Error('Startup-only must not run avatar smoke'); },
    Promise, Error, setTimeout,
  });
  const originalWindow = context.BrowserWindow;
  context.BrowserWindow = class extends originalWindow {
    constructor() { super(); this.webContents.executeJavaScript = async script => script.includes('connection().then') ? { url: 'http://127.0.0.1:50000', hasToken: true } : { available: true, state: 'online', hostId: 'desktop-fixture' }; }
  };
  const boot = declaration('boot')
    .replace("await import(pathToFileURL(path.join(root, 'server', 'app.mjs')).href)", 'serverModule')
    .replace("await import(pathToFileURL(path.join(__dirname, 'executor.mjs')).href)", 'executorModuleStub')
    .replace("await import(pathToFileURL(path.join(__dirname, 'updates.mjs')).href)", 'updaterModuleStub');
  vm.runInContext(`let mainWindow, petWindow, mainLoaded, petLoaded, tray, backend, origin, quitting = false, exitCode = 0;
    let updates, pendingUpdate, verifyDownloadedUpdate, remoteHttp, executor;
    let startupDiagnostics, startupPhase = 'electron-ready', startupFailed = false;
    const root = ${JSON.stringify(f.root)}, __dirname = ${JSON.stringify(f.root)}, iconPath = 'fixture-icon';
    ${['getStartupDiagnostics', 'startupMilestone', 'handleStartupFailure', 'rendererFailure', 'createMain', 'showPet'].map(declaration).join('\n')}
    ${boot}`, context);
  const lifecycle = parsed.statements.find(node => ts.isIfStatement(node) && node.expression.getText(parsed).includes('requestSingleInstanceLock'));
  const startupStatement = lifecycle.elseStatement.statements.find(node => ts.isExpressionStatement(node) && node.getText(parsed).startsWith('app.whenReady()'));
  assert.ok(startupStatement, 'The actual application lifecycle must own boot rejection');
  return { ...f, app, dialogs, diagnostics, windows, logs, loads, context,
    start: () => vm.runInContext(startupStatement.getText(parsed), context) };
}

test('the ordinary application lifecycle handles page-load rejection once and shows a safe actionable error', async t => {
  const secret = 'private-renderer-response-token';
  const f = await bootHarness(t, { loadError: Object.assign(new Error(secret), { code: 'ERR_FAILED' }) });
  await f.start();
  assert.equal(f.app.quitCount, 1);
  assert.equal(f.dialogs.length, 1);
  assert.ok(!JSON.stringify(f.dialogs).includes(secret));
  assert.ok(!JSON.stringify(f.logs).includes(secret));
  const records = (await readFile(path.join(f.userData, 'logs', 'startup.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(records.at(-1).event, 'failure');
  assert.equal(records.at(-1).phase, 'window-load');
  assert.equal(records.at(-1).code, 'ERR_FAILED');
  await vm.runInContext('handleStartupFailure(new Error("later failure"))', f.context);
  assert.equal(f.app.quitCount, 1);
});

test('ordinary startup awaits both main and floating-pet pages before becoming ready', async t => {
  const f = await bootHarness(t, { deferredLoads: true });
  const boot = f.start();
  for (let index = 0; index < 200 && f.windows.length < 2; index++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(f.windows.length, 2);
  f.loads[0].resolve();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(f.diagnostics.includes('ready'), false);
  f.loads[1].resolve();
  await boot;
  assert.equal(f.diagnostics.at(-1), 'ready');
  assert.equal(f.app.quitCount, 0);
});

test('non-clean renderer exit is diagnosed once without trusting renderer-supplied error text', async t => {
  const f = await bootHarness(t); await f.start();
  f.windows[0].webContents.emit('render-process-gone', {}, { reason: 'crashed', message: 'private-renderer-token' });
  for (let index = 0; index < 100 && !f.app.quitCount; index++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(f.app.quitCount, 1); assert.equal(f.dialogs.length, 1);
  const records = (await readFile(path.join(f.userData, 'logs', 'startup.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(records.at(-1).code, 'RENDERER_CRASHED');
  assert.equal(records.at(-1).phase, 'renderer-run');
  assert.ok(!JSON.stringify(records).includes('private-renderer-token'));
});

test('startup-only smoke writes its own evidence after login, executor and bundled-tool checks', async t => {
  const f = await bootHarness(t, { args: ['--smoke-test', '--startup-only'] });
  await f.start();
  const result = JSON.parse(await readFile(path.join(f.root, 'smoke', 'startup-result.json'), 'utf8'));
  assert.equal(result.startupReady, true); assert.equal(result.health.ok, true);
  assert.equal(result.executor.listedOnline, true); assert.equal(result.codex.available, true);
  assert.equal(result.desktopTools.opencli.readOnlyProbe, true);
  assert.equal(f.app.quitCount, 1); assert.equal(f.dialogs.length, 0);
  assert.equal(f.diagnostics.at(-1), 'smoke-complete');
  await assert.rejects(stat(path.join(f.root, 'smoke', 'result.json')), { code: 'ENOENT' });
});

test('startup-only has no effect outside an explicitly requested smoke run', async t => {
  const f = await bootHarness(t, { args: ['--startup-only'] });
  await f.start();
  assert.equal(f.app.quitCount, 0); assert.equal(f.diagnostics.at(-1), 'ready');
  await assert.rejects(stat(path.join(f.root, 'smoke')), { code: 'ENOENT' });
});
