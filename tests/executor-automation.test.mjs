import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createExecutors } from '../server/executors.mjs';
import { DesktopExecutor } from '../desktop/executor.mjs';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const args = () => ({ title: 'Fixture task', prompt: 'No desktop side effects.', requestId: randomUUID(), schedule: { kind: 'interval', minutes: 5 } });
async function fixture(t, automationTool = async () => ({ ok: true })) {
  const userId = randomUUID(), auth = { userId, sessionHash: 'fixture-login', bootstrap: false }, valid = new Set([auth.sessionHash]); let time = Date.now();
  const config = { mode: 'api', model: 'assigned-model', revision: randomUUID(), baseUrl: 'https://fixture-model.example/v1', apiKey: 'private-upstream-key' };
  const store = { state: { users: [{ id: userId }], executionHosts: [] }, save: async () => {} };
  const manager = createExecutors({ store, clock: () => time, authorizeSession: value => { if (!valid.has(value.sessionHash)) throw Object.assign(new Error('login expired'), { status: 401 }); }, authorizeEntry: value => { if (!valid.has(value.auth.sessionHash)) throw Object.assign(new Error('entry revoked'), { status: 401 }); }, readAttachment: async () => { throw new Error('no attachments'); }, getConfig: () => config, automationTool, pollMs: 2, stopMs: 5 });
  t.after(() => manager.close());
  const register = capabilities => manager.register(auth, { deviceId: randomUUID(), name: 'Fixture PC', platform: 'win32', arch: 'x64', ...(capabilities ? { capabilities } : {}) });
  const start = async (registration, permissions = { access: 'read-only', approval: 'auto' }) => {
    const entry = { id: randomUUID(), auth, conversationId: randomUUID(), hostId: registration.hostId, providerId: randomUUID(), model: config.model, effort: '', codexRevision: config.revision, permissions, attachmentIds: [] };
    const events = [], controller = new AbortController(), bridge = manager.bind(entry), done = bridge.run({ conversationId: entry.conversationId, prompt: 'Fixture task', permissions: entry.permissions, signal: controller.signal, onEvent: (event, data) => events.push({ event, data }) }); done.catch(() => {});
    const command = (await manager.poll(registration.connectionId, auth)).commands[0];
    const event = (name, sequence, data = {}) => manager.events(registration.connectionId, auth, { runId: entry.id, sequence, event: name, data });
    // Captured events are emitted through the actual bound run callback below.
    return { entry, controller, done, command, event, events, bridge, callback: body => manager.automation(registration.connectionId, entry.id, `Bearer ${command.relayToken}`, body) };
  };
  return { manager, register, start, auth, valid, config, expire() { time += 60001; } };
}

test('remote callback binds exact run token and frozen server entry, with one mutation per callId', async t => {
  const gate = deferred(), calls = [];
  const f = await fixture(t, async (...values) => { calls.push(values); await gate.promise; return { ok: true, automation: { id: 'one-result' } }; });
  const registration = await f.register({ projectDirectory: true, automations: true, approvalReview: true }), run = await f.start(registration);
  assert.equal(registration.capabilities.automations, true); assert.equal(run.command.automationTools, true); run.event('started', 1);
  const body = { callId: 'fixture-call', name: 'petpal_automation_create', arguments: args() };
  const first = run.callback(body), second = run.callback(structuredClone(body));
  await Promise.resolve(); assert.equal(calls.length, 1); assert.equal(calls[0][2].entry, run.entry);
  await assert.rejects(run.callback({ ...body, arguments: { ...body.arguments, prompt: 'changed' } }), { status: 409 });
  await assert.rejects(run.callback({ ...body, arguments: { ...body.arguments, userId: randomUUID() } }), { status: 400 });
  await assert.rejects(f.manager.automation(randomUUID(), run.entry.id, `Bearer ${run.command.relayToken}`, body), { status: 401 });
  await assert.rejects(f.manager.automation(registration.connectionId, randomUUID(), `Bearer ${run.command.relayToken}`, body), { status: 401 });
  await assert.rejects(f.manager.automation(registration.connectionId, run.entry.id, 'Bearer fixture-login', body), { status: 401 });
  gate.resolve(); assert.deepEqual(await first, await second); assert.equal(calls.length, 1);
  assert.doesNotMatch(JSON.stringify(run.command), /private-upstream-key|fixture-login/);
  run.event('complete', 2); await run.done; await assert.rejects(run.callback(body), { status: 401 });
});

