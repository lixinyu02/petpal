import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';
import ts from 'typescript';

const source = await readFile(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('main.cjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const functions = ['mainWindowState', 'applyMainStartupFullscreen', 'setMainFullscreen', 'toggleMainFullscreen', 'createMain', 'showMain'].map(name => {
  const declaration = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, name); return declaration.getText(parsed);
});
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
function fixture({ startFullscreen = false, tray = true, automatic = true } = {}) {
  const windows = [], timers = new Map(); let timerId = 0;
  class Window extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.full = false; this.destroyed = false; this.shows = 0; this.focuses = 0;
      this.requests = []; this.sent = []; this.webContents = new EventEmitter();
      this.webContents.send = (...args) => this.sent.push(args); windows.push(this);
    }
    show() { this.shows++; } focus() { this.focuses++; } hide() {}
    isDestroyed() { return this.destroyed; } isMinimized() { return false; } isFullScreen() { return this.full; }
    setFullScreen(enabled) { this.requests.push(enabled); if (automatic) this.ack(enabled); }
    ack(enabled) { this.full = enabled; this.emit(enabled ? 'enter-full-screen' : 'leave-full-screen'); }
    loadURL() { return Promise.resolve(); }
    close() { this.destroyed = true; this.emit('closed'); }
  }
  const preferences = { startFullscreen, closeToTray: true }, context = vm.createContext({
    BrowserWindow: Window, appPreferences: { current: () => ({ ...preferences }) }, app: { quit() {} },
    appearance: { current: () => ({ preference: 'day', theme: 'day', saved: false }), refresh: () => ({ preference: 'day', theme: 'day', saved: false }) },
    APPEARANCE_COLORS: { day: '#fafbf8', night: '#151515' }, appearanceArguments: () => ['--petpal-appearance=day:day:0'], crypto: { randomUUID: () => '12345678-1234-1234-1234-123456789abc' },
    screen: { getPrimaryDisplay: () => ({ workArea: {} }) }, mainWindowLayout: () => ({}),
    trackWindowDisplay() {}, fitWindowToDisplay() {}, secureWindow() {}, rendererFailure() {},
    path: { join: (...args) => args.join('/') }, __dirname: 'desktop', iconPath: 'icon.png',
    remoteHttp: { cancelOwner() {} }, executor: { async disconnect() {} },
    setTimeout(fn, ms) { assert.equal(ms, 3000); timers.set(++timerId, fn); return timerId; },
    clearTimeout(id) { timers.delete(id); },
  });
  vm.runInContext(`let mainWindow,mainLoaded,quitting=false,mainFullscreenChange=null,mainStartupFullscreenPending=false,appearanceSessionId;
    let mainWindowCreated=false,pendingMainReveal=false,origin='http://localhost',tray=${tray ? '{}' : 'null'};
    ${functions.join('\n')}`, context);
  const input = (key, extra = {}) => {
    let prevented = false;
    windows[0].webContents.emit('before-input-event', { preventDefault() { prevented = true; } }, { type: 'keyDown', key, ...extra });
    return prevented;
  };
  return { context, windows, preferences, timers, input, run: code => vm.runInContext(code, context) };
}

test('fullscreen startup covers the main window on first reveal without making a tray-only startup visible', () => {
  const f = fixture({ startFullscreen: true }); f.context.createMain(false); const win = f.windows[0];
  win.emit('ready-to-show'); assert.equal(win.shows, 0); assert.deepEqual(win.requests, []);
  f.context.showMain(); assert.equal(win.shows, 1); assert.equal(win.full, true); assert.deepEqual(win.requests, [true]);
  win.ack(false); f.context.showMain(); assert.deepEqual(win.requests, [true], 'Manual exit must remain windowed in this session');
  assert.equal(f.preferences.startFullscreen, true, 'Immediate changes never rewrite the launch preference');
});

