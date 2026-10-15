import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const { createOfficialAccountHandlers, officialPublicStatus } = createRequire(import.meta.url)('../desktop/official-account-ipc.cjs');
const selected = { url: 'http://127.0.0.1:43199', token: 'fixture-session' };
const status = { state: 'signed-in', activeProfileId: 'profile-one', planUsageEnabled: true,
  profiles: [{ id: 'profile-one', email: 'one@example.test', label: '账号一', signedIn: true, planUsageEnabled: true }],
  models: [{ id: 'model-one', model: 'official-model', displayName: '官方模型', supportsImages: true }] };
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { resolve, promise }; };
function fixture({ verify, operation, unavailable } = {}) {
  let current = { ...selected }, allowed = true;
  const calls = [], event = {}, auth = {};
  const accounts = { async status(userId) { calls.push(['status', userId]); return status; }, async refresh(userId) { calls.push(['refresh', userId]); } };
  for (const action of ['start', 'cancel', 'select', 'logout']) auth[action] = async (...args) => {
    calls.push([action, ...args]); const options = args.at(-1); await operation?.(action, options); await options.authorize();
  };
  const handlers = createOfficialAccountHandlers({ auth, accounts, origin: selected.url, isAllowed: raw => raw === event && allowed,
    unavailable,
    readConnection: async () => current,
    verifyConnection: async value => { calls.push(['verify', value]); return verify ? verify(value) : { instanceId: 'local-instance', userId: 'ordinary-user' }; },
  });
  return { calls, event, auth, accounts, setConnection: value => { current = value; }, disallow: () => { allowed = false; },
    call: (action, input, connection = selected, sender = event) => handlers[`petpal:official-account:${action}`](sender, connection, input) };
}

test('official management only accepts a currently logged-in trusted main frame on its embedded local service', async () => {
  for (const action of ['status', 'start', 'refresh', 'cancel', 'select', 'logout']) {
    const f = fixture();
    await assert.rejects(f.call(action, undefined, null), /先登录/);
    await assert.rejects(f.call(action, undefined, selected, {}), /可信主窗口/);
    await assert.rejects(f.call(action, undefined, { ...selected, url: 'https://central.example.test' }), /本机服务/);
    await assert.rejects(f.call(action, undefined, { ...selected, url: `${selected.url}/path` }), /本机服务/);
    assert.equal(f.calls.length, 0, 'Credentials cannot be sent to another service');
  }
});

test('a damaged optional official store is reported after login without calling account mutations', async () => {
  const f = fixture({ unavailable: () => true });
  await assert.rejects(f.call('start'), /私有目录权限或系统密钥环/);
  assert.equal(f.calls.some(call => call[0] === 'start'), false);
  await assert.rejects(f.call('status', undefined, null), /先登录/);
});

test('ordinary users manage only the user returned by online local session verification', async () => {
  const f = fixture();
  assert.deepEqual(await f.call('start', { profileId: 'profile-one' }), { supported: true, ...status });
  const action = f.calls.find(call => call[0] === 'start'); assert.equal(action[1], 'ordinary-user');
  assert.deepEqual(action[2], { profileId: 'profile-one' }); assert.equal(typeof action[3].authorize, 'function');
  assert.equal(f.calls.filter(call => call[0] === 'verify').length, 2);
  await f.call('select', 'profile-one'); await f.call('cancel'); await f.call('logout'); await f.call('refresh');
  for (const call of f.calls.filter(call => ['select', 'cancel', 'logout', 'refresh', 'status'].includes(call[0]))) assert.equal(call[1], 'ordinary-user');
});

test('renderer cannot inject a user id, auth URL, token or arbitrary profile object', async () => {
  const f = fixture();
  for (const input of [{ userId: 'other' }, { authUrl: 'https://evil.test' }, { profileId: '' }, [], null]) await assert.rejects(f.call('start', input), /有效的官方账号/);
  await assert.rejects(f.call('select', { profileId: 'profile-one' }), /有效的官方账号/);
  assert.equal(f.calls.some(call => call[0] === 'start' || call[0] === 'select'), false);
});

