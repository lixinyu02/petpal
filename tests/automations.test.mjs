import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { JsonStore, defaultSettings } from '../server/store.mjs';
import { defaultVoiceSettings } from '../server/voice.mjs';
import { createAutomationService } from '../server/automations.mjs';
import { validateStoredAutomations } from '../server/automation-schema.mjs';
import { createPetServer } from '../server/app.mjs';
import { defaultCodexConfig } from '../server/codex-config.mjs';
import { listenFixture } from './helpers/loopback.mjs';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function until(predicate) { for (let i = 0; i < 200; i++) { if (await predicate()) return; await delay(5); } assert.fail('Automation did not settle'); }
async function fixture(t, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-automations-'));
  const store = await new JsonStore(directory).init();
  const ownerId = store.state.ownerId, providerId = randomUUID(), remoteId = randomUUID();
  const member = { id: randomUUID(), username: 'automation-member', displayName: 'Member', role: 'member', agentAccess: 'full', disabled: false, providerIds: [providerId], password: null, settings: defaultSettings(), voice: defaultVoiceSettings(), createdAt: new Date().toISOString() };
  store.state.users.push(member);
  store.state.executionHosts.push({ id: remoteId, deviceId: randomUUID(), userId: ownerId, name: 'Fixture PC', platform: 'linux', arch: 'x64', createdAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() });
  await store.save();
  let timestamp = Date.parse('2026-10-05T00:00:00Z'), online = true, busy = false, modelAllowed = true;
  const calls = [], outcomes = new Map(), services = [], authorizations = [], timers = new Set();
  const authorize = (userId, spec, { online: requireOnline, dispatch }) => {
    authorizations.push({ userId, spec, online: requireOnline, dispatch });
    const user = store.state.users.find(item => item.id === userId);
    if (!user || user.disabled) throw Object.assign(new Error('Account revoked'), { status: 401 });
    if (!modelAllowed || spec.providerId !== providerId && !(spec.providerId === null && userId === ownerId)) throw Object.assign(new Error('Model revoked'), { status: 403 });
    if (spec.hostId !== 'central' && !store.state.executionHosts.some(item => item.id === spec.hostId && item.userId === userId)) throw Object.assign(new Error('Foreign host'), { status: 404 });
    if (spec.permissions.access === 'full-access' && user.agentAccess !== 'full') throw Object.assign(new Error('Permission revoked'), { status: 403 });
    if (requireOnline && !online) throw Object.assign(new Error('Fixed computer offline'), { status: 409, code: 'executor_offline' });
    if (dispatch && busy) throw Object.assign(new Error('Fixed computer busy'), { status: 409, code: 'executor_busy' });
    return { hostName: spec.hostId === 'central' ? 'Central' : 'Fixture PC', providerName: 'Fixture model' };
  };
  const defaultDispatch = async payload => {
    calls.push(payload);
    const conversation = { id: randomUUID(), userId: payload.job.userId, mode: 'codex', title: 'Fixture automation', messages: [], automationId: payload.job.id, automationRunId: payload.run.id };
    store.state.conversations.push(conversation);
    await payload.bindConversation(conversation.id);
    assert.equal(JSON.parse(await readFile(store.file, 'utf8')).automations.jobs.find(item => item.id === payload.job.id).runs.find(item => item.id === payload.run.id).conversationId, conversation.id, 'binding must be durable before submission');
    return { status: 'running' };
  };
  const make = (target = store, overrides = {}) => {
    const service = createAutomationService({ store: target, clock: () => timestamp, authorize, dispatch: options.dispatch ?? defaultDispatch, observe: run => outcomes.get(run.id), onAcknowledge: options.onAcknowledge, setInterval: handler => { timers.add(handler); return handler; }, clearInterval: handler => timers.delete(handler), ...overrides });
    services.push(service); return service;
  };
  const service = make();
  const input = (patch = {}) => ({ requestId: randomUUID(), title: 'Daily fixture', prompt: 'Isolated fixed task', hostId: 'central', providerId, projectDirectory: '/workspace', permissions: { access: 'read-only', approval: 'ask' }, schedule: { kind: 'interval', minutes: 5 }, ...patch });
  t.after(async () => { await Promise.all(services.map(value => value.close())); await store.queue.catch(() => {}); await rm(directory, { recursive: true, force: true }); });
  return { directory, store, service, make, ownerId, member, providerId, remoteId, calls, outcomes, authorizations, timers, input, now: () => timestamp, setTime: value => { timestamp = typeof value === 'string' ? Date.parse(value) : value; }, advance: ms => { timestamp += ms; }, online: value => { online = value; }, busy: value => { busy = value; }, model: value => { modelAllowed = value; }, saved: async () => JSON.parse(await readFile(store.file, 'utf8')), create: patch => service.create(ownerId, input(patch)) };
}

