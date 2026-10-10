import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';

// Execute the production hook. Only the React scheduler, authenticated transport
// and audio hardware are isolated; the effect's epoch/revision guards stay real.
const fakeModules = {
  react: `export const useRef=(...args)=>globalThis.__voiceAuthScope.useRef(...args);export const useState=(...args)=>globalThis.__voiceAuthScope.useState(...args);export const useEffect=(...args)=>globalThis.__voiceAuthScope.useEffect(...args);export const useCallback=(...args)=>globalThis.__voiceAuthScope.useCallback(...args);`,
  api: `export const api=(...args)=>globalThis.__voiceAuthScope.api(...args);export const apiSpeechAudio=()=>{throw new Error('Fixture cannot synthesize audio');};export const apiSpeechStream=()=>{throw new Error('Fixture cannot stream audio');};export const getConnection=()=>globalThis.__voiceAuthScope.connection;export const getIdentity=()=>globalThis.__voiceAuthScope.identity;export const getSessionEpoch=()=>globalThis.__voiceAuthScope.epoch;export const isSessionChanged=error=>error?.name==='SessionChangedError';`,
  speech: `export const createSpeechController=options=>globalThis.__voiceAuthScope.createPlayer('system',options);export const selectSpeechVoice=voices=>voices[0]||null;`,
  remote: `export const createRemoteSpeechController=options=>globalThis.__voiceAuthScope.createPlayer('remote',options);`,
  stream: `export const createStreamingSpeechController=options=>globalThis.__voiceAuthScope.createPlayer('stream',options);`,
};
const bundled = await build({ entryPoints: [fileURLToPath(new URL('../src/avatar/useSpeech.ts', import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'node', plugins: [{ name: 'speech-account-boundaries', setup(plugin) {
  plugin.onResolve({ filter: /.*/ }, args => {
    if (args.path === 'react') return { path: 'react', namespace: 'speech-account-fake' };
    if (!args.importer.replaceAll('\\', '/').endsWith('/src/avatar/useSpeech.ts')) return;
    const key = { '../api': 'api', './speech.mjs': 'speech', './remote-speech.mjs': 'remote', './stream-speech.mjs': 'stream' }[args.path];
    if (key) return { path: key, namespace: 'speech-account-fake' };
  });
  plugin.onLoad({ filter: /.*/, namespace: 'speech-account-fake' }, args => ({ contents: fakeModules[args.path], loader: 'js' }));
} }] });
const { useSpeech } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

// Compile the callers' actual scope initializers, rather than reproducing their
// account fallback in this fixture. The first scope is the main page, not Settings.
async function pageScope(file) {
  const source = await readFile(new URL(file, import.meta.url), 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  const declarations = new Map();
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && ['voiceIdentity', 'voiceScope'].includes(node.name.text) && !declarations.has(node.name.text)) declarations.set(node.name.text, node.initializer.getText(ast));
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(declarations.has('voiceScope'), `${file} must expose its real account scope`);
  const body = `${declarations.has('voiceIdentity') ? `const voiceIdentity=${declarations.get('voiceIdentity')};` : ''}const voiceScope=${declarations.get('voiceScope')};return voiceScope;`;
  const compiled = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return new Function('state', 'session', 'user', 'getIdentity', 'getConnection', 'location', compiled);
}
const scopes = await Promise.all([pageScope('../src/App.tsx'), pageScope('../src/CompanionWorld.tsx')]);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let index = 0; index < 30; index++) await Promise.resolve(); };
const settings = (speed = 1) => ({ tts: { mode: 'cosyvoice', speed } });
class Surface extends EventTarget {
  listeners = new Map();
  addEventListener(type, callback, options) { super.addEventListener(type, callback, options); const entries = this.listeners.get(type) || new Set(); entries.add(callback); this.listeners.set(type, entries); }
  removeEventListener(type, callback, options) { super.removeEventListener(type, callback, options); this.listeners.get(type)?.delete(callback); }
  get listenerCount() { return [...this.listeners.values()].reduce((sum, entries) => sum + entries.size, 0); }
}
function harness(context, scope) {
  const slots = [], effects = [], calls = [], players = [], preferences = new Map();
  let cursor = 0, disposed = false, bootstrap = {}, allowed = true;
  const same = (left, right) => left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
  const runtime = {
    epoch: 1, identity: { instanceId: 'server-one', userId: 'member-one' }, connection: { token: 'fixture-token', url: 'https://fixture.invalid' }, lateWrites: 0,
    useRef(value) { const index = cursor++; return (slots[index] ??= { current: value }); },
    useState(initial) { const index = cursor++; slots[index] ??= { value: typeof initial === 'function' ? initial() : initial }; return [slots[index].value, next => { if (disposed) { runtime.lateWrites++; return; } slots[index].value = typeof next === 'function' ? next(slots[index].value) : next; }]; },
    useCallback(callback, deps) { const index = cursor++; if (!same(slots[index]?.deps, deps)) slots[index] = { callback, deps }; return slots[index].callback; },
    useEffect(callback, deps) { const index = cursor++, previous = slots[index]; if (!same(previous?.deps, deps)) { const next = { deps, cleanup: null }; slots[index] = next; effects.push(() => { previous?.cleanup?.(); next.cleanup = callback(); }); } },
    api(path, options) { assert.equal(path, '/voice', 'account configuration reads must never invoke a synthesis upstream'); const pending = deferred(); calls.push({ path, options, ...pending }); return pending.promise; },
    createPlayer(kind, options) { const player = { kind, options, disposed: false, stops: 0, unlocks: 0, stop() { this.stops++; }, dispose() { this.disposed = true; }, unlock() { this.unlocks++; return Promise.resolve(true); }, speak() { return true; }, snapshot() { return { error: '' }; } }; players.push(player); return player; },
  };
  const window = new Surface(), document = new Surface(), devices = new Surface(); document.hidden = false;
  window.localStorage = { getItem: key => preferences.get(key) || null };
  const values = { __voiceAuthScope: runtime, window, document, navigator: { mediaDevices: devices, language: 'zh-CN' }, AudioContext: class FixtureAudioContext {}, Audio: class FixtureAudio {} };
  const descriptors = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { value, configurable: true });
  function render(options = {}) {
    if (Object.hasOwn(options, 'bootstrap')) bootstrap = options.bootstrap;
    if (Object.hasOwn(options, 'allowed')) allowed = options.allowed;
    cursor = 0;
    const voiceScope = scope(bootstrap, bootstrap.instanceId ? bootstrap : null, bootstrap.user, () => runtime.identity, () => runtime.connection, { origin: 'https://fixture.invalid' });
    const voice = useSpeech(allowed, voiceScope);
    while (effects.length) effects.shift()();
    return { ...voice, scope: voiceScope };
  }
  function dispose() {
    if (disposed) return;
    for (const slot of slots) slot?.cleanup?.();
    disposed = true;
    assert.equal(window.listenerCount + document.listenerCount + devices.listenerCount, 0, 'unmount must detach all hardware and account listeners');
  }
  context.after(() => { dispose(); for (const [key, descriptor] of descriptors) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; });
  return { runtime, render, calls, players, preferences, window, dispose };
}

