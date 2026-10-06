import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createPetServer } from '../server/app.mjs';
import { JsonStore } from '../server/store.mjs';
import { defaultCodexConfig } from '../server/codex-config.mjs';
import { listenFixture } from './helpers/loopback.mjs';

const bootstrap = 'isolated-automation-owner';
const password = 'isolated-password-123';
async function until(check, { message = 'Automation fixture did not settle', diagnostic = () => '' } = {}) {
  const deadline = performance.now() + 15000;
  do {
    const result = await check(); if (result) return result;
    if (performance.now() >= deadline) break;
    await delay(25);
  } while (performance.now() < deadline);
  assert.fail(`${message}${diagnostic() ? `: ${diagnostic()}` : ''}`);
}

async function fixture(t, { seed, autoStart = true } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-automation-api-')), dataDir = path.join(directory, 'data');
  const store = await new JsonStore(dataDir).init(), timestamp = new Date().toISOString(); let time = Date.now();
  store.state.codexConfig = { ...defaultCodexConfig(), mode: 'api', model: 'fixture-default', baseUrl: 'https://fixture-automations.example/v1', apiKey: 'private-fixture-model-secret' };
  const provider = { id: randomUUID(), name: 'Assigned automation model', protocol: 'responses', baseUrl: store.state.codexConfig.baseUrl, model: 'fixture-assigned', reasoningEffort: 'high', apiKey: 'private-provider-secret' };
  const foreign = { ...provider, id: randomUUID(), name: 'Unassigned model', model: 'fixture-other' };
  store.state.providers = [provider, foreign]; seed?.(store.state, timestamp); await store.save();
  const calls = []; let desktopTools;
  const app = await createPetServer({ dataDir, token: bootstrap, automationOptions: { autoStart, clock: () => time, setInterval: () => ({ unref() {} }), clearInterval() {} }, desktopTools: { specs: [], close: async () => {} }, codexFactory: options => {
    desktopTools = options.desktopTools;
    return { async status() { return { available: true, authenticated: true }; }, async run(args) {
      return new Promise((resolve, reject) => {
        const call = { args, resolve: value => resolve(value ?? { threadId: randomUUID(), text: 'Fixture complete' }), reject }; calls.push(call);
        args.onEvent('thread', { threadId: randomUUID() }); args.onEvent('turn', { turnId: randomUUID() });
        args.signal.addEventListener('abort', () => reject(args.signal.reason), { once: true });
      });
    }, async close() { for (const call of calls) call.reject(new Error('Fixture closed')); } };
  } });
  await listenFixture(app.server);
  const request = async (route, { token = bootstrap, method = 'GET', body } = {}) => {
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}/api${route}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  };
  const member = async (username, agentAccess = 'workspace') => {
    const created = await request('/admin/users', { method: 'POST', body: { username, password, agentAccess, providerIds: [provider.id] } }); assert.equal(created.status, 201);
    const login = await request('/auth/login', { token: '', method: 'POST', body: { username, password } }); assert.equal(login.status, 200);
    return { user: created.data.user, token: login.data.token };
  };
  const body = extra => ({ requestId: randomUUID(), title: 'Fixture schedule', prompt: 'Reply with fixture text without using tools.', hostId: 'central', providerId: provider.id, projectDirectory: '', permissions: { access: 'read-only', approval: 'auto' }, schedule: { kind: 'interval', minutes: 5 }, ...extra });
  const create = async (token = bootstrap, extra = {}) => { const value = await request('/automations', { token, method: 'POST', body: body(extra) }); assert.equal(value.status, 201); return value.data.automation; };
  const jobs = async token => (await request('/automations', { token })).data.automations;
  const saved = async () => JSON.parse(await readFile(path.join(dataDir, 'state.json'), 'utf8'));
  const completed = async (job, index, token = bootstrap) => {
    let observed;
    const terminalFailure = new Set(['error', 'cancelled', 'unknown', 'skipped']);
    const diagnostic = () => {
      let text = JSON.stringify(observed ?? { stage: 'waiting for automation binding' });
      for (const key of [store.state.codexConfig.apiKey, provider.apiKey, foreign.apiKey].filter(Boolean)) text = text.replaceAll(key, '[hidden]');
      return text.slice(0, 1500);
    };
    const current = await until(async () => {
      const response = await request('/automations', { token });
      observed = { stage: 'waiting for automation binding', httpStatus: response.status };
      assert.equal(response.status, 200, diagnostic());
      const visible = response.data.automations.find(item => item.id === job.id), run = visible?.runs.at(-1);
      observed = { ...observed, automationStatus: run?.status, message: run?.message };
      assert.ok(visible, diagnostic());
      assert.ok(!terminalFailure.has(run?.status), `Automation terminated before completion: ${diagnostic()}`);
      return run?.conversationId && run;
    }, { message: 'Automation result was not bound', diagnostic });
    await until(() => calls.length > index, { message: 'Agent fixture did not start', diagnostic }); calls[index].resolve();
    await until(async () => {
      const response = await request(`/conversations/${current.conversationId}`, { token }), agent = response.data.agent;
      const receipt = agent?.submissions.find(item => item.submissionId === current.id);
      observed = { stage: 'waiting for Agent completion', httpStatus: response.status, agentStatus: agent?.run?.status, paused: agent?.paused, error: agent?.run?.error || receipt?.error, message: agent?.run?.message, receiptStatus: receipt?.status };
      assert.equal(response.status, 200, diagnostic());
      assert.ok(!terminalFailure.has(agent?.run?.status), `Agent terminated without completion: ${diagnostic()}`);
      assert.ok(!['error', 'cancelled', 'uncertain'].includes(receipt?.status), `Agent submission terminated without completion: ${diagnostic()}`);
      return agent?.run?.status === 'completed';
    }, { message: 'Agent fixture completion did not settle', diagnostic });
    await app.automations.tick(); return current;
  };
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  return { app, request, member, body, create, jobs, calls, saved, completed, provider, foreign, tools: () => desktopTools, advance(minutes) { time += minutes * 60000; }, directory, dataDir };
}

