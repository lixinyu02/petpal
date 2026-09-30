import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { JsonStore, defaultSettings } from '../server/store.mjs';
import { newSession, tokenHash } from '../server/auth.mjs';
import { createNotificationService } from '../server/notifications.mjs';
import { createAgentTasks } from '../server/agent-tasks.mjs';
import { defaultVoiceSettings } from '../server/voice.mjs';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const query = (after = 0, wait = 0, limit = 50) => ({ after: String(after), wait: String(wait), limit: String(limit) });
async function until(predicate) { for (let i = 0; i < 200; i++) { if (await predicate()) return; await delay(5); } assert.fail('Notification state did not settle'); }

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-notifications-'));
  const store = await new JsonStore(directory).init();
  const member = { id: randomUUID(), username: 'notification-member', displayName: 'Member', role: 'member', agentAccess: 'full', disabled: false, providerIds: [], password: null, settings: defaultSettings(), voice: defaultVoiceSettings(), createdAt: new Date().toISOString() };
  store.state.users.push(member);
  const first = newSession(store.state.ownerId), second = newSession(member.id);
  store.state.sessions.push(first.session, second.session); await store.save();
  let timestamp = Date.now();
  const auth = { userId: store.state.ownerId, sessionHash: first.session.tokenHash, bootstrap: false };
  const memberAuth = { userId: member.id, sessionHash: second.session.tokenHash, bootstrap: false };
  const authorize = input => {
    const user = store.state.users.find(item => item.id === input.userId);
    const session = store.state.sessions.find(item => item.userId === input.userId && item.tokenHash === input.sessionHash && item.expiresAt > timestamp);
    if (!user || user.disabled || !session) throw Object.assign(new Error('Session revoked'), { status: 401 });
    if (user.agentAccess === 'none') throw Object.assign(new Error('Agent permission revoked'), { status: 403 });
    return { user, expiresAt: session.expiresAt, sourceCreatedAt: Date.parse(session.createdAt) };
  };
  const notifications = createNotificationService({ store, authorize, clock: () => timestamp });
  const terminal = (status = 'completed', { userId = auth.userId, parent, conversation } = {}) => {
    const value = conversation ?? { id: randomUUID(), userId, mode: 'codex', messages: [], title: 'Fixture', createdAt: new Date(timestamp).toISOString(), updatedAt: new Date(timestamp).toISOString(), ...(parent ? { backgroundParentId: parent.id } : {}) };
    if (!conversation) store.state.conversations.push(value);
    const runId = randomUUID(), submissionId = randomUUID();
    value.agent = { revision: 1, paused: false, queue: [], submissions: [{ submissionId, entryId: runId, fingerprint: 'f'.repeat(64), status: status === 'unknown' ? 'uncertain' : status, content: 'secret task input', attachmentIds: [], createdAt: new Date(timestamp).toISOString() }], run: { id: runId, submissionId, status, permissions: { access: 'read-only', approval: 'auto' }, finishedAt: new Date(timestamp).toISOString() } };
    if (parent) (parent.assistantTasks ??= []).push({ conversationId: value.id });
    return value;
  };
  const installationId = randomUUID();
  const register = (deviceId = installationId, identity = auth) => notifications.register(identity, { deviceId });
  const feed = (device, after = 0, wait = 0, limit = 50) => notifications.feed(`Bearer ${device.token}`, query(after, wait, limit));
  t.after(async () => { notifications.close(); await store.queue.catch(() => {}); await rm(directory, { recursive: true, force: true }); });
  return { directory, store, notifications, auth, memberAuth, first, second, member, terminal, register, feed, timestamp: () => timestamp, advance: milliseconds => { timestamp += milliseconds; }, authorize };
}