test('create/list/preferences expose only owner data and public run routing fields', async t => {
  const f = await fixture(t), job = await f.create();
  assert.equal(f.service.list(f.ownerId).allowAgentCreate, true);
  assert.equal(job.hostName, 'Central'); assert.equal(job.providerName, 'Fixture model');
  assert.equal(job.userId, undefined); assert.equal(job.nextRunAt, '2026-10-05T00:05:00.000Z');
  assert.deepEqual(f.service.list(f.member.id), { allowAgentCreate: true, automations: [] });
  await f.service.preferences(f.ownerId, { allowAgentCreate: false });
  assert.equal(f.service.list(f.ownerId).allowAgentCreate, false); assert.equal(f.service.list(f.member.id).allowAgentCreate, true);
  for (const method of [() => f.service.update(f.member.id, job.id, { revision: job.revision, enabled: false }), () => f.service.remove(f.member.id, job.id, { revision: job.revision }), () => f.service.run(f.member.id, job.id, { requestId: randomUUID() })]) await assert.rejects(method(), { status: 404 });
  assert.equal((await f.saved()).automations.jobs[0].userId, f.ownerId);
});

test('parallel create retries are durable idempotent and conflicting fingerprints are rejected', async t => {
  const f = await fixture(t), body = f.input();
  const jobs = await Promise.all(Array.from({ length: 12 }, () => f.service.create(f.ownerId, body)));
  assert.equal(new Set(jobs.map(item => item.id)).size, 1); assert.equal(f.service.list(f.ownerId).automations.length, 1);
  await assert.rejects(f.service.create(f.ownerId, { ...body, prompt: 'Changed' }), { status: 409 });
  assert.equal((await f.saved()).automations.requests.length, 1);
  await f.service.remove(f.ownerId, jobs[0].id, { revision: jobs[0].revision });
  await assert.rejects(f.service.create(f.ownerId, body), { status: 410 });
});

test('CAS edits reject stale revisions and preserve running snapshot while pause affects future work', async t => {
  const f = await fixture(t), job = await f.create();
  const run = await f.service.run(f.ownerId, job.id, { requestId: randomUUID() });
  await until(() => f.service.list(f.ownerId).automations[0].runs[0].status === 'running');
  const current = f.service.list(f.ownerId).automations[0];
  const changed = await f.service.update(f.ownerId, job.id, { revision: current.revision, enabled: false, prompt: 'Future prompt' });
  await assert.rejects(f.service.update(f.ownerId, job.id, { revision: current.revision, enabled: true }), { status: 409 });
  assert.equal(changed.nextRunAt, null); assert.equal(changed.prompt, 'Future prompt');
  const call = f.calls[0], conversationId = changed.runs[0].conversationId;
  assert.equal(f.service.authorizePrincipal(call.auth, { content: 'Isolated fixed task', hostId: 'central', providerId: f.providerId, permissions: job.permissions, projectDirectory: '/workspace', conversationId }).runId, run.id);
  f.advance(300000); await f.service.tick(); assert.equal(f.calls.length, 1);
});

test('manual run UUID retries never submit twice and retained receipts prevent replay after run pruning', async t => {
  const f = await fixture(t), job = await f.create(), requestId = randomUUID();
  const runs = await Promise.all(Array.from({ length: 10 }, () => f.service.run(f.ownerId, job.id, { requestId })));
  assert.equal(new Set(runs.map(item => item.id)).size, 1);
  await until(() => f.service.list(f.ownerId).automations[0].runs[0].status === 'running'); assert.equal(f.calls.length, 1);
  f.outcomes.set(runs[0].id, { status: 'completed', finishedAt: new Date(f.now()).toISOString() }); await f.service.tick();
  const again = await f.service.run(f.ownerId, job.id, { requestId }); assert.equal(again.id, runs[0].id); assert.equal(again.status, 'completed');
  await f.store.save({ automation: { apply: data => { const item = data.jobs[0]; item.runs = []; } } });
  await assert.rejects(f.service.run(f.ownerId, job.id, { requestId }), { status: 410 }); assert.equal(f.calls.length, 1);
});

test('claim and next schedule are on disk before dispatch and overlapping ticks execute once', async t => {
  let f;
  f = await fixture(t, { dispatch: async payload => {
    const saved = await f.saved(), stored = saved.automations.jobs[0];
    assert.equal(stored.runs[0].status, 'claiming'); assert.equal(stored.nextRunAt, '2026-10-05T00:10:00.000Z');
    f.calls.push(payload);
    const conversation = { id: randomUUID(), userId: f.ownerId, mode: 'codex', messages: [], automationId: payload.job.id, automationRunId: payload.run.id };
    f.store.state.conversations.push(conversation); await payload.bindConversation(conversation.id); return { status: 'running' };
  } });
  await f.create(); f.advance(300000);
  await Promise.all(Array.from({ length: 10 }, () => f.service.tick()));
  assert.equal(f.calls.length, 1); const result = f.service.list(f.ownerId).automations[0];
  assert.equal(result.runs[0].scheduledFor, '2026-10-05T00:05:00.000Z'); assert.equal(result.runs[0].trigger, 'scheduled');
  f.advance(300000); await f.service.tick(); assert.equal(f.calls.length, 1); assert.equal(f.service.list(f.ownerId).automations[0].runs.at(-1).status, 'skipped');
});

