import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const compile = async file => (await build({
  entryPoints: [fileURLToPath(new URL(file, import.meta.url))], bundle: true, write: false,
  format: 'cjs', platform: 'node', external: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', './api'],
  loader: { '.css': 'empty' },
})).outputFiles[0].text;
const platformModule = { exports: {} };
new Function('require', 'module', 'exports', await compile('../src/platform/central-server.ts'))(require, platformModule, platformModule.exports);
const { readCentralServerPort, readCentralServerPublicUrl, readCentralServerStatus, createCentralServerOperationGuard, centralServerErrorMessage } = platformModule.exports;
const componentSource = await compile('../src/CentralServerSettings.tsx');
const initial = { supported: true, platform: 'win32', enabled: false, listening: false, port: 4319, urls: [], publicUrl: '', ownerHasPassword: true };
const owner = { id: 'owner', username: 'owner', displayName: 'Owner', role: 'owner', isOwner: true, canUseCodex: true, agentAccess: 'full' };

/** Real React renderer and useSyncExternalStore; only the host API is an isolated fixture. */
function render({ platform = 'desktop', target = 'local', connected = true, user = owner } = {}) {
  let calls = 0;
  const bridge = { status: async () => { calls++; return initial; }, update: async () => { calls++; return initial; } };
  const beforeWindow = globalThis.window, beforeLocation = globalThis.location;
  globalThis.window = platform === 'desktop' ? { petpal: { centralServer: bridge } } : platform === 'legacy' ? { petpal: {} } : {};
  globalThis.location = { origin: 'https://website.example' };
  const api = {
    getConnection: () => ({ url: target === 'local' ? 'http://127.0.0.1:49201' : 'https://remote.example', token: 'secret-must-not-be-rendered' }),
    getExecutionTarget: () => target, getIdentity: () => connected ? { instanceId: 'fixture', userId: user?.id || 'user' } : null,
    getSessionEpoch: () => 1, subscribeSession: () => () => {},
  };
  const compiled = { exports: {} };
  try {
    new Function('require', 'module', 'exports', componentSource)(name => name === './api' ? api : require(name), compiled, compiled.exports);
    const html = renderToStaticMarkup(createElement(compiled.exports.default, { connected, user, onConnect() {}, onAccounts() {}, onDownload() {} }));
    return { html, calls };
  } finally { globalThis.window = beforeWindow; globalThis.location = beforeLocation; }
}

test('real React logged-out surface requires login and does not read native status', () => {
  const { html, calls } = render({ connected: false });
  assert.match(html, /登录后可以管理中央服务器/); assert.equal(calls, 0);
  assert.doesNotMatch(html, /启用中央服务器|secret-must-not-be-rendered|当前连接/);
});
test('real React web and Android-compatible surface explains the PC role and offers a desktop download', () => {
  for (const platform of ['web', 'android']) {
    const { html, calls } = render({ platform, target: 'remote' });
    assert.match(html, /Windows 或 Ubuntu 电脑可以承担中央服务器/); assert.match(html, /下载桌面客户端/);
    assert.match(html, /当前连接 · 远程服务/); assert.match(html, /https:\/\/remote\.example/);
    assert.doesNotMatch(html, /启用中央服务器|secret-must-not-be-rendered/); assert.equal(calls, 0);
  }
});
test('real React old desktop bridge has a truthful upgrade state with no fabricated off switch', () => {
  const { html, calls } = render({ platform: 'legacy' });
  assert.match(html, /当前客户端还不支持中央服务器设置/); assert.match(html, /下载桌面客户端/);
  assert.doesNotMatch(html, /中央服务器已关闭|role="switch"/); assert.equal(calls, 0);
});
test('real React remote owners and local members must select the local administrator before management', () => {
  for (const options of [{ target: 'remote' }, { user: { ...owner, id: 'member', isOwner: false } }]) {
    const { html, calls } = render(options);
    assert.match(html, /登录本机管理员/); assert.match(html, /当前账号的聊天与服务连接保持原样/);
    assert.doesNotMatch(html, /role="switch"|局域网端口/); assert.equal(calls, 0);
  }
});
test('real React local owner begins without inventing listener state or trusting a bridge response before effects', () => {
  const { html, calls } = render();
  assert.match(html, /当前连接 · 本机服务/); assert.match(html, /重新读取/);
  assert.doesNotMatch(html, /正在监听局域网连接|中央服务器已关闭|role="switch"|secret-must-not-be-rendered/);
  assert.equal(calls, 0, 'SSR never runs effects or initiates host operations');
});