test('durable terminal feed excludes cancelled/unknown and contains only routing identifiers', async t => {
  const f = await fixture(t), device = await f.register();
  const direct = f.terminal('completed'); f.terminal('error'); f.terminal('cancelled'); f.terminal('unknown');
  const parent = { id: randomUUID(), userId: f.auth.userId, mode: 'chat', messages: [] }; f.store.state.conversations.push(parent);
  const child = f.terminal('error', { parent });
  await f.store.save();
  const result = await f.feed(device);
  assert.equal(result.highWater, 3); assert.deepEqual(result.events.map(event => event.status), ['completed', 'error', 'error']);
  assert.equal(result.events[0].conversationId, direct.id);
  assert.equal(result.events[2].conversationId, parent.id); assert.equal(result.events[2].agentConversationId, child.id); assert.equal(result.events[2].source, 'chat-agent');
  for (const event of result.events) assert.deepEqual(Object.keys(event), ['seq', 'id', 'conversationId', 'agentConversationId', 'runId', 'status', 'source', 'createdAt']);
  assert.equal(JSON.stringify(result).includes('secret task input'), false);
  const persisted = JSON.parse(await readFile(f.store.file, 'utf8'));
  assert.equal(persisted.conversations.find(item => item.id === direct.id).agent.run.status, 'completed');
  assert.deepEqual(persisted.notifications.accounts[0].events, result.events);
  assert.equal(persisted.notifications.devices[0].tokenHash, tokenHash(device.token)); assert.equal(JSON.stringify(persisted).includes(device.token), false);
  await f.store.save(); assert.equal((await f.feed(device)).highWater, 3, 'unchanged terminal save cannot duplicate an event');
});

test('initial registration establishes high water and independent devices acknowledge their own cursor', async t => {
  const f = await fixture(t); f.terminal(); await f.store.save();
  const a = await f.register(), b = await f.register(randomUUID()); assert.equal(a.cursor, 1); assert.equal(b.cursor, 1);
  assert.match(a.expiresAt, /^\d{4}-\d{2}-\d{2}T.*Z$/); assert.ok(Date.parse(a.expiresAt) <= f.first.session.expiresAt);
  assert.deepEqual((await f.feed(a, 1)).events, []);
  f.terminal(); await f.store.save();
  await f.notifications.ack(`Bearer ${a.token}`, { cursor: 2 });
  assert.equal((await f.notifications.feed(`Bearer ${a.token}`, {})).nextCursor, 2);
  assert.equal((await f.notifications.feed(`Bearer ${b.token}`, {})).events.length, 1);
  await assert.rejects(f.notifications.ack(`Bearer ${b.token}`, { cursor: 3 }), { status: 400 });
  await f.notifications.ack(`Bearer ${a.token}`, { cursor: 1 }); assert.equal((await f.notifications.feed(`Bearer ${a.token}`, {})).nextCursor, 2);
});

test('first-enable baseline includes terminal events committed in the registration snapshot', async t => {
  const f = await fixture(t); f.terminal();
  const device = await f.register(); assert.equal(device.cursor, 1); assert.equal((await f.feed(device, 1)).events.length, 0);
});

test('long poll publishes after successful persistence without waking other accounts', async t => {
  const f = await fixture(t), a = await f.register(), b = await f.register(randomUUID(), f.memberAuth);
  let woke = false; const pending = f.feed(a, 0, 25).then(result => { woke = true; return result; });
  f.terminal('completed', { userId: f.memberAuth.userId }); await f.store.save();
  await f.notifications.ack(`Bearer ${a.token}`, { cursor: 0 }); await delay(10);
  assert.equal(woke, false); assert.equal((await f.feed(b)).events.length, 1);
  f.terminal(); await f.store.save(); assert.equal((await pending).events.length, 1);
});

test('failed and concurrently queued saves never expose an undurable event or lose a committed feed', async t => {
  const f = await fixture(t), device = await f.register(), release = deferred();
  const extension = f.store.notificationPersistence, prepare = extension.prepare;
  let failOnce = true;
  extension.prepare = (...args) => { prepare(...args); if (failOnce) { failOnce = false; throw new Error('Synthetic save failure'); } };
  f.store.queue = release.promise;
  const task = f.terminal(), rejected = f.store.save(), unrelated = f.store.save();
  assert.equal((await f.feed(device)).highWater, 0); assert.equal(f.store.state.notifications.accounts[0].highWater, 0);
  release.resolve(); await assert.rejects(rejected, /Synthetic save failure/); await unrelated;
  const result = await f.feed(device); assert.equal(result.highWater, 1); assert.equal(result.events[0].runId, task.agent.run.id);
  assert.equal(JSON.parse(await readFile(f.store.file, 'utf8')).notifications.accounts[0].highWater, 1);
  await f.store.save(); assert.equal((await f.feed(device)).highWater, 1);
});

test('an actual atomic replacement failure leaves the event invisible until a successful retry', async t => {
  const f = await fixture(t), device = await f.register(), original = f.store.file;
  const failureTarget = path.join(f.directory, 'replacement-is-a-directory'); await mkdir(failureTarget);
  f.terminal(); f.store.file = failureTarget;
  await assert.rejects(f.store.save());
  assert.equal((await f.feed(device)).highWater, 0); assert.equal(f.store.state.notifications.accounts[0].highWater, 0);
  assert.equal(JSON.parse(await readFile(original, 'utf8')).notifications.accounts[0].highWater, 0);
  f.store.file = original; await f.store.save(); assert.equal((await f.feed(device)).highWater, 1);
});

