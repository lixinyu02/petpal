import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';
import ts from 'typescript';

const source = await readFile(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('main.cjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
function declaration(name) {
  const node = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(node, `Missing production function ${name}`);
  return node.getText(parsed);
}
const lifecycle = parsed.statements.find(node => ts.isIfStatement(node) && node.expression.getText(parsed).includes('requestSingleInstanceLock'));
function registration(event) {
  const node = lifecycle.elseStatement.statements.find(node => ts.isExpressionStatement(node) && node.getText(parsed).startsWith(`app.on('${event}'`));
  assert.ok(node, `Missing production lifecycle registration ${event}`);
  return node.getText(parsed);
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Run the production functions and lifecycle callbacks, with only Electron's
// window/process boundaries replaced by controllable event emitters.
function harness({ origin = 'http://127.0.0.1:4318', tray = true, deferredPetLoad = false } = {}) {
  const windows = [], app = new EventEmitter();
  const calls = { quits: 0, disconnects: 0, fatalErrors: 0, backendCloses: 0, fitted: [] };
  const petNavigation = deferred();
  const backend = { async close() { calls.backendCloses++; } };
  app.quit = () => { calls.quits++; };
  class Window extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.webContents = new EventEmitter();
      this.shows = 0; this.inactiveShows = 0; this.focuses = 0; this.restores = 0;
      this.destroys = 0; this.destroyed = false; this.minimized = false;
      windows.push(this);
    }
    show() { assert.equal(this.destroyed, false); this.shows++; }
    showInactive() { assert.equal(this.destroyed, false); this.inactiveShows++; }
    focus() { assert.equal(this.destroyed, false); this.focuses++; }
    hide() {}
    isDestroyed() { return this.destroyed; }
    isMinimized() { return this.minimized; }
    restore() { this.minimized = false; this.restores++; }
    destroy() { this.destroys++; this.destroyed = true; }
    setAlwaysOnTop() {}
    setVisibleOnAllWorkspaces() {}
    loadURL(url) {
      this.url = url;
      return deferredPetLoad && url.endsWith('/?pet=1') && windows.filter(win => win.options.frame === false).length === 1
        ? petNavigation.promise : Promise.resolve();
    }
  }
  const context = vm.createContext({
    app, BrowserWindow: Window, backend,
    appPreferences: { current: () => ({ closeToTray: true, petAlwaysOnTop: true }) },
    executor: { async disconnect() { calls.disconnects++; } },
    rendererFailure() { calls.fatalErrors++; }, remoteHttp: { cancelOwner() {} },
    screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) },
    mainWindowLayout: () => ({}), petWindowLayout: () => ({}),
    trackWindowDisplay() {}, secureWindow() {}, fitWindowToDisplay(win, isPet = false) { calls.fitted.push({ win, isPet }); },
    process: { platform: 'win32' }, path: { join: (...parts) => parts.join('/') }, __dirname: 'desktop', iconPath: 'icon.png',
  });
  vm.runInContext(`let mainWindow, petWindow, mainLoaded, petLoaded, quitting = false;
    let pendingMainReveal = false, mainWindowCreated = false;
    let origin = ${JSON.stringify(origin)}, tray = ${tray ? '{}' : 'null'};
    ${['createMain', 'showMain', 'showPet', 'applyPetWindowPreferences'].map(declaration).join('\n')}
    ${registration('second-instance')}
    ${registration('activate')}`, context);
  return { context, windows, app, calls, backend, petNavigation,
    run: code => vm.runInContext(code, context),
    launch: argv => app.emit('second-instance', {}, argv),
  };
}

test('manual relaunch during boot survives backend readiness and creates only one initial main window', () => {
  const f = harness({ origin: null });
  f.launch(['PetPal.exe']); f.launch(['PetPal.exe']);
  assert.equal(f.windows.length, 0);
  assert.equal(f.run('pendingMainReveal'), true);
  f.run("origin = 'http://127.0.0.1:4318'");
  f.launch(['PetPal.exe']);
  assert.equal(f.windows.length, 0, 'Backend readiness must not bypass boot window creation');
  f.context.createMain(false);
  const main = f.windows[0];
  assert.equal(f.windows.length, 1); assert.equal(main.shows, 0); assert.equal(main.focuses, 0);
  main.emit('ready-to-show');
  assert.equal(main.shows, 1); assert.equal(main.focuses, 1); assert.equal(f.run('pendingMainReveal'), false);
  main.emit('ready-to-show');
  assert.equal(main.shows, 1); assert.equal(main.focuses, 1);
  f.launch(['PetPal.exe', '--petpal-autostart']);
  assert.equal(main.shows, 1); assert.equal(main.focuses, 1);
});

test('autostart duplicates never queue a reveal or steal focus from a tray-only startup', () => {
  const f = harness({ origin: null });
  f.launch(['PetPal.exe', '--petpal-autostart']);
  assert.equal(f.run('pendingMainReveal'), false);
  f.run("origin = 'http://127.0.0.1:4318'");
  f.launch(['PetPal.exe', '--petpal-autostart']);
  assert.equal(f.windows.length, 0); assert.equal(f.run('pendingMainReveal'), false);
  f.context.createMain(false);
  const main = f.windows[0]; main.emit('ready-to-show');
  f.launch(['PetPal.exe', '--petpal-autostart']);
  assert.equal(main.shows, 0); assert.equal(main.focuses, 0);
});

test('an autostart duplicate cannot discard a pending manual reveal', () => {
  const f = harness({ origin: null });
  f.launch(['PetPal.exe']); f.launch(['PetPal.exe', '--petpal-autostart']);
  f.run("origin = 'http://127.0.0.1:4318'"); f.context.createMain(false);
  f.windows[0].emit('ready-to-show');
  assert.equal(f.windows[0].shows, 1); assert.equal(f.windows[0].focuses, 1);
});

