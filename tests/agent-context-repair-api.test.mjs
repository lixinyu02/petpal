import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { createPetServer } from '../server/app.mjs';
import { JsonStore, defaultSettings } from '../server/store.mjs';
import { hashPassword } from '../server/auth.mjs';
import { defaultVoiceSettings } from '../server/voice.mjs';
import { defaultCodexConfig } from '../server/codex-config.mjs';
import { listenFixture } from './helpers/loopback.mjs';

async function until(check) { for (let i = 0; i < 200; i++) { const value = await check(); if (value) return value; await delay(5); } assert.fail('Context API fixture did not settle'); }
async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-context-repair-api-')), token = randomUUID(), password = randomUUID(), calls = [];
  const store = await new JsonStore(directory).init(), memberId = randomUUID(), memberHost = randomUUID();
  store.state.codexConfig = { ...defaultCodexConfig(), mode: 'api', baseUrl: 'https://context.example.test/v1', model: 'fixture-model', apiKey: 'synthetic-context-key-only' };
  store.state.users.push({ id: memberId, username: 'context-member', displayName: 'Context member', role: 'user', agentAccess: 'full', disabled: false, providerIds: [], password: await hashPassword(password), settings: defaultSettings(), voice: defaultVoiceSettings(), createdAt: new Date().toISOString() });
  store.state.executionHosts.push({ id: memberHost, userId: memberId, deviceId: randomUUID(), name: 'Offline context PC', platform: 'win32', arch: 'x64', createdAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() });
  const seed = (userId, hostId) => {
    const id = randomUUID(), runId = randomUUID(), submissionId = randomUUID();
    return { id, userId, mode: 'codex', title: 'Preserved history', customTitle: 'Named old conversation', projectId: null, archivedAt: null, codexRevision: randomUUID(), agentHostId: hostId, agentProjectDirectory: hostId === 'central' ? directory : 'C:\\old-project', threadId: 'old-native-context', threadHostId: hostId, threadProjectDirectory: hostId === 'central' ? directory : 'C:\\old-project', threadCodexRevision: randomUUID(), threadReviewFingerprint: 'a'.repeat(64), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messages: [{ id: randomUUID(), role: 'user', content: 'Old task must not replay', status: 'complete' }, { id: randomUUID(), role: 'assistant', content: 'Existing output', status: 'error' }],
      agent: { revision: 7, queueRevision: 0, paused: true, queue: [], run: { id: runId, submissionId, status: 'error', turnId: null, permissions: { access: 'workspace-write', approval: 'ask' }, providerId: null, model: 'old-model', effort: '', error: 'Missing old context', errorCode: 'thread_context_missing', startedAt: new Date().toISOString() }, submissions: [{ submissionId, entryId: runId, fingerprint: 'b'.repeat(64), status: 'error', content: 'Old task must not replay', attachmentIds: [], createdAt: new Date().toISOString() }] } };
  };
  const ownerConversation = seed(store.state.ownerId, 'central'), memberConversation = seed(memberId, memberHost);
  store.state.conversations.push(ownerConversation, memberConversation); await store.save();
  let mode = 'success';
  const codex = {
    async status() { return { available: true, authenticated: true, configured: true, model: 'fixture-model', mode: 'api' }; },
    run(args) { calls.push(args); if (mode === 'hold') return new Promise((resolve, reject) => { args.onEvent('turn', { turnId: 'held-context-turn' }); args.signal.addEventListener('abort', () => reject(args.signal.reason), { once: true }); }); const threadId = args.threadId || `fresh-context-${calls.length}`; args.onEvent('thread', { threadId }); return Promise.resolve({ threadId, text: 'Synthetic fresh response' }); },
    async close() {},
  };
  const app = await createPetServer({ dataDir: directory, token, codex, desktopTools: { specs: [], async close() {} }, automationOptions: { autoStart: false } }); await listenFixture(app.server);
  const request = async (route, { method = 'GET', body, authorization = token } = {}) => {
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}/api${route}`, { method, headers: { 'Content-Type': 'application/json', ...(authorization ? { Authorization: `Bearer ${authorization}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); return { status: response.status, data: await response.json() };
  };
  const login = await request('/auth/login', { method: 'POST', authorization: '', body: { username: 'context-member', password } }); assert.equal(login.status, 200);
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  return { request, calls, ownerConversation, memberConversation, memberToken: login.data.token, mode(value) { mode = value; } };
}

