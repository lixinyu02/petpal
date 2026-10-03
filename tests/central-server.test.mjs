import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const { createCentralServer, normalizePublicUrl, validateCentralServerPatch } = createRequire(import.meta.url)('../desktop/central-server.cjs');
const authorize = async () => {};
const listen = (server, port = 0, host = '127.0.0.1') => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => { server.off('error', reject); resolve(server.address().port); }); });
const close = server => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
async function freePort(t) {
  const server = createServer(); let port;
  do { port = await listen(server); await close(server); } while (assertPort(port) === false);
  return port;
}
function assertPort(port) { try { validateCentralServerPatch({ port }); return true; } catch { return false; } }
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }

async function fixture(t, { password = true, fsImpl = fs, platform = 'win32', createListener, reservedPorts = [] } = {}) {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'petpal-central-test-')), listeners = [], calls = [];
  let hasPassword = password;
  const hosting = { status: () => ({ ownerHasPassword: hasPassword, instanceId: 'native-fixture' }),
    createListener: options => {
      calls.push(options);
      const value = createListener ? createListener(options) : createServer((req, res) => {
        res.setHeader('Connection', 'close'); res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ path: req.url, remoteAddress: req.socket.remoteAddress, marker: 'same-app-fixture' }));
      });
      listeners.push(value); return value;
    }, updateListener: (_listener, options) => { calls.push({ update: true, ...options }); } };
  const manager = createCentralServer({ userData: directory, hosting, platform, fs: fsImpl, reservedPorts,
    networkInterfaces: () => ({ ethernet: [{ family: 'IPv4', address: '192.168.60.222', internal: false },
      { family: 'IPv4', address: '192.168.60.222', internal: false }, { family: 'IPv6', address: 'fe80::1', internal: false },
      { family: 'IPv4', address: '169.254.1.1', internal: false }], loopback: [{ family: 'IPv4', address: '127.0.0.1', internal: true }] }) });
  t.after(async () => { await manager.close(); for (const value of listeners) await close(value); assert.ok(directory.startsWith(path.join(tmpdir(), 'petpal-central-test-'))); await fs.rm(directory, { recursive: true, force: true }); });
  return { directory, manager, listeners, calls, hosting, file: path.join(directory, 'central-server.json'), setPassword: value => { hasPassword = value; } };
}

test('central defaults are closed without writing files, status contains only public hosting metadata', async t => {
  const h = await fixture(t), value = await h.manager.load();
  assert.deepEqual(value, { supported: true, platform: 'win32', enabled: false, listening: false, port: 4319, urls: [], publicUrl: '', ownerHasPassword: true });
  assert.deepEqual(await fs.readdir(h.directory), []); assert.equal(h.calls.length, 0);
  assert.equal(JSON.stringify(value).includes('native-fixture'), false);
});

test('central port and public HTTPS origin validate without accepting secrets or endpoint paths', () => {
  for (const port of [0, 80, 1023, 2049, 5060, 6000, 6667, 10080, 65536, 4319.1, '4319', null]) assert.throws(() => validateCentralServerPatch({ port }));
  assert.deepEqual(validateCentralServerPatch({ enabled: true, port: 4319, publicUrl: 'https://PET.example:443/' }), { enabled: true, port: 4319, publicUrl: 'https://pet.example' });
  for (const value of [null, [], { unsupported: true }, { version: 1 }, { enabled: 1 }, { publicUrl: null }]) assert.throws(() => validateCentralServerPatch(value));
  for (const url of ['http://pet.example', 'https://user:secret@pet.example', 'https://pet.example/v1', 'https://pet.example?x=1',
    'https://pet.example#fragment', 'https://pet.example?', 'https://pet.example#', 'https://pet.example/.', 'https://pet.example/a/..',
    'https:pet.example', 'https:///pet.example', ' https://pet.example', 'https://pet.example\\path', 'https://*.example', 'https://pet.example/%2f']) assert.throws(() => normalizePublicUrl(url));
  assert.equal(normalizePublicUrl(''), '');
});