test('activation in the backend-ready gap is retained and a manual request on an existing window is immediate', () => {
  const early = harness(); early.app.emit('activate');
  assert.equal(early.windows.length, 0);
  early.context.createMain(false); early.windows[0].emit('ready-to-show');
  assert.equal(early.windows[0].shows, 1); assert.equal(early.windows[0].focuses, 1);
  const created = harness(); created.context.createMain(false); created.launch(['PetPal.exe']);
  assert.equal(created.windows[0].shows, 1); assert.equal(created.windows[0].focuses, 1);
  created.windows[0].emit('ready-to-show'); assert.equal(created.windows[0].shows, 1);
});

test('a normal manual relaunch restores the minimized main window without creating another one', () => {
  const f = harness(); f.context.createMain(false); const main = f.windows[0]; main.emit('ready-to-show');
  main.minimized = true; f.launch(['PetPal.exe']);
  assert.equal(main.restores, 1); assert.equal(main.minimized, false);
  assert.equal(main.shows, 1); assert.equal(main.focuses, 1); assert.equal(f.windows.length, 1);
  assert.equal(f.calls.fitted.length, 1); assert.equal(f.calls.fitted[0].win, main);
});

test('shutdown discards late reveal and floating-window callbacks without showing any window', () => {
  const f = harness({ origin: null }); f.launch(['PetPal.exe']);
  f.run("origin = 'http://127.0.0.1:4318'"); f.context.createMain(false); f.context.showPet();
  f.run('quitting = true'); f.launch(['PetPal.exe']); f.app.emit('activate'); f.context.showPet();
  f.windows.forEach(win => win.emit('ready-to-show'));
  assert.equal(f.windows.length, 2);
  f.windows.forEach(win => { assert.equal(win.shows, 0); assert.equal(win.inactiveShows, 0); assert.equal(win.focuses, 0); });
});

for (const reason of ['crashed', 'oom', 'launch-failed', 'integrity-failure', 'abnormal-exit', 'killed']) {
  test(`a pet ${reason} exit is confined to that window and allows one replacement`, () => {
    const f = harness(); f.context.createMain(false); const main = f.windows[0]; main.emit('ready-to-show');
    f.context.showPet(); const failed = f.windows[1];
    failed.webContents.emit('render-process-gone', {}, { reason });
    assert.equal(failed.destroys, 1); assert.equal(f.run('petWindow'), null);
    assert.equal(main.destroyed, false); assert.equal(f.run('mainWindow'), main); assert.equal(f.context.backend, f.backend);
    assert.equal(f.calls.quits, 0); assert.equal(f.calls.disconnects, 0); assert.equal(f.calls.fatalErrors, 0); assert.equal(f.calls.backendCloses, 0);
    f.context.showPet(); const replacement = f.windows[2];
    assert.equal(f.windows.length, 3); assert.notEqual(replacement, failed);
    // Electron may finish events from the previous renderer after a replacement exists.
    failed.emit('ready-to-show'); failed.emit('closed');
    assert.equal(f.run('petWindow'), replacement); assert.equal(replacement.inactiveShows, 0);
    replacement.emit('ready-to-show');
    assert.equal(replacement.inactiveShows, 1); assert.equal(replacement.focuses, 0);
    f.context.showPet();
    assert.equal(f.windows.length, 3); assert.equal(replacement.inactiveShows, 2); assert.equal(main.shows, 0);
  });
}

test('a destroyed pet still referenced before its closed event is replaced without stale cleanup affecting the new window', () => {
  const f = harness(); f.context.showPet(); const old = f.windows[0]; old.destroy();
  f.context.showPet(); const replacement = f.windows[1]; old.emit('closed');
  assert.equal(f.run('petWindow'), replacement); assert.equal(f.windows.length, 2);
});

test('clean renderer exit and application shutdown do not run pet recovery', () => {
  for (const shutdown of [false, true]) {
    const f = harness(); f.context.showPet(); const pet = f.windows[0];
    if (shutdown) f.run('quitting = true');
    pet.webContents.emit('render-process-gone', {}, { reason: shutdown ? 'crashed' : 'clean-exit' });
    assert.equal(pet.destroys, 0); assert.equal(f.run('petWindow'), pet);
    assert.equal(f.calls.quits, 0); assert.equal(f.calls.disconnects, 0); assert.equal(f.calls.fatalErrors, 0);
  }
});

test('a crash during the first pet navigation does not reject the healthy main window startup', async () => {
  const f = harness({ deferredPetLoad: true }); f.context.createMain(false); f.context.showPet();
  const oldLoad = f.run('petLoaded'), failed = f.windows[1];
  failed.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
  f.context.showPet(); const replacement = f.windows[2];
  f.petNavigation.reject(Object.assign(new Error('Renderer crashed during navigation'), { code: 'ERR_FAILED' }));
  await oldLoad; await f.run('mainLoaded'); await f.run('petLoaded');
  assert.equal(f.run('petWindow'), replacement); assert.equal(f.calls.quits, 0); assert.equal(f.calls.fatalErrors, 0);
});

test('a navigation failure on a live pet window retains the existing startup error contract', async () => {
  const f = harness({ deferredPetLoad: true }); f.context.showPet();
  const failure = Object.assign(new Error('Pet page failed to load'), { code: 'ERR_FAILED' });
  const load = f.run('petLoaded'); f.petNavigation.reject(failure);
  await assert.rejects(load, error => error === failure);
  assert.equal(f.run('petWindow'), f.windows[0]); assert.equal(f.windows[0].destroyed, false);
});
