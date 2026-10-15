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

async function until(callback) {
  for (let index = 0; index < 200; index++) { const result = await callback(); if (result) return result; await delay(5); }
  assert.fail('Queue HTTP fixture did not settle');
}

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-agent-queue-api-')), token = randomUUID(), calls = [];
  const store = await new JsonStore(directory).init();
  store.state.codexConfig = { ...defaultCodexConfig(), mode: 'api', baseUrl: 'https://queue.example.test/v1', model: 'fixture-queue-model', apiKey: 'synthetic-queue-only-key' };
  await store.save();
  const codex = {
    async status() { return { available: true, authenticated: true }; },
    run(args) { return new Promise((resolve, reject) => { calls.push({ args, resolve, reject }); args.onEvent('turn', { turnId: `queue-turn-${calls.length}` }); args.signal.addEventListener('abort', () => reject(args.signal.reason), { once: true }); }); },
    async close() { for (const call of calls) call.reject(new Error('Fixture closed')); },
  };
  const app = await createPetServer({ dataDir: directory, token, codex }); await listenFixture(app.server);
  const request = async (route, { method = 'GET', body, authorization = token } = {}) => {
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}/api${route}`, { method, headers: { 'Content-Type': 'application/json', ...(authorization ? { Authorization: `Bearer ${authorization}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  };
  const create = async () => { const result = await request('/conversations', { method: 'POST', body: { mode: 'codex' } }); assert.equal(result.status, 201); return result.data; };
  const submit = (conversation, content) => request(`/conversations/${conversation.id}/agent/submit`, { method: 'POST', body: { submissionId: randomUUID(), content } });
  t.after(async () => { await app.close(); assert.ok(directory.startsWith(path.join(tmpdir(), 'petpal-agent-queue-api-'))); await rm(directory, { recursive: true, force: true }); });
  return { request, create, submit, calls, directory };
}

test('authenticated queue reorder persists only pending order and survives ended submit requests', async t => {
  const f = await fixture(t), conversation = await f.create();
  assert.equal((await f.submit(conversation, 'current task')).status, 200); await until(() => f.calls.length === 1);
  await f.submit(conversation, 'first pending'); await f.submit(conversation, 'second pending');
  const before = (await f.request(`/conversations/${conversation.id}`)).data, entryIds = before.agent.queue.map(entry => entry.id).reverse();
  f.calls[0].args.onEvent('delta', { text: 'a token does not change the order version' });
  const result = await f.request(`/conversations/${conversation.id}/agent/queue/reorder`, { method: 'POST', body: { queueRevision: before.agent.queueRevision, entryIds } });
  assert.equal(result.status, 200); assert.deepEqual(result.data.conversation.agent.queue.map(entry => entry.id), entryIds);
  assert.equal(result.data.conversation.agent.queueRevision, before.agent.queueRevision + 1);
  assert.equal(result.data.conversation.agent.run.id, before.agent.run.id); assert.equal(f.calls.length, 1);
  const saved = JSON.parse(await readFile(path.join(f.directory, 'state.json'), 'utf8')).conversations.find(item => item.id === conversation.id);
  assert.deepEqual(saved.agent.queue.map(entry => entry.id), entryIds);
  f.calls[0].resolve({ text: 'current done' }); await until(() => f.calls.length === 2);
  assert.equal(f.calls[1].args.prompt, 'second pending');
});

test('reorder API rejects unauthenticated callers, foreign conversations and malformed or stale permutations', async t => {
  const f = await fixture(t), conversation = await f.create();
  await f.submit(conversation, 'running'); await until(() => f.calls.length === 1); await f.submit(conversation, 'first'); await f.submit(conversation, 'second');
  const state = (await f.request(`/conversations/${conversation.id}`)).data.agent;
  const route = `/conversations/${conversation.id}/agent/queue/reorder`, body = { queueRevision: state.queueRevision, entryIds: state.queue.map(entry => entry.id).reverse() };
  assert.equal((await f.request(route, { authorization: '', method: 'POST', body })).status, 401);
  const password = randomUUID();
  const user = await f.request('/admin/users', { method: 'POST', body: { username: 'other-queue-user', password, agentAccess: 'full' } }); assert.equal(user.status, 201);
  const login = await f.request('/auth/login', { authorization: '', method: 'POST', body: { username: 'other-queue-user', password } }); assert.equal(login.status, 200);
  assert.equal((await f.request(route, { authorization: login.data.token, method: 'POST', body })).status, 404);
  assert.equal((await f.request(route, { method: 'POST', body: { ...body, entryIds: [] } })).status, 400);
  assert.equal((await f.request(route, { method: 'POST', body: { ...body, queueRevision: state.queueRevision - 1 } })).status, 409);
  assert.equal((await f.request(route, { method: 'POST', body: { ...body, hostId: 'central' } })).status, 400);
  assert.deepEqual((await f.request(`/conversations/${conversation.id}`)).data.agent.queue.map(entry => entry.id), state.queue.map(entry => entry.id));
});

test('reordering a paused queue does not resume or dispatch it', async t => {
  const f = await fixture(t), conversation = await f.create();
  await f.submit(conversation, 'running'); await until(() => f.calls.length === 1); await f.submit(conversation, 'first'); await f.submit(conversation, 'second');
  assert.equal((await f.request(`/conversations/${conversation.id}/stop`, { method: 'POST', body: {} })).status, 200);
  const state = (await f.request(`/conversations/${conversation.id}`)).data.agent;
  assert.equal(state.paused, true);
  const result = await f.request(`/conversations/${conversation.id}/agent/queue/reorder`, { method: 'POST', body: { queueRevision: state.queueRevision, entryIds: state.queue.map(entry => entry.id).reverse() } });
  assert.equal(result.status, 200); assert.equal(result.data.conversation.agent.paused, true);
  await delay(30); assert.equal(f.calls.length, 1);
});
