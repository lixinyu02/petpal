import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPetServer } from '../server/app.mjs';
import { listenFixture } from './helpers/loopback.mjs';

const { createCentralServer } = createRequire(import.meta.url)('../desktop/central-server.cjs');
const { createCentralServerHandlers } = createRequire(import.meta.url)('../desktop/central-server-ipc.cjs');
const requestVirtualHost = (port, hostname) => new Promise((resolve, reject) => {
  const req = httpRequest({ hostname: '127.0.0.1', port, path: '/api/health', headers: { Host: hostname, Origin: `https://${hostname}` } }, res => {
    res.resume(); res.once('end', () => resolve(res.statusCode));
  }); req.once('error', reject); req.setTimeout(3000, () => req.destroy(new Error('Fixture timeout'))); req.end();
});

test('native central manager serves the same backend over its extra socket with password sessions and preserves the local backend on disable', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-native-hosting-')), bootstrap = 'isolated-native-bootstrap';
  const backend = await createPetServer({ dataDir: path.join(directory, 'data'), token: bootstrap,
    codex: { async status() { return { available: true, authenticated: false }; }, async close() {} }, desktopTools: { async close() {} } });
  await listenFixture(backend.server); const origin = `http://127.0.0.1:${backend.server.address().port}`;
  const manager = createCentralServer({ userData: directory, hosting: backend.hosting, reservedPorts: [backend.server.address().port] });
  t.after(async () => { await manager.close(); await backend.close(); assert.ok(directory.startsWith(path.join(tmpdir(), 'petpal-native-hosting-'))); await rm(directory, { recursive: true, force: true }); });
  const request = (base, route, { token = bootstrap, method = 'GET', body, headers = {} } = {}) => fetch(base + route, {
    method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(3000),
  });
  const me = await (await request(origin, '/api/auth/me')).json();
  assert.equal(backend.hosting.status().ownerHasPassword, false);
  assert.equal((await request(origin, `/api/admin/users/${me.user.id}`, { method: 'PATCH', body: { password: 'isolated-password-123' } })).status, 200);
  const portProbe = createServer(); await listenFixture(portProbe); const port = portProbe.address().port;
  await new Promise(resolve => portProbe.close(resolve));
  await manager.load();
  const event = { sender: 'main' }, selected = { url: origin, token: bootstrap };
  const handlers = createCentralServerHandlers(manager, { origin, isAllowed: raw => raw === event, readConnection: async () => selected,
    assertOwnerSession: token => backend.hosting.assertOwnerSession(token) });
  const enabled = await handlers['petpal:central-server:update'](event, selected, { enabled: true, port, publicUrl: '' });
  assert.equal(enabled.listening, true); const remote = `http://127.0.0.1:${port}`;
  assert.equal((await request(remote, '/api/auth/me')).status, 403, 'pairing token must never authenticate over the network listener');
  assert.equal((await request(remote, '/api/state', { token: null })).status, 401);
  const loginResponse = await request(remote, '/api/auth/login', { token: null, method: 'POST', body: { username: 'owner', password: 'isolated-password-123' } });
  assert.equal(loginResponse.status, 200); const session = await loginResponse.json();
  assert.equal((await request(remote, '/api/auth/me', { token: session.token })).status, 200);
  const changed = await request(remote, '/api/settings', { token: session.token, method: 'PATCH', body: { petName: '中央共享实例' } });
  assert.equal(changed.status, 200);
  const localState = await (await request(origin, '/api/state')).json();
  assert.equal(localState.settings.petName, '中央共享实例'); assert.equal(localState.instanceId, me.instanceId);
  await handlers['petpal:central-server:update'](event, selected, { publicUrl: 'https://hosting.example' });
  assert.equal(await requestVirtualHost(port, 'hosting.example'), 200);
  await handlers['petpal:central-server:update'](event, selected, { publicUrl: 'https://changed.example' });
  assert.equal(await requestVirtualHost(port, 'hosting.example'), 403);
  assert.equal(await requestVirtualHost(port, 'changed.example'), 200);
  const persisted = await readFile(path.join(directory, 'central-server.json'), 'utf8');
  assert.equal(persisted.includes(bootstrap), false); assert.equal(persisted.includes(session.token), false); assert.equal(persisted.includes('isolated-password'), false);
  const disabled = await handlers['petpal:central-server:update'](event, selected, { enabled: false });
  assert.equal(disabled.listening, false); assert.equal(backend.server.listening, true);
  assert.equal((await request(origin, '/api/auth/me')).status, 200);
  await assert.rejects(request(remote, '/api/health', { token: null }));
});
