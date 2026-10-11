import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createPetServer } from '../server/app.mjs';
import { JsonStore, defaultSettings } from '../server/store.mjs';
import { hashPassword } from '../server/auth.mjs';
import { defaultCodexConfig } from '../server/codex-config.mjs';
import { DesktopExecutor } from '../desktop/executor.mjs';
import { listenFixture } from './helpers/loopback.mjs';

const password = 'isolated-device-role-password';
const permissions = { access: 'full-access', approval: 'auto' };
const tools = () => ({ specs: [], async close() {}, async status() { return {}; } });
const denied = response => assert.ok([403, 404].includes(response.status), `Expected a denied device scope, received ${response.status}: ${response.text}`);
async function until(check) {
  const deadline = Date.now() + 8000;
  do { const value = await check(); if (value) return value; await delay(15); } while (Date.now() < deadline);
  assert.fail('Role/executor fixture did not settle');
}

async function fixture(t, { seed } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-user-device-roles-'));
  const dataDir = path.join(directory, 'server'), bootstrap = `isolated-roles-${randomUUID()}`;
  const modelRequests = [], centralCalls = [], calls = [], workers = [];
  // The upstream is loopback-only and deterministic. A valid Chat + Agent turn
  // requests a task; unauthorized turns must be rejected before reaching it.
  const upstream = http.createServer(async (req, res) => {
    let raw = ''; for await (const bytes of req) raw += bytes;
    const body = JSON.parse(raw); modelRequests.push(body);
    const taskText = 'Run the isolated device permission fixture.';
    const output = body.tool_choice === 'none'
      ? { status: 'completed', output_text: '任务已派发。' }
      : { status: 'completed', output: [{ type: 'function_call', id: 'fc_device_roles', call_id: 'call_device_roles', name: 'run_agent', arguments: JSON.stringify({ task: taskText }) }] };
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(output));
  });
  await listenFixture(upstream);
  const store = await new JsonStore(dataDir).init();
  const provider = { id: randomUUID(), name: 'Role fixture model', protocol: 'responses', baseUrl: `http://127.0.0.1:${upstream.address().port}/v1`, model: 'role-fixture-model', reasoningEffort: '', supportsImages: true, apiKey: 'isolated-role-provider-secret' };
  store.state.providers = [provider];
  store.state.codexConfig = { ...defaultCodexConfig(), mode: 'api', baseUrl: provider.baseUrl, model: provider.model, apiKey: 'isolated-central-secret' };
  await seed?.(store.state, provider); await store.save();
  const ownerId = store.state.ownerId;
  const centralBridge = {
    async status() { return { available: true, authenticated: true }; }, async close() {},
    async run(args) { centralCalls.push(args); args.onEvent('thread', { threadId: randomUUID() }); return { text: 'Central fixture completed', threadId: randomUUID() }; },
  };
  let app;
  async function start() {
    app = await createPetServer({ dataDir, token: bootstrap, codex: centralBridge, desktopTools: tools(), automationOptions: { autoStart: false } });
    await listenFixture(app.server);
  }
  await start();
  const request = async (route, { token = bootstrap, method = 'GET', body } = {}) => {
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}/api${route}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text(); let data; try { data = JSON.parse(text); } catch {}
    return { status: response.status, data, text };
  };
  const login = async username => {
    const result = await request('/auth/login', { token: '', method: 'POST', body: { username, password } });
    assert.equal(result.status, 200, result.text); return result.data.token;
  };
  const account = async (username, role, extra = {}) => {
    const result = await request('/admin/users', { method: 'POST', body: { username, password, providerIds: [provider.id], ...(role === undefined ? {} : { role }), ...extra } });
    assert.equal(result.status, 201, result.text); return { user: result.data.user, username, token: await login(username) };
  };
  const createConversation = async (token, mode = 'codex') => {
    const result = await request('/conversations', { token, method: 'POST', body: { mode, ...(mode === 'chat' ? { providerId: provider.id } : {}) } });
    assert.equal(result.status, 201, result.text); return result.data;
  };
  const submit = (conversation, token, hostId, content = 'Run a deterministic fixture', extra = {}) => request(`/conversations/${conversation.id}/agent/submit`, { token, method: 'POST', body: { submissionId: randomUUID(), content, providerId: provider.id, permissions, ...(hostId === undefined ? {} : { hostId }), ...extra } });
  const complete = async (conversation, token, submissionId) => until(async () => {
    const result = await request(`/conversations/${conversation.id}`, { token });
    assert.equal(result.status, 200, result.text);
    const run = result.data.agent?.run;
    assert.ok(!['error', 'unknown'].includes(run?.status), JSON.stringify(run));
    return run?.submissionId === submissionId && run.status === 'completed' && result.data;
  });
  const addWorker = async (name, account) => {
    const worker = new DesktopExecutor({ dataDir: path.join(directory, name), name, resolveCommand: async () => ({ file: 'isolated-codex', args: [] }), toolsFactory: tools,
      bridgeFactory(options) {
        let active;
        return {
          async status() { return { available: true, authenticated: true }; },
          async run(args) {
            const call = { name, args, options }; calls.push(call); active = call;
            const threadId = args.threadId || randomUUID(); args.onEvent('thread', { threadId }); args.onEvent('turn', { turnId: randomUUID() });
            if (args.prompt.includes('HOLD')) return new Promise((resolve, reject) => {
              call.finish = () => resolve({ text: `${name} finished`, threadId }); call.reject = reject;
              args.signal.addEventListener('abort', () => reject(args.signal.reason), { once: true });
            });
            args.onEvent('delta', { text: `${name} completed` }); return { text: `${name} completed`, threadId };
          },
          async close() { active?.reject?.(new Error('Isolated worker closed')); },
        };
      },
    });
    workers.push(worker);
    const status = await worker.connect({ url: `http://127.0.0.1:${app.server.address().port}`, token: account.token, instanceId: store.state.instanceId, userId: account.user.id });
    assert.equal(status.state, 'online'); return worker;
  };
  const automationBody = extra => ({ requestId: randomUUID(), title: 'Isolated role schedule', prompt: 'Run the isolated schedule fixture', hostId: 'central', providerId: provider.id, projectDirectory: '', permissions, schedule: { kind: 'interval', minutes: 5 }, enabled: false, ...extra });
  const saved = async () => JSON.parse(await readFile(path.join(dataDir, 'state.json'), 'utf8'));
  const restart = async () => { await Promise.all(workers.map(worker => worker.close())); await app.close(); await start(); };
  const tick = () => app.automations.tick();
  t.after(async () => {
    await Promise.allSettled(workers.map(worker => worker.close())); await app?.close();
    upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve));
    assert.equal(path.dirname(directory), tmpdir()); assert.ok(path.basename(directory).startsWith('petpal-user-device-roles-'));
    await rm(directory, { recursive: true, force: true });
  });
  return { request, account, login, createConversation, submit, complete, addWorker, automationBody, saved, restart, tick, provider, ownerId, calls, centralCalls, modelRequests };
}