test('task state and event are committed by the real Agent finalization without a conversation read', async t => {
  const f = await fixture(t), device = await f.register(), finish = deferred(), active = new Map();
  const conversation = { id: randomUUID(), userId: f.auth.userId, mode: 'codex', messages: [] }; f.store.state.conversations.push(conversation);
  const tasks = createAgentTasks({ store: f.store, active, approvals: new Map(), authorize: entry => f.authorize(entry.auth).expiresAt, getBridge: () => ({ run: () => finish.promise }), resolveModel: () => ({ model: 'fixture', effort: '', codexRevision: 'fixture' }) });
  await tasks.submit(conversation, { submissionId: randomUUID(), content: 'Do isolated fixture work' }, f.auth);
  await until(() => active.has(conversation.id));
  const pending = f.feed(device, 0, 25); finish.resolve({ text: 'Done' });
  const result = await pending; assert.equal(result.events.length, 1); assert.equal(result.events[0].status, 'completed');
  await tasks.close();
  const persisted = JSON.parse(await readFile(f.store.file, 'utf8')); assert.equal(persisted.conversations[0].agent.run.status, 'completed'); assert.equal(persisted.notifications.accounts[0].events[0].runId, persisted.conversations[0].agent.run.id);
  const restarted = await new JsonStore(f.directory).init(); assert.equal(restarted.state.notifications.accounts[0].highWater, 1);
});

for (const reason of ['logout', 'disabled', 'agent-revoked', 'expires', 'device-replaced']) test(`waiting and late acknowledgement fail closed after ${reason}`, async t => {
  const f = await fixture(t), device = await f.register();
  const pending = f.feed(device, 0, 25); const rejected = assert.rejects(pending, error => [401, 403].includes(error.status));
  if (reason === 'logout') f.store.state.sessions = f.store.state.sessions.filter(item => item.tokenHash !== f.auth.sessionHash);
  if (reason === 'disabled') f.store.state.users[0].disabled = true;
  if (reason === 'agent-revoked') f.store.state.users[0].agentAccess = 'none';
  if (reason === 'expires') f.advance(8 * 24 * 60 * 60 * 1000);
  if (reason === 'device-replaced') await f.register(); else await f.notifications.revoke(item => item.userId === f.auth.userId);
  await rejected;
  await assert.rejects(f.notifications.ack(`Bearer ${device.token}`, { cursor: 0 }), error => [401, 403].includes(error.status));
});

test('expired retention returns explicit reset and sequence survives pruning', async t => {
  const f = await fixture(t); f.terminal(); await f.store.save(); f.advance(31 * 24 * 60 * 60 * 1000);
  f.first.session.expiresAt = f.timestamp() + 7 * 24 * 60 * 60 * 1000;
  const device = await f.register(); assert.equal(device.cursor, 1);
  let result = await f.feed(device, 0); assert.equal(result.resetRequired, true); assert.equal(result.minCursor, 1); assert.equal(result.nextCursor, 1);
  f.terminal(); await f.store.save(); result = await f.feed(device, 1); assert.equal(result.events[0].seq, 2); assert.equal(result.highWater, 2);
  result = await f.feed(device, 20); assert.equal(result.resetRequired, true); assert.equal(result.nextCursor, 2);
});

test('bounded feed retains 500 and marks cursor gaps instead of replaying retained tasks', async t => {
  const f = await fixture(t), device = await f.register();
  for (let i = 0; i < 505; i++) f.terminal(); await f.store.save();
  const gap = await f.feed(device, 0); assert.equal(gap.highWater, 505); assert.equal(gap.minCursor, 5); assert.equal(gap.resetRequired, true);
  const page = await f.feed(device, 5); assert.equal(page.events.length, 50); assert.equal(page.events[0].seq, 6); assert.equal(page.nextCursor, 55);
  await f.store.save(); assert.equal((await f.feed(device, 5)).highWater, 505);
});

test('self revoke and account-scoped removal never revoke another account device', async t => {
  const f = await fixture(t), a = await f.register(), b = await f.register(a.deviceId, f.memberAuth);
  await f.notifications.remove(f.auth, a.deviceId); await assert.rejects(f.feed(a), { status: 401 });
  assert.equal((await f.feed(b)).userId, f.memberAuth.userId);
  await f.notifications.removeSelf(`Bearer ${b.token}`); await assert.rejects(f.feed(b), { status: 401 });
});