for (const reason of ['stop', 'disconnect', 'expiry', 'revocation']) test(`remote automation callback rejects ${reason} and suppresses late mutation result`, async t => {
  const gate = deferred(), entered = deferred(); let signal, calls = 0;
  const f = await fixture(t, async (_name, _args, context) => { calls++; signal = context.signal; entered.resolve(); await gate.promise; return { ok: true }; });
  const registration = await f.register({ projectDirectory: true, automations: true, approvalReview: true }), run = await f.start(registration); run.event('started', 1);
  const body = { callId: 'once', name: 'petpal_automation_list', arguments: {} }, pending = run.callback(body); const rejected = assert.rejects(pending);
  await entered.promise;
  if (reason === 'stop') run.controller.abort();
  if (reason === 'disconnect') f.manager.disconnect(registration.connectionId, f.auth);
  if (reason === 'expiry') f.expire();
  if (reason === 'revocation') f.valid.clear();
  await assert.rejects(run.callback(body)); gate.resolve(); await rejected; assert.equal(calls, 1);
  if (reason === 'stop' || reason === 'disconnect') assert.equal(signal.aborted, true);
});

test('old client cannot claim automation tools but still receives the unchanged ordinary run protocol', async t => {
  const f = await fixture(t), old = await f.register(), run = await f.start(old);
  assert.equal(Object.hasOwn(run.command, 'automationTools'), false);
  assert.equal(f.manager.list(f.auth.userId).find(host => host.id === old.hostId).codex.automations, false);
  run.event('started', 1); await assert.rejects(run.callback({ name: 'petpal_automation_list', arguments: {}, callId: 'one' }), { status: 409 });
  run.event('complete', 2); await run.done;
});

for (const approval of ['ask', 'review']) test(`central ${approval} approval binds complete automation arguments and rejects client self approval`, async t => {
  let mutations = 0; const f = await fixture(t, async () => { mutations++; return { ok: true }; });
  const registration = await f.register({ projectDirectory: true, automations: true, approvalReview: true }), run = await f.start(registration, { access: 'read-only', approval }); run.event('started', 1);
  const packet = { name: 'petpal_automation_create', arguments: args(), callId: 'approved-call' };
  await assert.rejects(run.callback(packet), { status: 403 });
  assert.throws(() => run.event('approval', 2, { id: 'remote-approval', kind: 'automation', description: 'untrusted summary' }), { status: 400 });
  run.event('approval', 2, { id: 'remote-approval', kind: 'automation', description: 'untrusted summary', automation: packet });
  // Capture the central ID via its public approval callback rather than trusting
  // a remote approved=true claim. The normal account HTTP route owns this call.
  const centralApproval = run.events.find(item => item.event === 'approval').data;
  assert.notEqual(centralApproval.id, 'remote-approval'); assert.ok(centralApproval.description.includes(packet.arguments.prompt)); assert.ok(centralApproval.description.includes(run.entry.model)); assert.ok(!centralApproval.description.includes('untrusted summary'));
  assert.equal(mutations, 0);
  await assert.rejects(run.callback({ ...packet, approved: true }), { status: 400 });
  const accepting = run.bridge.approve(centralApproval.id, 'accept');
  const command = (await f.manager.poll(registration.connectionId, f.auth)).commands[0]; assert.equal(command.type, 'approve');
  run.event('command-result', 3, { commandId: command.id, ok: true }); await accepting;
  await assert.rejects(run.callback({ ...packet, arguments: { ...packet.arguments, prompt: 'not approved' } }), { status: 403 });
  assert.equal((await run.callback(packet)).ok, true); assert.equal((await run.callback(packet)).ok, true); assert.equal(mutations, 1);
  await assert.rejects(run.callback({ ...packet, callId: 'different-call' }), { status: 403 });
  assert.throws(() => run.event('approval', 4, { id: 'new-remote-approval', kind: 'automation', description: 'duplicate', automation: packet }), { status: 409 });
  run.controller.abort(); await assert.rejects(run.callback(packet));
});