test('user/admin accounts expose canonical roles and full Agent access while management stays administrative', async t => {
  const f = await fixture(t), regular = await f.account('roles-default'), admin = await f.account('roles-admin', 'admin');
  assert.deepEqual([regular.user.role, regular.user.isAdmin, regular.user.agentAccess, regular.user.canUseCodex], ['user', false, 'full', true]);
  assert.deepEqual([admin.user.role, admin.user.isAdmin, admin.user.isOwner, admin.user.agentAccess], ['admin', true, false, 'full']);
  for (const value of ['none', 'workspace', 'full']) {
    const legacy = await f.account(`legacy-${value}`, 'member', { agentAccess: value });
    assert.equal(legacy.user.role, 'user'); assert.equal(legacy.user.agentAccess, 'full'); assert.equal(legacy.user.canUseCodex, true);
  }
  denied(await f.request('/admin/users', { token: regular.token }));
  denied(await f.request('/admin/users', { token: regular.token, method: 'POST', body: { username: 'unauthorized', password, role: 'admin' } }));
  denied(await f.request(`/admin/users/${regular.user.id}`, { token: regular.token, method: 'PATCH', body: { role: 'admin' } }));
  assert.equal((await f.request('/admin/users', { token: admin.token })).status, 200);
  for (const body of [{ role: 'user' }, { disabled: true }]) assert.equal((await f.request(`/admin/users/${f.ownerId}`, { token: admin.token, method: 'PATCH', body })).status, 400);
  assert.equal((await f.request(`/admin/users/${f.ownerId}`, { token: admin.token, method: 'PATCH', body: { role: 'admin' } })).status, 200);
  assert.equal((await f.request(`/admin/users/${regular.user.id}`, { method: 'PATCH', body: { role: 'administrator' } })).status, 400);
  assert.equal((await f.request(`/admin/users/${regular.user.id}`, { method: 'PATCH', body: { agentAccess: 'invalid' } })).status, 400);
  assert.equal((await f.request(`/admin/users/${admin.user.id}`, { token: admin.token, method: 'PATCH', body: { role: 'user' } })).status, 200);
  assert.equal((await f.request('/auth/me', { token: admin.token })).status, 401, 'Self downgrade revokes the session that requested it');
});