test('port validation accepts only bounded browser-safe integer ports', () => {
  for (const value of [1024, '4319', '65535', ' 44318 ']) assert.equal(readCentralServerPort(value), Number(value));
  for (const value of ['', '4e3', '04319', 1023, 65536, 4319.2, '4319.0', '4319x', null, true, NaN]) assert.throws(() => readCentralServerPort(value));
  for (const value of [1719, 2049, 6000, 6667, 10080]) assert.throws(() => readCentralServerPort(value), /浏览器限制/);
});
test('optional HTTPS origin rejects credentials, query, fragments, paths and non-HTTPS schemes', () => {
  assert.equal(readCentralServerPublicUrl(''), ''); assert.equal(readCentralServerPublicUrl(' https://pet.example:44318/ '), 'https://pet.example:44318');
  for (const value of ['http://pet.example', 'https://user:secret@pet.example', 'https://pet.example/api', 'https://pet.example?token=secret', 'https://pet.example/#', 'https://pet.example/?a', 'javascript:alert(1)', 'https://pet.example\\path', 'https://pet.example\n/x', 'https://*.pet.example', 'https://pet%2eexample']) assert.throws(() => readCentralServerPublicUrl(value));
});
test('native readback is bounded and returns only the declared non-secret fields', () => {
  const next = readCentralServerStatus({ ...initial, publicUrl: 'https://pet.example/', token: 'never-forward', dataDir: 'private-path', reason: '端口被占用。' });
  assert.deepEqual(next, { ...initial, publicUrl: 'https://pet.example', reason: '端口被占用。' });
  assert.doesNotMatch(JSON.stringify(next), /never-forward|private-path|token|dataDir/);
  const running = readCentralServerStatus({ ...initial, enabled: true, listening: true, urls: ['http://192.168.60.222:4319/', 'http://192.168.60.222:4319'], platform: 'linux' });
  assert.deepEqual(running.urls, ['http://192.168.60.222:4319']);
});
test('malformed, inconsistent and unsafe native statuses fail closed instead of displaying an off switch', () => {
  for (const value of [null, [], {}, { ...initial, supported: undefined }, { ...initial, platform: '' }, { ...initial, port: '4319' },
    { ...initial, publicUrl: 'http://pet.example' }, { ...initial, reason: 'x'.repeat(2001) }, { ...initial, urls: Array(33).fill('http://host:4319') },
    { ...initial, listening: true }, { ...initial, listening: true, enabled: true, supported: false },
    { ...initial, urls: ['http://192.168.60.222:4319'] },
    ...['javascript:alert(1)', 'http://host:4319/path', 'http://user:secret@host:4319', 'http://host:4320', 'https://host:4319', 'http://host:4319?token=secret'].map(url => ({ ...initial, enabled: true, listening: true, urls: [url] }))]) {
    assert.throws(() => readCentralServerStatus(value), /状态不完整/);
  }
});
test('supported but failed restoration preserves enabled intent and does not invent LAN URLs', () => {
  const value = readCentralServerStatus({ ...initial, enabled: true, reason: '无法监听此端口。' });
  assert.equal(value.enabled, true); assert.equal(value.listening, false); assert.deepEqual(value.urls, []);
});
test('safe known native errors preserve the actionable reason without forwarding arbitrary IPC exception text', () => {
  const fallback = '未知状态，请重新读取。';
  for (const message of ['此端口已被占用，请更换端口后重试。', '系统未允许监听此端口，请检查本机权限。', '请先为本机管理员设置登录密码。']) {
    assert.equal(centralServerErrorMessage(new Error(message), fallback), message);
    assert.equal(centralServerErrorMessage(new Error(`Error invoking remote method 'petpal:central-server:update': Error: ${message}`), fallback), message);
  }
  for (const value of [null, 'raw text', new Error('Authorization: Bearer private-secret'), new Error('private-dir 此端口已被占用，请更换端口后重试。'),
    new Error("Error invoking remote method 'other': Error: 此端口已被占用，请更换端口后重试。"), { message: 'x'.repeat(1025) }]) assert.equal(centralServerErrorMessage(value, fallback), fallback);
});

test('operation guard serializes duplicate saves and reads synchronously before React can rerender', () => {
  let scope = 'account-one'; const guard = createCentralServerOperationGuard(() => scope);
  const save = guard.begin(scope); assert.ok(save); assert.equal(guard.current(save), true);
  assert.equal(guard.begin(scope), null); guard.finish(save); assert.equal(guard.current(save), false);
  assert.ok(guard.begin(scope));
});
test('account changes fence stale event handlers immediately even before a subscription rerender', () => {
  let scope = 'account-one'; const guard = createCentralServerOperationGuard(() => scope);
  const read = guard.begin(scope); scope = 'account-two';
  assert.equal(guard.current(read), false); assert.equal(guard.begin('account-one'), null);
  guard.invalidate(); assert.ok(guard.begin(scope));
});
test('old operations cannot clear a new operation after account change or unmount cleanup', () => {
  let scope = 'account-one'; const guard = createCentralServerOperationGuard(() => scope);
  const read = guard.begin(scope); guard.invalidate(); scope = 'account-two';
  const save = guard.begin(scope); guard.finish(read); assert.equal(guard.current(save), true);
  guard.invalidate(); assert.equal(guard.current(save), false); guard.finish(save);
  const next = guard.begin(scope); assert.equal(guard.current(next), true);
});
test('readback results are discarded after a scope change while awaiting native work', async () => {
  let scope = 'account-one', resolve;
  const guard = createCentralServerOperationGuard(() => scope), operation = guard.begin(scope);
  const pending = new Promise(yes => { resolve = yes; });
  const work = pending.then(value => guard.current(operation) ? readCentralServerStatus(value) : null).finally(() => guard.finish(operation));
  scope = 'account-two'; resolve(initial); assert.equal(await work, null);
  guard.invalidate(); assert.ok(guard.begin(scope));
});