test('account APIs require Agent authorization, isolate users and retain exact create/run request receipts', async t => {
  const f = await fixture(t), alice = await f.member('schedule-alice'), bob = await f.member('schedule-bob'), chatOnly = await f.member('schedule-chat', 'none');
  assert.equal((await f.request('/automations', { token: '' })).status, 401); assert.equal((await f.request('/automations', { token: chatOnly.token })).status, 403);
  const body = f.body(), first = await f.request('/automations', { token: alice.token, method: 'POST', body }), repeated = await f.request('/automations', { token: alice.token, method: 'POST', body });
  assert.equal(first.status, 201); assert.equal(repeated.data.automation.id, first.data.automation.id); assert.equal((await f.jobs(alice.token)).length, 1);
  assert.equal((await f.request('/automations', { token: alice.token, method: 'POST', body: { ...body, prompt: 'Changed content' } })).status, 409);
  const job = first.data.automation;
  for (const [method, suffix, payload] of [['PATCH', '', { revision: job.revision, enabled: false }], ['DELETE', '', { revision: job.revision }], ['POST', '/run', { requestId: randomUUID() }], ['POST', '/acknowledge', { revision: job.revision, runId: randomUUID() }]]) assert.equal((await f.request(`/automations/${job.id}${suffix}`, { token: bob.token, method, body: payload })).status, 404);
  assert.equal((await f.jobs(bob.token)).length, 0);
  assert.equal((await f.request(`/automations/${job.id}`, { token: alice.token, method: 'PATCH', body: { revision: randomUUID(), enabled: false } })).status, 409);
  const runBody = { requestId: randomUUID() }, run = await f.request(`/automations/${job.id}/run`, { token: alice.token, method: 'POST', body: runBody }), again = await f.request(`/automations/${job.id}/run`, { token: alice.token, method: 'POST', body: runBody });
  assert.equal(run.status, 200); assert.equal(run.data.run.id, again.data.run.id); await until(() => f.calls.length === 1);
  assert.equal(f.calls[0].args.model, f.provider.model);
  const visible = JSON.stringify((await f.request('/automations', { token: alice.token })).data);
  assert.doesNotMatch(visible, /grantId|snapshot|sessionHash|private-fixture|private-provider|sourceRunId/);
});

