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
import { approvalReviewCapability } from '../server/approval-review.mjs';
import { listenFixture } from './helpers/loopback.mjs';

const bootstrap = 'independent-review-fixture-owner';
async function until(callback) { for (let i = 0; i < 300; i++) { const value = await callback(); if (value) return value; await delay(5); } assert.fail('Reviewer task did not settle'); }
async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-review-selection-')), dataDir = path.join(directory, 'data');
  const store = await new JsonStore(dataDir).init();
  store.state.codexConfig = { ...defaultCodexConfig(), mode: 'api', baseUrl: 'https://task-model.example/v1', model: 'task-default', apiKey: 'synthetic-task-key' };
  const agent = { id: randomUUID(), name: 'Agent', protocol: 'responses', baseUrl: store.state.codexConfig.baseUrl, model: 'task-assigned', apiKey: 'synthetic-agent-key' };
  const review = { id: randomUUID(), name: 'Review', protocol: 'responses', baseUrl: 'https://review-model.example/v1', model: 'review-assigned', apiKey: 'synthetic-review-key' };
  const foreign = { ...review, id: randomUUID(), name: 'Other review', model: 'review-foreign', apiKey: 'synthetic-other-review-key' };
  const chat = { ...review, id: randomUUID(), name: 'Chat', protocol: 'chat-completions', model: 'chat-only' };
  store.state.providers = [agent, review, foreign, chat]; await store.save();
  const calls = [];
  const codex = { async status() { return { available: true, authenticated: true, approvalReview: approvalReviewCapability(true) }; },
    run(args) { return new Promise((resolve, reject) => { const threadId = args.threadId || randomUUID(); calls.push({ args, threadId, resolve: text => resolve({ threadId, text: text || 'done' }), reject }); args.onEvent('thread', { threadId }); args.onEvent('turn', { turnId: randomUUID() }); args.signal.addEventListener('abort', () => reject(args.signal.reason), { once: true }); }); },
    async close() { for (const call of calls) call.reject(new Error('fixture closed')); } };
  const app = await createPetServer({ dataDir, token: bootstrap, codex }); await listenFixture(app.server);
  const request = async (route, { token = bootstrap, method = 'GET', body } = {}) => {
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}/api${route}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  };
  const member = async () => { const password = 'synthetic-review-password'; const created = await request('/admin/users', { method: 'POST', body: { username: `review-${randomUUID().slice(0, 8)}`, password, agentAccess: 'full', providerIds: [agent.id, review.id, chat.id] } }); assert.equal(created.status, 201); const login = await request('/auth/login', { token: '', method: 'POST', body: { username: created.data.user.username, password } }); assert.equal(login.status, 200); return { user: created.data.user, token: login.data.token }; };
  const create = async (token = bootstrap) => { const response = await request('/conversations', { token, method: 'POST', body: { mode: 'codex' } }); assert.equal(response.status, 201); return response.data; };
  const submit = (conversation, token = bootstrap, extra = {}) => request(`/conversations/${conversation.id}/agent/submit`, { token, method: 'POST', body: { submissionId: randomUUID(), content: 'fixture request', providerId: agent.id, permissions: { access: 'read-only', approval: 'review', reviewProviderId: review.id }, ...extra } });
  const finish = async (conversation, call, token = bootstrap) => { call.resolve(); await until(async () => (await request(`/conversations/${conversation.id}`, { token })).data.agent.run?.status === 'completed'); };
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  return { app, request, member, create, submit, finish, calls, agent, review, foreign, chat, saved: async () => JSON.parse(await readFile(path.join(dataDir, 'state.json'), 'utf8')) };
}

test('authorized reviewer can use a different Responses endpoint and its credentials remain private', async t => {
  const f = await fixture(t), user = await f.member(), state = await f.request('/state', { token: user.token });
  assert.ok(state.data.codex.approvalReviewProviderIds.includes(f.review.id));
  assert.ok(!state.data.codex.approvalReviewProviderIds.includes(f.foreign.id));
  assert.ok(!state.data.codex.approvalReviewProviderIds.includes(f.chat.id));
  assert.ok(!state.data.codex.eligibleProviderIds.includes(f.review.id));
  assert.equal(state.data.codex.approvalReview.independentModel, true);
  const conversation = await f.create(user.token); assert.equal((await f.submit(conversation, user.token)).status, 200); await until(() => f.calls.length === 1);
  const args = f.calls[0].args; assert.deepEqual(args.reviewConfig, { providerId: f.review.id, model: f.review.model, baseUrl: f.review.baseUrl, apiKey: f.review.apiKey, reasoningEffort: '' });
  assert.equal(args.model, f.agent.model); assert.doesNotThrow(args.authorizeReview);
  const visible = (await f.request(`/conversations/${conversation.id}`, { token: user.token })).data;
  assert.equal(visible.agent.run.reviewModel, f.review.model); assert.equal(visible.agent.run.reviewFingerprint, undefined);
  assert.equal(JSON.stringify(visible).includes(f.review.apiKey), false);
  const stored = await until(async () => { const value = (await f.saved()).conversations.find(item => item.id === conversation.id); return value.threadReviewFingerprint && value; });
  assert.equal(JSON.stringify(stored).includes(f.review.apiKey), false); assert.match(stored.threadReviewFingerprint, /^[a-f0-9]{64}$/);
  args.onEvent('delta', { text: `secret=${f.review.apiKey}` }); await f.finish(conversation, f.calls[0], user.token);
  assert.equal((await f.request(`/conversations/${conversation.id}`, { token: user.token })).data.messages.at(-1).content, 'secret=[已隐藏]');
});

