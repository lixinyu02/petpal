import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { JsonStore } from '../server/store.mjs';
import { createSessionPersistence } from '../server/session-persistence.mjs';
import { newSession, rememberedSessionPatch, sessionIsActive, publicSession, SESSION_LIFETIME, REMEMBERED_SESSION_IDLE, REMEMBERED_SESSION_ABSOLUTE, SESSION_RENEWAL_INTERVAL } from '../server/auth.mjs';

const day = 24 * 60 * 60 * 1000, start = Date.UTC(2026, 0, 1);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };

test('ordinary sessions retain seven days while remembered devices use 90 idle days and a one-year cap', () => {
  const ordinary = newSession('fixture-user', { clock: () => start }).session;
  const remembered = newSession('fixture-user', { rememberDevice: true, clock: () => start }).session;
  assert.equal(ordinary.expiresAt, start + SESSION_LIFETIME); assert.equal(SESSION_LIFETIME, 7 * day);
  assert.equal(remembered.expiresAt, start + REMEMBERED_SESSION_IDLE); assert.equal(remembered.absoluteExpiresAt, start + REMEMBERED_SESSION_ABSOLUTE);
  assert.equal(sessionIsActive(remembered, start + 8 * day), true); assert.equal(sessionIsActive(ordinary, start + 8 * day), false);
  assert.equal(sessionIsActive(remembered, start + 90 * day), false);
  assert.deepEqual(Object.keys(publicSession(remembered)).sort(), ['absoluteExpiresAt', 'expiresAt', 'rememberDevice']);
});

test('daily renewal keeps the original identity and cannot extend the absolute limit', () => {
  const session = newSession('fixture-user', { rememberDevice: true, clock: () => start }).session, original = { tokenHash: session.tokenHash, createdAt: session.createdAt };
  assert.equal(rememberedSessionPatch(session, start + SESSION_RENEWAL_INTERVAL - 1), null);
  Object.assign(session, rememberedSessionPatch(session, start + day)); assert.equal(session.expiresAt, start + 91 * day);
  for (let elapsed = 2; elapsed <= 364; elapsed++) Object.assign(session, rememberedSessionPatch(session, start + elapsed * day));
  assert.equal(session.expiresAt, start + 365 * day); assert.equal(session.absoluteExpiresAt, start + 365 * day);
  assert.deepEqual({ tokenHash: session.tokenHash, createdAt: session.createdAt }, original);
  assert.throws(() => rememberedSessionPatch(session, start + 365 * day), { status: 401, code: 'session_invalid' });
});

test('a valid old session upgrades from its original creation time; an expired one cannot be renewed', () => {
  const session = newSession('fixture-user', { clock: () => start }).session;
  Object.assign(session, rememberedSessionPatch(session, start + 6 * day)); assert.equal(session.absoluteExpiresAt, start + 365 * day);
  const expired = newSession('fixture-user', { clock: () => start }).session;
  assert.throws(() => rememberedSessionPatch(expired, start + 7 * day), { code: 'session_invalid' });
  const old = { ...expired, createdAt: new Date(start - 366 * day).toISOString(), expiresAt: start + day };
  assert.throws(() => rememberedSessionPatch(old, start), { code: 'session_invalid' });
});

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-remembered-session-')), store = await new JsonStore(directory).init();
  const issued = newSession(store.state.ownerId, { clock: () => start }), session = issued.session;
  store.state.sessions.push(session); await store.save();
  let time = start + day, writes = 0;
  store.sessionPersistence = createSessionPersistence(store, { clock: () => time });
  const originalRename = fs.promises.rename;
  t.mock.method(fs.promises, 'rename', async (...args) => { const value = await originalRename(...args); if (args[1] === store.file) writes++; return value; }); syncBuiltinESMExports();
  t.after(async () => { await store.queue.catch(() => {}); t.mock.restoreAll(); syncBuiltinESMExports(); assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir())); assert.ok(path.basename(directory).startsWith('petpal-remembered-session-')); await rm(directory, { recursive: true, force: true }); });
  return { store, session, directory, token: issued.token, advance: value => { time = value; }, writes: () => writes,
    renew: (authorize = () => {}) => store.save({ sessionRenewal: { session, authorize } }), disk: async () => JSON.parse(await readFile(store.file, 'utf8')) };
}