test('scheduled Agent dispatch resolves its fixed independent reviewer without storing review credentials in the run', async t => {
  const f = await fixture(t), permissions = { access: 'read-only', approval: 'review', reviewProviderId: f.foreign.id };
  const job = await f.create(bootstrap, { permissions });
  assert.equal(job.permissions.reviewProviderId, f.foreign.id);
  const submitted = await f.request(`/automations/${job.id}/run`, { method: 'POST', body: { requestId: randomUUID() } }); assert.equal(submitted.status, 200);
  await until(() => f.calls.length === 1);
  const call = f.calls[0]; assert.equal(call.args.reviewConfig.model, f.foreign.model); assert.equal(call.args.reviewConfig.apiKey, f.foreign.apiKey); assert.equal(call.args.authorizeReview(), true);
  const saved = await f.saved(), stored = saved.automations.jobs.find(item => item.id === job.id);
  assert.equal(stored.runs[0].snapshot.permissions.reviewProviderId, f.foreign.id);
  assert.equal(JSON.stringify(stored).includes(f.foreign.apiKey), false);
  const conversation = saved.conversations.find(item => item.id === stored.runs[0].conversationId);
  assert.equal(JSON.stringify(conversation).includes(f.foreign.apiKey), false);
  await f.completed(job, 0);
});

test('owned offline computers may be saved, while foreign hosts, models and escalated access are rejected', async t => {
  const f = await fixture(t), alice = await f.member('scope-alice'), bob = await f.member('scope-bob');
  const register = token => f.request('/agent/executors/register', { token, method: 'POST', body: { deviceId: randomUUID(), name: 'Fixture PC', platform: process.platform, arch: process.arch } });
  const own = (await register(alice.token)).data, other = (await register(bob.token)).data;
  assert.equal((await f.request('/automations', { token: alice.token, method: 'POST', body: f.body({ hostId: other.hostId }) })).status, 404);
  assert.equal((await f.request('/automations', { token: alice.token, method: 'POST', body: f.body({ providerId: f.foreign.id }) })).status, 404);
  assert.equal((await f.request('/automations', { token: alice.token, method: 'POST', body: f.body({ providerId: null }) })).status, 403);
  assert.equal((await f.request('/automations', { token: alice.token, method: 'POST', body: f.body({ permissions: { access: 'full-access', approval: 'auto' } }) })).status, 403);
  await f.request(`/agent/executors/${own.connectionId}`, { token: alice.token, method: 'DELETE' });
  const job = await f.create(alice.token, { hostId: own.hostId });
  const run = await f.request(`/automations/${job.id}/run`, { token: alice.token, method: 'POST', body: { requestId: randomUUID() } });
  assert.equal(run.status, 200); assert.equal(run.data.run.status, 'skipped'); assert.equal(f.calls.length, 0);
  const ownerDefault = await f.create(bootstrap, { providerId: null }); assert.equal(ownerDefault.providerId, null);
});

test('scheduled work survives browser logout, keeps its fixed scope, and observes revocation', async t => {
  const f = await fixture(t), member = await f.member('persist-schedule'), job = await f.create(member.token);
  await f.request('/auth/logout', { token: member.token, method: 'POST', body: {} });
  f.advance(5); await f.app.automations.tick(); await until(() => f.calls.length === 1);
  assert.equal(f.calls[0].args.model, f.provider.model); assert.deepEqual(f.calls[0].args.permissions, { access: 'read-only', approval: 'auto' });
  assert.equal((await f.request('/automations', { token: member.token })).status, 401);
  const changed = await f.request(`/admin/users/${member.user.id}`, { method: 'PATCH', body: { agentAccess: 'none' } }); assert.equal(changed.status, 200);
  assert.equal(f.calls[0].args.signal.aborted, true); await f.app.automations.tick();
  const saved = await f.saved(), stored = saved.automations.jobs.find(item => item.id === job.id); assert.equal(stored.runs[0].status, 'cancelled');
  f.advance(5); await f.app.automations.tick(); assert.equal(f.calls.length, 1); assert.equal((await f.saved()).automations.jobs.find(item => item.id === job.id).enabled, false);
});