test('offline registered fixed computer can be saved but due work skips without fallback', async t => {
  const f = await fixture(t); f.online(false);
  const job = await f.create({ hostId: f.remoteId }); f.advance(300000); await f.service.tick();
  const current = f.service.list(f.ownerId).automations[0];
  assert.equal(current.hostId, f.remoteId); assert.equal(current.enabled, true); assert.equal(current.runs[0].status, 'skipped'); assert.match(current.runs[0].message, /offline/); assert.equal(f.calls.length, 0);
  const manual = await f.service.run(f.ownerId, job.id, { requestId: randomUUID() }); assert.equal(manual.status, 'skipped');
  f.online(true); f.advance(300000); await f.service.tick(); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].run.snapshot.hostId, f.remoteId);
});

test('busy checks apply to fresh dispatch only and never reject the bound principal', async t => {
  const f = await fixture(t), job = await f.create(); f.busy(true);
  const skipped = await f.service.run(f.ownerId, job.id, { requestId: randomUUID() }); assert.equal(skipped.status, 'skipped'); assert.equal(f.calls.length, 0);
  f.busy(false); await f.service.run(f.ownerId, job.id, { requestId: randomUUID() });
  await until(() => f.service.list(f.ownerId).automations[0].runs.at(-1).status === 'running');
  f.busy(true); assert.equal(f.service.authorizePrincipal(f.calls[0].auth).userId, f.ownerId);
  assert.equal(f.authorizations.at(-1).dispatch, false);
});

test('startup skips missed schedules and never replays active claims or queued work', async t => {
  const f = await fixture(t), job = await f.create(); await f.service.run(f.ownerId, job.id, { requestId: randomUUID() });
  await until(() => f.service.list(f.ownerId).automations[0].runs[0].status === 'running');
  await f.service.close(); const restored = await new JsonStore(f.directory).init();
  const stopped = restored.state.automations.jobs[0]; assert.equal(stopped.enabled, false); assert.equal(stopped.runs[0].status, 'unknown'); assert.equal(stopped.nextRunAt, null);
  assert.match(stopped.runs[0].message, /不会自动重试/);
  const restarted = f.make(restored); await restarted.start(); await restarted.tick(); assert.equal(f.calls.length, 1);
  // A second job expired while the server was absent; startup records the skip.
  await restarted.create(f.ownerId, f.input({ title: 'Missed task', schedule: { kind: 'once', at: new Date(f.now() + 300000).toISOString() } }));
  f.advance(300001); await restarted.close(); await restored.queue;
  const afterAbsence = await new JsonStore(f.directory).init(), activeService = f.make(afterAbsence); await activeService.start();
  const missed = activeService.list(f.ownerId).automations.find(item => item.title === 'Missed task');
  assert.equal(missed.runs[0].status, 'skipped'); assert.equal(missed.enabled, false); assert.equal(f.calls.length, 1);
});

test('startup repairs unbound claiming records as unknown and pauses once', async t => {
  const f = await fixture(t), job = await f.create();
  await f.store.save({ automation: { apply: data => data.jobs[0].runs.push({ id: randomUUID(), grantId: randomUUID(), snapshot: { prompt: job.prompt, hostId: job.hostId, providerId: job.providerId, projectDirectory: job.projectDirectory, permissions: job.permissions }, status: 'claiming', trigger: 'manual', scheduledFor: new Date(f.now()).toISOString(), startedAt: new Date(f.now()).toISOString() }) } });
  await f.service.start(); const current = f.service.list(f.ownerId).automations[0];
  assert.equal(current.runs[0].status, 'unknown'); assert.equal(current.enabled, false); assert.equal(f.calls.length, 0);
  await f.service.start(); assert.equal(f.timers.size, 1);
});

test('late ticks skip expired work and advance to the next future interval without catch-up', async t => {
  const f = await fixture(t); await f.create(); f.advance(22 * 60000); await f.service.tick();
  const job = f.service.list(f.ownerId).automations[0]; assert.equal(job.runs.length, 1); assert.equal(job.runs[0].status, 'skipped'); assert.equal(job.nextRunAt, '2026-10-05T00:25:00.000Z'); assert.equal(f.calls.length, 0);
});

test('atomic replacement failure rolls back create and claim without publishing or dispatching', async t => {
  const f = await fixture(t), original = f.store.file, invalidTarget = path.join(f.directory, 'cannot-replace-directory'); await mkdir(invalidTarget);
  f.store.file = invalidTarget; await assert.rejects(f.create()); assert.equal(f.service.list(f.ownerId).automations.length, 0); assert.equal((await f.saved().catch(() => null)), null);
  f.store.file = original; const body = f.input(), job = await f.service.create(f.ownerId, body); assert.equal((await f.saved()).automations.jobs.length, 1);
  f.store.file = invalidTarget; f.advance(300000); await assert.rejects(f.service.tick()); assert.equal(f.calls.length, 0); assert.equal(f.service.list(f.ownerId).automations[0].runs.length, 0);
  const disk = JSON.parse(await readFile(original, 'utf8')); assert.equal(disk.automations.jobs[0].runs.length, 0); assert.equal(disk.automations.jobs[0].nextRunAt, job.nextRunAt);
  f.store.file = original; await f.service.tick(); assert.equal(f.calls.length, 1);
});