for (const [index, page] of ['Chat workspace', 'Companion home'].entries()) {
  test(`${page}: a stored token without verified identity cannot read voice settings`, context => {
    const h = harness(context, scopes[index]); h.runtime.identity = null;
    const voice = h.render(); assert.ok(voice.scope.startsWith('guest')); assert.equal(h.calls.length, 0); assert.equal(h.players.length, 0);
    assert.equal(h.render().supported, false); assert.match(h.render().feedback, /先登录账号/);
  });

  test(`${page}: authenticated delayed bootstrap reads voice once and preserves the installed player`, async context => {
    const h = harness(context, scopes[index]);
    assert.equal(h.render({ allowed: index === 0 }).scope, 'server-one:member-one');
    assert.equal(h.calls.length, 1);
    h.calls[0].resolve(settings()); await flush();
    const before = h.render(); assert.equal(before.supported, true); assert.equal(before.engine, 'cosyvoice'); assert.equal(h.players.length, 1);
    const player = h.players[0];
    h.preferences.set('petpal.mediaDevices:server-one%3Amember-one', JSON.stringify({ speakerId: 'account-headphones' }));
    assert.equal(player.options.getSpeakerId(), 'account-headphones', 'player starts with the authenticated device preference, not guest preference');
    const after = h.render({ bootstrap: { instanceId: 'server-one', user: { id: 'member-one' } }, allowed: true });
    assert.equal(after.scope, before.scope); assert.equal(h.calls.length, 1); assert.equal(h.players.length, 1); assert.equal(player.disposed, false);
    after.setEnabled(true); await flush();
    assert.equal(h.render().enabled, true); assert.equal(player.unlocks, 1); assert.equal(h.calls.length, 1);
  });

  test(`${page}: account replacement aborts the old request and fences its late configuration`, async context => {
    const h = harness(context, scopes[index]); h.render();
    const old = h.calls[0]; h.runtime.epoch++; h.runtime.identity = { instanceId: 'server-one', userId: 'member-two' };
    h.window.dispatchEvent(new Event('petpal:session-change'));
    assert.equal(h.render({ bootstrap: {} }).scope, 'server-one:member-two');
    assert.equal(old.options.signal.aborted, true); assert.equal(h.calls.length, 2);
    h.calls[1].resolve(settings()); await flush();
    assert.equal(h.render().supported, true); assert.equal(h.players.length, 1);
    old.resolve(settings(1.25)); await flush();
    assert.equal(h.players.length, 1, 'transport ignoring abort cannot install the former account player'); assert.equal(h.players[0].kind, 'stream');
    h.render({ bootstrap: { instanceId: 'server-one', user: { id: 'member-two' } } }); assert.equal(h.calls.length, 2);
  });

  test(`${page}: a new server with the same user ID replaces the player; logout performs no voice read`, async context => {
    const h = harness(context, scopes[index]); h.render(); h.calls[0].resolve(settings()); await flush();
    const first = h.players[0]; h.runtime.epoch++; h.runtime.identity = { instanceId: 'server-two', userId: 'member-one' };
    h.window.dispatchEvent(new Event('petpal:session-change'));
    assert.equal(h.render({ bootstrap: {} }).scope, 'server-two:member-one'); assert.equal(first.disposed, true); assert.equal(h.calls.length, 2);
    h.calls[1].resolve(settings()); await flush(); assert.equal(h.players.length, 2);
    const second = h.players[1]; h.runtime.epoch++; h.runtime.identity = null; h.runtime.connection.token = '';
    h.window.dispatchEvent(new Event('petpal:session-change')); h.render({ bootstrap: {}, allowed: false });
    assert.equal(second.disposed, true); assert.equal(h.calls.length, 2); assert.equal(h.render().supported, false);
  });
}

test('real speech hook cancels an in-flight read on unmount and cannot publish its late result', async context => {
  const h = harness(context, scopes[0]); h.render(); const pending = h.calls[0]; h.dispose();
  assert.equal(pending.options.signal.aborted, true); pending.resolve(settings()); await flush();
  assert.equal(h.players.length, 0); assert.equal(h.runtime.lateWrites, 0);
});

test('real speech hook revision fences older settings reloads within the same account', async context => {
  const h = harness(context, scopes[0]); h.render(); const first = h.calls[0];
  h.window.dispatchEvent(new Event('petpal:voice-settings-change')); assert.equal(first.options.signal.aborted, true); assert.equal(h.calls.length, 2);
  h.calls[1].resolve(settings()); await flush(); first.resolve(settings(1.25)); await flush();
  assert.equal(h.players.length, 1); assert.equal(h.players[0].kind, 'stream'); assert.equal(h.render().streamingEnabled, true);
});