test('unknown, unauthorized and Chat-only reviewers are rejected before dispatch while ask keeps the inactive preference', async t => {
  const f = await fixture(t), user = await f.member(), conversation = await f.create(user.token);
  for (const id of [randomUUID(), f.foreign.id, f.chat.id]) {
    const response = await f.submit(conversation, user.token, { permissions: { access: 'read-only', approval: 'review', reviewProviderId: id } });
    assert.equal(response.status, id === f.chat.id ? 400 : 404);
  }
  assert.equal(f.calls.length, 0);
  assert.equal((await f.submit(conversation, user.token, { permissions: { access: 'read-only', approval: 'ask', reviewProviderId: f.review.id } })).status, 200); await until(() => f.calls.length === 1);
  assert.equal(f.calls[0].args.reviewConfig, undefined); assert.equal(f.calls[0].args.authorizeReview, undefined);
  await f.finish(conversation, f.calls[0], user.token);
  assert.equal((await f.submit(conversation, user.token, { permissions: { access: 'read-only', approval: 'review', reviewProviderId: null } })).status, 200); await until(() => f.calls.length === 2);
  assert.deepEqual(f.calls[1].args.permissions, { access: 'read-only', approval: 'review' }); assert.equal(f.calls[1].args.reviewConfig, undefined);
});

test('review configuration is frozen per task and a changed secret or model prevents queued execution', async t => {
  const f = await fixture(t), conversation = await f.create();
  await f.submit(conversation); await until(() => f.calls.length === 1); await f.submit(conversation, bootstrap, { content: 'queued old reviewer' });
  const patched = await f.request('/providers', { method: 'POST', body: { id: f.review.id, apiKey: 'synthetic-review-replaced', model: 'review-replaced' } }); assert.equal(patched.status, 200);
  assert.equal(f.calls[0].args.reviewConfig.apiKey, f.review.apiKey); assert.throws(f.calls[0].args.authorizeReview, { status: 409, code: 'review_config_changed' });
  f.calls[0].resolve();
  const visible = await until(async () => { const value = (await f.request(`/conversations/${conversation.id}`)).data; return value.agent.paused && value.agent.run.status === 'error' && value; });
  assert.equal(f.calls.length, 1); assert.equal(visible.agent.queue.length, 1);
  assert.equal((await f.request(`/conversations/${conversation.id}/agent/queue/resume`, { method: 'POST', body: {} })).status, 409); assert.equal(f.calls.length, 1);
});

test('review grant revocation aborts active review and removes queued work without dispatching it', async t => {
  const f = await fixture(t), user = await f.member(), conversation = await f.create(user.token);
  await f.submit(conversation, user.token); await until(() => f.calls.length === 1); await f.submit(conversation, user.token, { content: 'queued reviewer' });
  const revoked = await f.request(`/admin/users/${user.user.id}`, { method: 'PATCH', body: { providerIds: [f.agent.id] } }); assert.equal(revoked.status, 200);
  assert.equal(f.calls[0].args.signal.aborted, true); assert.throws(f.calls[0].args.authorizeReview); assert.equal(f.calls.length, 1);
  const saved = (await f.saved()).conversations.find(item => item.id === conversation.id); assert.equal(saved.agent.queue.length, 0); assert.equal(saved.agent.paused, true);
});

test('concurrent conversations keep different reviewer providers and secrets scoped to their own run', async t => {
  const f = await fixture(t), a = await f.create(), b = await f.create();
  await Promise.all([f.submit(a), f.submit(b, bootstrap, { permissions: { access: 'read-only', approval: 'review', reviewProviderId: f.foreign.id } })]); await until(() => f.calls.length === 2);
  const aCall = f.calls.find(call => call.args.conversationId === a.id), bCall = f.calls.find(call => call.args.conversationId === b.id);
  assert.equal(aCall.args.reviewConfig.model, f.review.model); assert.equal(aCall.args.reviewConfig.apiKey, f.review.apiKey);
  assert.equal(bCall.args.reviewConfig.model, f.foreign.model); assert.equal(bCall.args.reviewConfig.apiKey, f.foreign.apiKey);
  assert.doesNotThrow(aCall.args.authorizeReview); assert.doesNotThrow(bCall.args.authorizeReview);
});

test('changing the review selection starts a fresh native thread with bounded chat context and same selection resumes it', async t => {
  const f = await fixture(t), conversation = await f.create();
  await f.submit(conversation, bootstrap, { permissions: { approval: 'review' }, content: 'earlier task' }); await until(() => f.calls.length === 1); await f.finish(conversation, f.calls[0]);
  await f.submit(conversation); await until(() => f.calls.length === 2); assert.equal(f.calls[1].args.threadId, undefined); assert.match(f.calls[1].args.prompt, /earlier task/); await f.finish(conversation, f.calls[1]);
  await f.submit(conversation); await until(() => f.calls.length === 3); assert.equal(f.calls[2].args.threadId, f.calls[1].threadId); await f.finish(conversation, f.calls[2]);
  await f.submit(conversation, bootstrap, { permissions: { approval: 'review', reviewProviderId: f.foreign.id } }); await until(() => f.calls.length === 4); assert.equal(f.calls[3].args.threadId, undefined); assert.match(f.calls[3].args.prompt, /earlier task/);
});