test('account changes during verification or a queued mutation stop before identity side effects', async () => {
  const enter = deferred(), finish = deferred();
  const f = fixture({ verify: async () => { enter.resolve(); await finish.promise; return { instanceId: 'local-instance', userId: 'ordinary-user' }; } });
  const request = f.call('start'); await enter.promise; f.setConnection({ ...selected, token: 'next-user' }); finish.resolve();
  await assert.rejects(request, /登录已变化/); assert.equal(f.calls.some(call => call[0] === 'start'), false);
  let changed;
  const queued = fixture({ operation: async (_action, options) => { changed(); await options.authorize(); } });
  changed = () => queued.setConnection({ ...selected, token: 'other-user' });
  await assert.rejects(queued.call('select', 'profile-one'), /登录已变化/);
});

test('expired local login, changed identity and private runtime failures return controlled errors', async () => {
  const secret = 'refresh-token-never-return';
  const noLogin = fixture({ verify: async () => { throw new Error(secret); } });
  await assert.rejects(noLogin.call('status'), error => !error.message.includes(secret) && /无法验证/.test(error.message));
  let count = 0;
  const changed = fixture({ verify: async () => ({ instanceId: 'local-instance', userId: ++count > 1 ? 'different-user' : 'ordinary-user' }) });
  await assert.rejects(changed.call('logout'), /登录已变化/);
  const failed = fixture(); failed.auth.start = async () => { throw Object.assign(new Error(secret), { code: 'PETPAL_OFFICIAL_FAKE' }); };
  await assert.rejects(failed.call('start'), error => /未能打开官方登录/.test(error.message) && !error.message.includes(secret));
});

test('public account status whitelists display fields and strips all private credential/runtime fields', () => {
  const output = officialPublicStatus({ ...status, accessToken: 'secret-access', refreshToken: 'secret-refresh', authUrl: 'secret-url',
    clientId: 'secret-client', subject: 'secret-subject', revision: 'internal', gatewayKey: 'secret-gateway',
    profiles: status.profiles.map(profile => ({ ...profile, accessToken: 'secret-profile' })),
    models: status.models.map(model => ({ ...model, apiKey: 'secret-key', baseUrl: 'secret-local' })),
    error: 'secret-error', modelsError: 'secret-model-error' });
  assert.equal(JSON.stringify(output).includes('secret-'), false);
  assert.equal(output.models[0].model, 'official-model'); assert.equal(output.profiles[0].email, 'one@example.test');
  assert.throws(() => officialPublicStatus({ state: 'unknown' }), /无法读取/);
});

test('real preload exposes a fixed official API and captures only the current connection on every call', async () => {
  let bridge, saved = selected; const calls = [];
  vm.runInNewContext(await readFile(new URL('../desktop/preload.cjs', import.meta.url), 'utf8'), {
    require: name => { assert.equal(name, 'electron'); return { contextBridge: { exposeInMainWorld: (_name, value) => { bridge = value; } }, ipcRenderer: { invoke: async (...args) => { calls.push(args); } } }; },
    sessionStorage: { getItem: () => saved ? JSON.stringify(saved) : null }, location: { origin: selected.url },
  });
  assert.deepEqual(Object.keys(bridge.officialAccount), ['status', 'start', 'cancel', 'select', 'logout', 'refresh']);
  assert.equal(Object.isFrozen(bridge.officialAccount), true);
  await bridge.officialAccount.start(); saved = { url: '', token: 'next-session' }; await bridge.officialAccount.select('profile-one');
  saved = null; await bridge.officialAccount.logout();
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['petpal:official-account:start', selected, null],
    ['petpal:official-account:select', { url: selected.url, token: 'next-session' }, 'profile-one'],
    ['petpal:official-account:logout', null, null],
  ]);
});
