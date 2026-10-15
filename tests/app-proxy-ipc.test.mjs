import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const { createAppProxyHandlers, appProxyPublicStatus } = createRequire(import.meta.url)('../desktop/app-proxy-ipc.cjs');
const selected = { url: 'http://127.0.0.1:43199', token: 'fixture-session' };
const status = { supported: true, state: 'stopped', configured: true, autoStart: false, running: false,
  version: '1.19.32', platform: 'win32', arch: 'x64', groups: [{ name: '节点选择', selected: 'DIRECT', choices: ['DIRECT', '节点一'] }] };
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
function fixture({ verify, operation, file = null, fileOperation } = {}) {
  let current = { ...selected }, allowed = true;
  const calls = [], event = {}, manager = {};
  for (const action of ['refresh', 'status', 'importConfiguration', 'start', 'stop', 'updatePreferences', 'select']) manager[action] = async (...args) => {
    calls.push([action, ...args]); await operation?.(action, ...args);
    if (typeof args.at(-1)?.authorize === 'function') await args.at(-1).authorize();
    return status;
  };
  const handlers = createAppProxyHandlers({ manager, origin: selected.url, isAllowed: raw => raw === event && allowed,
    readConnection: async () => current,
    verifyConnection: async value => { calls.push(['verify', value]); return verify ? verify(value) : { userId: 'local-owner', instanceId: 'local-instance' }; },
    openConfigFile: async () => { calls.push(['openConfigFile']); await fileOperation?.(); return file; },
  });
  return { handlers, calls, manager, event, setConnection: value => { current = value; }, disallow: () => { allowed = false; },
    call: (action, input, connection = selected, sender = event) => handlers[`petpal:app-proxy:${action}`](sender, connection, input) };
}
const actionInputs = { status: undefined, importFile: undefined, importText: { yaml: 'proxies: []' }, start: undefined, stop: undefined,
  preferences: { autoStart: true }, select: { group: '节点选择', name: '节点一' } };

test('every proxy action requires the current trusted main window, local origin and owner login', async () => {
  for (const [action, input] of Object.entries(actionInputs)) {
    const f = fixture();
    await assert.rejects(f.call(action, input, null), /先登录/);
    await assert.rejects(f.call(action, input, selected, {}), /可信主窗口/);
    for (const url of ['https://central.example.test', `${selected.url}/`, `${selected.url}/private`, selected.url.replace('127.0.0.1', 'localhost'), `${selected.url}?url=private`])
      await assert.rejects(f.call(action, input, { ...selected, url }), /本机服务/);
    assert.equal(f.calls.length, 0, 'remote credentials never reach verification, manager or file dialog');
  }
  const f = fixture({ verify: async () => { throw new Error('private-owner-token'); } });
  await assert.rejects(f.call('status'), error => /管理员登录/.test(error.message) && !error.message.includes('private-owner-token'));
  assert.equal(f.calls.some(call => call[0] === 'refresh'), false);
});

test('fixed actions pass only validated values and a fresh authorization callback to the manager', async () => {
  const f = fixture();
  for (const [action, input] of Object.entries(actionInputs)) assert.deepEqual(await f.call(action, input), status);
  const imported = f.calls.find(call => call[0] === 'importConfiguration'); assert.equal(imported[1], 'proxies: []'); assert.equal(typeof imported[2].authorize, 'function');
  const preferences = f.calls.find(call => call[0] === 'updatePreferences'); assert.deepEqual(preferences[1], { autoStart: true });
  const selection = f.calls.find(call => call[0] === 'select'); assert.deepEqual(selection.slice(1, 3), ['节点选择', '节点一']);
  assert.equal(f.calls.filter(call => call[0] === 'openConfigFile').length, 1);
  assert.deepEqual(Object.keys(f.handlers).sort(), Object.keys(actionInputs).map(action => `petpal:app-proxy:${action}`).sort());
});