test('users see only their PC and can run full-access/auto tasks without a central or foreign fallback', { timeout: 20000 }, async t => {
  const f = await fixture(t), alice = await f.account('own-alice'), bob = await f.account('own-bob');
  const empty = await f.request('/agent/hosts', { token: alice.token }); assert.equal(empty.status, 200); assert.deepEqual(empty.data.hosts, []);
  const alicePC = await f.addWorker('Alice-PC', alice), bobPC = await f.addWorker('Bob-PC', bob);
  const hosts = await f.request('/agent/hosts', { token: alice.token });
  assert.deepEqual(hosts.data.hosts.map(host => host.id), [alicePC.status().hostId]); assert.equal(hosts.data.hosts[0].kind, 'desktop');
  assert.doesNotMatch(JSON.stringify(hosts.data), /sessionHash|deviceId|isolated-central-secret|isolated-role-provider-secret/);
  const chat = await f.createConversation(alice.token);
  for (const hostId of ['central', bobPC.status().hostId, undefined]) denied(await f.submit(chat, alice.token, hostId));
  assert.equal(f.calls.length, 0); assert.equal(f.centralCalls.length, 0);
  const own = await f.submit(chat, alice.token, alicePC.status().hostId); assert.equal(own.status, 200, own.text);
  await f.complete(chat, alice.token, own.data.submission.submissionId);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].name, 'Alice-PC'); assert.deepEqual(f.calls[0].args.permissions, permissions);
  const capturedHostId = alicePC.status().hostId; await alicePC.disconnect();
  const disconnected = await f.submit(chat, alice.token, capturedHostId);
  assert.equal(disconnected.status, 409); assert.equal(f.calls.length, 1); assert.equal(f.centralCalls.length, 0);
});

test('user queues cannot overwrite the captured computer and resume only on the authorized PC', { timeout: 20000 }, async t => {
  const f = await fixture(t), alice = await f.account('queue-role-alice'), bob = await f.account('queue-role-bob');
  const alicePC = await f.addWorker('Queue-Role-Alice-PC', alice), bobPC = await f.addWorker('Queue-Role-Bob-PC', bob);
  const chat = await f.createConversation(alice.token), hostId = alicePC.status().hostId;
  assert.equal((await f.submit(chat, alice.token, hostId, 'HOLD to verify the queued device')).status, 200);
  await until(() => f.calls[0]?.finish);
  assert.equal((await f.submit(chat, alice.token, hostId, 'Queued authorized work')).status, 200);
  const queued = (await f.request(`/conversations/${chat.id}`, { token: alice.token })).data.agent.queue[0];
  for (const forbiddenHost of ['central', bobPC.status().hostId]) {
    const changed = await f.request(`/conversations/${chat.id}/agent/queue/${queued.id}`, { token: alice.token, method: 'PATCH', body: { revision: queued.revision, content: 'Must not redirect work', hostId: forbiddenHost } });
    assert.equal(changed.status, 400, changed.text);
  }
  assert.equal((await f.request(`/conversations/${chat.id}/stop`, { token: alice.token, method: 'POST', body: {} })).status, 200);
  assert.equal((await f.request(`/conversations/${chat.id}/agent/queue/resume`, { token: alice.token, method: 'POST', body: {} })).status, 200);
  await f.complete(chat, alice.token, queued.submissionId);
  assert.deepEqual(f.calls.map(call => call.name), ['Queue-Role-Alice-PC', 'Queue-Role-Alice-PC']);
  assert.equal(f.centralCalls.length, 0);
});

