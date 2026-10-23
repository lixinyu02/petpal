import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { JsonStore } from '../server/store.mjs';
import { createPetServer } from '../server/app.mjs';
import { hashPassword, newSession, SESSION_LIFETIME, REMEMBERED_SESSION_IDLE, REMEMBERED_SESSION_ABSOLUTE } from '../server/auth.mjs';
import { listenFixture } from './helpers/loopback.mjs';

const day = 24 * 60 * 60 * 1000, bootstrap = 'isolated-session-renewal-bootstrap', password = 'isolated-fixture-password';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
async function until(predicate) { for (let n = 0; n < 200; n++) { if (predicate()) return; await delay(5); } assert.fail('isolated authentication did not settle'); }

async function fixture(t, { sessions = 0 } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-auth-renewal-'));
  const seed = await new JsonStore(directory).init(); seed.state.users[0].password = await hashPassword(password);
  const seeded = Array.from({ length: sessions }, (_, index) => newSession(seed.state.ownerId, { clock: () => Date.now() - (sessions - index) * day }));
  // Seed every legacy session as valid, allowing an oldest-but-active phone.
  for (const { session } of seeded) session.expiresAt = Date.now() + day;
  seed.state.sessions.push(...seeded.map(value => value.session)); await seed.save();
  let store, app, time = Date.now(); const originalInit = JsonStore.prototype.init;
  t.mock.method(Date, 'now', () => time);
  t.mock.method(JsonStore.prototype, 'init', async function (...args) { const result = await originalInit.apply(this, args); if (this.directory === directory) store = this; return result; });
  app = await createPetServer({ dataDir: directory, token: bootstrap, allowedOrigins: ['https://localhost'], codex: { async status() { return { available: true }; }, async run() { return { text: 'isolated task complete' }; }, async close() {} } });
  await listenFixture(app.server);
  const base = `http://127.0.0.1:${app.server.address().port}/api`;
  const request = (route, { token = bootstrap, method = 'GET', body, headers = {} } = {}) => fetch(base + route, { method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const login = async (rememberDevice = false) => { const response = await request('/auth/login', { token: '', method: 'POST', body: { username: 'owner', password, rememberDevice } }); assert.equal(response.status, 200); return response.json(); };
  t.after(async () => { await app.close(); t.mock.restoreAll(); syncBuiltinESMExports(); assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir())); assert.ok(path.basename(directory).startsWith('petpal-auth-renewal-')); await rm(directory, { recursive: true, force: true }); });
  return { store, request, login, directory, seeded, app, time: () => time, advance: value => { time += value; }, disk: async () => JSON.parse(await readFile(store.file, 'utf8')) };
}

test('Android opt-in login keeps default Web lifetime and does not lengthen notification credentials', async t => {
  const f = await fixture(t), web = await f.login(), android = await f.login(true);
  assert.equal(web.session.expiresAt, f.time() + SESSION_LIFETIME); assert.equal(web.session.rememberDevice, false);
  assert.equal(android.session.expiresAt, f.time() + REMEMBERED_SESSION_IDLE); assert.equal(android.session.absoluteExpiresAt, f.time() + REMEMBERED_SESSION_ABSOLUTE);
  const registered = await f.request('/notifications/devices', { token: android.token, method: 'POST', body: { deviceId: randomUUID() } });
  assert.equal(registered.status, 201); assert.equal(Date.parse((await registered.json()).expiresAt), f.time() + SESSION_LIFETIME);
  f.advance(8 * day);
  assert.equal((await f.request('/auth/me', { token: web.token })).status, 401);
  const kept = await f.request('/auth/me', { token: android.token }); assert.equal(kept.status, 200); assert.equal((await kept.json()).session.rememberDevice, true);
});

test('valid legacy login upgrades with its original token; simultaneous checks renew at most once per day', async t => {
  const f = await fixture(t), logged = await f.login(), original = structuredClone(f.store.state.sessions[0]); let saves = 0;
  const save = f.store.save.bind(f.store); t.mock.method(f.store, 'save', (...args) => { saves++; return save(...args); });
  const request = () => f.request('/auth/me', { token: logged.token, headers: { 'X-PetPal-Remember-Device': '1' } });
  const checks = await Promise.all(Array.from({ length: 12 }, request));
  for (const response of checks) { assert.equal(response.status, 200); const result = await response.json(); assert.equal(result.session.rememberDevice, true); assert.equal('tokenHash' in result.session, false); }
  assert.equal(saves, 1); assert.equal(f.store.state.sessions[0].tokenHash, original.tokenHash); assert.equal(f.store.state.sessions[0].createdAt, original.createdAt);
  await (await request()).arrayBuffer(); assert.equal(saves, 1);
  f.advance(day); await (await request()).arrayBuffer(); assert.equal(saves, 2); assert.equal(f.store.state.sessions[0].expiresAt, f.time() + REMEMBERED_SESSION_IDLE);
  const disk = await f.disk(); assert.equal(disk.sessions[0].expiresAt, f.store.state.sessions[0].expiresAt); assert.equal(JSON.stringify(disk).includes(logged.token), false);
});

