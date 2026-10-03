import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const { createAppPreferencesHandlers, verifyPreferencesSessionConnection } = createRequire(import.meta.url)('../desktop/app-preferences-ipc.cjs');
const connection = { url: 'https://pet.example', token: 'fixture-session' };
const identity = { instanceId: 'fixture-service', user: { id: 'chat-only-user', isOwner: false, canUseCodex: false } };
const response = value => Response.json(value);
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { resolve, reject, promise }; };

test('login verification uses only the exact current account, fixed auth path and bounded credential-free request options', async () => {
  const calls = [];
  const value = await verifyPreferencesSessionConnection(connection, { fetchImpl: async (url, options) => { calls.push({ url, options }); return response({ ...identity, token: 'no-return', arbitrary: 'private response' }); } });
  assert.deepEqual(value, { instanceId: identity.instanceId, userId: identity.user.id });
  assert.equal(calls.length, 1); assert.equal(calls[0].url, 'https://pet.example/api/auth/me');
  assert.equal(calls[0].options.method, 'GET');
  assert.deepEqual(calls[0].options.headers, { Authorization: `Bearer ${connection.token}`, Accept: 'application/json' });
  for (const [key, value] of Object.entries({ redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' })) assert.equal(calls[0].options[key], value);
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.equal(JSON.stringify(value).includes('never-return-this'), false);
});

test('local owner logins and deployments below a URL prefix use the same fixed endpoint contract', async () => {
  const urls = [];
  for (const url of ['http://127.0.0.1:5182', 'https://pet.example/service/']) {
    const expected = url.replace(/\/+$/, '') + '/api/auth/me';
    await verifyPreferencesSessionConnection({ ...connection, url }, { fetchImpl: async actual => { urls.push(actual); return response(identity); } });
    assert.equal(urls.at(-1), expected);
  }
});

test('invalid credentials and URL features are rejected before any HTTP request', async () => {
  const invalid = [null, {}, { ...connection, userId: 'injected' }, { ...connection, token: '' }, { ...connection, token: 'bad\nvalue' },
    { ...connection, token: 'x'.repeat(4097) }, { ...connection, url: 'file:///private' }, { ...connection, url: 'https://user:pass@pet.example' },
    { ...connection, url: 'https://pet.example/?token=private' }, { ...connection, url: 'https://pet.example/#secret' },
    { ...connection, url: 'https://pet.example/path\\suffix' }, { ...connection, url: 'https://pet.example/path%2fescape' },
    { ...connection, url: 'https://pet.example/path%5cescape' }, { ...connection, url: 'https://pet.example/path%00escape' },
    { ...connection, url: ' https://pet.example' }, { ...connection, url: 'https://pet.example/' + 'x'.repeat(2049) }];
  let calls = 0;
  for (const value of invalid) await assert.rejects(verifyPreferencesSessionConnection(value, { fetchImpl: async () => { calls++; return response(identity); } }), /请先登录/);
  assert.equal(calls, 0);
});

test('network errors, auth refusals, redirects, malformed bodies and invalid identity values are sanitized', async () => {
  const secret = 'fixture-private';
  const bad = [
    () => { throw new Error(secret); },
    () => Response.json({ error: secret }, { status: 401 }),
    () => Response.json({ error: secret }, { status: 403 }),
    () => new Response(secret, { status: 302, headers: { location: 'https://evil.example/' + secret } }),
    () => new Response(secret),
    () => new Response(new Uint8Array([0xff, 0xfe])),
    () => response({ instanceId: identity.instanceId }),
    () => response({ instanceId: null, user: identity.user }),
    () => response({ instanceId: '../bad', user: identity.user }),
    () => response({ ...identity, user: { id: 'bad token' } }),
    () => response({ ...identity, user: [] }),
    () => response([identity]),
    () => ({ status: 200, redirected: true, headers: new Headers(), body: response(identity).body }),
    () => ({ status: 200, redirected: false, url: 'https://evil.example/api/auth/me', headers: new Headers(), body: response(identity).body }),
  ];
  for (const make of bad) await assert.rejects(verifyPreferencesSessionConnection(connection, { fetchImpl: async () => make() }), error => {
    assert.equal(error.message.includes(secret), false); assert.equal(error.code, 'PETPAL_PREFERENCES_VERIFICATION');
    return /无法验证当前登录/.test(error.message);
  });
});

test('oversized announced or streamed identity bodies are rejected and their streams canceled', async () => {
  for (const announced of [false, true]) {
    let canceled = false;
    const body = new ReadableStream({ start(controller) { if (!announced) controller.enqueue(new Uint8Array(1025)); }, cancel() { canceled = true; } });
    await assert.rejects(verifyPreferencesSessionConnection(connection, { maxBytes: 1024, fetchImpl: async () => new Response(body, { headers: announced ? { 'content-length': '1025' } : {} }) }), /无法验证/);
    await Promise.resolve(); assert.equal(canceled, true);
  }
});

test('both a stalled fetch and stalled response body obey the verification deadline', async () => {
  let requestSignal, canceled = false;
  await assert.rejects(verifyPreferencesSessionConnection(connection, { timeoutMs: 15, fetchImpl: (_url, options) => { requestSignal = options.signal; return new Promise(() => {}); } }), /无法验证/);
  assert.equal(requestSignal.aborted, true);
  const body = new ReadableStream({ cancel() { canceled = true; } });
  await assert.rejects(verifyPreferencesSessionConnection(connection, { timeoutMs: 15, fetchImpl: async () => new Response(body) }), /无法验证/);
  await Promise.resolve(); assert.equal(canceled, true);
});

test('valid multichunk identity is decoded after all bounded bytes arrive', async () => {
  const bytes = new TextEncoder().encode(JSON.stringify(identity));
  const body = new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.subarray(i, i + 3)); controller.close(); } });
  assert.deepEqual(await verifyPreferencesSessionConnection(connection, { fetchImpl: async () => new Response(body) }), { instanceId: identity.instanceId, userId: identity.user.id });
});