test('enabling persists only public config and exposes a real additional listener with LAN address readback', async t => {
  const h = await fixture(t), port = await freePort(t);
  await h.manager.load();
  const value = await h.manager.update({ enabled: true, port, publicUrl: 'https://pet.example/' }, { authorize });
  assert.equal(value.listening, true); assert.deepEqual(value.urls, [`http://192.168.60.222:${port}`]);
  assert.equal(h.listeners[0].address().address, '0.0.0.0');
  const reply = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2000) });
  assert.equal((await reply.json()).path, '/api/health');
  assert.deepEqual(JSON.parse(await fs.readFile(h.file, 'utf8')), { version: 1, enabled: true, port, publicUrl: 'https://pet.example' });
  assert.deepEqual(h.calls, [{ publicUrl: 'https://pet.example' }]);
});

test('port replacement binds and commits the new listener before retiring only the previous listener', async t => {
  const h = await fixture(t), first = await freePort(t), second = await freePort(t);
  await h.manager.update({ enabled: true, port: first }, { authorize });
  let bothWereListening = false;
  await h.manager.update({ port: second }, { authorize: async () => { if (h.listeners.length === 2 && h.listeners.every(value => value.listening)) bothWereListening = true; } });
  assert.equal(bothWereListening, true); assert.equal(h.listeners[0].listening, false); assert.equal(h.listeners[1].listening, true);
  const value = await h.manager.status(); assert.equal(value.port, second); assert.equal(value.listening, true);
  await h.manager.update({ enabled: false }, { authorize });
  assert.equal(h.listeners[1].listening, false); assert.equal((await h.manager.status()).enabled, false);
});

test('an occupied port preserves current config and running listener without leaking exception text', async t => {
  const h = await fixture(t), port = await freePort(t), occupied = createServer();
  const occupiedPort = await listen(occupied, 0, '0.0.0.0'); t.after(() => close(occupied));
  await h.manager.update({ enabled: true, port }, { authorize }); const before = await fs.readFile(h.file);
  await assert.rejects(h.manager.update({ port: occupiedPort }, { authorize }), error => error.code === 'PETPAL_CENTRAL_SERVER_PORT_IN_USE');
  assert.deepEqual(await fs.readFile(h.file), before); assert.equal(h.listeners[0].listening, true);
  assert.equal((await h.manager.status()).port, port);
});

test('owner password is mandatory to enable and missing password on restore leaves saved intent intact', async t => {
  const h = await fixture(t, { password: false }), port = await freePort(t);
  await assert.rejects(h.manager.update({ enabled: true, port }, { authorize }), /设置登录密码/);
  assert.equal(h.calls.length, 0); await assert.rejects(fs.stat(h.file), { code: 'ENOENT' });
  const settings = { version: 1, enabled: true, port, publicUrl: '' };
  await fs.writeFile(h.file, JSON.stringify(settings)); const restored = await h.manager.load();
  assert.equal(restored.enabled, true); assert.equal(restored.listening, false); assert.match(restored.reason, /登录密码/);
  assert.deepEqual(JSON.parse(await fs.readFile(h.file, 'utf8')), settings);
});

test('restart restores the saved listener and ordinary shutdown does not change enabled intent', async t => {
  const h = await fixture(t), port = await freePort(t);
  await fs.writeFile(h.file, JSON.stringify({ version: 1, enabled: true, port, publicUrl: '' }));
  assert.equal((await h.manager.load()).listening, true);
  await h.manager.load(); assert.equal(h.calls.length, 1, 'load must not create a second listener');
  await h.manager.close(); assert.equal((await h.manager.status()).listening, false);
  assert.equal(JSON.parse(await fs.readFile(h.file, 'utf8')).enabled, true);
  await assert.rejects(h.manager.update({ enabled: false }, { authorize }), /正在退出/);
});

