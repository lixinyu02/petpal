import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createPetServer } from '../server/app.mjs';
import { listenFixture } from './helpers/loopback.mjs';

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-notifications-api-'));
  const calls = [];
  const codex = { async status() { return { available: true }; }, run(args) { return new Promise((resolve, reject) => { calls.push({ args, resolve, reject }); args.signal.addEventListener('abort', () => reject(args.signal.reason), { once: true }); }); }, async close() { for (const call of calls) call.reject(new DOMException('Closed', 'AbortError')); } };
  const bootstrap = 'isolated-notifications-bootstrap';
  const app = await createPetServer({ dataDir: directory, token: bootstrap, codex }); await listenFixture(app.server);
  const request = async (route, { token = bootstrap, method = 'GET', body, headers } = {}) => {
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}/api${route}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  };
  const account = async (name, agentAccess = 'full') => {
    const created = await request('/admin/users', { method: 'POST', body: { username: name, password: 'fixture-notifications-password', agentAccess } }); assert.equal(created.status, 201);
    const login = await request('/auth/login', { token: '', method: 'POST', body: { username: name, password: 'fixture-notifications-password' } }); assert.equal(login.status, 200);
    return { ...created.data.user, token: login.data.token };
  };
  const register = async token => {
    const result = await request('/notifications/devices', { token, method: 'POST', body: { deviceId: randomUUID() } }); assert.equal(result.status, 201); return result.data;
  };
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  return { directory, app, request, account, register, calls, bootstrap };
}

test('restricted device credential cannot access full state, models, voice, other devices or dispatch', async t => {
  const f = await fixture(t), user = await f.account('notifications-member'), device = await f.register(user.token);
  assert.equal((await f.request('/notifications/device/feed?after=0', { token: device.token })).status, 200);
  for (const route of ['/state', '/providers', '/voice', '/agent/hosts', '/auth/me']) assert.equal((await f.request(route, { token: device.token })).status, 401, route);
  for (const route of ['/conversations', '/notifications/devices', '/tts']) assert.equal((await f.request(route, { token: device.token, method: 'POST', body: {} })).status, 401, route);
  assert.equal((await f.request(`/notifications/devices/${device.deviceId}`, { token: device.token, method: 'DELETE' })).status, 401);
  assert.equal((await f.request('/notifications/device/feed?after=0', { token: user.token })).status, 401, 'full session is not a device token');
  assert.equal((await f.request('/notifications/device/ack', { token: device.token, method: 'POST', body: { cursor: 0, userId: user.id } })).status, 400);
  assert.equal((await f.request('/notifications/device/feed?after=0&userId=other', { token: device.token })).status, 400);
  assert.equal((await f.request('/notifications/device/feed?after=0', { token: device.token, headers: { Origin: 'https://untrusted.example' } })).status, 403);
  const chatOnly = await f.account('notifications-chat-only', 'none');
  assert.equal((await f.request('/notifications/devices', { token: chatOnly.token, method: 'POST', body: { deviceId: randomUUID() } })).status, 403);
});

test('logout and Agent downgrade abort pending HTTP feeds and preserve account isolation', async t => {
  const f = await fixture(t), a = await f.account('notifications-first'), b = await f.account('notifications-second');
  const da = await f.register(a.token), db = await f.register(b.token);
  const pending = f.request('/notifications/device/feed?after=0&wait=25', { token: da.token }); await delay(15);
  assert.equal((await f.request('/auth/logout', { token: a.token, method: 'POST', body: {} })).status, 200); assert.equal((await pending).status, 401);
  assert.equal((await f.request('/notifications/device/feed?after=0', { token: db.token })).status, 200);
  const second = f.request('/notifications/device/feed?after=0&wait=25', { token: db.token }); await delay(15);
  assert.equal((await f.request(`/admin/users/${b.id}`, { method: 'PATCH', body: { agentAccess: 'none' } })).status, 200); assert.equal((await second).status, 401);
  const stored = JSON.parse(await readFile(path.join(f.directory, 'state.json'), 'utf8')); assert.equal(stored.notifications.devices.length, 0);
});

test('bootstrap logout explicitly revokes background devices while leaving the owner pairing login valid', async t => {
  const f = await fixture(t), device = await f.register(f.bootstrap);
  const pending = f.request('/notifications/device/feed?after=0&wait=25', { token: device.token }); await delay(15);
  assert.equal((await f.request('/auth/logout', { method: 'POST', body: {} })).status, 200); assert.equal((await pending).status, 401);
  assert.equal((await f.request('/auth/me')).status, 200); assert.equal((await f.request('/notifications/device/feed?after=0', { token: device.token })).status, 401);
});
