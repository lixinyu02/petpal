import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

const source = ts.transpileModule(await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'), {
  fileName: 'App.tsx', compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText + '\nexports.fixtureSettingsView=SettingsView;';
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : !tree || typeof tree !== 'object' ? [] : [tree, ...nodes(tree.props?.children)];
const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree == null || typeof tree === 'boolean' ? '' : typeof tree !== 'object' ? String(tree) : text(tree.props?.children);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

function fixture({ post, refresh, connected = true } = {}) {
  let index = 0, tree, epoch = 1, dirty = false, mounted = true, lateUpdates = 0, refreshes = 0;
  const hooks = [], effects = [], requests = [], notices = [];
  const same = (left, right) => left && right && left.length === right.length && left.every((value, at) => Object.is(value, right[at]));
  const react = {
    useState(initial) { const at = index++; hooks[at] ??= { value: typeof initial === 'function' ? initial() : initial }; return [hooks[at].value, next => { if (!mounted) lateUpdates++; hooks[at].value = typeof next === 'function' ? next(hooks[at].value) : next; dirty = true; }]; },
    useRef(value) { const at = index++; hooks[at] ??= { ref: { current: value } }; return hooks[at].ref; },
    useEffect(effect, deps) { const at = index++, previous = hooks[at]; if (!same(previous?.deps, deps)) effects.push(() => { previous?.cleanup?.(); hooks[at] = { deps, cleanup: effect() }; }); },
    useCallback: value => value, useMemo: callback => callback(), useSyncExternalStore: (_subscribe, snapshot) => snapshot(), lazy: loader => ({ loader }), Suspense: Symbol('Suspense'),
  };
  const window = new EventTarget();
  const api = {
    getIdentity: () => ({ instanceId: 'fixture-server', userId: 'fixture-owner' }), getConnection: () => ({ url: 'http://127.0.0.1' }), getSessionEpoch: () => epoch,
    isSessionChanged: failure => failure?.name === 'SessionChangedError',
    api: async (path, options) => { const request = { path, method: options.method, body: JSON.parse(options.body) }; requests.push(request); return await post?.(request) ?? { id: request.body.id || 'created-model' }; },
  };
  const modules = {
    react, 'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'lucide-react': new Proxy({}, { get: (_target, name) => Symbol.for(name) }),
    '@capacitor/core': { Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web', isPluginAvailable: () => false } },
    './api': api, './desktop-settings.mjs': { reasoningEfforts: ['', 'low', 'medium', 'high'] },
    './platform/music-mcp': { nativeMusicMcp: () => undefined }, './platform/computer-use': { nativeComputerUse: () => undefined }, './platform/ui-motion.ts': { useUiEntrance: () => null },
  };
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, window, URLSearchParams, Intl, require: name => name.endsWith('.css') ? {} : modules[name] || { __esModule: true, default: Symbol(name) } });
  const state = {
    instanceId: 'fixture-server', user: { id: 'fixture-owner', isAdmin: true, isOwner: true }, settings: { petName: '合成伙伴', persona: '合成设置' },
    providers: ['one', 'two'].map(id => ({ id, name: `Fixture ${id}`, model: `model-${id}`, protocol: 'responses', baseUrl: 'http://127.0.0.1/v1', editable: true })),
  };
  const props = { state, connected, refresh: async () => { refreshes++; return await refresh?.(refreshes) ?? state; }, notice: value => notices.push(value), connect() {}, initialTab: 'models', hasDraft: false, onDownload() {}, onPrepareBrowser() {}, prepareBrowserDisabled: false };
  function render() { index = 0; dirty = false; effects.length = 0; tree = module.exports.fixtureSettingsView(props); for (const effect of effects) effect(); }
  async function flush() { for (let tick = 0; tick < 24; tick++) { await Promise.resolve(); if (dirty && mounted) render(); } }
  const find = (type, predicate = () => true) => nodes(tree).find(node => node.type === type && predicate(node.props));
  const button = label => find('button', props => props['aria-label'] === label || text(props.children) === label);
  const click = label => { const node = button(label); assert.ok(node, label); assert.ok(!node.props.disabled, `${label} is disabled`); const result = node.props.onClick?.(); render(); return result; };
  render(); if (dirty) render();
  return {
    find, button, click, render, flush, requests, notices, text: () => text(tree),
    get refreshes() { return refreshes; }, get lateUpdates() { return lateUpdates; },
    submit: () => find('form').props.onSubmit({ preventDefault() {} }),
    type(placeholder, value) { const input = find('input', props => props.placeholder === placeholder); assert.ok(input); input.props.onChange({ target: { value } }); render(); },
    changeAccount() { epoch++; render(); if (dirty) render(); },
    close() { mounted = false; for (const hook of hooks) hook?.cleanup?.(); },
  };
}