test('malformed, oversized and incompatible persisted config are preserved while startup remains usable', async t => {
  for (const bytes of [Buffer.from('{private-invalid'), Buffer.alloc(8193, 32), Buffer.from(JSON.stringify({ ...{ version: 1, enabled: true, port: 4319, publicUrl: '' }, secret: 'private' })), Buffer.from([0xff, 0xfe])]) {
    const h = await fixture(t); await fs.writeFile(h.file, bytes);
    const value = await h.manager.load(); assert.equal(value.listening, false); assert.equal(value.enabled, false); assert.match(value.reason, /原文件保留/);
    assert.deepEqual(await fs.readFile(h.file), bytes); assert.equal(h.calls.length, 0);
  }
});

test('startup bind failure is nonfatal, retaining saved intent and actionable reason', async t => {
  const occupied = createServer(), port = await listen(occupied, 0, '0.0.0.0'); t.after(() => close(occupied));
  const h = await fixture(t); await fs.writeFile(h.file, JSON.stringify({ version: 1, enabled: true, port, publicUrl: '' }));
  const value = await h.manager.load(); assert.equal(value.enabled, true); assert.equal(value.listening, false); assert.match(value.reason, /占用/);
});

test('persistence failure closes the provisional listener and leaves the old listener and config intact', async t => {
  let rejectRename = false;
  const h = await fixture(t, { fsImpl: { ...fs, rename: async (...args) => { if (rejectRename) throw new Error('private disk state'); return fs.rename(...args); } } });
  const first = await freePort(t), second = await freePort(t);
  await h.manager.update({ enabled: true, port: first }, { authorize }); const before = await fs.readFile(h.file); rejectRename = true;
  await assert.rejects(h.manager.update({ port: second }, { authorize }), error => error.code === 'PETPAL_CENTRAL_SERVER_SAVE' && !error.message.includes('private'));
  assert.equal(h.listeners[0].listening, true); assert.equal(h.listeners[1].listening, false); assert.deepEqual(await fs.readFile(h.file), before);
  assert.deepEqual((await fs.readdir(h.directory)).sort(), ['central-server.json']);
});

test('logout after bind but before durable commit retracts the provisional network listener', async t => {
  const h = await fixture(t), port = await freePort(t); let count = 0;
  await assert.rejects(h.manager.update({ enabled: true, port }, { authorize: async () => {
    if (++count === 2) throw Object.assign(new Error('登录账号已变化'), { code: 'PETPAL_CENTRAL_IPC_CHANGED' });
  } }), error => error.code === 'PETPAL_CENTRAL_IPC_CHANGED');
  assert.equal(h.listeners.length, 1); assert.equal(h.listeners[0].listening, false);
  await assert.rejects(fs.stat(h.file), { code: 'ENOENT' }); assert.equal((await h.manager.status()).enabled, false);
});

test('shutdown while bind is being authorized retracts the candidate and prevents settings commit', async t => {
  const h = await fixture(t), port = await freePort(t), entered = deferred(), finish = deferred(); let count = 0;
  const update = h.manager.update({ enabled: true, port }, { authorize: async () => { if (++count === 2) { entered.resolve(); await finish.promise; } } });
  await entered.promise; const closing = h.manager.close(); finish.resolve();
  await assert.rejects(update, /正在退出/); await closing; assert.equal(h.listeners[0].listening, false);
  await assert.rejects(fs.stat(h.file), { code: 'ENOENT' });
});

test('password disappearing during restore never leaves a provisional listener online', async t => {
  const h = await fixture(t), port = await freePort(t); let reads = 0;
  h.hosting.status = () => { if (++reads === 2) throw new Error('private'); return { ownerHasPassword: true }; };
  await fs.writeFile(h.file, JSON.stringify({ version: 1, enabled: true, port, publicUrl: '' }));
  const value = await h.manager.load(); assert.equal(value.listening, false); assert.equal(h.listeners[0].listening, false);
});

test('unsupported platforms never listen or persist an enabled central server', async t => {
  const h = await fixture(t, { platform: 'darwin' });
  assert.equal((await h.manager.load()).supported, false);
  await assert.rejects(h.manager.update({ enabled: true }, { authorize }), /此系统/); assert.equal(h.calls.length, 0);
});