test('admins can dispatch on all devices while desktop connection credentials remain session scoped', { timeout: 20000 }, async t => {
  const f = await fixture(t), admin = await f.account('all-admin', 'admin'), alice = await f.account('all-alice'), bob = await f.account('all-bob');
  const alicePC = await f.addWorker('All-Alice-PC', alice), bobPC = await f.addWorker('All-Bob-PC', bob);
  const hosts = await f.request('/agent/hosts', { token: admin.token }); assert.equal(hosts.status, 200);
  assert.deepEqual(new Set(hosts.data.hosts.map(host => host.id)), new Set(['central', alicePC.status().hostId, bobPC.status().hostId]));
  const chat = await f.createConversation(admin.token);
  const foreign = await f.submit(chat, admin.token, alicePC.status().hostId); assert.equal(foreign.status, 200, foreign.text);
  await f.complete(chat, admin.token, foreign.data.submission.submissionId);
  const central = await f.submit(chat, admin.token, 'central'); assert.equal(central.status, 200, central.text);
  await f.complete(chat, admin.token, central.data.submission.submissionId);
  assert.equal(f.calls[0].name, 'All-Alice-PC'); assert.equal(f.centralCalls.length, 1);
  const foreground = await f.createConversation(admin.token, 'chat');
  const assistantReply = await f.request(`/conversations/${foreground.id}/messages`, { token: admin.token, method: 'POST', body: { submissionId: randomUUID(), content: 'Run this on the other account PC', assistant: { enabled: true, hostId: bobPC.status().hostId, providerId: f.provider.id, permissions } } });
  assert.equal(assistantReply.status, 200, assistantReply.text);
  await until(async () => (await f.request(`/conversations/${foreground.id}`, { token: admin.token })).data.assistantTasks?.some(task => task.status === 'completed'));
  assert.equal(f.calls[1].name, 'All-Bob-PC');
  const createdJob = await f.request('/automations', { token: admin.token, method: 'POST', body: f.automationBody({ hostId: alicePC.status().hostId }) });
  assert.equal(createdJob.status, 201, createdJob.text);
  const job = createdJob.data.automation;
  const runJob = await f.request(`/automations/${job.id}/run`, { token: admin.token, method: 'POST', body: { requestId: randomUUID() } });
  assert.equal(runJob.status, 200, runJob.text);
  await until(async () => { await f.tick(); const result = await f.request('/automations', { token: admin.token }); return result.data.automations.find(item => item.id === job.id)?.runs.at(-1)?.status === 'completed'; });
  assert.equal(f.calls[2].name, 'All-Alice-PC');
  const connectionId = alicePC.current.connectionId;
  for (const [method, suffix, body] of [['POST', '/heartbeat', {}], ['GET', '/poll', undefined], ['POST', '/events', { runId: randomUUID(), sequence: 1, event: 'started', data: {} }], ['DELETE', '', undefined]]) {
    denied(await f.request(`/agent/executors/${connectionId}${suffix}`, { token: admin.token, method, body }));
  }
  assert.equal(alicePC.status().state, 'online');
  await f.restart();
  const retained = await f.request(`/conversations/${chat.id}`, { token: admin.token });
  assert.equal(retained.status, 200, retained.text); assert.equal(retained.data.messages.length, 4);
  assert.equal((await f.request('/agent/hosts', { token: admin.token })).data.hosts.length, 3);
  assert.ok((await f.request(`/conversations/${foreground.id}`, { token: admin.token })).data.assistantTasks.some(task => task.status === 'completed'));
  assert.equal((await f.request('/automations', { token: admin.token })).data.automations.find(item => item.id === job.id).runs.at(-1).status, 'completed');
});

