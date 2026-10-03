import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const { createCentralServerHandlers } = createRequire(import.meta.url)('../desktop/central-server-ipc.cjs');
const origin = 'http://127.0.0.1:5182', selected = { url: origin, token: 'fixture-local-owner' };
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }
function fixture(options = {}) {
  const event = { sender: 'main' }, calls = [], updates = [];
  let current = { ...selected }, allowed = true, valid = true;
  const manager = { status: async () => ({ enabled: false, listening: false, urls: [] }),
    update: async (patch, { authorize }) => { await authorize(); updates.push(patch); return { enabled: patch.enabled }; }, ...options.manager };
  const handlers = createCentralServerHandlers(manager, {
    origin, isAllowed: input => allowed && input === event,
    readConnection: async () => current,
    assertOwnerSession: token => { calls.push(token); if (!valid || token !== selected.token) throw new Error('private owner assertion'); },
    ...options.handlers,
  });
  return { calls, updates, event,
    setConnection: value => { current = value; }, disallow: () => { allowed = false; }, revoke: () => { valid = false; },
    status: (snapshot = selected, raw = event) => handlers['petpal:central-server:status'](raw, snapshot),
    update: (patch = { enabled: true }, snapshot = selected, raw = event) => handlers['petpal:central-server:update'](raw, snapshot, patch) };
}

test('status and update require a currently selected local owner and repeated server-side assertion', async () => {
  const h = fixture(); assert.deepEqual(await h.status(), { enabled: false, listening: false, urls: [] });
  assert.deepEqual(await h.update(), { enabled: true }); assert.ok(h.calls.length >= 8);
  assert.equal(h.calls.every(token => token === selected.token), true); assert.deepEqual(h.updates, [{ enabled: true }]);
});

test('guest, remote owner, URL alias, local member, untrusted frame and quitting cannot inspect or manage hosting', async () => {
  for (const value of [null, {}, { ...selected, token: '' }, { ...selected, token: 'bad\nvalue' }, { ...selected, token: 'x'.repeat(4097) },
    { ...selected, extra: true }, { ...selected, url: 'https://remote.example' }, { ...selected, url: 'http://localhost:5182' },
    { ...selected, url: origin + '/' }, { ...selected, token: 'member-token' }]) {
    const h = fixture(); h.setConnection(value);
    await assert.rejects(h.status(value), error => /^PETPAL_CENTRAL_IPC_/.test(error.code));
    await assert.rejects(h.update({}, value), error => /^PETPAL_CENTRAL_IPC_/.test(error.code)); assert.equal(h.updates.length, 0);
  }
  const h = fixture(); await assert.rejects(h.status(selected, { sender: 'pet' }), /可信主窗口/);
  h.disallow(); await assert.rejects(h.update(), /可信主窗口/); assert.equal(h.calls.length, 0);
});

test('snapshot mismatch prevents reading manager status even when supplied token is a valid owner', async () => {
  let reads = 0;
  const h = fixture({ manager: { status: async () => { reads++; return {}; } } });
  h.setConnection({ ...selected, token: 'another-account' });
  await assert.rejects(h.status(), /账号已变化/); assert.equal(reads, 0); assert.equal(h.calls.length, 0);
});

test('status does not return network addresses after logout during a delayed manager read', async () => {
  const entered = deferred(), finish = deferred();
  const h = fixture({ manager: { status: async () => { entered.resolve(); return finish.promise; } } });
  const pending = h.status(); await entered.promise; h.setConnection(null); finish.resolve({ urls: ['http://192.168.60.222:4319'] });
  await assert.rejects(pending, /请先登录/);
});