test('Agent creation uses current entry scope and permissions, preferences and 10-per-turn limit are durable', async t => {
  const f = await fixture(t), member = await f.member('agent-schedules'), conversation = (await f.request('/conversations', { token: member.token, method: 'POST', body: { mode: 'codex' } })).data;
  const permissions = { access: 'workspace-write', approval: 'ask' };
  assert.equal((await f.request(`/conversations/${conversation.id}/agent/submit`, { token: member.token, method: 'POST', body: { submissionId: randomUUID(), content: 'Fixture task', hostId: 'central', providerId: f.provider.id, permissions } })).status, 200);
  await until(() => f.calls.length === 1);
  const call = { conversationId: conversation.id, callId: 'fixture-tool', signal: f.calls[0].args.signal }, input = { title: 'Agent created', prompt: 'Fixture scheduled reply', schedule: { kind: 'interval', minutes: 5 }, requestId: randomUUID() };
  const created = await f.tools().execute('petpal_automation_create', input, call), repeated = await f.tools().execute('petpal_automation_create', input, call);
  assert.equal(created.automation.id, repeated.automation.id); assert.deepEqual(created.automation.permissions, permissions); assert.equal(created.automation.providerId, f.provider.id); assert.equal(created.automation.hostId, 'central');
  for (let i = 1; i < 10; i++) await f.tools().execute('petpal_automation_create', { ...input, requestId: randomUUID(), title: `Agent created ${i}` }, call);
  await assert.rejects(f.tools().execute('petpal_automation_create', { ...input, requestId: randomUUID() }, call), { status: 429 });
  await f.request('/automations/preferences', { token: member.token, method: 'PATCH', body: { allowAgentCreate: false } });
  await assert.rejects(f.tools().execute('petpal_automation_create', { ...input, requestId: randomUUID() }, call), { status: 403 });
  const pause = await f.tools().execute('petpal_automation_pause', { id: created.automation.id, revision: created.automation.revision }, call); assert.equal(pause.automation.enabled, false);
  await assert.rejects(f.tools().execute('petpal_automation_create', { ...input, hostId: randomUUID() }, call), { status: 400 });
  f.calls[0].resolve(); await until(async () => (await f.request(`/conversations/${conversation.id}`, { token: member.token })).data.agent.run.status === 'completed');
  await assert.rejects(f.tools().execute('petpal_automation_list', {}, call), /当前实际|任务/);
});

test('remote tools use narrow run credentials and a fixed host rather than client claimed identity', async t => {
  const f = await fixture(t), member = await f.member('remote-schedules');
  const registration = (await f.request('/agent/executors/register', { token: member.token, method: 'POST', body: { deviceId: randomUUID(), name: 'Remote fixture PC', platform: process.platform, arch: process.arch, capabilities: { projectDirectory: true, automations: true } } })).data;
  const conversation = (await f.request('/conversations', { token: member.token, method: 'POST', body: { mode: 'codex' } })).data;
  assert.equal((await f.request(`/conversations/${conversation.id}/agent/submit`, { token: member.token, method: 'POST', body: { submissionId: randomUUID(), content: 'Fixture remote task', hostId: registration.hostId, providerId: f.provider.id, permissions: { access: 'read-only', approval: 'auto' } } })).status, 200);
  const command = (await f.request(`/agent/executors/${registration.connectionId}/poll`, { token: member.token })).data.commands[0]; assert.equal(command.automationTools, true);
  const events = (event, sequence, data = {}) => f.request(`/agent/executors/${registration.connectionId}/events`, { token: member.token, method: 'POST', body: { runId: command.runId, event, sequence, data } });
  await events('started', 1);
  const callback = `/agent/executors/${registration.connectionId}/runs/${command.runId}/automations/tools`, input = { title: 'Remote created', prompt: 'Reply safely', schedule: { kind: 'interval', minutes: 5 }, requestId: randomUUID() }, packet = { callId: 'remote-call', name: 'petpal_automation_create', arguments: input };
  assert.equal((await f.request(callback, { token: member.token, method: 'POST', body: packet })).status, 401);
  const created = await f.request(callback, { token: command.relayToken, method: 'POST', body: packet }); assert.equal(created.status, 200); assert.equal(created.data.automation.hostId, registration.hostId); assert.equal(created.data.automation.providerId, f.provider.id);
  const repeated = await f.request(callback, { token: command.relayToken, method: 'POST', body: packet }); assert.equal(repeated.data.automation.id, created.data.automation.id);
  assert.equal((await f.request('/automations', { token: command.relayToken })).status, 401);
  assert.equal((await f.request(callback, { token: command.relayToken, method: 'POST', body: { ...packet, arguments: { ...input, userId: randomUUID() } } })).status, 400);
  await events('complete', 2, { threadId: randomUUID(), text: '' });
  assert.equal((await f.request(callback, { token: command.relayToken, method: 'POST', body: packet })).status, 401);
});