function harness(overrides = {}) {
  const event = { sender: 'main' }, calls = [], updates = [], applied = [];
  let current = { ...connection }, allowed = true;
  const preferences = {
    status: async () => ({ closeToTray: true }),
    update: async (patch, { authorize }) => { await authorize(); updates.push(patch); return { closeToTray: true, ...patch }; },
    ...overrides.preferences,
  };
  const handlers = createAppPreferencesHandlers(preferences, {
    isAllowed: raw => allowed && raw === event,
    readConnection: async () => ({ ...current }),
    verifyConnection: async value => { calls.push({ ...value }); return { instanceId: identity.instanceId, userId: identity.user.id }; },
    onUpdated: async value => { applied.push(value); },
    ...overrides.options,
  });
  return { event, calls, updates, applied, handlers, setConnection: value => { current = value; }, disallow: () => { allowed = false; },
    status: raw => handlers['petpal:app-preferences:status'](raw ?? event),
    update: (patch = { closeToTray: false }, input = connection, raw = event) => handlers['petpal:app-preferences:update'](raw, input, patch) };
}

test('status is a trusted low-sensitivity read, available before login without verification', async () => {
  const h = harness(); h.setConnection({ url: connection.url, token: '' });
  assert.deepEqual(await h.status(), { closeToTray: true }); assert.equal(h.calls.length, 0);
  await assert.rejects(h.status({ sender: 'pet' }), /可信主窗口/);
});

test('status rechecks ownership after its asynchronous read and sanitizes store failures', async () => {
  const entered = deferred(), finish = deferred();
  const h = harness({ preferences: { status: async () => { entered.resolve(); return finish.promise; } } });
  const pending = h.status(); await entered.promise; h.disallow(); finish.resolve({ closeToTray: true });
  await assert.rejects(pending, /可信主窗口/);
  const broken = harness({ preferences: { status: async () => { throw new Error('private filename and settings'); } } });
  await assert.rejects(broken.status(), error => error.code === 'PETPAL_PREFERENCES_STATUS' && !error.message.includes('private'));
});