test('renewal publishes only a durable value and old queued snapshots cannot undo it', async t => {
  const f = await fixture(t), gate = deferred(), before = f.session.expiresAt;
  f.store.queue = gate.promise;
  const renewal = f.renew(), stale = f.store.save();
  assert.equal(f.session.expiresAt, before); assert.equal(f.session.rememberDevice, undefined);
  gate.resolve(); await Promise.all([renewal, stale]);
  assert.equal(f.session.expiresAt, start + 91 * day); assert.equal((await f.disk()).sessions[0].expiresAt, f.session.expiresAt);
  assert.equal(f.writes(), 1, 'the stale logical save uses the already durable renewal');
  const restarted = await new JsonStore(f.directory).init(); assert.equal(restarted.state.sessions[0].tokenHash, f.session.tokenHash); assert.equal(restarted.state.sessions[0].expiresAt, f.session.expiresAt);
  assert.equal(JSON.stringify(await f.disk()).includes(f.token), false);
});

test('pending old save then renewal then logout cannot resurrect the removed session', async t => {
  const f = await fixture(t), gate = deferred(); f.store.queue = gate.promise;
  f.store.state.settings.petName = 'Pending change'; const old = f.store.save(), renewal = f.renew();
  const rejected = assert.rejects(renewal, { status: 401, code: 'session_invalid' });
  f.store.state.sessions = []; const logout = f.store.save(); gate.resolve();
  await Promise.all([old, rejected, logout]); assert.equal(f.store.state.sessions.length, 0); assert.equal((await f.disk()).sessions.length, 0);
  assert.equal((await new JsonStore(f.directory).init()).state.sessions.length, 0);
});

test('a concurrent new login is preserved when the original session renewal loses to revocation', async t => {
  const f = await fixture(t), gate = deferred(); f.store.queue = gate.promise;
  const renewal = assert.rejects(f.renew(), { code: 'session_invalid' });
  const another = newSession(f.store.state.ownerId, { clock: () => start + day }).session;
  f.store.state.sessions.push(another); const login = f.store.save(), stale = f.store.save();
  f.store.state.sessions = [another]; const revoked = f.store.save(); gate.resolve();
  await Promise.all([renewal, login, stale, revoked]);
  assert.deepEqual(f.store.state.sessions.map(value => value.tokenHash), [another.tokenHash]);
  assert.deepEqual((await f.disk()).sessions.map(value => value.tokenHash), [another.tokenHash]);
  assert.equal((await new JsonStore(f.directory).init()).state.sessions[0].rememberDevice, undefined);
});

test('revocation during fsync is checked before atomic replacement and never restored in memory', async t => {
  const f = await fixture(t), persistence = f.store.sessionPersistence;
  f.store.sessionPersistence = { ...persistence, beforeCommit(snapshot) { f.store.state.sessions = []; persistence.beforeCommit(snapshot); } };
  await assert.rejects(f.renew(), { code: 'session_invalid' }); assert.equal(f.store.state.sessions.length, 0); assert.equal(f.writes(), 0);
  f.store.sessionPersistence = persistence; await f.store.save(); assert.equal((await f.disk()).sessions.length, 0);
});

test('failed atomic renewal cannot leak its staged expiry into a concurrently captured ordinary save', async t => {
  const f = await fixture(t), original = structuredClone(f.session), rename = fs.promises.rename;
  let fail = true;
  t.mock.method(fs.promises, 'rename', (...args) => { if (fail && args[1] === f.store.file) { fail = false; return Promise.reject(new Error('synthetic session replacement failure')); } return rename(...args); }); syncBuiltinESMExports();
  const gate = deferred(); f.store.queue = gate.promise;
  const renewal = assert.rejects(f.renew(), /synthetic session replacement failure/);
  f.store.state.settings.petName = 'Saved independently'; const ordinary = f.store.save(); gate.resolve(); await Promise.all([renewal, ordinary]);
  assert.deepEqual(f.session, original); const disk = await f.disk(); assert.deepEqual(disk.sessions[0], original); assert.equal(disk.settings.petName, 'Saved independently');
  assert.equal((await new JsonStore(f.directory).init()).state.sessions[0].rememberDevice, undefined);
});

test('an old snapshot cannot drop a login that another queued save committed', async t => {
  const f = await fixture(t), gate = deferred(); f.store.queue = gate.promise;
  const late = newSession(f.store.state.ownerId, { clock: () => start }).session; f.store.state.sessions.push(late);
  const login = f.store.save(); f.store.state.sessions = [f.session]; const captured = f.store.save(); f.store.state.sessions.push(late);
  gate.resolve(); await Promise.all([login, captured]); assert.equal((await f.disk()).sessions.length, 2);
});

test('malformed remembered-session deadlines are rejected on reload without modifying the file', async t => {
  const f = await fixture(t); await f.renew(); const raw = await f.disk(); raw.sessions[0].absoluteExpiresAt += REMEMBERED_SESSION_ABSOLUTE;
  const contents = JSON.stringify(raw); await writeFile(f.store.file, contents);
  await assert.rejects(new JsonStore(f.directory).init(), /长期登录会话/); assert.equal(await readFile(f.store.file, 'utf8'), contents);
});