test('remote ask writes require an authenticated approval from the run account over the complete canonical description', async t => {
  const f = await fixture(t), member = await f.member('remote-approval-schedule');
  const registration = (await f.request('/agent/executors/register', { token: member.token, method: 'POST', body: { deviceId: randomUUID(), name: 'Approval fixture PC', platform: process.platform, arch: process.arch, capabilities: { projectDirectory: true, automations: true } } })).data;
  const conversation = (await f.request('/conversations', { token: member.token, method: 'POST', body: { mode: 'codex' } })).data;
  await f.request(`/conversations/${conversation.id}/agent/submit`, { token: member.token, method: 'POST', body: { submissionId: randomUUID(), content: 'Fixture approval turn', providerId: f.provider.id, hostId: registration.hostId, permissions: { access: 'read-only', approval: 'ask' } } });
  const command = (await f.request(`/agent/executors/${registration.connectionId}/poll`, { token: member.token })).data.commands[0];
  const event = (name, sequence, data = {}) => f.request(`/agent/executors/${registration.connectionId}/events`, { token: member.token, method: 'POST', body: { runId: command.runId, sequence, event: name, data } }); await event('started', 1);
  const callback = `/agent/executors/${registration.connectionId}/runs/${command.runId}/automations/tools`, packet = { callId: 'canonical-call', name: 'petpal_automation_create', arguments: { title: 'Approved task', prompt: 'Full task instruction shown to the user.', schedule: { kind: 'interval', minutes: 5 }, requestId: randomUUID() } };
  assert.equal((await f.request(callback, { token: command.relayToken, method: 'POST', body: packet })).status, 403);
  assert.equal((await event('approval', 2, { id: 'client-approval', kind: 'automation', description: 'Client tries to hide instructions', automation: packet })).status, 200);
  const visible = (await f.request(`/conversations/${conversation.id}`, { token: member.token })).data.agent.approvals[0]; assert.ok(visible.description.includes(packet.arguments.prompt)); assert.ok(visible.description.includes(f.provider.model)); assert.ok(!visible.description.includes('hide instructions'));
  assert.equal((await f.request(`/codex/approvals/${visible.id}`, { method: 'POST', body: { decision: 'accept' } })).status, 404);
  const approval = f.request(`/codex/approvals/${visible.id}`, { token: member.token, method: 'POST', body: { decision: 'accept' } });
  const approvedCommand = (await f.request(`/agent/executors/${registration.connectionId}/poll`, { token: member.token })).data.commands[0]; assert.equal(approvedCommand.decision, 'accept');
  await event('command-result', 3, { commandId: approvedCommand.id, ok: true }); assert.equal((await approval).status, 200);
  assert.equal((await f.request(callback, { token: command.relayToken, method: 'POST', body: { ...packet, arguments: { ...packet.arguments, prompt: 'Hidden changed task' } } })).status, 403);
  const saved = await f.request(callback, { token: command.relayToken, method: 'POST', body: packet }); assert.equal(saved.status, 200); assert.equal(saved.data.automation.permissions.approval, 'ask');
  assert.equal((await f.jobs(member.token)).length, 1); await event('complete', 4, { threadId: randomUUID(), text: '' });
});