test('context reset adopts current global config, keeps history and only a later explicit submit starts a fresh CLI task', async t => {
  const f = await fixture(t), id = f.ownerConversation.id, before = (await f.request(`/conversations/${id}`)).data;
  assert.equal(before.codexConfigChanged, true); assert.equal(before.agent.contextRepairNeeded, true);
  assert.equal((await f.request(`/conversations/${id}/agent/submit`, { method: 'POST', body: { submissionId: randomUUID(), content: 'must remain unsent' } })).status, 409);
  const reset = await f.request(`/conversations/${id}/agent/context/reset`, { method: 'POST', body: { revision: before.agent.revision, confirmed: true } }); assert.equal(reset.status, 200);
  const after = reset.data.conversation; assert.equal(after.codexConfigChanged, false); assert.equal(after.agent.contextRepairNeeded, false); assert.equal(after.threadId, undefined); assert.equal(after.threadProjectDirectory, undefined);
  assert.deepEqual(after.messages, before.messages); assert.deepEqual(after.agent.submissions, before.agent.submissions); assert.equal(after.customTitle, before.customTitle); assert.equal(after.agentProjectDirectory, before.agentProjectDirectory); assert.equal(after.agentHostId, before.agentHostId);
  assert.equal(after.agent.run.errorCode, undefined); assert.equal(after.agent.run.error, undefined); assert.match(after.agent.contextNotice, /记忆已重置.*历史已保留.*主动发送.*补充/); assert.equal(f.calls.length, 0);
  const posted = await f.request(`/conversations/${id}/agent/submit`, { method: 'POST', body: { submissionId: randomUUID(), content: 'Only this new explicit task' } }); assert.equal(posted.status, 200);
  await until(() => f.calls.length === 1); assert.equal(f.calls[0].threadId, undefined); assert.equal(f.calls[0].prompt, 'Only this new explicit task');
  await until(async () => (await f.request(`/conversations/${id}`)).data.agent.run.status === 'completed');
});

test('context reset requires login and ownership, preserves host choice, and cannot grant a model or central-computer access', async t => {
  const f = await fixture(t), id = f.memberConversation.id, before = (await f.request(`/conversations/${id}`, { authorization: f.memberToken })).data;
  const route = `/conversations/${id}/agent/context/reset`, body = { revision: before.agent.revision, confirmed: true };
  assert.equal((await f.request(route, { method: 'POST', authorization: '', body })).status, 401);
  assert.equal((await f.request(route, { method: 'POST', body })).status, 404);
  for (const change of [{ confirmed: false }, { confirmed: 'true' }, { revision: -1 }, { model: 'unauthorized-model' }]) assert.equal((await f.request(route, { method: 'POST', authorization: f.memberToken, body: { ...body, ...change } })).status, 400);
  assert.equal((await f.request(route, { method: 'POST', authorization: f.memberToken, body: { ...body, revision: 0 } })).status, 409);
  const reset = await f.request(route, { method: 'POST', authorization: f.memberToken, body }); assert.equal(reset.status, 200);
  assert.equal(reset.data.conversation.agentHostId, before.agentHostId); assert.equal(reset.data.conversation.agentProjectDirectory, before.agentProjectDirectory);
  const denied = await f.request(`/conversations/${id}/agent/submit`, { method: 'POST', authorization: f.memberToken, body: { submissionId: randomUUID(), content: 'Do not gain central access', hostId: 'central', providerId: null } }); assert.equal(denied.status, 403);
  assert.equal(f.calls.length, 0); assert.equal((await f.request(route, { method: 'POST', authorization: f.memberToken, body })).status, 409);
});

test('active and queued tasks block context reset until explicitly stopped and removed', async t => {
  const f = await fixture(t), id = f.ownerConversation.id;
  await f.request(`/conversations/${id}/agent/context/reset`, { method: 'POST', body: { revision: 7, confirmed: true } }); f.mode('hold');
  const submit = content => f.request(`/conversations/${id}/agent/submit`, { method: 'POST', body: { submissionId: randomUUID(), content } });
  assert.equal((await submit('Held current task')).status, 200); await until(() => f.calls.length === 1);
  const active = (await f.request(`/conversations/${id}`)).data;
  assert.equal((await f.request(`/conversations/${id}/agent/context/reset`, { method: 'POST', body: { revision: active.agent.revision, confirmed: true } })).status, 409);
  assert.equal((await submit('Queued task')).status, 200);
  await f.request(`/conversations/${id}/stop`, { method: 'POST', body: {} });
  const stopped = (await f.request(`/conversations/${id}`)).data;
  assert.equal(stopped.agent.queue.length, 1); assert.equal((await f.request(`/conversations/${id}/agent/context/reset`, { method: 'POST', body: { revision: stopped.agent.revision, confirmed: true } })).status, 409);
  assert.equal(f.calls.length, 1);
});