test('changing public origin commits and updates network policy without replacing or stopping the fixed listener', async t => {
  const h = await fixture(t), port = await freePort(t);
  await h.manager.update({ enabled: true, port }, { authorize });
  await h.manager.update({ publicUrl: 'https://pet.example' }, { authorize });
  assert.equal((await h.manager.status()).publicUrl, 'https://pet.example'); assert.equal(h.listeners[0].listening, true);
  assert.equal(h.listeners.length, 1); assert.deepEqual(h.calls.at(-1), { update: true, publicUrl: 'https://pet.example' });
  assert.equal(JSON.parse(await fs.readFile(h.file, 'utf8')).publicUrl, 'https://pet.example');
});

test('same-port policy update failure restores exact persisted bytes and prior network policy', async t => {
  const h = await fixture(t), port = await freePort(t);
  await h.manager.update({ enabled: true, port }, { authorize });
  const before = await fs.readFile(h.file), updates = [];
  h.hosting.updateListener = (_listener, options) => { updates.push(options); if (options.publicUrl) throw new Error('private internal policy'); };
  await assert.rejects(h.manager.update({ publicUrl: 'https://pet.example' }, { authorize }), error => error.code === 'PETPAL_CENTRAL_SERVER_POLICY' && !error.message.includes('private'));
  assert.deepEqual(await fs.readFile(h.file), before); assert.equal((await h.manager.status()).publicUrl, '');
  assert.deepEqual(updates, [{ publicUrl: 'https://pet.example' }, { publicUrl: '' }]); assert.equal(h.listeners[0].listening, true);
});

test('an asynchronous listener error is handled and reflected as offline without crashing the local backend', async t => {
  const h = await fixture(t), port = await freePort(t);
  await h.manager.update({ enabled: true, port }, { authorize });
  h.listeners[0].emit('error', new Error('private unexpected listener error'));
  const value = await h.manager.status(); assert.equal(value.listening, false); assert.match(value.reason, /监听发生错误/);
  assert.equal(JSON.stringify(value).includes('private'), false); assert.equal(value.enabled, true);
});

test('a reserved loopback origin port is refused before a wildcard bind even on Windows', async t => {
  const port = await freePort(t), h = await fixture(t, { reservedPorts: [port] });
  await assert.rejects(h.manager.update({ enabled: true, port }, { authorize }), error => error.code === 'PETPAL_CENTRAL_SERVER_RESERVED_PORT');
  assert.equal(h.calls.length, 0); await assert.rejects(fs.stat(h.file), { code: 'ENOENT' });
});

test('config read is bounded through an fd even when the file grows after its stat', async t => {
  let requestedBytes = 0, grow = true, target;
  const fsImpl = { ...fs, readFile: async () => { throw new Error('Unbounded config read must not be used'); },
    open: async (...args) => {
      const handle = await fs.open(...args);
      if (args[0] !== target) return handle;
      return { stat: () => handle.stat(), close: () => handle.close(), read: async (buffer, offset, length, position) => {
        requestedBytes += length;
        if (grow) { grow = false; await fs.appendFile(target, Buffer.alloc(20000, 32)); }
        return handle.read(buffer, offset, length, position);
      } };
    } };
  const h = await fixture(t, { fsImpl }); target = h.file;
  await fs.writeFile(target, JSON.stringify({ version: 1, enabled: false, port: 4319, publicUrl: '' }));
  const value = await h.manager.load(); assert.equal(value.enabled, false); assert.match(value.reason, /原文件保留/);
  assert.equal(requestedBytes, 8193); assert.ok((await fs.stat(target)).size > 8193);
});