test('renderer paths, runtime options, extra fields and malformed input cannot reach mutations', async () => {
  const malformed = {
    status: [null, {}, { refresh: true }], importFile: ['/private/config.yaml', { path: 'C:/secret.yaml' }],
    start: [null, {}, { port: 7890 }], stop: [null, { force: true }],
    importText: [undefined, null, [], '', { yaml: '' }, { yaml: ' ' }, { yaml: 42 }, { yaml: 'proxies: []', path: '/private' }, { yaml: 'x'.repeat(4 * 1024 * 1024 + 1) }],
    preferences: [undefined, null, [], { autoStart: 1 }, { autoStart: true, systemProxy: true }],
    select: [undefined, null, [], { group: '', name: 'x' }, { group: 'x', name: 'bad\nsecret' }, { group: 'x', name: 'y', url: 'private' }],
  };
  for (const [action, values] of Object.entries(malformed)) for (const value of values) {
    const f = fixture(); await assert.rejects(f.call(action, value), /格式无效|不超过|选项无效|有效的代理节点/);
    assert.equal(f.calls.some(call => call[0] !== 'verify'), false, `${action} called a manager or dialog`);
  }
  for (const bad of [{ ...selected, userId: 'someone-else' }, { ...selected, token: '' }, { ...selected, token: 'bad token' }, new Date(), []]) {
    const f = fixture(); await assert.rejects(f.call('start', undefined, bad), /先登录/); assert.equal(f.calls.length, 0);
  }
});

test('native file dialog is guarded, its content is reauthorized, and cancellation leaves status unchanged', async () => {
  const canceled = fixture(); assert.deepEqual(await canceled.call('importFile'), status);
  assert.equal(canceled.calls.some(call => call[0] === 'importConfiguration'), false);
  const imported = fixture({ file: 'proxies: []' }); await imported.call('importFile');
  assert.equal(imported.calls.find(call => call[0] === 'importConfiguration')[1], 'proxies: []');
  const gate = deferred(), entered = deferred();
  const changed = fixture({ file: 'proxies: []', fileOperation: async () => { entered.resolve(); await gate.promise; } });
  const pending = changed.call('importFile'); await entered.promise; changed.setConnection({ ...selected, token: 'next-session' }); gate.resolve();
  await assert.rejects(pending, /登录账号已变化/); assert.equal(changed.calls.some(call => call[0] === 'importConfiguration'), false);
});

test('login or window changes during verification and queued manager work stop cross-user mutations', async () => {
  const gate = deferred(), entered = deferred();
  const f = fixture({ verify: async () => { entered.resolve(); await gate.promise; return { userId: 'local-owner', instanceId: 'local-instance' }; } });
  const pending = f.call('start'); await entered.promise; f.setConnection({ ...selected, token: 'next-session' }); gate.resolve();
  await assert.rejects(pending, /登录账号已变化/); assert.equal(f.calls.some(call => call[0] === 'start'), false);
  let queued;
  queued = fixture({ operation: async action => { if (action === 'select') queued.disallow(); } });
  await assert.rejects(queued.call('select', actionInputs.select), /可信主窗口/);
  let count = 0;
  const identityChanged = fixture({ verify: async () => ({ userId: ++count > 1 ? 'other-user' : 'local-owner', instanceId: 'local-instance' }) });
  await assert.rejects(identityChanged.call('start'), /登录账号已变化/);
});

test('readonly status and completed operations reverify owner and server identity before exposing any result', async () => {
  for (const action of ['status', 'start', 'importFile']) {
    let revoked = false;
    const f = fixture({ verify: async () => { if (revoked) throw new Error('private-revocation'); return { userId: 'local-owner', instanceId: 'local-instance' }; },
      operation: async () => { revoked = true; } });
    await assert.rejects(f.call(action), /管理员登录/);
  }
  let reads = 0;
  const restarted = fixture({ verify: async () => ({ userId: 'local-owner', instanceId: ++reads > 1 ? 'new-server' : 'local-instance' }) });
  await assert.rejects(restarted.call('status'), /登录账号已变化/);
});

test('only controlled application errors survive IPC, including errors forged with a matching runtime code', async () => {
  for (const failure of [new Error('private-config-secret'), Object.assign(new Error('private-config-secret'), { code: 'PETPAL_PROXY' }),
    Object.assign(new Error('private-config-secret'), { code: 'PETPAL_APP_PROXY_IPC_INPUT' })]) {
    const f = fixture({ operation: async () => { throw failure; } });
    await assert.rejects(f.call('start'), error => /操作未完成/.test(error.message) && !error.message.includes('private-config-secret'));
  }
  const expected = fixture({ operation: async () => { throw Object.assign(new Error('请先导入 Clash YAML 配置。'), { code: 'PETPAL_PROXY' }); } });
  await assert.rejects(expected.call('start'), /请先导入 Clash YAML 配置/);
});