test('default targets, Chat+Agent, automation and legacy message routes enforce user device scope', { timeout: 20000 }, async t => {
  const f = await fixture(t), alice = await f.account('paths-alice'), bob = await f.account('paths-bob');
  const alicePC = await f.addWorker('Paths-Alice-PC', alice), bobPC = await f.addWorker('Paths-Bob-PC', bob);
  const chat = await f.createConversation(alice.token, 'chat'), agent = await f.createConversation(alice.token);
  const ownHost = alicePC.status().hostId;
  const ownDefault = await f.request('/settings', { token: alice.token, method: 'PATCH', body: { chatAssistantHostId: ownHost } }); assert.equal(ownDefault.status, 200);
  for (const hostId of ['central', bobPC.status().hostId]) {
    denied(await f.request('/settings', { token: alice.token, method: 'PATCH', body: { chatAssistantHostId: hostId, petName: 'Must not save' } }));
    const after = await f.request('/state', { token: alice.token }); assert.equal(after.data.settings.chatAssistantHostId, ownHost); assert.notEqual(after.data.settings.petName, 'Must not save');
    denied(await f.request(`/conversations/${chat.id}/messages`, { token: alice.token, method: 'POST', body: { submissionId: randomUUID(), content: 'Try the forbidden computer', assistant: { enabled: true, hostId, providerId: f.provider.id, permissions } } }));
    denied(await f.request('/automations', { token: alice.token, method: 'POST', body: f.automationBody({ hostId }) }));
  }
  denied(await f.request(`/conversations/${agent.id}/messages`, { token: alice.token, method: 'POST', body: { content: 'Legacy central execution attempt' } }));
  assert.equal(f.modelRequests.length, 0); assert.equal(f.centralCalls.length, 0); assert.equal(f.calls.length, 0);
  const created = await f.request('/automations', { token: alice.token, method: 'POST', body: f.automationBody({ hostId: ownHost }) }); assert.equal(created.status, 201, created.text);
  denied(await f.request(`/automations/${created.data.automation.id}`, { token: alice.token, method: 'PATCH', body: { revision: created.data.automation.revision, hostId: 'central' } }));
  const response = await f.request(`/conversations/${chat.id}/messages`, { token: alice.token, method: 'POST', body: { submissionId: randomUUID(), content: 'Dispatch the fixture on my selected computer', assistant: { enabled: true, hostId: ownHost, providerId: f.provider.id, permissions } } });
  assert.equal(response.status, 200, response.text); assert.match(response.text, /event: done/);
  const completed = await until(async () => { const result = await f.request(`/conversations/${chat.id}`, { token: alice.token }); return result.data.assistantTasks?.some(task => task.status === 'completed') && result.data; });
  assert.ok(completed.messages.some(message => message.assistantTaskReport === 'result')); assert.equal(f.calls[0].name, 'Paths-Alice-PC'); assert.equal(f.centralCalls.length, 0);
});