test('service close aborts waiters but preserves valid device credential for process restart', async t => {
  const f = await fixture(t), device = await f.register();
  const pending = f.feed(device, 0, 25); const rejected = assert.rejects(pending, { status: 503 });
  f.notifications.close(); await rejected; await f.store.save();
  assert.equal(JSON.parse(await readFile(f.store.file, 'utf8')).notifications.devices.length, 1);
  const restarted = await new JsonStore(f.directory).init();
  const notifications = createNotificationService({ store: restarted, authorize: f.authorize });
  assert.equal((await notifications.feed(`Bearer ${device.token}`, query())).deviceId, device.deviceId); notifications.close();
});

test('an old-session registration and late cleanup cannot replace or revoke a newer-session installation', async t => {
  const f = await fixture(t), a = await f.register();
  const newer = newSession(f.auth.userId); newer.session.createdAt = new Date(Date.parse(f.first.session.createdAt) + 1000).toISOString(); f.store.state.sessions.push(newer.session);
  const newAuth = { ...f.auth, sessionHash: newer.session.tokenHash };
  const b = await f.register(a.deviceId, newAuth);
  await assert.rejects(f.feed(a), { status: 401 });
  await assert.rejects(f.register(a.deviceId, f.auth), { status: 409 });
  await f.notifications.remove(f.auth, a.deviceId);
  assert.equal((await f.feed(b)).deviceId, b.deviceId);
  await f.notifications.revoke(item => item.sessionHash === f.auth.sessionHash); assert.equal((await f.feed(b)).userId, b.userId);
});

test('registration and acknowledgement blocked in persistence reject a late session revocation', async t => {
  const f = await fixture(t), device = await f.register(), release = deferred();
  f.store.queue = release.promise;
  const registration = f.register(randomUUID()); const rejectedRegistration = assert.rejects(registration, { status: 401 });
  const ack = f.notifications.ack(`Bearer ${device.token}`, { cursor: 0 }); const rejectedAck = assert.rejects(ack, { status: 401 });
  f.store.state.sessions = []; release.resolve();
  await Promise.all([rejectedRegistration, rejectedAck]);
  assert.equal(f.store.state.notifications.devices.some(item => item.deviceId !== device.deviceId), false);
});

test('explicit source revoke fences an in-flight bootstrap registration even while pairing auth stays valid', async t => {
  const f = await fixture(t), release = deferred(); f.store.queue = release.promise;
  const registration = f.register(randomUUID()); const rejected = assert.rejects(registration, { status: 401 });
  // Unlike a removed password session, an owner pairing token remains usable
  // after logout. The notification generation still revokes its pending mint.
  const revoked = f.notifications.revoke(item => item.sessionHash === f.auth.sessionHash);
  release.resolve(); await rejected; await revoked;
  assert.equal(f.store.state.notifications.devices.length, 0);
  assert.ok(await f.register(randomUUID()), 'a fresh explicit enable with valid login remains possible');
});

test('long-poll count is bounded and cancelled requests release their slots', async t => {
  const f = await fixture(t), device = await f.register(), abort = new AbortController();
  const a = f.notifications.feed(`Bearer ${device.token}`, query(0, 25), abort.signal);
  const b = f.notifications.feed(`Bearer ${device.token}`, query(0, 25), abort.signal);
  const failures = [assert.rejects(a, { name: 'AbortError' }), assert.rejects(b, { name: 'AbortError' })];
  await assert.rejects(f.feed(device, 0, 25), { status: 429 }); abort.abort(); await Promise.all(failures);
  const next = f.feed(device, 0, 25); f.terminal(); await f.store.save(); assert.equal((await next).events.length, 1);
});

test('initial migration does not backfill old completions and restart-repaired running states', async t => {
  const f = await fixture(t); f.terminal('completed'); f.terminal('error'); const interrupted = f.terminal('running');
  delete f.store.state.notifications;
  delete f.store.notificationPersistence;
  await f.store.save();
  const restarted = await new JsonStore(f.directory).init();
  assert.equal(restarted.state.notifications.accounts.length, 0);
  assert.equal(restarted.state.conversations.find(item => item.id === interrupted.id).agent.run.status, 'error');
  const notifications = createNotificationService({ store: restarted, authorize: f.authorize });
  const device = await notifications.register(f.auth, { deviceId: randomUUID() });
  assert.equal((await notifications.feed(`Bearer ${device.token}`, query())).highWater, 0); notifications.close();
});