test('older unrelated saves cannot overwrite committed jobs or a failed mutation', async t => {
  const f = await fixture(t), release = deferred(); f.store.queue = release.promise;
  const created = f.create(), unrelated = f.store.save();
  assert.equal(f.service.list(f.ownerId).automations.length, 0); release.resolve(); const job = await created; await unrelated;
  assert.equal((await f.saved()).automations.jobs[0].id, job.id);
  const extension = f.store.automationPersistence, prepare = extension.prepare; let failOnce = true;
  extension.prepare = (...args) => { prepare(...args); if (failOnce) { failOnce = false; throw new Error('Injected failure after prepare'); } };
  const paused = f.service.update(f.ownerId, job.id, { revision: job.revision, enabled: false }), oldSnapshot = f.store.save();
  await assert.rejects(paused, /Injected failure/); await oldSnapshot;
  const current = f.service.list(f.ownerId).automations[0]; assert.equal(current.enabled, true); assert.equal(current.revision, job.revision); assert.equal((await f.saved()).automations.jobs[0].enabled, true);
});

test('principal checks reject foreign grants, conversation/scope substitutions and live revocations', async t => {
  const f = await fixture(t), job = await f.create({ permissions: { access: 'full-access', approval: 'ask' } }); await f.service.run(f.ownerId, job.id, { requestId: randomUUID() });
  await until(() => f.service.list(f.ownerId).automations[0].runs[0].status === 'running');
  const call = f.calls[0], current = f.service.list(f.ownerId).automations[0], entry = { content: job.prompt, hostId: job.hostId, providerId: job.providerId, permissions: job.permissions, projectDirectory: job.projectDirectory, conversationId: current.runs[0].conversationId };
  for (const patch of [{ content: 'Changed' }, { hostId: f.remoteId }, { providerId: null }, { projectDirectory: '/foreign' }, { permissions: { access: 'read-only', approval: 'ask' } }, { conversationId: randomUUID() }]) assert.throws(() => f.service.authorizePrincipal(call.auth, { ...entry, ...patch }), { status: 403 });
  assert.throws(() => f.service.authorizePrincipal({ ...call.auth, userId: f.member.id }), { status: 404 });
  assert.throws(() => f.service.authorizePrincipal({ ...call.auth, automation: { ...call.auth.automation, grantId: randomUUID() } }), { status: 401 });
  f.model(false); assert.throws(() => f.service.authorizePrincipal(call.auth), { status: 403 }); f.model(true);
  f.online(false); assert.throws(() => f.service.authorizePrincipal(call.auth), { status: 409 }); f.online(true);
  f.store.state.users.find(item => item.id === f.ownerId).disabled = true; assert.throws(() => f.service.authorizePrincipal(call.auth), { status: 401 }); f.store.state.users.find(item => item.id === f.ownerId).disabled = false;
  await f.service.remove(f.ownerId, job.id, { revision: current.revision }); assert.throws(() => f.service.authorizePrincipal(call.auth), { status: 404 });
  assert.doesNotMatch(JSON.stringify(current), /grantId|snapshot|sessionHash|userId/);
});

test('logout/session removal does not cancel an independent automation principal', async t => {
  const f = await fixture(t), job = await f.create(); await f.service.run(f.ownerId, job.id, { requestId: randomUUID() });
  await until(() => f.service.list(f.ownerId).automations[0].runs[0].status === 'running');
  f.store.state.sessions = []; await f.store.save(); assert.equal(f.service.authorizePrincipal(f.calls[0].auth).automationId, job.id);
});

test('Agent creation inherits current turn scope, persists ten-per-turn bound across deletion, and honors opt-out', async t => {
  const f = await fixture(t), conversationId = randomUUID(), sourceRunId = randomUUID();
  f.store.state.conversations.push({ id: conversationId, userId: f.ownerId, mode: 'codex', messages: [] }); await f.store.save();
  const context = { sourceRunId, hostId: 'central', providerId: f.providerId, projectDirectory: '/current', permissions: { access: 'read-only', approval: 'ask' } }, options = { source: 'agent', sourceConversationId: conversationId, context };
  const body = { requestId: randomUUID(), title: 'Agent plan', prompt: 'Reminder', schedule: { kind: 'interval', minutes: 5 } };
  await assert.rejects(f.service.create(f.ownerId, { ...body, permissions: { access: 'full-access', approval: 'auto' } }, options), { status: 400 });
  await assert.rejects(f.service.create(f.ownerId, body, { ...options, context: undefined }), { status: 403 });
  for (let i = 0; i < 10; i++) {
    const job = await f.service.create(f.ownerId, { ...body, requestId: randomUUID() }, options);
    assert.equal(job.projectDirectory, '/current'); assert.equal(job.sourceRunId, undefined); assert.deepEqual(job.permissions, context.permissions);
    await f.service.remove(f.ownerId, job.id, { revision: job.revision });
  }
  await assert.rejects(f.service.create(f.ownerId, body, options), { status: 429 });
  const nextTurn = { ...options, context: { ...context, sourceRunId: randomUUID() } }; await f.service.create(f.ownerId, body, nextTurn);
  await f.service.preferences(f.ownerId, { allowAgentCreate: false });
  await assert.rejects(f.service.create(f.ownerId, { ...body, requestId: randomUUID() }, nextTurn), { status: 403 });
});