test('admin downgrade revokes sessions and cross-account runs but preserves readable history across restart', { timeout: 25000 }, async t => {
  const f = await fixture(t), admin = await f.account('downgrade-admin', 'admin'), alice = await f.account('downgrade-alice');
  const alicePC = await f.addWorker('Downgrade-Alice-PC', alice), foreignHostId = alicePC.status().hostId;
  const chat = await f.createConversation(admin.token);
  assert.equal((await f.request('/settings', { token: admin.token, method: 'PATCH', body: { chatAssistantHostId: foreignHostId } })).status, 200);
  const job = await f.request('/automations', { token: admin.token, method: 'POST', body: f.automationBody({ hostId: foreignHostId }) }); assert.equal(job.status, 201, job.text);
  assert.equal((await f.submit(chat, admin.token, foreignHostId, 'HOLD until administrator loses device rights')).status, 200);
  await until(() => f.calls[0]?.finish);
  assert.equal((await f.submit(chat, admin.token, foreignHostId, 'Queued foreign task must never run')).status, 200);
  const demoted = await f.request(`/admin/users/${admin.user.id}`, { method: 'PATCH', body: { role: 'user' } }); assert.equal(demoted.status, 200, demoted.text);
  assert.equal(demoted.data.user.role, 'user'); assert.equal(demoted.data.user.agentAccess, 'full');
  assert.equal((await f.request('/auth/me', { token: admin.token })).status, 401);
  await until(() => f.calls[0].args.signal.aborted);
  const relayRoute = new URL(f.calls[0].options.config.baseUrl).pathname.replace(/^\/api/, '') + '/responses';
  const relay = await f.request(relayRoute, { token: f.calls[0].options.config.apiKey, method: 'POST', body: { model: f.provider.model, stream: true } });
  assert.equal(relay.status, 401, 'The captured remote relay credential is unusable after administrator downgrade');
  const nextToken = await f.login(admin.username);
  const state = await f.request('/state', { token: nextToken }); assert.equal(state.status, 200, state.text); assert.equal(state.data.settings.chatAssistantHostId, null);
  assert.deepEqual((await f.request('/agent/hosts', { token: nextToken })).data.hosts, []);
  denied(await f.submit(chat, nextToken, foreignHostId)); denied(await f.submit(chat, nextToken, 'central'));
  denied(await f.request(`/automations/${job.data.automation.id}/run`, { token: nextToken, method: 'POST', body: { requestId: randomUUID() } }));
  const history = await f.request(`/conversations/${chat.id}`, { token: nextToken }); assert.equal(history.status, 200, history.text); assert.equal(history.data.agent.queue.length, 0);
  assert.equal(f.calls.length, 1); assert.equal(f.centralCalls.length, 0);
  await f.restart();
  const restored = await f.request(`/conversations/${chat.id}`, { token: nextToken }); assert.equal(restored.status, 200, restored.text);
  assert.equal(restored.data.messages[0].content, 'HOLD until administrator loses device rights');
  assert.equal((await f.request('/state', { token: nextToken })).data.settings.chatAssistantHostId, null);
  assert.equal((await f.saved()).users.find(user => user.id === admin.user.id).role, 'user');
});

test('legacy members migrate to full users and lose central preference without losing old conversations', async t => {
  const legacyId = randomUUID(), conversationId = randomUUID();
  const f = await fixture(t, { seed: async state => {
    state.users.push({ id: legacyId, username: 'migrated-member', displayName: 'Legacy member', role: 'member', agentAccess: 'none', disabled: false, providerIds: state.providers.map(provider => provider.id), password: await hashPassword(password), settings: { ...defaultSettings(), chatAssistantHostId: 'central' }, createdAt: new Date().toISOString() });
    state.conversations.push({ id: conversationId, userId: legacyId, title: 'Historical central task', mode: 'codex', providerId: null, codexRevision: state.codexConfig.revision, agentHostId: 'central', threadHostId: 'central', messages: [{ id: randomUUID(), role: 'assistant', content: 'Keep the old result', status: 'complete', createdAt: new Date().toISOString() }], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  } });
  const token = await f.login('migrated-member'), state = await f.request('/state', { token }); assert.equal(state.status, 200, state.text);
  assert.deepEqual([state.data.user.role, state.data.user.agentAccess, state.data.user.canUseCodex], ['user', 'full', true]);
  assert.equal(state.data.settings.chatAssistantHostId, null); assert.deepEqual((await f.request('/agent/hosts', { token })).data.hosts, []);
  assert.equal(state.data.conversations.find(conversation => conversation.id === conversationId).messages[0].content, 'Keep the old result');
  denied(await f.submit({ id: conversationId }, token, 'central'));
  await f.restart(); assert.equal((await f.request(`/conversations/${conversationId}`, { token })).status, 200);
});