test('model save serializes same-tick submits and locks edits, dismissal and other model entries', async t => {
  const pending = deferred(), f = fixture({ post: () => pending.promise }); t.after(f.close);
  f.click('编辑 Fixture one');
  const submit = f.find('form').props.onSubmit, close = f.button('关闭模型窗口').props.onClick;
  const openOther = f.button('编辑 Fixture two').props.onClick;
  const change = f.find('input', props => props.placeholder === '例如：我的 OpenAI').props.onChange;
  const first = submit({ preventDefault() {} }), duplicate = submit({ preventDefault() {} });
  close(); openOther(); change({ target: { value: 'must not replace submitted draft' } }); f.render();
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0].body.id, 'one');
  assert.equal(f.find('input', props => props.placeholder === '例如：我的 OpenAI').props.value, 'Fixture one');
  for (const label of ['关闭模型窗口', '添加连接', '编辑 Fixture two', '删除 Fixture two']) assert.equal(f.button(label).props.disabled, true, label);
  const form = f.find('form'); for (const control of nodes(form).filter(node => ['input', 'select', 'button'].includes(node.type))) assert.equal(control.props.disabled, true);
  pending.resolve({ id: 'one' }); await Promise.all([first, duplicate]); await f.flush();
  assert.equal(f.find('form'), undefined); assert.equal(f.refreshes, 1); assert.equal(f.notices.length, 1);
  f.click('编辑 Fixture two'); assert.equal(f.find('input', props => props.placeholder === '例如：我的 OpenAI').props.value, 'Fixture two');
});

test('successful create leaves create mode before a failed refresh and retries only the list', async t => {
  const retry = deferred(), f = fixture({ refresh: count => count === 1 ? Promise.reject(new Error('synthetic state unavailable')) : retry.promise }); t.after(f.close);
  f.click('添加连接'); f.type('例如：我的 OpenAI', 'Synthetic model'); f.type('填写服务商提供的模型 ID', 'fixture-model');
  await f.submit(); await f.flush();
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0].body.id, undefined); assert.equal(f.find('form'), undefined);
  assert.match(f.text(), /模型连接已保存，但列表刷新失败。synthetic state unavailable/); assert.deepEqual(f.notices, ['模型连接已保存']);
  const refresh = f.button('重试刷新模型列表').props.onClick;
  refresh(); refresh(); await f.flush();
  assert.equal(f.refreshes, 2); assert.equal(f.requests.length, 1); assert.equal(f.button('正在刷新…').props.disabled, true);
  retry.resolve({}); await f.flush();
  assert.doesNotMatch(f.text(), /列表刷新失败/); assert.equal(f.requests.length, 1); assert.equal(f.button('添加连接').props.disabled, false);
});

test('a rejected provider POST keeps the draft editable and does not claim a committed save', async t => {
  let fail = true; const f = fixture({ post: () => { if (fail) throw new Error('synthetic provider validation'); return { id: 'one' }; } }); t.after(f.close);
  f.click('编辑 Fixture one'); await f.submit(); await f.flush();
  assert.ok(f.find('form')); assert.match(f.text(), /synthetic provider validation/); assert.equal(f.refreshes, 0); assert.equal(f.notices.length, 0);
  assert.equal(f.button('关闭模型窗口').props.disabled, false); assert.equal(f.find('input', props => props.placeholder === '例如：我的 OpenAI').props.disabled, false);
  fail = false; await f.submit(); await f.flush(); assert.equal(f.find('form'), undefined); assert.equal(f.refreshes, 1);
});

test('late saves after account replacement cannot close or modify the new account draft', async t => {
  const pending = deferred(), f = fixture({ post: () => pending.promise }); t.after(f.close);
  f.click('编辑 Fixture one'); const save = f.submit(); f.render();
  f.changeAccount(); f.click('编辑 Fixture two'); f.type('例如：我的 OpenAI', 'New account draft');
  pending.resolve({ id: 'one' }); await save; await f.flush();
  assert.equal(f.find('input', props => props.placeholder === '例如：我的 OpenAI').props.value, 'New account draft');
  assert.equal(f.refreshes, 0); assert.equal(f.notices.length, 0); assert.equal(f.button('关闭模型窗口').props.disabled, false);
});

test('unmounted settings ignore late provider completion without refreshing or updating state', async () => {
  const pending = deferred(), f = fixture({ post: () => pending.promise });
  f.click('编辑 Fixture one'); const save = f.submit(); f.close();
  pending.resolve({ id: 'one' }); await save;
  assert.equal(f.refreshes, 0); assert.equal(f.notices.length, 0); assert.equal(f.lateUpdates, 0);
});