test('central config symlinks are never followed and their target bytes remain unchanged', async t => {
  const h = await fixture(t), target = path.join(h.directory, 'preserved.json'), bytes = '{private target}';
  await fs.writeFile(target, bytes);
  try { await fs.symlink(target, h.file, 'file'); }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('Host lacks symbolic-link creation permission'); return; } throw error; }
  const value = await h.manager.load(); assert.equal(value.listening, false); assert.match(value.reason, /原文件保留/);
  await assert.rejects(h.manager.update({ enabled: false }, { authorize }), /配置文件无效/);
  assert.equal(await fs.readFile(target, 'utf8'), bytes); assert.equal((await fs.lstat(h.file)).isSymbolicLink(), true);
});

test('session revocation after rename retracts an enabled listener and removes a first persisted intent', async t => {
  let armed = false, valid = true;
  const fsImpl = { ...fs, rename: async (...args) => { await fs.rename(...args); if (armed) valid = false; } };
  const h = await fixture(t, { fsImpl }), port = await freePort(t); armed = true;
  await assert.rejects(h.manager.update({ enabled: true, port }, { authorize: async () => {
    if (!valid) throw Object.assign(new Error('账号已撤销'), { code: 'PETPAL_CENTRAL_IPC_CHANGED' });
  } }), error => error.code === 'PETPAL_CENTRAL_IPC_CHANGED');
  assert.equal(h.listeners[0].listening, false); assert.equal((await h.manager.status()).enabled, false);
  await assert.rejects(fs.stat(h.file), { code: 'ENOENT' });
});

test('session revocation after a replacement config rename restores prior bytes and keeps its original listener', async t => {
  let armed = false, valid = true;
  const fsImpl = { ...fs, rename: async (...args) => { await fs.rename(...args); if (armed) valid = false; } };
  const h = await fixture(t, { fsImpl }), first = await freePort(t), second = await freePort(t);
  await h.manager.update({ enabled: true, port: first }, { authorize }); const before = await fs.readFile(h.file); armed = true;
  await assert.rejects(h.manager.update({ port: second }, { authorize: async () => {
    if (!valid) throw Object.assign(new Error('账号已撤销'), { code: 'PETPAL_CENTRAL_IPC_CHANGED' });
  } }), error => error.code === 'PETPAL_CENTRAL_IPC_CHANGED');
  assert.deepEqual(await fs.readFile(h.file), before); assert.equal(h.listeners[0].listening, true); assert.equal(h.listeners[1].listening, false);
  assert.equal((await h.manager.status()).port, first);
});

test('shutdown triggered after rename restores the prior disabled intent and closes its provisional listener', async t => {
  let armed = false, closing;
  const fsImpl = { ...fs, rename: async (...args) => { await fs.rename(...args); if (armed) closing = h.manager.close(); } };
  const h = await fixture(t, { fsImpl }), port = await freePort(t);
  await h.manager.update({ enabled: false, port }, { authorize }); const before = await fs.readFile(h.file); armed = true;
  await assert.rejects(h.manager.update({ enabled: true }, { authorize }), /正在退出/);
  await closing; assert.deepEqual(await fs.readFile(h.file), before); assert.equal(h.listeners[0].listening, false);
});

test('revocation after same-port policy application restores both previous policy and config without closing the listener', async t => {
  const h = await fixture(t), port = await freePort(t); let valid = true; const updates = [];
  await h.manager.update({ enabled: true, port }, { authorize }); const before = await fs.readFile(h.file);
  h.hosting.updateListener = (_listener, options) => { updates.push(options); if (options.publicUrl) valid = false; };
  await assert.rejects(h.manager.update({ publicUrl: 'https://pet.example' }, { authorize: async () => {
    if (!valid) throw Object.assign(new Error('账号已撤销'), { code: 'PETPAL_CENTRAL_IPC_CHANGED' });
  } }), error => error.code === 'PETPAL_CENTRAL_IPC_CHANGED');
  assert.deepEqual(await fs.readFile(h.file), before); assert.equal(h.listeners[0].listening, true); assert.equal((await h.manager.status()).publicUrl, '');
  assert.deepEqual(updates, [{ publicUrl: 'https://pet.example' }, { publicUrl: '' }]);
});