test('public proxy status strips private configuration, ports, credentials and arbitrary nested fields', () => {
  const result = appProxyPublicStatus({ ...status, yaml: 'private-yaml', port: 7890, controllerPort: 7891, secret: 'private-secret',
    url: 'http://user:password@127.0.0.1:7890', groups: [{ ...status.groups[0], password: 'private-node-password', url: 'private-url' }], error: 'private-error' });
  assert.doesNotMatch(JSON.stringify(result), /private-|password|7890|7891|127\.0\.0\.1/); assert.equal(result.groups[0].name, '节点选择');
  assert.equal(result.error, '应用代理暂不可用，请刷新状态后重试。');
  const bounded = appProxyPublicStatus({ ...status, groups: Array.from({ length: 129 }, (_, index) => ({ name: `group-${index}`, selected: '\n', choices: Array(2050).fill('node') })) });
  assert.equal(bounded.groups.length, 128); assert.equal(bounded.groups[0].choices.length, 2048); assert.equal(bounded.groups[0].selected, '');
  for (const patch of [{ state: 'unknown' }, { version: 'private-version' }, { platform: 'private-platform' }, { arch: 'private-arch' }])
    assert.throws(() => appProxyPublicStatus({ ...status, ...patch }), /无法读取应用代理状态/);
});

test('proxy IPC setup refuses remote origins and missing authorization dependencies', () => {
  const dependencies = { manager: {}, origin: selected.url, isAllowed: () => true, readConnection: () => selected,
    verifyConnection: () => ({ userId: 'owner', instanceId: 'local' }), openConfigFile: () => null };
  for (const origin of ['https://central.example.test', `${selected.url}/path`, `${selected.url}/`, 'file:///private/config'])
    assert.throws(() => createAppProxyHandlers({ ...dependencies, origin }), /Invalid application proxy/);
  for (const key of ['verifyConnection', 'isAllowed', 'readConnection', 'openConfigFile'])
    assert.throws(() => createAppProxyHandlers({ ...dependencies, [key]: undefined }), /Invalid application proxy/);
});

test('real preload exposes fixed proxy actions and takes the current login snapshot for every request', async () => {
  let bridge, saved = selected; const calls = [];
  vm.runInNewContext(await readFile(new URL('../desktop/preload.cjs', import.meta.url), 'utf8'), {
    require: name => { assert.equal(name, 'electron'); return { contextBridge: { exposeInMainWorld: (_name, value) => { bridge = value; } },
      ipcRenderer: { invoke: async (...args) => { calls.push(JSON.parse(JSON.stringify(args))); } } }; },
    sessionStorage: { getItem: () => saved ? JSON.stringify(saved) : null }, location: { origin: selected.url },
  });
  assert.ok(bridge.appProxy, 'preload must expose appProxy');
  assert.deepEqual(Object.keys(bridge.appProxy), Object.keys(actionInputs)); assert.equal(Object.isFrozen(bridge.appProxy), true);
  await bridge.appProxy.status(); await bridge.appProxy.importFile(); await bridge.appProxy.importText({ yaml: 'proxies: []' });
  saved = { url: '', token: 'next-session' }; await bridge.appProxy.preferences({ autoStart: true });
  saved = null; await bridge.appProxy.stop();
  assert.deepEqual(calls, [
    ['petpal:app-proxy:status', selected, null], ['petpal:app-proxy:importFile', selected, null],
    ['petpal:app-proxy:importText', selected, { yaml: 'proxies: []' }],
    ['petpal:app-proxy:preferences', { url: selected.url, token: 'next-session' }, { autoStart: true }],
    ['petpal:app-proxy:stop', null, null],
  ]);
});

test('real preload and IPC handlers preserve undefined inputs and enforce login end to end', async () => {
  const f = fixture(); let bridge, saved = selected;
  vm.runInNewContext(await readFile(new URL('../desktop/preload.cjs', import.meta.url), 'utf8'), {
    require: name => { assert.equal(name, 'electron'); return { contextBridge: { exposeInMainWorld: (_name, value) => { bridge = value; } },
      ipcRenderer: { invoke: async (channel, ...args) => { assert.ok(f.handlers[channel]); return f.handlers[channel](f.event, ...structuredClone(args)); } } }; },
    sessionStorage: { getItem: () => saved ? JSON.stringify(saved) : null }, location: { origin: selected.url },
  });
  assert.ok(bridge.appProxy, 'preload must expose appProxy');
  assert.deepEqual(await bridge.appProxy.status(), status);
  await bridge.appProxy.importText({ yaml: 'proxies: []' });
  assert.equal(f.calls.find(call => call[0] === 'importConfiguration')[1], 'proxies: []');
  saved = { url: 'https://central.example.test', token: 'remote-token' };
  await assert.rejects(bridge.appProxy.start(), /本机服务/);
  saved = null; await assert.rejects(bridge.appProxy.stop(), /先登录/);
  assert.equal(f.calls.some(call => call[0] === 'start' || call[0] === 'stop'), false);
});