test('real API 200 malformed provider JSON closes create mode and follows only state reads', async t => {
  const moduleUrl = source => 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText).toString('base64');
  const nativeUrl = moduleUrl(await readFile(new URL('../src/auth/native-fetch.ts', import.meta.url), 'utf8'));
  let apiSource = (await readFile(new URL('../src/api.ts', import.meta.url), 'utf8')).replaceAll("'./auth/native-fetch'", JSON.stringify(nativeUrl));
  for (const name of ['connection-targets', 'request-scope']) apiSource = apiSource.replaceAll(`'./auth/${name}.mjs'`, JSON.stringify(new URL(`../src/auth/${name}.mjs`, import.meta.url).href));
  for (const name of ['speech-stream', 'speech-emotion']) apiSource = apiSource.replaceAll(`'./avatar/${name}.mjs'`, JSON.stringify(new URL(`../src/avatar/${name}.mjs`, import.meta.url).href));
  const names = ['window', 'location', 'history', 'sessionStorage', 'fetch'];
  const originals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const install = (name, value) => Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  const disk = new Map(), window = new EventTarget(); window.speechSynthesis = { cancel() {} };
  install('window', window); install('location', { origin: 'https://fixture.invalid', hash: '', pathname: '/', search: '' }); install('history', { replaceState() {} });
  install('sessionStorage', { getItem: name => disk.get(name) ?? null, setItem: (name, value) => disk.set(name, value), removeItem: name => disk.delete(name) });
  const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
  try {
    for (const outcome of ['refresh-success', 'refresh-failure', 'network-failure']) await t.test(outcome, async t => {
      const realApi = await import(moduleUrl(apiSource + `\n// provider-save ${outcome}`));
      await realApi.setConnection({ url: 'https://fixture.invalid', token: 'synthetic-provider-session' }, 'session');
      const calls = []; let stateReads = 0, observedFailure;
      install('fetch', async (url, options) => {
        const path = new URL(url).pathname, method = options.method || 'GET'; calls.push([method, path]);
        if (path === '/api/providers') {
          assert.equal(method, 'POST');
          if (outcome === 'network-failure') throw new TypeError('synthetic network unavailable');
          return new Response('{"id":', { status: 200, headers: { 'content-type': 'application/json' } });
        }
        assert.equal(path, '/api/state'); assert.equal(method, 'GET'); stateReads++;
        if (outcome === 'refresh-failure' && stateReads === 1) return json({ error: 'synthetic state unavailable' }, 503);
        return json({ instanceId: 'fixture-server', user: { id: 'fixture-owner' }, settings: {}, providers: [], conversations: [] });
      });
      const f = fixture({
        post: async request => {
          try { return await realApi.api(request.path, { method: request.method, body: JSON.stringify(request.body) }); }
          catch (failure) { observedFailure = failure; throw failure; }
        },
        refresh: () => realApi.api('/state'),
      }); t.after(f.close);
      f.click('添加连接'); f.type('例如：我的 OpenAI', 'Synthetic malformed response'); f.type('填写服务商提供的模型 ID', 'fixture-model');
      await f.submit(); await f.flush();
      if (outcome === 'network-failure') {
        assert.ok(f.find('form')); assert.match(f.text(), /synthetic network unavailable/);
        assert.equal(f.notices.length, 0); assert.equal(f.refreshes, 0); assert.deepEqual(calls, [['POST', '/api/providers']]);
      } else {
        assert.equal(observedFailure.code, 'invalid_response'); assert.equal(observedFailure.status, 200); assert.ok(observedFailure.cause instanceof SyntaxError);
        assert.equal(f.find('form'), undefined); assert.match(f.notices[0], /服务端已接受模型连接保存.*响应内容不完整/);
        assert.deepEqual(calls, [['POST', '/api/providers'], ['GET', '/api/state']]);
        if (outcome === 'refresh-failure') {
          assert.match(f.text(), /模型连接已保存，但列表刷新失败/);
          f.click('重试刷新模型列表');
          for (let tick = 0; tick < 12; tick++) { await new Promise(resolve => setImmediate(resolve)); await f.flush(); if (!f.text().includes('列表刷新失败')) break; }
          assert.doesNotMatch(f.text(), /列表刷新失败/);
          assert.deepEqual(calls, [['POST', '/api/providers'], ['GET', '/api/state'], ['GET', '/api/state']]);
        } else assert.doesNotMatch(f.text(), /列表刷新失败/);
        assert.equal(f.requests.length, 1);
      }
    });
  } finally { for (const [name, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } }
});

test('only invalid_response with a numeric 2xx status is a provider save acknowledgement', async t => {
  const failures = [
    { code: 'request_timeout', status: 200 }, { code: 'invalid_response', status: 500 },
    { code: 'invalid_response' }, { code: 'invalid_response', status: '200' }, { code: 'invalid_response', status: NaN },
  ];
  for (const extra of failures) {
    const f = fixture({ post: () => { throw Object.assign(new Error('synthetic unconfirmed failure'), extra); } }); t.after(f.close);
    f.click('添加连接'); await f.submit(); await f.flush();
    assert.ok(f.find('form')); assert.equal(f.refreshes, 0); assert.equal(f.notices.length, 0); assert.match(f.text(), /synthetic unconfirmed failure/);
  }
});
