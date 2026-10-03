import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

const transpile = async path => ts.transpileModule(await readFile(new URL(path, import.meta.url), 'utf8'), {
  fileName: path, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
const componentSource = await transpile('../src/ClientBehaviorSettings.tsx');
const platformSource = await transpile('../src/platform/app-preferences.ts');
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : !tree || typeof tree !== 'object' ? [] : [tree, ...nodes(tree.props?.children)];
const initial = { platform: 'win32', autoLaunchSupported: true, autoLaunch: false, startMinimized: false, showPetOnLaunch: true, closeToTray: true, petAlwaysOnTop: true };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

/** Real component effects/handlers, with isolated host bridge and account lifecycle. */
function fixture({ platform = 'desktop', connected = true, value = initial, read = null, write = null } = {}) {
  const hooks = [], effects = [], statusCalls = [], updates = [], downloads = [];
  let actual = { ...value }, epoch = 1, identity = { instanceId: 'fixture-host', userId: 'fixture-user' };
  let index = 0, tree, dirty = false, mounted = true, afterUnmountUpdates = 0;
  const same = (left, right) => left && right && left.length === right.length && left.every((entry, at) => Object.is(entry, right[at]));
  const react = {
    useState(initialValue) {
      const at = index++; hooks[at] ||= { value: typeof initialValue === 'function' ? initialValue() : initialValue };
      return [hooks[at].value, next => { if (!mounted) afterUnmountUpdates++; hooks[at].value = typeof next === 'function' ? next(hooks[at].value) : next; dirty = true; }];
    },
    useRef(initialValue) { const at = index++; hooks[at] ||= { ref: { current: initialValue } }; return hooks[at].ref; },
    useId() { index++; return 'fixture-behavior'; },
    useSyncExternalStore(_subscribe, snapshot) { index++; return snapshot(); },
    useEffect(effect, deps) { const at = index++, previous = hooks[at]; if (!same(previous?.deps, deps)) effects.push(() => { previous?.cleanup?.(); hooks[at] = { deps, cleanup: effect() }; }); },
  };
  const bridge = {
    async status() { statusCalls.push(true); return read ? read(statusCalls.length, actual) : { ...actual }; },
    async update(patch) { updates.push({ ...patch }); if (write) return write(patch, actual); actual = { ...actual, ...patch }; return { ...actual }; },
  };
  const window = { ...(platform === 'desktop' || platform === 'legacy' ? { petpal: platform === 'desktop' ? { preferences: bridge } : {} } : {}) };
  const platformModule = { exports: {} };
  vm.runInNewContext(platformSource, { module: platformModule, exports: platformModule.exports });
  const notificationComponent = Symbol('TaskNotificationsSettings');
  const modules = {
    react, 'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'lucide-react': new Proxy({}, { get: (_target, name) => Symbol.for(String(name)) }),
    './api': { getSessionEpoch: () => epoch, getIdentity: () => identity, subscribeSession: () => () => {} },
    './TaskNotificationsSettings': { __esModule: true, default: notificationComponent },
    './platform/task-notifications': { supportsTaskNotifications: () => platform === 'android' },
    './platform/app-preferences': platformModule.exports,
  };
  const module = { exports: {} };
  vm.runInNewContext(componentSource, { module, exports: module.exports, window, require: name => { if (name.endsWith('.css')) return {}; assert.ok(Object.hasOwn(modules, name), name); return modules[name]; } });
  const find = (type, predicate = () => true) => nodes(tree).find(node => node.type === type && predicate(node.props));
  const render = () => {
    index = 0; dirty = false; effects.length = 0;
    tree = module.exports.default({ connected, onDownload: () => downloads.push(true) });
    for (const effect of effects) effect();
    return tree;
  };
  const flush = async () => { for (let tick = 0; tick < 12; tick++) { await Promise.resolve(); if (dirty && mounted) render(); } };
  render();
  return {
    flush, find, updates, statusCalls, downloads,
    get tree() { return tree; }, get afterUnmountUpdates() { return afterUnmountUpdates; },
    switch(name) { return find('input', props => props['aria-label'] === name); },
    change(name, checked) { find('input', props => props['aria-label'] === name).props.onChange({ target: { checked } }); },
    retry() { find('button', props => nodes(props.children).some(node => node.props?.children === '重新读取') || props.children?.includes?.('重新读取')).props.onClick(); },
    notificationNodes() { return nodes(tree).filter(node => node.type === notificationComponent); },
    text() { const text = node => Array.isArray(node) ? node.map(text).join(' ') : typeof node === 'string' ? node : node && typeof node === 'object' ? text(node.props?.children) : ''; return text(tree); },
    setConnected(next) { connected = next; render(); },
    changeSession({ notify = true } = {}) { epoch++; identity = { ...identity, userId: 'fixture-next-user' }; if (notify) render(); },
    close() { mounted = false; for (const hook of hooks) hook?.cleanup?.(); },
  };
}

test('desktop reads only after login and displays the actual local preferences', async t => {
  const f = fixture({ connected: false }); t.after(() => f.close()); await f.flush();
  assert.equal(f.statusCalls.length, 0); assert.equal(f.switch('开机自启'), undefined);
  f.setConnected(true); await f.flush();
  assert.equal(f.statusCalls.length, 1);
  assert.equal(f.switch('开机自启').props.checked, false);
  assert.equal(f.switch('启动显示桌宠').props.checked, true);
  assert.equal(nodes(f.tree).filter(node => node.props?.role === 'switch').length, 5);
  assert.equal(f.switch('启动时最小化').props.disabled, false, 'ordinary logged-in users can set local preferences');
});

test('changes save one boolean, remain disabled until readback, and never use optimistic values', async t => {
  const writing = deferred(), reading = deferred();
  const f = fixture({ read: call => call === 1 ? initial : reading.promise, write: () => writing.promise }); t.after(() => f.close());
  await f.flush(); f.change('开机自启', true); await f.flush();
  assert.deepEqual(f.updates, [{ autoLaunch: true }]);
  assert.equal(f.switch('开机自启').props.checked, false);
  assert.ok(nodes(f.tree).filter(node => node.props?.role === 'switch').every(node => node.props.disabled));
  writing.resolve({ ...initial, autoLaunch: true }); await f.flush();
  assert.equal(f.statusCalls.length, 2); assert.equal(f.switch('开机自启').props.checked, false);
  reading.resolve({ ...initial, autoLaunch: true }); await f.flush();
  assert.equal(f.switch('开机自启').props.checked, true); assert.equal(f.switch('开机自启').props.disabled, false);
  assert.match(f.text(), /设置已保存到这台电脑/);
});

test('mismatching operating-system readback shows actual value and an error instead of success', async t => {
  const f = fixture({ read: () => initial, write: () => ({ ...initial, autoLaunch: true }) }); t.after(() => f.close());
  await f.flush(); f.change('开机自启', true); await f.flush();
  assert.equal(f.switch('开机自启').props.checked, false);
  assert.match(f.text(), /设置未生效/); assert.doesNotMatch(f.text(), /设置已保存/);
});

test('failed readback hides uncertain switches and manual retry restores real state', async t => {
  let failure = true;
  const f = fixture({ read: (call, value) => { if (call === 2 && failure) throw new Error('fixture read failure'); return value; } }); t.after(() => f.close());
  await f.flush(); f.change('开机自启', true); await f.flush();
  assert.equal(f.switch('开机自启'), undefined); assert.match(f.text(), /未能确认设置是否保存/); assert.doesNotMatch(f.text(), /设置已保存/);
  failure = false; f.retry(); await f.flush();
  assert.equal(f.switch('开机自启').props.checked, true); assert.doesNotMatch(f.text(), /未能确认/);
});

test('failed initial reads can retry, and incomplete bridge statuses do not fabricate off states', async t => {
  let result = { platform: 'win32', autoLaunch: true };
  const f = fixture({ read: () => result }); t.after(() => f.close()); await f.flush();
  assert.equal(f.switch('开机自启'), undefined); assert.match(f.text(), /无法读取/);
  result = initial; f.retry(); await f.flush(); assert.equal(f.switch('启动显示桌宠').props.checked, true);
});

test('unsupported system autostart stays disabled while independent local settings work', async t => {
  const f = fixture({ value: { ...initial, platform: 'linux', autoLaunchSupported: false, autoLaunchReason: 'AppImage 路径已移动，请重新安装。' } }); t.after(() => f.close()); await f.flush();
  assert.equal(f.switch('开机自启').props.disabled, true); assert.match(f.text(), /AppImage 路径已移动/);
  assert.equal(f.switch('启动显示桌宠').props.disabled, false);
  f.change('开机自启', true); await f.flush(); assert.equal(f.updates.length, 0);
  f.change('启动显示桌宠', false); await f.flush(); assert.deepEqual(f.updates, [{ showPetOnLaunch: false }]);
});

test('supported autostart retains its system warning as accessible help without disabling retry', async t => {
  const reason = '系统启动应用中已禁用小伴，请在系统设置中重新允许。';
  const actual = { ...initial, autoLaunchSupported: true, autoLaunch: false, autoLaunchReason: reason };
  const f = fixture({ read: () => actual, write: () => ({ ...actual, autoLaunch: true }) }); t.after(() => f.close());
  await f.flush();
  const input = f.switch('开机自启');
  assert.equal(input.props.checked, false); assert.equal(input.props.disabled, false);
  assert.equal(f.find('small', props => props.id === input.props['aria-describedby']).props.children, reason);
  assert.match(f.text(), /系统启动应用中已禁用小伴/);
  assert.equal(f.switch('启动显示桌宠').props.disabled, false);
  f.change('开机自启', true); await f.flush();
  assert.deepEqual(f.updates, [{ autoLaunch: true }]);
  assert.equal(f.switch('开机自启').props.checked, false, 'system-disabled readback must remain authoritative');
  assert.equal(f.switch('开机自启').props.disabled, false, 'a supported registration remains retryable');
  assert.match(f.text(), /系统启动应用中已禁用小伴/); assert.match(f.text(), /设置未生效/);
  assert.doesNotMatch(f.text(), /设置已保存/);
});

test('immediate duplicate switches are serialized before React rerenders', async t => {
  const writing = deferred(), f = fixture({ write: () => writing.promise }); t.after(() => f.close()); await f.flush();
  f.change('开机自启', true); f.change('启动显示桌宠', false);
  assert.deepEqual(f.updates, [{ autoLaunch: true }]); writing.resolve(initial); await f.flush();
});

test('account changes reject stale handlers immediately and discard in-flight save results', async t => {
  const writing = deferred(), f = fixture({ write: () => writing.promise }); t.after(() => f.close()); await f.flush();
  f.change('开机自启', true); await f.flush();
  f.changeSession({ notify: false }); f.change('启动显示桌宠', false);
  assert.deepEqual(f.updates, [{ autoLaunch: true }]);
  f.setConnected(false); writing.resolve(initial); await f.flush();
  assert.equal(f.statusCalls.length, 1, 'old save must not read state for a new account');
  assert.equal(f.switch('开机自启'), undefined); assert.doesNotMatch(f.text(), /设置已保存/);
  f.setConnected(true); await f.flush(); assert.equal(f.statusCalls.length, 2); assert.equal(f.switch('开机自启').props.checked, false);
});

test('unmounted settings ignore pending loads and saves', async () => {
  const reading = deferred(), load = fixture({ read: () => reading.promise });
  load.close(); reading.resolve(initial); await load.flush(); assert.equal(load.afterUnmountUpdates, 0);
  const writing = deferred(), save = fixture({ write: () => writing.promise }); await save.flush();
  save.change('开机自启', true); save.close(); writing.resolve(initial); await save.flush();
  assert.equal(save.afterUnmountUpdates, 0); assert.equal(save.statusCalls.length, 1);
});

test('web and old clients explain capabilities rather than showing nonfunctional switches', async t => {
  for (const platform of ['web', 'legacy']) {
    const f = fixture({ platform }); t.after(() => f.close()); await f.flush();
    assert.equal(nodes(f.tree).filter(node => node.props?.role === 'switch').length, 0); assert.equal(f.statusCalls.length, 0);
    if (platform === 'web') { assert.match(f.text(), /浏览器不能设置系统开机自启/); f.find('button').props.onClick(); assert.equal(f.downloads.length, 1); }
    else assert.match(f.text(), /更新客户端/);
  }
});

test('Android reuses the existing OEM guidance exactly once and does not claim boot-time listening', async t => {
  const f = fixture({ platform: 'android' }); t.after(() => f.close()); await f.flush();
  assert.equal(f.notificationNodes().length, 1); assert.equal(f.notificationNodes()[0].props.connected, true);
  assert.equal(f.statusCalls.length, 0); assert.equal(f.switch('开机自启'), undefined);
  assert.match(f.text(), /手机重启后仍需打开小伴/);
});
