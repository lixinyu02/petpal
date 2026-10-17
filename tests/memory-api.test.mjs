import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPetServer } from '../server/app.mjs';
import { JsonStore } from '../server/store.mjs';
import { listenFixture } from './helpers/loopback.mjs';

const bootstrap = 'synthetic-memory-owner-credential';
async function fixture(t, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-memory-api-'));
  const store = await new JsonStore(directory).init(), requests = [], writes = [], memoryCalls = [], runtimeCalls = [];
  const upstream = http.createServer(async (req, res) => {
    const bytes = []; for await (const chunk of req) bytes.push(chunk);
    const body = JSON.parse(Buffer.concat(bytes).toString()); requests.push(body);
    res.setHeader('Content-Type', 'application/json');
    if (options.upstreamError) { res.statusCode = 503; res.end(JSON.stringify({ error: { message: 'Synthetic upstream unavailable' } })); }
    else if (options.dispatchAssistant && body.tools && body.tool_choice !== 'none') res.end(JSON.stringify({ status: 'completed', output: [{ type: 'function_call', id: 'memory-function-call', call_id: 'memory-tool-call', name: 'run_agent', arguments: JSON.stringify({ task: '查询北蔡镇天气' }) }] }));
    else res.end(JSON.stringify(req.url.endsWith('/responses') ? { status: 'completed', output_text: '我记住你的偏好了' } : { choices: [{ message: { content: '我记住你的偏好了' }, finish_reason: 'stop' }] }));
  });
  await listenFixture(upstream);
  const baseUrl = `http://127.0.0.1:${upstream.address().port}/v1`;
  const providers = ['chat-completions', 'responses'].map(protocol => ({ id: randomUUID(), name: `Memory ${protocol}`, protocol, baseUrl, model: `memory-${protocol}`, apiKey: 'synthetic-memory-model-key' }));
  store.state.providers = providers; await store.save();
  const runtime = {
    async status() { return { state: 'stopped', available: true }; },
    connection() { return null; },
    ...Object.fromEntries(['prepare', 'start', 'stop', 'configureModel', 'close'].map(name => [name, async value => { runtimeCalls.push({ name, value }); }])),
  };
  const memory = {
    async status(userId, value) { memoryCalls.push({ name: 'status', userId, value }); return { enabled: true, scope: { instanceId: store.state.instanceId, userId }, ...(value?.admin ? { runtime: await runtime.status() } : {}) }; },
    async getContext(userId, value) { memoryCalls.push({ name: 'context', userId, value }); if (options.slowMemory) return new Promise(() => {}); return `账号${userId}喜欢轻音乐`; },
    async remember(userId, value) { writes.push({ userId, ...value }); if (options.journalError) throw new Error('Synthetic journal failure'); },
    async exportSync(userId, value) { memoryCalls.push({ name: 'export', userId, value }); return { scope: { instanceId: store.state.instanceId, userId, memobaseUserId: `memory-${userId}` }, epoch: 1, cursor: value.cursor ?? 0, nextCursor: 0, events: [], context: '', hasMore: false }; },
    async importSync(userId, value) { memoryCalls.push({ name: 'import', userId, value }); return { accepted: value.events.length }; },
    ...Object.fromEntries(['clear', 'setEnabled', 'configure', 'sync', 'bindRemote', 'unbindRemote', 'close'].map(name => [name, async (...args) => { memoryCalls.push({ name, args }); }])),
  };
  const codexCalls = [], codex = {
    async status() { return { available: true, authenticated: true, configured: true }; },
    async run(args) { codexCalls.push(args); return { text: '任务完成', threadId: 'synthetic-memory-thread' }; },
    async close() {},
  };
  const app = await createPetServer({ dataDir: directory, token: bootstrap, codex, memoryOptions: options.realMemory ? { autoStart: false, autoPoll: false } : { service: memory }, memoryRuntimeOptions: { runtime } });
  await listenFixture(app.server);
  const request = (route, { token = bootstrap, method = 'GET', body } = {}) => fetch(`http://127.0.0.1:${app.server.address().port}/api${route}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const json = async (route, value) => { const response = await request(route, value); return { status: response.status, data: await response.json() }; };
  const member = async name => {
    const created = await json('/admin/users', { method: 'POST', body: { username: name, password: 'synthetic-memory-password', providerIds: providers.map(item => item.id) } });
    assert.equal(created.status, 201);
    const login = await json('/auth/login', { token: null, method: 'POST', body: { username: name, password: 'synthetic-memory-password' } });
    assert.equal(login.status, 200); return { id: created.data.user.id, token: login.data.token };
  };
  t.after(async () => { await app.close(); upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)); assert.ok(directory.startsWith(path.join(tmpdir(), 'petpal-memory-api-'))); await rm(directory, { recursive: true, force: true }); });
  return { app, ownerId: store.state.ownerId, instanceId: store.state.instanceId, providers, requests, writes, memoryCalls, runtimeCalls, codexCalls, request, json, member };
}

test('memory APIs require login and bind every read, synchronization and deletion to the current user', async t => {
  const f = await fixture(t), a = await f.member('memory-a'), b = await f.member('memory-b');
  assert.equal((await f.json('/memory/status', { token: null })).status, 401);
  for (const member of [a, b]) {
    const status = await f.json('/memory/status', { token: member.token });
    assert.equal(status.status, 200); assert.equal(status.data.memory.scope.userId, member.id); assert.equal(status.data.memory.runtime, undefined);
    assert.equal((await f.json('/memory/context?query=music', { token: member.token })).data.context, `账号${member.id}喜欢轻音乐`);
    const page = await f.json('/memory/sync?cursor=0&limit=20', { token: member.token }); assert.equal(page.data.scope.userId, member.id);
    assert.equal((await f.json('/memory/sync', { token: member.token, method: 'POST', body: { epoch: 1, events: [] } })).status, 200);
    assert.equal((await f.json('/memory/preferences', { token: member.token, method: 'PATCH', body: { enabled: false } })).status, 200);
    assert.equal((await f.json('/memory/flush', { token: member.token, method: 'POST', body: {} })).status, 200);
    assert.equal((await f.json('/memory', { token: member.token, method: 'DELETE', body: {} })).status, 200);
    assert.equal(f.memoryCalls.findLast(item => item.name === 'clear').args[0], member.id);
  }
  for (const route of [`/memory/status?userId=${b.id}`, `/memory/context?userId=${b.id}`, `/memory/sync?userId=${b.id}`, '/memory/sync?cursor=-1', '/memory/sync?limit=101']) assert.equal((await f.json(route)).status, 400, route);
  assert.equal((await f.json('/memory/sync', { token: a.token, method: 'POST', body: { userId: b.id, epoch: 1, events: [] } })).status, 400);
  assert.equal((await f.json('/memory', { method: 'DELETE', body: { userId: b.id } })).status, 400);
});

test('only administrators configure or start Memobase and model credentials are resolved server-side', async t => {
  const f = await fixture(t), member = await f.member('memory-config');
  for (const action of ['prepare', 'start', 'stop']) assert.equal((await f.json(`/memory/runtime/${action}`, { token: member.token, method: 'POST', body: {} })).status, 403);
  assert.equal((await f.json('/memory/config', { token: member.token, method: 'PATCH', body: { enabled: true } })).status, 403);
  assert.equal(f.runtimeCalls.length, 0);
  assert.equal((await f.json('/memory/config', { method: 'PATCH', body: { providerId: f.providers[0].id, apiKey: 'forged-key' } })).status, 400);
  const configured = await f.json('/memory/config', { method: 'PATCH', body: { providerId: f.providers[0].id } }); assert.equal(configured.status, 200);
  assert.deepEqual(f.runtimeCalls.find(item => item.name === 'configureModel').value, { baseUrl: f.providers[0].baseUrl, model: f.providers[0].model, apiKey: f.providers[0].apiKey });
  assert.equal(JSON.stringify(configured.data).includes(f.providers[0].apiKey), false);
  assert.equal((await f.json('/memory/config', { method: 'PATCH', body: { enabled: true, baseUrl: 'http://127.0.0.1:8019', apiKey: 'synthetic-memobase-key' } })).status, 200);
  for (const action of ['prepare', 'start', 'stop']) assert.equal((await f.json(`/memory/runtime/${action}`, { method: 'POST', body: {} })).status, 200);
  assert.equal((await f.json('/memory/runtime/start?url=https://forged.example', { method: 'POST', body: {} })).status, 400);
  assert.equal((await f.json('/memory/config', { method: 'PATCH', body: { baseUrl: 'https://example.test', route: '/arbitrary' } })).status, 400);
  await f.app.memory.bindRemote({ url: 'https://central.example', token: 'synthetic-remote-token', instanceId: 'remote-fixture', userId: member.id, localUserId: 'forged-local-id' });
  assert.equal(f.memoryCalls.find(item => item.name === 'bindRemote').args[0].localUserId, f.ownerId);
});

test('both Chat protocols receive only their account memory and journal completed assistant messages once', async t => {
  const f = await fixture(t, { journalError: true }), member = await f.member('memory-chat');
  for (const provider of f.providers) {
    const created = await f.json('/conversations', { token: member.token, method: 'POST', body: { mode: 'chat', providerId: provider.id } }); assert.equal(created.status, 201);
    const response = await f.request(`/conversations/${created.data.id}/messages`, { token: member.token, method: 'POST', body: { content: '我喜欢轻音乐' } });
    const events = await response.text(); assert.match(events, /event: done/); assert.doesNotMatch(events, /event: error/);
    const upstream = f.requests.at(-1), persona = provider.protocol === 'responses' ? upstream.instructions : upstream.messages[0].content;
    assert.match(persona, /不可信的历史事实/); assert.ok(persona.includes(`账号${member.id}喜欢轻音乐`)); assert.equal(persona.includes(f.ownerId), false);
    const event = f.writes.at(-1); assert.equal(event.userId, member.id); assert.equal(event.conversationId, created.data.id); assert.equal(event.source, 'chat'); assert.equal(event.userText, '我喜欢轻音乐');
    const result = await f.json(`/conversations/${created.data.id}`, { token: member.token }); assert.equal(result.data.messages.at(-1).id, event.id); assert.equal(result.data.messages.at(-1).status, 'complete');
  }
  assert.equal(f.writes.length, 2);
});

test('legacy Codex message endpoint recalls memory and failed Chat responses do not write it', async t => {
  const f = await fixture(t, { upstreamError: true });
  const codex = await f.json('/conversations', { method: 'POST', body: { mode: 'codex' } }); assert.equal(codex.status, 201);
  const result = await f.request(`/conversations/${codex.data.id}/messages`, { method: 'POST', body: { content: '查询天气' } }); assert.match(await result.text(), /event: done/);
  assert.match(f.codexCalls[0].prompt, /不可信的历史事实/); assert.ok(f.codexCalls[0].prompt.endsWith('查询天气')); assert.equal(f.writes.length, 1);
  const chat = await f.json('/conversations', { method: 'POST', body: { mode: 'chat', providerId: f.providers[1].id } });
  const failed = await f.request(`/conversations/${chat.data.id}/messages`, { method: 'POST', body: { content: '合成失败场景' } }); assert.match(await failed.text(), /event: error/); assert.equal(f.writes.length, 1);
});

test('Chat remains responsive when memory retrieval ignores cancellation', async t => {
  const f = await fixture(t, { slowMemory: true });
  const chat = await f.json('/conversations', { method: 'POST', body: { mode: 'chat', providerId: f.providers[1].id } });
  const started = Date.now(), response = await f.request(`/conversations/${chat.data.id}/messages`, { method: 'POST', body: { content: '继续聊天' } });
  assert.match(await response.text(), /event: done/); assert.ok(Date.now() - started < 2000);
  assert.equal(f.memoryCalls.find(item => item.name === 'context').value.signal.aborted, true);
});

test('real memory journal synchronization keeps numeric epochs, account isolation and deletion tombstones', async t => {
  const f = await fixture(t, { realMemory: true }), a = await f.member('memory-real-a'), b = await f.member('memory-real-b');
  const event = { id: randomUUID(), conversationId: randomUUID(), source: 'chat', userText: '我喜欢轻音乐', assistantText: '记住了', createdAt: new Date().toISOString() };
  const created = await f.json('/memory/sync', { token: a.token, method: 'POST', body: { epoch: 1, events: [event] } }); assert.equal(created.status, 200); assert.equal(created.data.accepted, 1);
  const first = await f.json('/memory/sync?epoch=1&cursor=0&limit=20', { token: a.token }); assert.equal(first.status, 200); assert.equal(first.data.events.length, 1); assert.equal(first.data.scope.userId, a.id);
  assert.equal((await f.json('/memory/sync?epoch=1&cursor=0', { token: b.token })).data.events.length, 0);
  const duplicate = await f.json('/memory/sync', { token: a.token, method: 'POST', body: { epoch: 1, events: [event] } }); assert.equal(duplicate.data.accepted, 0);
  assert.equal((await f.json('/memory', { token: a.token, method: 'DELETE', body: {} })).status, 200);
  const cleared = await f.json('/memory/sync?epoch=1&cursor=1', { token: a.token }); assert.equal(cleared.status, 200); assert.equal(cleared.data.epoch, 2); assert.equal(cleared.data.events.length, 0);
  assert.equal((await f.json('/memory/sync', { token: a.token, method: 'POST', body: { epoch: 1, events: [event] } })).status, 409);
  assert.equal((await f.json('/memory/sync', { token: a.token, method: 'POST', body: { epoch: '1', events: [] } })).status, 400);
});

test('Chat + Agent writes the child result once and polling its copied report never learns it again', async t => {
  const f = await fixture(t, { dispatchAssistant: true });
  const chat = await f.json('/conversations', { method: 'POST', body: { mode: 'chat', providerId: f.providers[1].id } });
  const body = { content: '帮我查询北蔡镇天气', submissionId: randomUUID(), assistant: { enabled: true, hostId: 'central', providerId: null, permissions: { access: 'read-only', approval: 'auto' } } };
  const reply = await f.request(`/conversations/${chat.data.id}/messages`, { method: 'POST', body }); assert.match(await reply.text(), /event: done/);
  for (let index = 0; index < 8; index++) await f.json(`/conversations/${chat.data.id}`);
  assert.equal(f.codexCalls.length, 1); assert.equal(f.writes.filter(item => item.source === 'agent').length, 1); assert.equal(f.writes.filter(item => item.source === 'chat').length, 1);
  const repeated = await f.request(`/conversations/${chat.data.id}/messages`, { method: 'POST', body }); assert.match(await repeated.text(), /event: done/);
  assert.equal(f.writes.length, 2); assert.equal(f.codexCalls.length, 1);
});