test('busy fixed host skips a fresh schedule, while active automation does not revoke itself', async t => {
  const f = await fixture(t), first = await f.create(), second = await f.create();
  assert.equal((await f.request(`/automations/${first.id}/run`, { method: 'POST', body: { requestId: randomUUID() } })).status, 200); await until(() => f.calls.length === 1);
  const result = await f.request(`/automations/${second.id}/run`, { method: 'POST', body: { requestId: randomUUID() } }); assert.equal(result.data.run.status, 'skipped'); assert.match(result.data.run.message, /其他任务/); assert.equal(f.calls[0].args.signal.aborted, false);
  const latest = (await f.jobs()).find(job => job.id === first.id);
  assert.equal((await f.request(`/automations/${first.id}`, { method: 'DELETE', body: { revision: latest.revision } })).status, 200); assert.equal(f.calls[0].args.signal.aborted, true);
  assert.equal((await f.jobs()).some(job => job.id === first.id), false);
});

test('30-result retention prunes only terminal generated results and concurrent notifications do not resurrect them', async t => {
  let ordinaryId;
  const f = await fixture(t, { seed(state, timestamp) {
    ordinaryId = randomUUID();
    state.conversations.push({ id: ordinaryId, userId: state.ownerId, title: 'Ordinary source to preserve', mode: 'chat', providerId: null, messages: [], createdAt: timestamp, updatedAt: timestamp });
  } });
  const job = await f.create(), results = [], deviceId = randomUUID(); let notificationToken;
  for (let i = 0; i < 32; i++) {
    const notification = f.request('/notifications/devices', { method: 'POST', body: { deviceId } });
    const sent = await f.request(`/automations/${job.id}/run`, { method: 'POST', body: { requestId: randomUUID() } }); assert.equal(sent.status, 200);
    results.push(await f.completed(job, i)); const registered = await notification; assert.equal(registered.status, 201); notificationToken = registered.data.token;
  }
  const data = await f.saved(), stored = data.automations.jobs.find(item => item.id === job.id), generated = data.conversations.filter(item => item.automationId === job.id);
  assert.equal(stored.runs.length, 30); assert.equal(generated.length, 30); assert.equal(data.conversations.some(item => item.id === ordinaryId), true);
  assert.equal(data.conversations.some(item => item.id === results[0].conversationId), false); assert.equal(data.conversations.some(item => item.id === results[1].conversationId), false);
  assert.deepEqual(new Set(generated.map(item => item.automationRunId)), new Set(stored.runs.map(item => item.id)));
  const normal = (await f.request('/state')).data.conversations; assert.equal(normal.some(item => item.id === ordinaryId), true); assert.equal(normal.some(item => item.automationId === job.id), false);
  const feed = await f.request('/notifications/device/feed?after=0', { token: notificationToken }); assert.equal(feed.status, 200); assert.equal(feed.data.events.length, 32);
});

test('orphan generated results are visible, read-only and included in the ordinary 200-conversation limit', async t => {
  const orphanJob = randomUUID(); let orphan;
  const f = await fixture(t, { seed(state, timestamp) {
    for (let i = 0; i < 200; i++) { const id = randomUUID(); if (!i) orphan = id; state.conversations.push({ id, userId: state.ownerId, title: 'Orphan result', mode: 'codex', automationId: orphanJob, automationRunId: randomUUID(), codexRevision: state.codexConfig.revision, providerId: null, messages: [], createdAt: timestamp, updatedAt: timestamp }); }
  } });
  assert.equal((await f.request('/state')).data.conversations.length, 200);
  assert.equal((await f.request('/conversations', { method: 'POST', body: { mode: 'chat' } })).status, 400);
  assert.equal((await f.request(`/conversations/${orphan}/agent/submit`, { method: 'POST', body: { submissionId: randomUUID(), content: 'Do not execute' } })).status, 409);
  assert.equal((await f.request(`/conversations/${orphan}/messages`, { method: 'POST', body: { content: 'Do not execute' } })).status, 409);
  assert.equal((await f.request(`/conversations/${orphan}`, { method: 'DELETE', body: {} })).status, 200);
  assert.equal((await f.request('/conversations', { method: 'POST', body: { mode: 'chat' } })).status, 201);
});