test('logged-in Chat-only users may update and the manager receives a repeatable authorization guard', async () => {
  const h = harness(); const next = await h.update();
  assert.deepEqual(next, { closeToTray: false }); assert.equal(h.calls.length, 2);
  assert.deepEqual(h.calls[0], connection); assert.deepEqual(h.updates, [{ closeToTray: false }]); assert.deepEqual(h.applied, [next]);
});

test('guest, mismatched snapshot, untrusted frame and quitting paths cannot modify the machine', async () => {
  const guests = [null, { ...connection, token: '' }];
  for (const input of guests) { const h = harness(); await assert.rejects(h.update({}, input), /请先登录/); assert.equal(h.updates.length, 0); }
  for (const key of ['url', 'token']) {
    const h = harness(); h.setConnection({ ...connection, [key]: key === 'url' ? 'https://other.example' : 'other-session' });
    await assert.rejects(h.update(), /账号已变化/); assert.equal(h.calls.length, 0); assert.equal(h.updates.length, 0);
  }
  const h = harness(); await assert.rejects(h.update({}, connection, { sender: 'pet' }), /可信主窗口/);
  h.disallow(); await assert.rejects(h.update(), /可信主窗口/); assert.equal(h.updates.length, 0);
});

test('logout or account change while /me is awaited fails before any persistence or window changes', async () => {
  for (const change of ['logout', 'account', 'service', 'quit']) {
    const entered = deferred(), finish = deferred();
    const h = harness({ options: { verifyConnection: async () => { entered.resolve(); return finish.promise; } } });
    const pending = h.update(); await entered.promise;
    if (change === 'quit') h.disallow();
    else h.setConnection({ ...connection, token: change === 'logout' ? '' : change === 'account' ? 'other-token' : connection.token, url: change === 'service' ? 'https://other.example' : connection.url });
    finish.resolve(identity);
    await assert.rejects(pending, change === 'quit' ? /可信主窗口/ : /请先登录|账号已变化/);
    assert.equal(h.updates.length, 0); assert.equal(h.applied.length, 0);
  }
});

test('queued manager authorization catches logout before OS side effects', async () => {
  const entered = deferred(), finish = deferred(); let osModified = false;
  const h = harness({ preferences: { update: async (_patch, { authorize }) => { entered.resolve(); await finish.promise; await authorize(); osModified = true; return {}; } } });
  const pending = h.update(); await entered.promise; h.setConnection({ ...connection, token: '' }); finish.resolve();
  await assert.rejects(pending, /请先登录/); assert.equal(osModified, false); assert.equal(h.applied.length, 0);
});

test('a manager may wrap a rejected guard without losing the controlled login failure message', async () => {
  const entered = deferred(), finish = deferred();
  const h = harness({ preferences: { update: async (_patch, { authorize }) => {
    entered.resolve(); await finish.promise;
    try { await authorize(); } catch { throw Object.assign(new Error('controlled manager wrapper'), { code: 'PETPAL_APP_PREFERENCES' }); }
    return {};
  } } });
  const pending = h.update(); await entered.promise; h.setConnection({ ...connection, token: '' }); finish.resolve();
  await assert.rejects(pending, error => error.code === 'PETPAL_PREFERENCES_LOGIN' && /请先登录/.test(error.message));
});

test('revoked or unavailable /me responses never reach mutation even when the snapshot is unchanged', async () => {
  const secret = 'private failure';
  const h = harness({ options: { verifyConnection: async () => { throw new Error(secret); } } });
  await assert.rejects(h.update(), error => error.code === 'PETPAL_PREFERENCES_VERIFICATION' && !error.message.includes(secret));
  assert.equal(h.updates.length, 0); assert.equal(h.applied.length, 0);
});