test('queued update reauthorization prevents logout or connection changes from opening a network listener', async () => {
  for (const change of ['logout', 'remote', 'account', 'quit', 'revoked']) {
    const entered = deferred(), finish = deferred(); let listenerOpened = false;
    const h = fixture({ manager: { update: async (_patch, { authorize }) => { entered.resolve(); await finish.promise; await authorize(); listenerOpened = true; return {}; } } });
    const pending = h.update(); await entered.promise;
    if (change === 'quit') h.disallow();
    else if (change === 'revoked') h.revoke();
    else h.setConnection(change === 'logout' ? null : { ...selected, ...(change === 'remote' ? { url: 'https://remote.example' } : { token: 'different-account' }) });
    finish.resolve(); await assert.rejects(pending, error => /^PETPAL_CENTRAL_IPC_/.test(error.code)); assert.equal(listenerOpened, false);
  }
});

test('logout while the renderer snapshot is pending is rejected by a second backend owner assertion', async () => {
  const entered = deferred(), finish = deferred(); let reads = 0, ownerValid = true;
  const h = fixture({ handlers: {
    readConnection: async () => { if (++reads === 2) { entered.resolve(); await finish.promise; } return selected; },
    assertOwnerSession: () => { if (!ownerValid) throw new Error('revoked-session-private'); },
  } });
  const pending = h.update(); await entered.promise; ownerValid = false; finish.resolve();
  await assert.rejects(pending, error => error.code === 'PETPAL_CENTRAL_IPC_OWNER' && !error.message.includes('private'));
  assert.equal(h.updates.length, 0);
});

test('manager failures are sanitized while controlled central errors retain useful diagnostics', async () => {
  const h = fixture({ manager: { status: async () => { throw new Error('private file path'); }, update: async () => { throw new Error('private socket payload'); } } });
  await assert.rejects(h.status(), error => error.code === 'PETPAL_CENTRAL_IPC_STATUS' && !error.message.includes('private'));
  await assert.rejects(h.update(), error => error.code === 'PETPAL_CENTRAL_IPC_UPDATE' && !error.message.includes('private'));
  const controlled = fixture({ manager: { update: async () => { throw Object.assign(new Error('端口已被占用'), { code: 'PETPAL_CENTRAL_SERVER_PORT_IN_USE' }); } } });
  await assert.rejects(controlled.update(), error => error.code === 'PETPAL_CENTRAL_SERVER_PORT_IN_USE');
});

const source = await readFile(new URL('../desktop/preload.cjs', import.meta.url), 'utf8');
function preload() {
  const calls = []; let facade, saved = null, rejectedStorage = false;
  vm.runInNewContext(source, {
    require(name) { assert.equal(name, 'electron'); return { contextBridge: { exposeInMainWorld(name, value) { assert.equal(name, 'petpal'); facade = value; } },
      ipcRenderer: { invoke: async (...args) => { calls.push(args); return {}; } } }; },
    sessionStorage: { getItem: () => { if (rejectedStorage) throw new Error('storage disabled'); return saved; } }, location: { origin },
  });
  return { calls, facade, save: value => { saved = value; }, deny: () => { rejectedStorage = true; } };
}

test('preload status and update send only the current account snapshot, never automatic pairing credentials', async () => {
  const h = preload(); h.save(JSON.stringify({ url: '', token: selected.token, target: 'local', credentialKind: 'owner', unwanted: true }));
  await h.facade.centralServer.status(); await h.facade.centralServer.update({ enabled: true, port: 4319 });
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls)), [
    ['petpal:central-server:status', selected], ['petpal:central-server:update', selected, { enabled: true, port: 4319 }],
  ]);
  assert.equal(Object.isFrozen(h.facade.centralServer), true); assert.equal(h.calls.some(call => call[0] === 'petpal:connection'), false);
  h.save(JSON.stringify({ url: 'https://remote.example', token: 'next-login' })); await h.facade.centralServer.status();
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.at(-1))), ['petpal:central-server:status', { url: 'https://remote.example', token: 'next-login' }]);
});

test('logged-out and storage-denied central calls forward null without substituting native credentials', async () => {
  const h = preload(); await h.facade.centralServer.status(); assert.equal(h.calls[0][1], null);
  h.deny(); await h.facade.centralServer.update({ enabled: true }); assert.equal(h.calls[1][1], null);
});