test('retention and job deletion preserve generated source conversations referenced by another plan', async t => {
  const f = await fixture(t), parent = await f.create(); let sourceId, child;
  for (let i = 0; i < 32; i++) {
    await f.request(`/automations/${parent.id}/run`, { method: 'POST', body: { requestId: randomUUID() } }); await until(() => f.calls.length > i);
    if (!i) {
      sourceId = f.calls[i].args.conversationId;
      child = (await f.tools().execute('petpal_automation_create', { title: 'Preserve source', prompt: 'Fixture follow-up', schedule: { kind: 'interval', minutes: 5 }, enabled: false, requestId: randomUUID() }, { conversationId: sourceId, signal: f.calls[i].args.signal })).automation;
    }
    await f.completed(parent, i);
  }
  let saved = await f.saved(); assert.equal(saved.conversations.filter(item => item.automationId === parent.id).length, 31); assert.equal(saved.conversations.some(item => item.id === sourceId), true);
  const current = (await f.jobs()).find(item => item.id === parent.id);
  assert.equal((await f.request(`/automations/${parent.id}`, { method: 'DELETE', body: { revision: current.revision } })).status, 200);
  saved = await f.saved(); assert.equal(saved.conversations.filter(item => item.automationId === parent.id).length, 1); assert.equal(saved.conversations[0].id, sourceId);
  assert.equal(saved.automations.jobs.find(item => item.id === child.id).sourceConversationId, sourceId);
  assert.equal((await f.request('/state')).data.conversations.some(item => item.id === sourceId), true);
  assert.equal((await f.request(`/conversations/${sourceId}/agent/submit`, { method: 'POST', body: { submissionId: randomUUID(), content: 'Cannot reuse result' } })).status, 409);
});

function blockAutomationSave(t, dataDir) {
  const original = JsonStore.prototype.save; let release, entered;
  const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; }); let once = true;
  JsonStore.prototype.save = function (operation) {
    if (this.directory === dataDir && operation?.automation && once) {
      once = false; this.queue = this.queue.then(() => gate); entered();
    }
    return original.call(this, operation);
  };
  t.after(() => { release(); JsonStore.prototype.save = original; });
  return { started, release };
}

test('an HTTP create queued behind a disk write is rejected if its login ends before the actual mutation', async t => {
  const f = await fixture(t), member = await f.member('queued-http-schedule'), barrier = blockAutomationSave(t, f.dataDir);
  const creating = f.request('/automations', { token: member.token, method: 'POST', body: f.body() }); await barrier.started;
  const logout = f.request('/auth/logout', { token: member.token, method: 'POST', body: {} });
  await until(async () => (await f.request('/auth/me', { token: member.token })).status === 401);
  barrier.release(); assert.equal((await creating).status, 401); assert.equal((await logout).status, 200);
  assert.equal((await f.saved()).automations.jobs.length, 0); assert.equal(f.calls.length, 0);
});

test('an Agent create already in the disk queue cannot commit after the current turn is stopped', async t => {
  const f = await fixture(t), member = await f.member('queued-tool-schedule'), conversation = (await f.request('/conversations', { token: member.token, method: 'POST', body: { mode: 'codex' } })).data;
  await f.request(`/conversations/${conversation.id}/agent/submit`, { token: member.token, method: 'POST', body: { submissionId: randomUUID(), content: 'Fixture guarded turn', providerId: f.provider.id, permissions: { access: 'read-only', approval: 'auto' } } }); await until(() => f.calls.length === 1);
  const barrier = blockAutomationSave(t, f.dataDir), pending = f.tools().execute('petpal_automation_create', { title: 'Must not persist', prompt: 'Fixture only', schedule: { kind: 'interval', minutes: 5 }, requestId: randomUUID() }, { conversationId: conversation.id, signal: f.calls[0].args.signal });
  const rejected = assert.rejects(pending); await barrier.started;
  const stopping = f.request(`/conversations/${conversation.id}/stop`, { token: member.token, method: 'POST', body: {} }); await until(() => f.calls[0].args.signal.aborted);
  barrier.release(); await rejected; assert.equal((await stopping).status, 200); assert.equal((await f.saved()).automations.jobs.length, 0);
});

