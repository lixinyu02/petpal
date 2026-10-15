import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { deflateSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createPetServer } from '../server/app.mjs';
import { JsonStore } from '../server/store.mjs';
import { defaultCodexConfig } from '../server/codex-config.mjs';
import { DesktopExecutor } from '../desktop/executor.mjs';
import { approvalReviewCapability } from '../server/approval-review.mjs';
import { listenFixture } from './helpers/loopback.mjs';

async function until(fn) { for (let i = 0; i < 300; i++) { const value = await fn(); if (value) return value; await delay(5); } assert.fail('Official task did not settle'); }
function tinyPng() {
  const chunk = (name, data) => { const result = Buffer.alloc(12 + data.length); result.writeUInt32BE(data.length); result.write(name, 4); data.copy(result, 8); let crc = 0xffffffff; for (const byte of result.subarray(4, -4)) { crc ^= byte; for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1; } result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4); return result; };
  const header = Buffer.alloc(13); header.writeUInt32BE(1); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([0, 255, 0, 0, 255]))), chunk('IEND', Buffer.alloc(0))]);
}

async function fixture(t, { api = false, inject = true } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-official-api-')), bootstrap = 'synthetic-official-owner';
  const store = await new JsonStore(directory).init(), ownerId = store.state.ownerId;
  const upstreamRequests = [], calls = [], bridges = [], workers = [], profiles = new Map(), grants = new Map(), controls = { chatGate: null };
  const upstream = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString()); upstreamRequests.push({ body, authorization: req.headers.authorization });
    if (controls.chatGate) await controls.chatGate;
    if (res.destroyed) return;
    const output = body.tool_choice === 'none' ? [{ type: 'message', content: [{ type: 'output_text', text: 'Task dispatched.' }] }]
      : body.tools ? [{ type: 'function_call', call_id: 'official-test-call', name: 'run_agent', arguments: JSON.stringify({ task: 'Open the requested music application' }) }]
      : [{ type: 'message', content: [{ type: 'output_text', text: 'Official fixture response.' }] }];
    res.setHeader('Content-Type', 'text/event-stream');
    res.end(`event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output } })}\n\n`);
  });
  await listenFixture(upstream);
  const baseUrl = `http://127.0.0.1:${upstream.address().port}/v1`;
  const shared = { id: randomUUID(), name: 'Assigned API', protocol: 'responses', baseUrl, model: 'assigned-api-model', apiKey: 'synthetic-shared-key', supportsImages: true };
  store.state.providers.push(shared);
  store.state.codexConfig = { ...defaultCodexConfig(), ...(api ? { mode: 'api', baseUrl, model: shared.model, apiKey: 'synthetic-global-agent-key' } : {}) };
  await store.save();
  const model = (userId, label = 'official-model') => ({ id: randomUUID(), name: `ChatGPT · ${label}`, protocol: 'responses', baseUrl, model: label, apiKey: `synthetic-private-${userId}`, source: 'official-account', officialProfileId: randomUUID(), supportsImages: true, reasoningEffort: '' });
  profiles.set(ownerId, [model(ownerId)]);
  const accounts = {
    providers(userId) { const values = profiles.get(userId) || []; const existing = grants.get(userId) ?? new Map(); for (const provider of values) existing.set(provider.id, { ...provider }); grants.set(userId, existing); return values.map(item => ({ ...item })); },
    providerFor(userId, id) { const provider = grants.get(userId)?.get(id); return provider && { ...provider }; },
  };
  const makeBridge = config => {
    const bridge = {
      config, closed: false,
      async status() { return { available: true, running: true, authenticated: true, ...config, approvalReview: approvalReviewCapability(true) }; },
      run(args) { return new Promise((resolve, reject) => { const threadId = args.threadId || randomUUID(); const call = { bridge, config, args, threadId, resolve: (text = 'Agent finished.') => resolve({ threadId, text }), reject }; calls.push(call); args.onEvent?.('thread', { threadId }); args.onEvent?.('turn', { turnId: randomUUID() }); args.signal?.addEventListener('abort', () => reject(args.signal.reason), { once: true }); }); },
      async close() { bridge.closed = true; for (const call of calls.filter(item => item.bridge === bridge)) call.reject(new Error('Fixture bridge closed')); },
    };
    bridges.push(bridge); return bridge;
  };
  const app = await createPetServer({ dataDir: directory, token: bootstrap, codex: makeBridge(store.state.codexConfig), codexFactory: ({ config }) => makeBridge(config), ...(inject ? { officialAccounts: accounts } : {}), desktopTools: { specs: [], async close() {} }, automationOptions: { autoStart: false } });
  await listenFixture(app.server);
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  const request = (route, { token = bootstrap, method = 'GET', body, raw } = {}) => fetch(`${origin}/api${route}`, { method, headers: { Authorization: `Bearer ${token}`, ...(raw ? { 'Content-Type': 'image/png' } : body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(raw ? { body: raw } : body === undefined ? {} : { body: JSON.stringify(body) }) });
  const json = async (route, options) => { const response = await request(route, options); return { status: response.status, data: await response.json() }; };
  const create = async (mode = 'codex', token = bootstrap, providerId) => { const result = await json('/conversations', { token, method: 'POST', body: { mode, ...(providerId ? { providerId } : {}) } }); assert.equal(result.status, 201); return result.data; };
  const submit = (conversation, providerId, options = {}) => json(`/conversations/${conversation.id}/agent/submit`, { token: options.token || bootstrap, method: 'POST', body: { submissionId: randomUUID(), content: 'Perform fixture task', permissions: { access: 'read-only', approval: 'ask' }, providerId, ...options.body } });
  const finish = async (conversation, call, token = bootstrap) => { call.resolve(); await until(async () => (await json(`/conversations/${conversation.id}`, { token })).data.agent.run?.status === 'completed'); };
  const member = async name => { const password = 'synthetic-member-password'; const created = await json('/admin/users', { method: 'POST', body: { username: name, password, providerIds: [shared.id] } }); assert.equal(created.status, 201); const login = await json('/auth/login', { method: 'POST', body: { username: name, password } }); assert.equal(login.status, 200); profiles.set(created.data.user.id, [model(created.data.user.id)]); return { user: created.data.user, token: login.data.token, provider: profiles.get(created.data.user.id)[0] }; };
  const connect = async user => { const worker = new DesktopExecutor({ dataDir: path.join(directory, `worker-${user.user.id}`), resolveCommand: async () => ({ file: 'fixture-codex', args: [] }), toolsFactory: () => ({ specs: [], async close() {} }), bridgeFactory: ({ config }) => makeBridge(config) }); workers.push(worker); const online = await worker.connect({ url: origin, token: user.token, instanceId: store.state.instanceId, userId: user.user.id }); assert.equal(online.state, 'online'); return online.hostId; };
  t.after(async () => { controls.chatGate = null; await Promise.allSettled(workers.map(worker => worker.close())); await app.close(); upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)); assert.equal(path.dirname(directory), path.resolve(tmpdir())); assert.ok(path.basename(directory).startsWith('petpal-official-api-')); await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  return { app, json, request, create, submit, finish, member, connect, profiles, grants, ownerId, official: profiles.get(ownerId)[0], shared, calls, bridges, upstreamRequests, controls, saved: async () => JSON.parse(await readFile(path.join(directory, 'state.json'), 'utf8')) };
}

test('personal official models remain scoped even to admins and cannot be persisted as shared connections', async t => {
  const f = await fixture(t), a = await f.member('official-a'), b = await f.member('official-b');
  for (const [token, provider, other] of [[undefined, f.official, a.provider], [a.token, a.provider, b.provider], [b.token, b.provider, f.official]]) {
    const state = await f.json('/state', { token }); assert.equal(state.status, 200);
    const personal = state.data.providers.find(item => item.id === provider.id); assert.equal(personal.source, 'official-account'); assert.equal(personal.editable, false); assert.equal(personal.baseUrl, 'https://api.openai.com/v1'); assert.equal(personal.hasApiKey, false);
    assert.ok(!state.data.providers.some(item => item.id === other.id)); assert.ok(state.data.codex.eligibleProviderIds.includes(provider.id));
    assert.equal(JSON.stringify(state.data).includes(provider.apiKey), false); assert.equal(JSON.stringify(state.data).includes(provider.officialProfileId), false); assert.equal(JSON.stringify(state.data).includes(provider.baseUrl), true, 'shared API may expose its own endpoint');
    assert.equal((await f.json('/settings', { token, method: 'PATCH', body: { defaultProviderId: provider.id } })).status, 200);
    assert.equal((await f.json('/settings', { token, method: 'PATCH', body: { defaultProviderId: other.id } })).status, 404);
  }
  assert.equal((await f.json('/providers', { method: 'POST', body: { id: f.official.id, model: 'attacker' } })).status, 400);
  assert.equal((await f.json(`/providers/${f.official.id}`, { method: 'DELETE' })).status, 400);
  assert.equal((await f.json('/providers', { method: 'POST', body: { id: a.provider.id, model: 'attacker' } })).status, 404);
  const saved = await f.saved(); assert.deepEqual(saved.providers.map(item => item.id), [f.shared.id]); assert.equal(JSON.stringify(saved).includes(f.official.apiKey), false);
});

test('unconfigured host can use personal official Chat including images, while missing grants never fall back', async t => {
  const f = await fixture(t), chat = await f.create('chat', undefined, f.official.id);
  const upload = await f.json('/attachments', { method: 'POST', raw: tinyPng() });
  assert.equal(upload.status, 201);
  const response = await f.request(`/conversations/${chat.id}/messages`, { method: 'POST', body: { content: 'Describe this fixture', attachmentIds: [upload.data.id] } }); assert.equal(response.status, 200); assert.match(await response.text(), /Official fixture response/);
  const last = f.upstreamRequests.at(-1); assert.equal(last.authorization, `Bearer ${f.official.apiKey}`); assert.ok(last.body.input[0].content.some(item => item.type === 'input_image'));
  f.profiles.set(f.ownerId, []); assert.equal((await f.request(`/conversations/${chat.id}/messages`, { method: 'POST', body: { content: 'No fallback' } })).status, 404);
  assert.equal(f.upstreamRequests.length, 1);
});

test('official Agent gets a private per-model bridge and changes native threads on identity changes', async t => {
  const f = await fixture(t), conversation = await f.create();
  assert.equal((await f.submit(conversation, f.official.id)).status, 200); await until(() => f.calls.length === 1);
  assert.equal(f.calls[0].config.mode, 'api'); assert.equal(f.calls[0].config.apiKey, f.official.apiKey); assert.equal(f.calls[0].args.model, f.official.model);
  await f.finish(conversation, f.calls[0]);
  assert.equal((await f.submit(conversation, f.official.id)).status, 200); await until(() => f.calls.length === 2); assert.equal(f.calls[1].args.threadId, f.calls[0].threadId); await f.finish(conversation, f.calls[1]);
  const previous = f.official.id; f.profiles.set(f.ownerId, [{ ...f.official, apiKey: 'synthetic-relogged-key' }]); await f.app.officialAccountChanged(f.ownerId, { identityChanged: true, previousProviderIds: [previous] });
  assert.equal(f.calls[0].bridge.closed, true);
  assert.equal((await f.json(`/conversations/${conversation.id}/agent/queue/resume`, { method: 'POST', body: {} })).status, 200);
  assert.equal((await f.submit(conversation, previous)).status, 200); await until(() => f.calls.length === 3); assert.equal(f.calls[2].args.threadId, undefined); assert.match(f.calls[2].args.prompt, /先前的近期聊天记录/); await f.finish(conversation, f.calls[2]);
  const saved = await f.saved(); assert.equal(JSON.stringify(saved).includes(f.official.apiKey), false); assert.equal(JSON.stringify(saved).includes('synthetic-relogged-key'), false); assert.match(saved.conversations[0].threadCodexRevision, /^[a-f0-9-]{36}$/);
});

test('official models enable own-PC execution without granting ordinary users central or other PCs', async t => {
  const f = await fixture(t), a = await f.member('pc-a'), b = await f.member('pc-b'), hostA = await f.connect(a), hostB = await f.connect(b);
  const conversation = await f.create('codex', a.token);
  assert.equal((await f.submit(conversation, a.provider.id, { token: a.token })).status, 403);
  assert.equal((await f.submit(conversation, a.provider.id, { token: a.token, body: { hostId: hostB } })).status, 403);
  assert.equal((await f.submit(conversation, b.provider.id, { token: a.token, body: { hostId: hostA } })).status, 404);
  assert.equal((await f.submit(conversation, a.provider.id, { token: a.token, body: { hostId: hostA } })).status, 200); await until(() => f.calls.length === 1);
  assert.equal(f.calls[0].args.model, a.provider.model); assert.notEqual(f.calls[0].config.apiKey, a.provider.apiKey); assert.match(f.calls[0].config.baseUrl, /\/runs\//);
  await f.finish(conversation, f.calls[0], a.token);
});

test('official reviewer works with API Agent and scoped logout cancels only related work and queues', async t => {
  const f = await fixture(t, { api: true }), officialChat = await f.create('chat', undefined, f.official.id), official = await f.create(), api = await f.create(), reviewed = await f.create();
  assert.equal((await f.submit(official, f.official.id)).status, 200); assert.equal((await f.submit(api, f.shared.id)).status, 200);
  assert.equal((await f.submit(reviewed, f.shared.id, { body: { permissions: { access: 'read-only', approval: 'review', reviewProviderId: f.official.id } } })).status, 200); await until(() => f.calls.length === 3);
  const ownCall = f.calls.find(call => call.args.conversationId === official.id), apiCall = f.calls.find(call => call.args.conversationId === api.id), reviewCall = f.calls.find(call => call.args.conversationId === reviewed.id);
  assert.equal(reviewCall.args.reviewConfig.apiKey, f.official.apiKey); assert.doesNotThrow(reviewCall.args.authorizeReview);
  assert.equal((await f.submit(official, f.official.id)).status, 200); assert.equal((await f.submit(api, f.shared.id)).status, 200);
  f.profiles.set(f.ownerId, []); await f.app.officialAccountChanged(f.ownerId, { identityChanged: true, previousProviderIds: [f.official.id] });
  assert.equal(ownCall.args.signal.aborted, true); assert.equal(reviewCall.args.signal.aborted, true); assert.equal(apiCall.args.signal.aborted, false);
  assert.equal((await f.json(`/conversations/${official.id}`)).data.agent.queue.length, 0);
  await f.finish(api, apiCall); await until(() => f.calls.length === 4); await f.finish(api, f.calls[3]);
  assert.equal((await f.json(`/conversations/${api.id}`)).data.agent.run.status, 'completed');
  assert.equal((await f.request(`/conversations/${officialChat.id}/messages`, { method: 'POST', body: { content: 'No stale provider' } })).status, 404);
});

test('official Chat can dispatch official Agent and create automation while global Codex is host mode', async t => {
  const f = await fixture(t), chat = await f.create('chat', undefined, f.official.id);
  const response = await f.request(`/conversations/${chat.id}/messages`, { method: 'POST', body: { content: 'Open music', submissionId: randomUUID(), assistant: { enabled: true, hostId: 'central', providerId: f.official.id, permissions: { access: 'read-only', approval: 'ask' } } } });
  assert.equal(response.status, 200); assert.match(await response.text(), /Task dispatched/); await until(() => f.calls.length === 1);
  const visible = (await f.json(`/conversations/${chat.id}`)).data; assert.equal(visible.assistantTasks.length, 1); const child = (await f.json(`/conversations/${visible.assistantTasks[0].conversationId}`)).data; await f.finish(child, f.calls[0]);
  const created = await f.json('/automations', { method: 'POST', body: { requestId: randomUUID(), title: 'Official fixed task', prompt: 'Perform fixture task', hostId: 'central', providerId: f.official.id, permissions: { access: 'read-only', approval: 'ask' }, schedule: { kind: 'interval', minutes: 5 } } }); assert.equal(created.status, 201);
  const run = await f.json(`/automations/${created.data.automation.id}/run`, { method: 'POST', body: { requestId: randomUUID() } }); assert.equal(run.status, 200); await until(() => f.calls.length === 2); f.calls[1].resolve();
});

test('servers without official account injection preserve their provider and Agent behavior', async t => {
  const f = await fixture(t, { inject: false }), state = await f.json('/state'); assert.deepEqual(state.data.providers.map(item => item.id), [f.shared.id]); assert.deepEqual(state.data.codex.eligibleProviderIds, []); assert.equal(state.data.codex.mode, 'host');
  const conversation = await f.create(); assert.equal((await f.submit(conversation, f.official.id)).status, 404); assert.equal(f.calls.length, 0);
});

test('a failed same-identity catalog refresh hides new grants while existing runs and queues continue', async t => {
  const f = await fixture(t), user = await f.member('refresh-pc'), hostId = await f.connect(user), conversation = await f.create('codex', user.token);
  const options = { token: user.token, body: { hostId, permissions: { access: 'read-only', approval: 'review', reviewProviderId: user.provider.id } } };
  assert.equal((await f.submit(conversation, user.provider.id, options)).status, 200); await until(() => f.calls.length === 1);
  assert.equal((await f.submit(conversation, user.provider.id, options)).status, 200);
  f.profiles.set(user.user.id, []); await f.app.officialAccountChanged(user.user.id, { identityChanged: false });
  const state = await f.json('/state', { token: user.token }); assert.ok(!state.data.providers.some(provider => provider.id === user.provider.id));
  const denied = await f.submit(conversation, user.provider.id, options); assert.ok([404, 409].includes(denied.status));
  assert.equal(f.calls[0].args.signal.aborted, false);
  f.calls[0].resolve(); await until(() => f.calls.length === 2); assert.equal(f.calls[1].args.model, user.provider.model); assert.equal(f.calls[1].args.signal.aborted, false); await f.finish(conversation, f.calls[1], user.token);
});

test('official identity revocation aborts a still-deciding Chat plus Agent before any task can be dispatched', async t => {
  const f = await fixture(t, { api: true }), chat = await f.create('chat', undefined, f.shared.id);
  let release; f.controls.chatGate = new Promise(resolve => { release = resolve; }); t.after(() => release());
  const response = await f.request(`/conversations/${chat.id}/messages`, { method: 'POST', body: { content: 'Open music', submissionId: randomUUID(), assistant: { enabled: true, hostId: 'central', providerId: f.official.id, permissions: { access: 'read-only', approval: 'ask' } } } });
  const text = response.text(); await until(() => f.upstreamRequests.length === 1);
  f.profiles.set(f.ownerId, []); f.grants.delete(f.ownerId);
  await f.app.officialAccountChanged(f.ownerId, { identityChanged: true, previousProviderIds: [f.official.id] }); release(); await text;
  const result = (await f.json(`/conversations/${chat.id}`)).data;
  assert.equal(result.assistantTasks[0].status, 'cancelled'); assert.equal(result.messages.at(-1).status, 'cancelled'); assert.equal(f.calls.length, 0);
});

test('having an unrelated official account does not enable an independent reviewer for the host-login Agent', async t => {
  const f = await fixture(t), conversation = await f.create(), permissions = { access: 'read-only', approval: 'review', reviewProviderId: f.official.id };
  const rejected = await f.submit(conversation, null, { body: { permissions } }); assert.equal(rejected.status, 400); assert.equal(f.calls.length, 0);
  const chat = await f.create('chat', undefined, f.shared.id);
  const response = await f.request(`/conversations/${chat.id}/messages`, { method: 'POST', body: { content: 'Open music', submissionId: randomUUID(), assistant: { enabled: true, hostId: 'central', providerId: null, permissions } } });
  await response.text(); assert.equal(f.calls.length, 0); assert.equal(f.upstreamRequests.length, 0);
  assert.equal((await f.submit(conversation, f.official.id, { body: { permissions } })).status, 200); await until(() => f.calls.length === 1); await f.finish(conversation, f.calls[0]);
});
