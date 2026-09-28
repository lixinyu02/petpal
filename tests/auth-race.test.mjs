import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createPetServer } from '../server/app.mjs';
import { JsonStore } from '../server/store.mjs';
import { hashPassword, newSession } from '../server/auth.mjs';

const bootstrap = 'isolated-race-owner-bootstrap';
const oldPassword = 'original-race-password';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

async function fixture(t, { seededSessions = 0, approval = false } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-auth-race-'));
  const store = await new JsonStore(directory).init();
  const ownerId = store.state.ownerId;
  store.state.users[0].password = await hashPassword(oldPassword);
  const sessions = Array.from({ length: seededSessions }, () => newSession(ownerId));
  store.state.sessions = sessions.map(item => item.session);
  await store.save();
  const aborted = deferred(), started = deferred();
  let release;
  const codex = {
    approvalCalls: 0,
    async status() { return { available: true }; },
    run({ signal, onEvent }) {
      return new Promise((resolve, reject) => {
        release = () => reject(signal.reason ?? new DOMException('Fixture cleanup', 'AbortError'));
        signal.addEventListener('abort', () => aborted.resolve(), { once: true });
        if (approval) onEvent('approval', { id: 'race-approval', kind: 'command', description: 'Isolated test approval' });
        started.resolve();
      });
    },
    async approve() { this.approvalCalls++; return { ok: true }; },
    async close() { release?.(); },
  };
  const app = await createPetServer({ dataDir: directory, token: bootstrap, codex });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}/api`;
  const request = (route, { token = bootstrap, method = 'GET', body } = {}) => fetch(`${base}${route}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  t.after(async () => {
    release?.(); await app.close();
    assert.ok(directory.startsWith(path.join(tmpdir(), 'petpal-auth-race-')));
    await rm(directory, { recursive: true, force: true });
  });
  const start = async (token = bootstrap) => {
    const created = await request('/conversations', { token, method: 'POST', body: { mode: 'codex' } });
    assert.equal(created.status, 201); const chat = await created.json();
    const response = await request(`/conversations/${chat.id}/messages`, { token, method: 'POST', body: { content: 'Isolated delayed cancellation fixture' } });
    assert.equal(response.status, 200); const output = response.text(); await started.promise;
    return { chat, output };
  };
  return { request, start, sessions, ownerId, directory, codex, aborted: aborted.promise, release: () => release?.() };
}

test('password reset during ninth-login session eviction cannot resurrect an old-password session', { timeout: 15000 }, async t => {
  // Seed persisted sessions to model a restarted service, whose login limiter has reset.
  const f = await fixture(t, { seededSessions: 8 });
  const { output } = await f.start(f.sessions[0].token);
  const login = f.request('/auth/login', { token: '', method: 'POST', body: { username: 'owner', password: oldPassword } });
  await f.aborted; // The oldest session is revoked, but its task deliberately has not finished.
  const reset = f.request(`/admin/users/${f.ownerId}`, { method: 'PATCH', body: { password: 'replacement-race-password' } });
  let revoked = false;
  for (let attempt = 0; attempt < 200; attempt++) {
    const response = await f.request('/auth/me', { token: f.sessions[7].token });
    await response.arrayBuffer();
    if (response.status === 401) { revoked = true; break; }
    await delay(10);
  }
  assert.equal(revoked, true, 'password reset must revoke every old session before waiting for task cleanup');
  f.release();
  const [loginResponse, resetResponse] = await Promise.all([login, reset]);
  await output; await resetResponse.arrayBuffer();
  assert.equal(resetResponse.status, 200); assert.equal(loginResponse.status, 401);
  assert.equal((await loginResponse.json()).token, undefined);
  const persisted = JSON.parse(await readFile(path.join(f.directory, 'state.json'), 'utf8'));
  assert.equal(persisted.sessions.length, 0, 'the pending login must not persist a session after reset');
});

test('an owner cannot approve a task after cancellation starts but before its bridge finishes cleanup', { timeout: 15000 }, async t => {
  const f = await fixture(t, { approval: true });
  const { chat, output } = await f.start();
  const stopping = f.request(`/conversations/${chat.id}/stop`, { method: 'POST' });
  await f.aborted;
  const response = await f.request('/codex/approvals/race-approval', { method: 'POST', body: { decision: 'accept' } });
  await response.arrayBuffer();
  assert.equal(response.status, 404); assert.equal(f.codex.approvalCalls, 0);
  f.release();
  assert.equal((await stopping).status, 200); assert.match(await output, /cancelled/);
});