test('a snapshot change during manager persistence prevents immediate window side effects', async () => {
  const entered = deferred(), finish = deferred();
  const h = harness({ preferences: { update: async () => { entered.resolve(); return finish.promise; } } });
  const pending = h.update(); await entered.promise; h.setConnection({ ...connection, token: 'changed-session' }); finish.resolve({ petAlwaysOnTop: false });
  await assert.rejects(pending, /账号已变化/); assert.equal(h.applied.length, 0);
});

test('store and OS exceptions never disclose their text; an apply failure accurately says settings were saved', async () => {
  const h = harness({ preferences: { update: async () => { throw new Error('secret file path or registry payload'); } } });
  await assert.rejects(h.update(), error => error.code === 'PETPAL_PREFERENCES_UPDATE' && !error.message.includes('secret'));
  assert.equal(h.applied.length, 0);
  const apply = harness({ options: { onUpdated: async () => { throw new Error('private native exception'); } } });
  await assert.rejects(apply.update(), error => error.code === 'PETPAL_PREFERENCES_APPLY' && /设置已保存/.test(error.message) && !error.message.includes('private'));
  assert.equal(apply.updates.length, 1);
});

test('an asynchronous apply does not return a preference response into a changed account', async () => {
  const entered = deferred(), finish = deferred();
  const h = harness({ options: { onUpdated: async () => { entered.resolve(); await finish.promise; } } });
  const pending = h.update(); await entered.promise; h.setConnection({ ...connection, token: 'changed-session' }); finish.resolve();
  await assert.rejects(pending, /账号已变化/);
});

const preloadSource = await readFile(new URL('../desktop/preload.cjs', import.meta.url), 'utf8');
function preloadFixture() {
  let facade, saved = null, reads = 0, denyStorage = false;
  const calls = [];
  vm.runInNewContext(preloadSource, {
    require(name) {
      assert.equal(name, 'electron');
      return {
        contextBridge: { exposeInMainWorld(name, value) { assert.equal(name, 'petpal'); facade = value; } },
        ipcRenderer: { invoke: async (...args) => { calls.push(args); return { ok: true }; } },
      };
    },
    sessionStorage: { getItem(key) { reads++; assert.equal(key, 'petpal.connection'); if (denyStorage) throw new Error('storage denied'); return saved; } },
    location: { origin: 'http://127.0.0.1:5182' },
  });
  return { facade, calls, setSaved: value => { saved = value; }, deny: () => { denyStorage = true; }, get reads() { return reads; } };
}

test('real preload normalizes only same-site empty URL and carries only the current selected account snapshot', async () => {
  const h = preloadFixture(), patch = { autoLaunch: true };
  h.setSaved(JSON.stringify({ url: '', token: connection.token, credentialKind: 'session', target: 'local', ignored: 'metadata' }));
  await h.facade.preferences.update(patch);
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0])), ['petpal:app-preferences:update', { url: 'http://127.0.0.1:5182', token: connection.token }, patch]);
  h.setSaved(JSON.stringify({ ...connection, token: 'next-account' }));
  await h.facade.preferences.update(patch);
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls[1])), ['petpal:app-preferences:update', { url: connection.url, token: 'next-account' }, patch]);
  assert.equal(h.reads, 2);
  assert.equal(Object.isFrozen(h.facade.preferences), true);
});

test('real preload status requires no storage and missing or rejected storage cannot substitute native bootstrap credentials', async () => {
  const h = preloadFixture(); h.deny();
  await h.facade.preferences.status(); assert.equal(h.reads, 0); assert.deepEqual(h.calls[0], ['petpal:app-preferences:status']);
  await h.facade.preferences.update({ closeToTray: true });
  assert.equal(h.calls[1][0], 'petpal:app-preferences:update'); assert.equal(h.calls[1][1], null);
  assert.equal(h.calls.some(call => call[0] === 'petpal:connection'), false);
  const invalid = preloadFixture(); invalid.setSaved('{invalid JSON'); await invalid.facade.preferences.update({ closeToTray: true });
  assert.equal(invalid.calls[0][1], null);
});