test('account job and receipt limits reject new operations without evicting idempotency protection', async t => {
  const f = await fixture(t), body = f.input(), first = await f.service.create(f.ownerId, body);
  await f.store.save({ automation: { apply: data => {
    const base = data.jobs[0]; for (let i = 1; i < 50; i++) data.jobs.push({ ...structuredClone(base), id: randomUUID(), revision: randomUUID(), runs: [] });
    for (let i = 1; i < 500; i++) data.requests.push({ userId: f.ownerId, kind: 'create', requestId: randomUUID(), fingerprint: 'a'.repeat(64), jobId: randomUUID(), createdAt: new Date(f.now()).toISOString() });
  } } });
  assert.equal((await f.service.create(f.ownerId, body)).id, first.id);
  await assert.rejects(f.create(), { status: 409 }); assert.equal((await f.saved()).automations.requests.length, 500);
  await f.service.remove(f.ownerId, first.id, { revision: first.revision });
  await assert.rejects(f.create(), { status: 409 }); assert.equal((await f.saved()).automations.requests.length, 500);
});

test('fifty jobs per account limit is independent from receipts and another account capacity', async t => {
  const f = await fixture(t); await f.create();
  await f.store.save({ automation: { apply: data => { const base = data.jobs[0]; for (let i = 1; i < 50; i++) data.jobs.push({ ...structuredClone(base), id: randomUUID(), revision: randomUUID(), runs: [] }); } } });
  await assert.rejects(f.create(), /50/);
  assert.equal((await f.service.create(f.member.id, f.input())).createdBy, 'user');
  assert.equal(f.service.list(f.ownerId).automations.length, 50); assert.equal(f.service.list(f.member.id).automations.length, 1);
});

test('idle and unchanged active observations avoid persistence and service close clears its timer', async t => {
  const f = await fixture(t), job = await f.create(); await f.service.start();
  const original = f.store.save.bind(f.store); let saves = 0;
  f.store.save = (...args) => { saves++; return original(...args); };
  await f.service.tick(); assert.equal(saves, 0);
  const run = await f.service.run(f.ownerId, job.id, { requestId: randomUUID() });
  await until(() => f.service.list(f.ownerId).automations[0].runs[0].status === 'running');
  f.outcomes.set(run.id, { status: 'running', message: 'Working' }); await f.service.tick();
  saves = 0; await f.service.tick(); assert.equal(saves, 0);
  await f.service.close(); assert.equal(f.timers.size, 0); assert.throws(() => f.service.list(f.ownerId), { status: 503 });
});

test('permission revocation while persistence is queued rejects a new claim without dispatch', async t => {
  const f = await fixture(t), job = await f.create(), release = deferred(); f.store.queue = release.promise;
  const request = f.service.run(f.ownerId, job.id, { requestId: randomUUID() }); f.model(false); release.resolve();
  await assert.rejects(request, { status: 403 }); assert.equal(f.calls.length, 0); assert.equal(f.service.list(f.ownerId).automations[0].runs.length, 0);
});

for (const operation of ['create', 'pause', 'run']) test(`cancelled internal guard blocks queued ${operation} before any durable mutation`, async t => {
  const f = await fixture(t), job = await f.create(), before = await readFile(f.store.file, 'utf8');
  const release = deferred(), controller = new AbortController(); f.store.queue = release.promise;
  const options = { guard: () => controller.signal.throwIfAborted() };
  const request = operation === 'create' ? f.service.create(f.ownerId, f.input(), options) : operation === 'pause' ? f.service.update(f.ownerId, job.id, { revision: job.revision, enabled: false }, options) : f.service.run(f.ownerId, job.id, { requestId: randomUUID() }, options);
  controller.abort(new Error('Actual source run cancelled')); release.resolve();
  await assert.rejects(request, /source run cancelled/);
  assert.equal(await readFile(f.store.file, 'utf8'), before); assert.equal(f.calls.length, 0); assert.equal(f.service.list(f.ownerId).automations[0].revision, job.revision);
});

test('internal guard runs on UUID retries and rejects asynchronous or invalid guard contracts', async t => {
  const f = await fixture(t), body = f.input(), job = await f.service.create(f.ownerId, body);
  await assert.rejects(f.service.create(f.ownerId, body, { guard: () => { throw Object.assign(new Error('Run no longer valid'), { status: 401 }); } }), { status: 401 });
  await assert.rejects(f.service.update(f.ownerId, job.id, { revision: job.revision, enabled: false }, { guard: () => Promise.resolve() }), /同步/);
  await assert.rejects(f.service.preferences(f.ownerId, { allowAgentCreate: false }, { guard: true }), { status: 400 });
  assert.equal(f.service.list(f.ownerId).automations[0].enabled, true); assert.equal(f.service.list(f.ownerId).allowAgentCreate, true);
});