test('idle/absolute expiry is authoritative and the remember header never revives an expired session', async t => {
  const f = await fixture(t), first = await f.login(true); f.advance(90 * day);
  const idle = await f.request('/auth/me', { token: first.token, headers: { 'X-PetPal-Remember-Device': '1' } }); assert.equal(idle.status, 401); assert.equal((await idle.json()).code, 'session_invalid');
  const second = await f.login(true), created = f.time();
  for (let i = 0; i < 4; i++) { f.advance(89 * day); const response = await f.request('/auth/me', { token: second.token, headers: { 'X-PetPal-Remember-Device': '1' } }); assert.equal(response.status, 200); await response.arrayBuffer(); }
  assert.equal(f.store.state.sessions.at(-1).expiresAt, created + 365 * day);
  f.advance(9 * day); const absolute = await f.request('/auth/me', { token: second.token }); assert.equal(absolute.status, 401); assert.equal((await absolute.json()).code, 'session_invalid');
});

test('oldest active remembered phone survives the ninth-login eviction; legacy ordering remains stable', async t => {
  const f = await fixture(t, { sessions: 8 }), phone = f.seeded[0];
  const verified = await f.request('/auth/me', { token: phone.token, headers: { 'X-PetPal-Remember-Device': '1' } }); assert.equal(verified.status, 200); await verified.arrayBuffer();
  await f.login(); assert.equal(f.store.state.sessions.length, 8);
  assert.equal((await f.request('/auth/me', { token: phone.token })).status, 200);
  assert.equal((await f.request('/auth/me', { token: f.seeded[1].token })).status, 401);
  assert.equal((await f.request('/auth/me', { token: f.seeded[2].token })).status, 200);
});

test('wrong login password is not marked as invalidating the current device; rejected authentication is', async t => {
  const f = await fixture(t), logged = await f.login(true);
  const incorrect = await f.request('/auth/login', { token: '', method: 'POST', body: { username: 'owner', password: 'incorrect-fixture-password', rememberDevice: true } });
  assert.equal(incorrect.status, 401); assert.equal((await incorrect.json()).code, undefined); assert.equal((await f.request('/auth/me', { token: logged.token })).status, 200);
  const invalid = await f.request('/auth/me', { token: 'synthetic-unknown-token' }); assert.equal(invalid.status, 401); assert.equal((await invalid.json()).code, 'session_invalid');
});

test('Android HTTPS origin preflight permits the explicit remember-device header', async t => {
  const f = await fixture(t);
  const response = await f.request('/auth/me', { token: '', method: 'OPTIONS', headers: { Origin: 'https://localhost', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization,x-petpal-remember-device' } });
  assert.equal(response.status, 204); assert.equal(response.headers.get('access-control-allow-origin'), 'https://localhost');
  assert.match(response.headers.get('access-control-allow-headers'), /X-PetPal-Remember-Device/i); assert.match(response.headers.get('vary'), /Origin/); assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('logout wins while a renewal is queued and the auth/me caller receives session_invalid', async t => {
  const f = await fixture(t), logged = await f.login(), gate = deferred(), started = deferred(); const save = f.store.save.bind(f.store);
  f.store.queue = gate.promise; t.mock.method(f.store, 'save', operation => { if (operation?.sessionRenewal) started.resolve(); return save(operation); });
  const pending = f.request('/auth/me', { token: logged.token, headers: { 'X-PetPal-Remember-Device': '1' } }); await started.promise;
  const logout = f.request('/auth/logout', { token: logged.token, method: 'POST' }); await until(() => f.store.state.sessions.length === 0); gate.resolve();
  const response = await pending; assert.equal(response.status, 401); assert.equal((await response.json()).code, 'session_invalid');
  assert.equal((await logout).status, 200); assert.equal((await f.disk()).sessions.length, 0);
});

test('renewal persistence failure retains the existing login and exposes no successful expiry or invalid-session code', async t => {
  const f = await fixture(t), logged = await f.login(), before = structuredClone(f.store.state.sessions[0]), rename = fs.promises.rename;
  let fail = true;
  t.mock.method(fs.promises, 'rename', (...args) => { if (fail && args[1] === f.store.file) { fail = false; return Promise.reject(new Error('synthetic renewal disk failure')); } return rename(...args); }); syncBuiltinESMExports();
  const failed = await f.request('/auth/me', { token: logged.token, headers: { 'X-PetPal-Remember-Device': '1' } });
  assert.equal(failed.status, 500); const error = await failed.json(); assert.equal(error.code, undefined); assert.equal(error.session, undefined);
  assert.deepEqual(f.store.state.sessions[0], before); assert.deepEqual((await f.disk()).sessions[0], before);
  const existing = await f.request('/auth/me', { token: logged.token }); assert.equal(existing.status, 200); assert.equal((await existing.json()).session.rememberDevice, false);
  const retry = await f.request('/auth/me', { token: logged.token, headers: { 'X-PetPal-Remember-Device': '1' } }); assert.equal(retry.status, 200); assert.equal((await retry.json()).session.rememberDevice, true);
});
