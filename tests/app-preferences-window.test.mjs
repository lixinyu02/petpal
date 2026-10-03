import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';
import ts from 'typescript';

const source = await readFile(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('main.cjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
function harness({ tray = true } = {}) {
  const preferences = { closeToTray: true, petAlwaysOnTop: true }, windows = [];
  const calls = { quits: 0, cancels: 0 };
  class Window extends EventEmitter {
    constructor(options) { super(); this.options = options; this.webContents = new EventEmitter(); this.shows = 0; this.hidden = 0; this.tops = []; windows.push(this); }
    show() { this.shows++; } hide() { this.hidden++; } focus() {} showInactive() { this.shows++; }
    isDestroyed() { return false; } isMinimized() { return false; }
    setAlwaysOnTop(value, level) { this.tops.push({ value, level }); }
    setVisibleOnAllWorkspaces() {} loadURL() { return Promise.resolve(); }
  }
  const context = vm.createContext({
    BrowserWindow: Window, app: { quit() { calls.quits++; } },
    appPreferences: { current: () => ({ ...preferences }) },
    mainWindowLayout: () => ({}), petWindowLayout: () => ({}),
    screen: { getPrimaryDisplay: () => ({ workArea: {} }) },
    trackWindowDisplay() {}, fitWindowToDisplay() {}, secureWindow() {}, rendererFailure() {},
    path: { join: (...parts) => parts.join('/') }, __dirname: 'desktop', iconPath: 'icon.png',
    process: { platform: 'win32' }, remoteHttp: { cancelOwner() { calls.cancels++; } },
    executor: { async disconnect() {} },
  });
  const functions = ['createMain', 'showMain', 'showPet', 'applyPetWindowPreferences'].map(name => {
    const declaration = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    assert.ok(declaration, name); return declaration.getText(parsed);
  });
  vm.runInContext(`let mainWindow,petWindow,mainLoaded,petLoaded,quitting=false;let tray=${tray ? '{}' : 'null'};let origin='http://localhost';${functions.join('\n')}`, context);
  return { preferences, windows, calls, context };
}
function close(win) { let prevented = false; win.emit('close', { preventDefault() { prevented = true; } }); return prevented; }

test('a hidden startup stays in tray until explicitly opened without hiding a second-instance request', () => {
  const f = harness(); f.context.createMain(false); const main = f.windows[0];
  main.emit('ready-to-show'); assert.equal(main.shows, 0);
  f.context.showMain(); assert.equal(main.shows, 1);
  const early = harness(); early.context.createMain(false); early.context.showMain();
  early.windows[0].emit('ready-to-show'); assert.equal(early.windows[0].shows, 1);
});
test('visible startup and absence of a usable tray cannot strand a hidden main window', () => {
  const normal = harness(); normal.context.createMain(); normal.windows[0].emit('ready-to-show'); assert.equal(normal.windows[0].shows, 1);
  const noTray = harness({ tray: false }); noTray.context.createMain(false); noTray.windows[0].emit('ready-to-show'); assert.equal(noTray.windows[0].shows, 1);
});

test('an OS autostart duplicate preserves the tray while manual relaunch opens the main window', () => {
  const f = harness(); let received;
  f.context.app.on = (event, callback) => { assert.equal(event, 'second-instance'); received = callback; };
  const lifecycle = parsed.statements.find(node => ts.isIfStatement(node) && node.expression.getText(parsed).includes('requestSingleInstanceLock'));
  const registration = lifecycle.elseStatement.statements.find(node => ts.isExpressionStatement(node) && node.getText(parsed).startsWith("app.on('second-instance'"));
  assert.ok(registration);
  vm.runInContext(registration.getText(parsed), f.context);
  f.context.createMain(false);
  received({}, ['PetPal.exe', '--petpal-autostart']);
  f.windows[0].emit('ready-to-show');
  assert.equal(f.windows[0].shows, 0);
  received({}, ['PetPal.exe']);
  assert.equal(f.windows[0].shows, 1);
});
test('close-to-tray preserves active frontend requests while close-to-exit follows the complete app shutdown', () => {
  const f = harness(); f.context.createMain(); const main = f.windows[0];
  assert.equal(close(main), true); assert.equal(main.hidden, 1); assert.equal(f.calls.cancels, 0); assert.equal(f.calls.quits, 0);
  f.preferences.closeToTray = false;
  assert.equal(close(main), true); assert.equal(f.calls.cancels, 1); assert.equal(f.calls.quits, 1);
  vm.runInContext('quitting=true', f.context);
  assert.equal(close(main), false); assert.equal(f.calls.quits, 1);
});
test('closing without a tray still quits even if the stored close-to-tray option is enabled', () => {
  const f = harness({ tray: false }); f.context.createMain();
  assert.equal(close(f.windows[0]), true); assert.equal(f.calls.quits, 1);
});
test('pet topmost preference applies on creation and immediately after a saved change', () => {
  const f = harness(); f.preferences.petAlwaysOnTop = false; f.context.showPet(); const pet = f.windows[0];
  assert.equal(pet.options.alwaysOnTop, false); assert.deepEqual(pet.tops[0], { value: false, level: 'normal' });
  f.preferences.petAlwaysOnTop = true; f.context.applyPetWindowPreferences();
  assert.deepEqual(pet.tops[1], { value: true, level: 'pop-up-menu' });
  f.context.showPet(); assert.equal(f.windows.length, 1); assert.equal(pet.shows, 1);
});

test('application quit waits for pending preference rollback before exiting the process', async () => {
  const f = harness(); let received, finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const exits = [], closures = [];
  f.context.app.on = (event, callback) => { assert.equal(event, 'before-quit'); received = callback; };
  f.context.app.exit = code => exits.push(code);
  f.context.appPreferences.close = () => { closures.push('preferences'); return pending; };
  f.context.executor.close = async () => { closures.push('executor'); };
  f.context.remoteHttp.close = async () => { closures.push('requests'); };
  f.context.console = { error() { assert.fail('Unexpected shutdown failure'); } };
  vm.runInContext('let updates, pendingUpdate, backend, exitCode=0; tray={destroy(){}};', f.context);
  const lifecycle = parsed.statements.find(node => ts.isIfStatement(node) && node.expression.getText(parsed).includes('requestSingleInstanceLock'));
  const registration = lifecycle.elseStatement.statements.find(node => ts.isExpressionStatement(node) && node.getText(parsed).startsWith("app.on('before-quit'"));
  assert.ok(registration); vm.runInContext(registration.getText(parsed), f.context);
  let prevented = false;
  received({ preventDefault() { prevented = true; } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(prevented, true); assert.deepEqual(closures.sort(), ['executor','preferences','requests']);
  assert.equal(exits.length, 0, 'OS rollback must finish before process exit');
  finish(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(exits, [0]);
  received({ preventDefault() { assert.fail('Reentrant quit'); } });
  assert.deepEqual(exits, [0]);
});