test('dispatch acknowledgement unknown pauses future work and is never retried automatically', async t => {
  const f = await fixture(t, { dispatch: async payload => {
    f.calls.push(payload); const conversation = { id: randomUUID(), userId: f.ownerId, mode: 'codex', messages: [], automationId: payload.job.id, automationRunId: payload.run.id };
    f.store.state.conversations.push(conversation); await payload.bindConversation(conversation.id);
    throw Object.assign(new Error('Executor acknowledgement lost'), { code: 'execution_unknown' });
  } });
  const job = await f.create(), requestId = randomUUID(); const run = await f.service.run(f.ownerId, job.id, { requestId });
  await until(() => f.service.list(f.ownerId).automations[0].runs[0].status === 'unknown');
  assert.equal(f.service.list(f.ownerId).automations[0].enabled, false);
  assert.equal((await f.service.run(f.ownerId, job.id, { requestId })).id, run.id);
  f.advance(600000); await f.service.tick(); assert.equal(f.calls.length, 1);
});

test('unknown blocks new execution until an owned CAS acknowledgement, which leaves future work paused', async t => {
  const f = await fixture(t), job = await f.create(), first = await f.service.run(f.ownerId, job.id, { requestId: randomUUID() });
  await until(() => f.service.list(f.ownerId).automations[0].runs[0].status === 'running');
  f.outcomes.set(first.id, { status: 'unknown', message: 'Disconnected' }); await f.service.tick();
  const current = f.service.list(f.ownerId).automations[0];
  await assert.rejects(f.service.run(f.ownerId, job.id, { requestId: randomUUID() }), { status: 409 });
  await assert.rejects(f.service.update(f.ownerId, job.id, { revision: current.revision, enabled: true }), { status: 409 });
  await assert.rejects(f.service.acknowledge(f.member.id, job.id, { revision: current.revision, runId: first.id }), { status: 404 });
  await assert.rejects(f.service.acknowledge(f.ownerId, job.id, { revision: job.revision, runId: first.id }), { status: 409 });
  await assert.rejects(f.service.acknowledge(f.ownerId, job.id, { revision: current.revision, runId: randomUUID() }), { status: 409 });
  assert.throws(() => f.service.authorizePrincipal(f.calls[0].auth), { status: 401 });
  const acknowledged = await f.service.acknowledge(f.ownerId, job.id, { revision: current.revision, runId: first.id });
  assert.equal(acknowledged.runs[0].status, 'cancelled'); assert.equal(acknowledged.enabled, false); assert.equal(acknowledged.nextRunAt, null); assert.match(acknowledged.runs[0].message, /用户已确认/);
  f.advance(300000); await f.service.tick(); assert.equal(f.calls.length, 1);
  assert.equal((await f.service.update(f.ownerId, job.id, { revision: acknowledged.revision, enabled: true })).enabled, true);
});

test('acknowledgement callback failure and asynchronous callbacks leave durable run and conversation untouched', async t => {
  let mode = 'throw';
  const f = await fixture(t, { onAcknowledge: ({ job, run }, snapshot) => {
    const conversation = snapshot.conversations.find(item => item.id === run.conversationId && item.userId === job.userId && item.automationId === job.id);
    conversation.title = 'Undurable callback modification';
    if (mode === 'throw') throw new Error('Acknowledgement callback failed');
    return Promise.resolve();
  } });
  const job = await f.create(), run = await f.service.run(f.ownerId, job.id, { requestId: randomUUID() });
  await until(() => f.service.list(f.ownerId).automations[0].runs[0].status === 'running');
  f.outcomes.set(run.id, { status: 'unknown' }); await f.service.tick();
  const current = f.service.list(f.ownerId).automations[0], raw = await readFile(f.store.file, 'utf8');
  await assert.rejects(f.service.acknowledge(f.ownerId, job.id, { revision: current.revision, runId: run.id }), /callback failed/);
  assert.equal(await readFile(f.store.file, 'utf8'), raw); assert.equal(f.service.list(f.ownerId).automations[0].runs[0].status, 'unknown');
  mode = 'async'; await assert.rejects(f.service.acknowledge(f.ownerId, job.id, { revision: current.revision, runId: run.id }), /同步/);
  assert.equal(await readFile(f.store.file, 'utf8'), raw); assert.equal(f.store.state.conversations[0].title, 'Fixture automation');
});