test('a central decline cannot be overwritten by replayed approval metadata or a client callback', async t => {
  let mutations = 0; const f = await fixture(t, async () => { mutations++; return { ok: true }; });
  const registration = await f.register({ projectDirectory: true, automations: true, approvalReview: true }), run = await f.start(registration, { access: 'read-only', approval: 'ask' }); run.event('started', 1);
  const packet = { name: 'petpal_automation_create', arguments: args(), callId: 'denied-call' };
  run.event('approval', 2, { id: 'remote-deny', kind: 'automation', description: 'client summary', automation: packet });
  const approval = run.events.find(item => item.event === 'approval').data;
  const denying = run.bridge.approve(approval.id, 'decline'), command = (await f.manager.poll(registration.connectionId, f.auth)).commands[0];
  run.event('command-result', 3, { commandId: command.id, ok: true }); await denying;
  await assert.rejects(run.callback(packet), { status: 403 }); assert.equal(mutations, 0);
  assert.throws(() => run.event('approval', 4, { id: 'remote-deny-retry', kind: 'automation', description: 'retry', automation: packet }), { status: 409 });
  await assert.rejects(run.bridge.approve(approval.id, 'accept'), { status: 404 });
});

class WorkerFixture extends DesktopExecutor { _start() {} }
async function desktopFixture(t, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-automation-worker-')), requests = [];
  t.after(() => rm(directory, { recursive: true, force: true }));
  const manager = new WorkerFixture({ dataDir: directory, resolveCommand: async () => ({ file: 'fixture-codex' }), toolsFactory: () => ({ specs: [], close: async () => {} }), fetchImpl: async (url, init) => {
    requests.push({ url, init });
    if (url.endsWith('/auth/me')) return Response.json({ instanceId: 'fixture-instance', user: { id: 'fixture-user', canUseCodex: true, agentAccess: 'full' } });
    if (url.endsWith('/register')) return Response.json({ hostId: 'fixture-host', connectionId: 'fixture-connection', leaseMs: 30000, pollMs: 20000, capabilities: { automations: true } });
    if (url.endsWith('/events') || init.method === 'DELETE') return Response.json({ ok: true });
    return options.callback(url, init);
  }, bridgeFactory: options.bridgeFactory });
  t.after(() => manager.close());
  await manager.connect({ url: 'https://fixture-central.example', token: 'long-user-session', instanceId: 'fixture-instance', userId: 'fixture-user' });
  const command = extra => ({ id: randomUUID(), type: 'run', runId: randomUUID(), conversationId: randomUUID(), prompt: 'Fixture only', permissions: { access: 'read-only', approval: 'auto' }, model: 'fixture-model', effort: '', codexRevision: randomUUID(), relayToken: 'only-this-run-token', attachments: [], automationTools: true, ...extra });
  return { manager, requests, command };
}

test('desktop proxies only through run token, does not cache run closures and disables unknown write retries', async t => {
  const catalogues = []; let counter = 0;
  const f = await desktopFixture(t, { callback: async (url, init) => {
    assert.ok(url.endsWith('/automations/tools')); assert.equal(init.headers.Authorization, 'Bearer only-this-run-token'); assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit');
    if (++counter === 2) throw new Error('lost mutation response');
    return Response.json({ ok: true, allowAgentCreate: true, automations: [] });
  }, bridgeFactory: options => {
    catalogues.push(options.desktopTools);
    return { async run(value) { await options.desktopTools.execute('petpal_automation_list', {}, { conversationId: value.conversationId, callId: 'call-exact', signal: value.signal }); return { threadId: 'fixture-thread', text: '' }; }, async close() {} };
  } });
  const ctx = f.manager.current; await f.manager._command(ctx, f.command()); await ctx.run.done;
  await assert.rejects(catalogues[0].execute('petpal_automation_list', {}, { callId: 'late', signal: new AbortController().signal }), /结束/);
  await f.manager._command(ctx, f.command()); await ctx.run.done;
  assert.equal(counter, 2); assert.notEqual(catalogues[0], catalogues[1]); assert.equal(ctx.tools.specs.length, 0);
  assert.equal(f.requests.filter(item => item.url.endsWith('/automations/tools')).length, 2);
});