test('visible and no-tray startup apply fullscreen once, while ordinary startup stays windowed', () => {
  for (const tray of [true, false]) {
    const f = fixture({ startFullscreen: true, tray }); f.context.createMain(tray); f.windows[0].emit('ready-to-show');
    assert.equal(f.windows[0].shows, 1); assert.deepEqual(f.windows[0].requests, [true]);
  }
  const f = fixture(); f.context.createMain(); f.windows[0].emit('ready-to-show');
  assert.equal(f.windows[0].full, false); assert.deepEqual(f.windows[0].requests, []);
});

test('a manual reveal during startup cannot apply fullscreen twice', () => {
  const f = fixture({ startFullscreen: true }); f.context.createMain(false); f.context.showMain();
  f.windows[0].emit('ready-to-show'); assert.deepEqual(f.windows[0].requests, [true]); assert.equal(f.windows[0].shows, 1);
});

test('native transitions wait for the window manager and publish only the actual boolean state', async () => {
  const f = fixture({ automatic: false }); f.context.createMain(); const win = f.windows[0];
  let finished = false; const request = f.context.setMainFullscreen(true).then(() => { finished = true; }); await flush();
  assert.equal(finished, false); assert.equal(f.context.mainWindowState().fullscreen, false);
  win.ack(true); await request; assert.equal(finished, true); assert.equal(f.context.mainWindowState().fullscreen, true);
  assert.deepEqual(JSON.parse(JSON.stringify(win.sent.at(-1))), ['petpal:window-state', { fullscreen: true }]); assert.equal(f.timers.size, 0);
});

test('rapid fullscreen toggles are serialized and each operation rechecks authorization after waiting', async () => {
  const f = fixture({ automatic: false }); f.context.createMain(); const win = f.windows[0]; let allowed = true, checks = 0;
  const authorize = () => { checks++; if (!allowed) throw new Error('account changed'); };
  const first = f.context.setMainFullscreen(true, authorize), second = f.context.setMainFullscreen(false, authorize);
  const rejected = assert.rejects(second, /account changed/); await flush();
  assert.deepEqual(win.requests, [true]); allowed = false; win.ack(true); await first; await rejected;
  assert.equal(checks, 2); assert.deepEqual(win.requests, [true]); assert.equal(win.full, true);
  const third = f.context.setMainFullscreen(false); await flush(); win.ack(false); await third;
  assert.deepEqual(win.requests, [true, false]); assert.equal(f.timers.size, 0);
});

test('F11 and Escape operate the main window, ignore key repeats/modifiers and preserve startup settings', async () => {
  const f = fixture(); f.context.createMain(); const win = f.windows[0];
  assert.equal(f.input('Escape'), false); assert.equal(f.input('F11', { control: true }), false);
  assert.equal(f.input('F11', { isAutoRepeat: true }), false); assert.equal(f.input('F11'), true); await flush();
  assert.equal(win.full, true); assert.equal(f.input('Escape'), true); await flush(); assert.equal(win.full, false);
  assert.equal(f.preferences.startFullscreen, false);
});

test('Escape cancels a pending fullscreen transition and a timeout cleans listeners for retry', async () => {
  const f = fixture({ automatic: false }); f.context.createMain(); const win = f.windows[0];
  assert.equal(f.input('F11'), true); await flush(); assert.equal(f.input('Escape'), true);
  win.ack(true); await flush(); assert.deepEqual(win.requests, [true, false]); win.ack(false); await flush();
  assert.equal(win.full, false); assert.equal(f.timers.size, 0);
  const pending = f.context.setMainFullscreen(true); const rejected = assert.rejects(pending, /timed out/);
  await flush(); const deadline = [...f.timers.values()][0]; deadline(); await rejected;
  assert.equal(win.listenerCount('enter-full-screen'), 1, 'Only the long-lived state notification remains');
  assert.equal(f.timers.size, 0);
});

test('a closing window rejects a pending transition and never applies a queued operation to a replacement', async () => {
  const f = fixture({ automatic: false }); f.context.createMain(); const win = f.windows[0];
  const first = f.context.setMainFullscreen(true), second = f.context.setMainFullscreen(false);
  const a = assert.rejects(first, /closed/), b = assert.rejects(second, /unavailable/); await flush();
  win.close(); f.context.createMain(); await a; await b;
  assert.deepEqual(f.windows[1].requests, []); assert.equal(f.timers.size, 0);
});