test('acknowledged run and exact conversation cancellation commit atomically and defeat an older captured save', async t => {
  const f = await fixture(t, { onAcknowledge: ({ job, run, phase }, snapshot) => {
    assert.equal(phase, 'prepare');
    const conversation = snapshot.conversations.find(item => item.id === run.conversationId && item.userId === job.userId && item.automationId === job.id && item.automationRunId === run.id), agent = conversation?.agent;
    if (!agent || agent.run?.submissionId !== run.id) return;
    if (agent.run.status === 'unknown') { agent.run.status = 'cancelled'; agent.run.finishedAt = run.acknowledgedAt; agent.paused = true; agent.revision++; }
    for (const receipt of agent.submissions) if (receipt.submissionId === run.id && receipt.status === 'uncertain') receipt.status = 'cancelled';
  } });
  const job = await f.create(), run = await f.service.run(f.ownerId, job.id, { requestId: randomUUID() });
  await until(() => f.service.list(f.ownerId).automations[0].runs[0].status === 'running');
  const conversation = f.store.state.conversations[0], entryId = randomUUID();
  conversation.agent = { revision: 1, paused: true, queue: [], run: { id: entryId, submissionId: run.id, status: 'unknown', permissions: job.permissions, hostId: 'central' }, submissions: [{ submissionId: run.id, entryId, fingerprint: 'a'.repeat(64), status: 'uncertain', content: job.prompt, attachmentIds: [], createdAt: new Date(f.now()).toISOString() }] };
  f.outcomes.set(run.id, { status: 'unknown' }); await f.service.tick();
  const current = f.service.list(f.ownerId).automations[0], original = f.store.file, raw = await readFile(original, 'utf8');
  const invalidTarget = path.join(f.directory, 'ack-cannot-replace'); await mkdir(invalidTarget); f.store.file = invalidTarget;
  await assert.rejects(f.service.acknowledge(f.ownerId, job.id, { revision: current.revision, runId: run.id }));
  assert.equal(conversation.agent.run.status, 'unknown'); assert.equal(f.service.list(f.ownerId).automations[0].runs[0].status, 'unknown'); assert.equal(await readFile(original, 'utf8'), raw);
  f.store.file = original;
  const release = deferred(); f.store.queue = release.promise;
  const acknowledged = f.service.acknowledge(f.ownerId, job.id, { revision: current.revision, runId: run.id }), older = f.store.save();
  assert.equal(conversation.agent.run.status, 'unknown'); release.resolve(); const result = await acknowledged; await older;
  assert.equal(result.runs[0].status, 'cancelled'); assert.equal(result.runs[0].acknowledgedAt, undefined);
  assert.equal(conversation.agent.run.status, 'cancelled'); assert.equal(conversation.agent.submissions[0].status, 'cancelled'); assert.equal(conversation.agent.revision, 2);
  const saved = await f.saved(); assert.equal(saved.conversations[0].agent.run.status, 'cancelled'); assert.equal(saved.conversations[0].agent.submissions[0].status, 'cancelled'); assert.ok(saved.automations.jobs[0].runs[0].acknowledgedAt);
  const restored = await new JsonStore(f.directory).init(); assert.equal(restored.state.conversations[0].agent.run.status, 'cancelled');
});

test('completed observations persist bounded history and invalidate old grants', async t => {
  const f = await fixture(t), job = await f.create();
  for (let i = 0; i < 32; i++) {
    const run = await f.service.run(f.ownerId, job.id, { requestId: randomUUID() });
    await until(() => f.service.list(f.ownerId).automations[0].runs.at(-1).status === 'running');
    f.outcomes.set(run.id, { status: 'completed', message: 'Done' }); await f.service.tick();
  }
  const current = f.service.list(f.ownerId).automations[0]; assert.equal(current.runs.length, 30); assert.equal(current.runs.at(-1).message, 'Done'); assert.ok(current.runs.at(-1).finishedAt);
  assert.throws(() => f.service.authorizePrincipal(f.calls.at(-1).auth), { status: 401 }); assert.equal((await f.saved()).automations.jobs[0].runs.length, 30);
});

test('dispatch without binding or with another account conversation fails closed and pauses', async t => {
  const f = await fixture(t, { dispatch: async payload => {
    f.calls.push(payload); const conversation = { id: randomUUID(), userId: f.member.id, mode: 'codex', messages: [], automationId: payload.job.id };
    f.store.state.conversations.push(conversation); await payload.bindConversation(conversation.id);
  } });
  const job = await f.create(); await f.service.run(f.ownerId, job.id, { requestId: randomUUID() });
  await until(() => f.service.list(f.ownerId).automations[0].runs[0].status === 'error');
  assert.equal(f.service.list(f.ownerId).automations[0].enabled, false);
  assert.equal(f.service.list(f.ownerId).automations[0].runs[0].conversationId, undefined);
});

test('invalid persisted automation data never overwrites the user file or trusts a passed flag', async t => {
  const f = await fixture(t); await f.create(); await f.service.close();
  const state = await f.saved(); state.automations.jobs[0].runs.push({ passed: true }); const raw = JSON.stringify(state); await writeFile(f.store.file, raw);
  await assert.rejects(new JsonStore(f.directory).init(), /本地自动化/); assert.equal(await readFile(f.store.file, 'utf8'), raw);
  const valid = await fixture(t); const job = await valid.create();
  const candidate = await valid.saved(); candidate.automations.jobs[0].userId = valid.member.id; candidate.automations.jobs[0].hostId = valid.remoteId;
  assert.throws(() => validateStoredAutomations(candidate), /本地自动化/); assert.equal(job.runs.length, 0);
});