test('a remote create queued for persistence cannot commit after its executor connection disconnects', async t => {
  const f = await fixture(t), member = await f.member('queued-remote-schedule');
  const registration = (await f.request('/agent/executors/register', { token: member.token, method: 'POST', body: { deviceId: randomUUID(), name: 'Queued remote fixture', platform: process.platform, arch: process.arch, capabilities: { projectDirectory: true, automations: true } } })).data;
  const conversation = (await f.request('/conversations', { token: member.token, method: 'POST', body: { mode: 'codex' } })).data;
  await f.request(`/conversations/${conversation.id}/agent/submit`, { token: member.token, method: 'POST', body: { submissionId: randomUUID(), content: 'Fixture remote guard', providerId: f.provider.id, hostId: registration.hostId, permissions: { access: 'read-only', approval: 'auto' } } });
  const command = (await f.request(`/agent/executors/${registration.connectionId}/poll`, { token: member.token })).data.commands[0];
  await f.request(`/agent/executors/${registration.connectionId}/events`, { token: member.token, method: 'POST', body: { runId: command.runId, sequence: 1, event: 'started', data: {} } });
  const barrier = blockAutomationSave(t, f.dataDir);
  const creating = f.request(`/agent/executors/${registration.connectionId}/runs/${command.runId}/automations/tools`, { token: command.relayToken, method: 'POST', body: { name: 'petpal_automation_create', callId: 'queued-remote-call', arguments: { title: 'Must not persist remote', prompt: 'Fixture only', schedule: { kind: 'interval', minutes: 5 }, requestId: randomUUID() } } });
  await barrier.started; assert.equal((await f.request(`/agent/executors/${registration.connectionId}`, { token: member.token, method: 'DELETE' })).status, 200); barrier.release();
  assert.ok((await creating).status >= 400); await until(async () => (await f.request(`/conversations/${conversation.id}`, { token: member.token })).data.agent.run.status === 'unknown');
  assert.equal((await f.saved()).automations.jobs.length, 0);
});

test('failed conversation binding compensates only its unsubmitted result and queued old saves do not revive it', async t => {
  const f = await fixture(t), ordinary = (await f.request('/conversations', { method: 'POST', body: { mode: 'chat' } })).data, job = await f.create(), original = JsonStore.prototype.save; let once = true, queuedOldSave;
  JsonStore.prototype.save = function (operation) {
    if (this.directory === f.dataDir && operation?.automation && once && this.state.conversations.some(item => item.automationId === job.id)) {
      once = false;
      // This unrelated save captures the just-created result before compensation.
      queuedOldSave = original.call(this); return Promise.reject(new Error('Fixture binding write failed'));
    }
    return original.call(this, operation);
  };
  t.after(() => { JsonStore.prototype.save = original; });
  assert.equal((await f.request(`/automations/${job.id}/run`, { method: 'POST', body: { requestId: randomUUID() } })).status, 200);
  await until(async () => (await f.jobs()).find(item => item.id === job.id).runs[0]?.status === 'error'); await queuedOldSave;
  const data = await f.saved(); assert.equal(data.conversations.filter(item => item.automationId === job.id).length, 0); assert.equal(data.conversations.some(item => item.id === ordinary.id), true); assert.equal(f.calls.length, 0);
});

test('authorization failure after binding remains a visible error result and deleting the plan cleans it', async t => {
  const f = await fixture(t), job = await f.create(), original = f.app.automations.authorizePrincipal; let once = true;
  f.app.automations.authorizePrincipal = auth => {
    if (once && f.app.automations.list(auth.userId).automations.find(item => item.id === job.id)?.runs[0]?.conversationId) { once = false; throw Object.assign(new Error('Fixture authorization changed after bind'), { status: 401 }); }
    return original(auth);
  };
  assert.equal((await f.request(`/automations/${job.id}/run`, { method: 'POST', body: { requestId: randomUUID() } })).status, 200);
  const current = await until(async () => { const value = (await f.jobs()).find(item => item.id === job.id); return value.runs[0]?.status === 'error' && value; });
  assert.equal(f.calls.length, 0); const result = await f.request(`/conversations/${current.runs[0].conversationId}`); assert.match(result.data.messages[0].error, /未派发/);
  assert.equal((await f.saved()).conversations.find(item => item.id === current.runs[0].conversationId).automationDispatchFailed, true);
  assert.equal((await f.request(`/automations/${job.id}`, { method: 'DELETE', body: { revision: current.revision } })).status, 200);
  assert.equal((await f.saved()).conversations.some(item => item.id === current.runs[0].conversationId), false);
});
