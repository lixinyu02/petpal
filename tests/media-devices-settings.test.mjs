import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import * as preferencesModule from '../src/media/device-preferences.mjs';

const transpile = async path => ts.transpileModule(await readFile(new URL(path, import.meta.url), 'utf8'), {
  fileName: path, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
const componentSource = await transpile('../src/MediaDevicesSettings.tsx');
const devicesSource = await transpile('../src/media/devices.ts');
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : !tree || typeof tree !== 'object' ? [] : [tree, ...nodes(tree.props?.children)];
const text = tree => Array.isArray(tree) ? tree.map(text).join(' ') : typeof tree === 'string' ? tree : tree && typeof tree === 'object' ? text(tree.props?.children) : '';
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const deviceList = label => [
  { kind: 'audioinput', deviceId: 'mic-one', label: `${label}麦克风` },
  { kind: 'videoinput', deviceId: 'camera-one', label: `${label}摄像头` },
  { kind: 'audiooutput', deviceId: 'speaker-one', label: `${label}扬声器` },
];

/** Execute the real settings component, effects and media helper against browser events. */
function fixture({ listed = deviceList('旧'), enumerate, capture, secure = true } = {}) {
  const hooks = [], effects = [], frames = new Map(), enumerationCalls = [], captureCalls = [];
  const document = new EventTarget(), window = new EventTarget(), mediaDevices = new EventTarget();
  let scope = 'account-one', index = 0, tree, dirty = false, mounted = true, frameId = 0, afterUnmountUpdates = 0;
  document.hidden = false;
  const values = new Map([['petpal.mediaDevices:account-one', JSON.stringify({ microphoneId: 'mic-one', cameraId: 'camera-one', speakerId: 'speaker-one' })]]);
  Object.assign(window, { isSecureContext: secure, localStorage: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) } });
  mediaDevices.enumerateDevices = async () => { enumerationCalls.push(true); return enumerate ? enumerate(enumerationCalls.length) : listed; };
  mediaDevices.getUserMedia = async constraints => { captureCalls.push(constraints); return capture ? capture(constraints) : Promise.reject(new Error('unexpected media capture')); };
  const same = (left, right) => left && right && left.length === right.length && left.every((value, at) => Object.is(value, right[at]));
  const react = {
    useState(initial) {
      const at = index++; hooks[at] ||= { value: typeof initial === 'function' ? initial() : initial };
      return [hooks[at].value, next => { if (!mounted) afterUnmountUpdates++; hooks[at].value = typeof next === 'function' ? next(hooks[at].value) : next; dirty = true; }];
    },
    useRef(initial) { const at = index++; hooks[at] ||= { ref: { current: initial } }; return hooks[at].ref; },
    useEffect(effect, deps) { const at = index++, previous = hooks[at]; if (!same(previous?.deps, deps)) effects.push(() => { previous?.cleanup?.(); hooks[at] = { deps, cleanup: effect() }; }); },
  };
  const video = { pause() {}, async play() {}, srcObject: null };
  class HTMLMediaElement { async setSinkId() {} }
  const context = {
    window, document, navigator: { mediaDevices }, HTMLMediaElement, URL, Blob, Event,
    requestAnimationFrame(callback) { const id = ++frameId; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
  };
  const helperModule = { exports: {} };
  vm.runInNewContext(devicesSource, { ...context, module: helperModule, exports: helperModule.exports });
  const modules = {
    react, 'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'lucide-react': new Proxy({}, { get: (_target, name) => Symbol.for(String(name)) }),
    './media/device-preferences.mjs': preferencesModule, './media/devices': helperModule.exports,
  };
  const module = { exports: {} };
  vm.runInNewContext(componentSource, { ...context, module, exports: module.exports, require: name => { assert.ok(Object.hasOwn(modules, name), name); return modules[name]; } });
  const find = (type, predicate = () => true) => nodes(tree).find(node => node.type === type && predicate(node.props));
  const render = () => {
    index = 0; dirty = false; effects.length = 0;
    tree = module.exports.default({ scope });
    find('video').props.ref.current = video;
    for (const effect of effects) effect();
  };
  const flush = async () => { for (let tick = 0; tick < 14; tick++) { await Promise.resolve(); if (dirty && mounted) render(); } };
  render();
  return {
    find, flush, enumerationCalls, captureCalls, values, video,
    get afterUnmountUpdates() { return afterUnmountUpdates; }, get frameCount() { return frames.size; },
    picker(label) { return find('select', props => props['aria-label'] === label); },
    click(label) { find('button', props => text(props.children).includes(label)).props.onClick(); },
    labels(label) { return nodes(this.picker(label)).filter(node => node.type === 'option').map(node => text(node)); },
    setListed(value) { listed = value; },
    hidden(value) { document.hidden = value; document.dispatchEvent(new Event('visibilitychange')); },
    focus() { window.dispatchEvent(new Event('focus')); },
    pagehide() { window.dispatchEvent(new Event('pagehide')); },
    pageshow() { window.dispatchEvent(new Event('pageshow')); },
    devicechange() { mediaDevices.dispatchEvent(new Event('devicechange')); },
    changeSession() { window.dispatchEvent(new Event('petpal:session-change')); },
    changeScope(next) { scope = next; render(); },
    async frames() { const pending = [...frames.values()]; frames.clear(); for (const callback of pending) callback(); await flush(); },
    close() { if (!mounted) return; mounted = false; for (const hook of hooks) hook?.cleanup?.(); },
    text() { return text(tree); },
  };
}

test('foreground permission recovery coalesces visible/focus/pageshow and preserves every selected device', async t => {
  const f = fixture(); t.after(() => f.close()); await f.flush();
  assert.equal(f.enumerationCalls.length, 1);
  f.hidden(true); f.setListed(deviceList('授权后'));
  f.hidden(false); f.focus(); f.pageshow();
  assert.equal(f.frameCount, 1); assert.equal(f.enumerationCalls.length, 1);
  await f.frames();
  assert.equal(f.enumerationCalls.length, 2); assert.equal(f.captureCalls.length, 0);
  for (const [label, selected] of [['麦克风', 'mic-one'], ['摄像头', 'camera-one'], ['扬声器', 'speaker-one']]) {
    assert.equal(f.picker(label).props.value, selected);
    assert.ok(f.labels(label).some(value => value.startsWith('授权后')));
  }
  assert.equal(f.values.size, 1, 'refresh must not write a different account or speech draft');
});

test('focus and BFCache return recover labels without enumerating while the page is hidden', async t => {
  const f = fixture(); t.after(() => f.close()); await f.flush();
  f.hidden(true); f.focus(); f.pageshow(); f.devicechange(); await f.frames();
  assert.equal(f.enumerationCalls.length, 1);
  f.hidden(false); await f.frames();
  f.setListed(deviceList('外部设置后')); f.focus(); await f.frames();
  assert.equal(f.enumerationCalls.length, 3); assert.match(f.labels('摄像头').join(' '), /外部设置后摄像头/);
  f.pagehide(); f.setListed(deviceList('返回后')); f.pageshow(); await f.frames();
  assert.equal(f.enumerationCalls.length, 4); assert.match(f.labels('麦克风').join(' '), /返回后麦克风/);
  assert.equal(f.captureCalls.length, 0);
});

test('foreground and manual refresh wait for the actual capture permission request, then refresh once', async t => {
  for (const [label, kind, id] of [['预览摄像头', 'video', 'camera-one'], ['测试麦克风', 'audio', 'mic-one']]) {
    const permission = deferred(), f = fixture({ capture: () => permission.promise }); t.after(() => f.close()); await f.flush();
    f.click(label); f.click(label);
    assert.equal(f.captureCalls.length, 1, 'a repeated click must not open another permission request');
    assert.equal(f.captureCalls[0][kind === 'audio' ? 'video' : 'audio'], false); assert.equal(f.captureCalls[0][kind].deviceId.exact, id);
    f.focus(); f.pageshow(); await f.frames(); f.click('刷新设备'); f.devicechange();
    assert.equal(f.enumerationCalls.length, 1, 'enumeration must not overlap the system permission prompt');
    f.setListed(deviceList('权限变化后')); permission.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' })); await f.flush();
    assert.equal(f.enumerationCalls.length, 2); assert.equal(f.captureCalls.length, 1);
    assert.match(f.labels('麦克风').join(' '), /权限变化后麦克风/);
    assert.match(f.text(), /设备权限未获允许/);
  }
});

test('hiding an active camera releases its tracks and returning only enumerates, never restarts capture', async t => {
  const track = new EventTarget(); let stopped = 0; track.stop = () => { stopped++; };
  const stream = { getTracks: () => [track] }, f = fixture({ capture: async () => stream }); t.after(() => f.close()); await f.flush();
  f.click('预览摄像头'); await f.flush();
  assert.equal(f.video.srcObject, stream); assert.equal(f.find('video').props.hidden, false);
  f.hidden(true); await f.flush();
  assert.equal(stopped, 1); assert.equal(f.video.srcObject, null); assert.equal(f.find('video').props.hidden, true);
  f.hidden(false); f.focus(); await f.frames();
  assert.equal(f.captureCalls.length, 1); assert.equal(stopped, 1);
});

test('account replacement rejects stale enumeration and queued focus, and loads only the new account choice', async t => {
  const old = deferred(), f = fixture({ enumerate: count => count === 1 ? old.promise : deviceList('新账号') }); t.after(() => f.close());
  f.focus(); f.changeSession(); assert.equal(f.frameCount, 0);
  f.focus(); f.pageshow(); f.devicechange(); await f.frames();
  assert.equal(f.enumerationCalls.length, 1);
  f.values.set('petpal.mediaDevices:account-two', JSON.stringify({ microphoneId: 'mic-two', cameraId: '', speakerId: '' }));
  f.changeScope('account-two'); await f.flush(); old.resolve(deviceList('旧账号迟到')); await f.flush();
  assert.equal(f.picker('麦克风').props.value, 'mic-two');
  assert.match(f.labels('麦克风').join(' '), /新账号麦克风/);
  assert.doesNotMatch(f.text(), /旧账号迟到/);
  assert.equal(f.captureCalls.length, 0);
});

test('unmount cancels queued recovery, ignores late enumeration and stops late granted capture tracks', async () => {
  const enumeration = deferred(), f = fixture({ enumerate: () => enumeration.promise });
  f.focus(); assert.equal(f.frameCount, 1); f.close(); assert.equal(f.frameCount, 0);
  enumeration.resolve(deviceList('迟到')); f.focus(); f.pageshow(); f.devicechange(); await f.frames();
  assert.equal(f.afterUnmountUpdates, 0); assert.equal(f.enumerationCalls.length, 1);
  const permission = deferred(), capturing = fixture({ capture: () => permission.promise }); await capturing.flush();
  capturing.click('预览摄像头'); capturing.focus(); await capturing.frames(); capturing.close();
  let stopped = 0; permission.resolve({ getTracks: () => [{ stop() { stopped++; } }] }); await capturing.flush();
  assert.equal(stopped, 1); assert.equal(capturing.afterUnmountUpdates, 0); assert.equal(capturing.enumerationCalls.length, 1);
});

test('insecure environments never enumerate on restore or automatically ask for input permission', async t => {
  const f = fixture({ secure: false }); t.after(() => f.close()); await f.flush();
  f.focus(); f.pageshow(); f.hidden(true); f.hidden(false); await f.frames();
  assert.equal(f.enumerationCalls.length, 0); assert.equal(f.captureCalls.length, 0);
  assert.equal(f.picker('麦克风').props.disabled, true); assert.match(f.text(), /HTTPS/);
});