test('close waits for a blocked tick save and never starts another scheduled run', async t => {
  const f = await fixture(t), first = await f.create(), second = await f.create(); await f.service.start();
  const run = await f.service.run(f.ownerId, first.id, { requestId: randomUUID() });
  await until(() => f.service.list(f.ownerId).automations[0].runs[0].status === 'running');
  f.outcomes.set(run.id, { status: 'completed' }); f.advance(300000);
  const release = deferred(); f.store.queue = release.promise;
  const tick = f.service.tick(); let closed = false;
  const closing = f.service.close().then(() => { closed = true; });
  await delay(10); assert.equal(closed, false); assert.equal(f.timers.size, 0);
  assert.throws(() => f.service.list(f.ownerId), { status: 503 });
  release.resolve(); await closing; await tick;
  const saved = await f.saved();
  assert.equal(saved.automations.jobs.find(item => item.id === first.id).runs[0].status, 'completed');
  assert.equal(saved.automations.jobs.find(item => item.id === second.id).runs.length, 0); assert.equal(f.calls.length, 1);
  const before = await readFile(f.store.file, 'utf8'); await f.service.tick(); await delay(5);
  assert.equal(await readFile(f.store.file, 'utf8'), before);
});

test('close waits for in-flight dispatch binding and its final failure receipt', async t => {
  const release = deferred(), entered = deferred();
  const f = await fixture(t, { dispatch: async payload => {
    f.calls.push(payload);
    const conversation = { id: randomUUID(), userId: f.ownerId, mode: 'codex', messages: [], automationId: payload.job.id, automationRunId: payload.run.id };
    f.store.state.conversations.push(conversation); f.store.queue = release.promise;
    const binding = payload.bindConversation(conversation.id); entered.resolve(); await binding;
    assert.fail('Closed dispatch must not reach submission');
  } });
  const job = await f.create(); await f.service.run(f.ownerId, job.id, { requestId: randomUUID() }); await entered.promise;
  let closed = false; const closing = f.service.close().then(() => { closed = true; });
  await delay(10); assert.equal(closed, false); release.resolve(); await closing;
  const saved = await f.saved(); assert.equal(saved.automations.jobs[0].runs[0].status, 'error');
  assert.equal(saved.automations.jobs[0].enabled, false); assert.equal(f.calls.length, 1);
  assert.equal(saved.automations.jobs[0].runs[0].conversationId, undefined);
});

test('close drains an in-flight startup save without installing a timer', async t => {
  const f = await fixture(t); await f.create(); const release = deferred(); f.store.queue = release.promise;
  const starting = f.service.start(); let closed = false; const closing = f.service.close().then(() => { closed = true; });
  await delay(10); assert.equal(closed, false); release.resolve(); await closing; await starting;
  assert.equal(f.timers.size, 0); assert.equal(f.calls.length, 0);
});

test('real automation API execution uses canonical project scope and still rejects the wrong host platform', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-automation-path-api-')), dataDir = path.join(directory, 'data');
  const store = await new JsonStore(dataDir).init();
  store.state.codexConfig = { ...defaultCodexConfig(), mode: 'api', model: 'fixture-default', baseUrl: 'https://fixture-automations.example/v1', apiKey: 'private-fixture-model-secret' }; await store.save();
  const calls = [], token = 'isolated-canonical-path-owner';
  const app = await createPetServer({ dataDir, token, automationOptions: { setInterval: () => ({ unref() {} }), clearInterval() {} }, desktopTools: { specs: [], close: async () => {} }, codexFactory: () => ({
    status: async () => ({ available: true, authenticated: true }),
    run: async args => { calls.push(args); return { threadId: randomUUID(), text: 'Canonical path fixture complete' }; }, close: async () => {},
  }) });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); }); await listenFixture(app.server);
  const request = async (route, body) => {
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}/api${route}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  const projectDirectory = process.platform === 'win32' ? 'e:/fixture-parent/../fixture-project' : '/fixture-parent/../fixture-project';
  const expected = process.platform === 'win32' ? 'e:\\fixture-project' : '/fixture-project';
  const body = { requestId: randomUUID(), title: 'Canonical path execution', prompt: 'Fixture reply', hostId: 'central', providerId: null, projectDirectory, permissions: { access: 'read-only', approval: 'auto' }, schedule: { kind: 'interval', minutes: 5 } };
  const foreign = await request('/automations', { ...body, requestId: randomUUID(), projectDirectory: process.platform === 'win32' ? '/fixture-project' : 'E:/fixture-project' }); assert.equal(foreign.status, 400);
  const created = await request('/automations', body); assert.equal(created.status, 201); assert.equal(created.data.automation.projectDirectory, expected);
  const launched = await request(`/automations/${created.data.automation.id}/run`, { requestId: randomUUID() }); assert.equal(launched.status, 200);
  await until(() => calls.length === 1); assert.equal(calls[0].projectDirectory, expected);
  const saved = JSON.parse(await readFile(path.join(dataDir, 'state.json'), 'utf8')), run = saved.automations.jobs[0].runs[0];
  assert.equal(run.snapshot.projectDirectory, expected);
  const conversation = saved.conversations.find(item => item.id === run.conversationId); assert.equal(conversation.agent.run.projectDirectory, expected);
});
