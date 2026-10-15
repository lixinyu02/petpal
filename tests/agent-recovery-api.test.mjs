import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { createPetServer } from '../server/app.mjs';
import { JsonStore, defaultSettings } from '../server/store.mjs';
import { hashPassword } from '../server/auth.mjs';
import { defaultVoiceSettings } from '../server/voice.mjs';
import { defaultCodexConfig } from '../server/codex-config.mjs';
import { listenFixture } from './helpers/loopback.mjs';

async function until(check) { for (let i = 0; i < 200; i++) { const value = await check(); if (value) return value; await delay(5); } assert.fail('Recovery API fixture did not settle'); }
const permissions = { access: 'workspace-write', approval: 'ask' };
async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-agent-recovery-api-')), bootstrap = randomUUID(), password = randomUUID();
  const seed = await new JsonStore(directory).init(), memberId = randomUUID(), hostId = randomUUID(), calls = [];
  seed.state.codexConfig = { ...defaultCodexConfig(), mode: 'api', baseUrl: 'https://recovery.example.test/v1', model: 'fixture-recovery-model', apiKey: 'synthetic-recovery-only' };
  seed.state.users.push({ id: memberId, username: 'recovery-member', displayName: 'Recovery member', role: 'user', disabled: false, providerIds: [], agentAccess: 'full', password: await hashPassword(password), settings: defaultSettings(), voice: defaultVoiceSettings(), createdAt: new Date().toISOString() });
  seed.state.executionHosts.push({ id: hostId, userId: memberId, deviceId: randomUUID(), name: 'Offline fixture PC', platform: 'win32', arch: 'x64', createdAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() });
  const conversationId = randomUUID(), runId = randomUUID(), extraId = randomUUID(), queuedId = randomUUID();
  const makeReceipt = (entryId, status) => ({ submissionId: randomUUID(), entryId, fingerprint: 'b'.repeat(64), status, content: 'Synthetic recovery task', attachmentIds: [], createdAt: new Date().toISOString() });
  const main = makeReceipt(runId, 'uncertain'), extra = makeReceipt(extraId, 'uncertain'), queued = makeReceipt(queuedId, 'queued');
  const conversation = { id: conversationId, userId: memberId, title: 'Offline recovery task', mode: 'codex', codexRevision: randomUUID(), agentHostId: hostId, threadHostId: hostId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), projectId: null, archivedAt: null, messages: [{ id: randomUUID(), role: 'assistant', content: 'Preserved previous output', status: 'error' }], agent: { revision: 12, queueRevision: 1, paused: true,
    run: { id: runId, submissionId: main.submissionId, status: 'unknown', permissions, providerId: randomUUID(), model: 'removed-model', effort: '', hostId, hostName: 'Offline fixture PC', turnId: 'old-native-turn', startedAt: new Date().toISOString() },
    queue: [{ id: queuedId, submissionId: queued.submissionId, revision: 1, conversationId, content: queued.content, attachmentIds: [], permissions, providerId: null, model: 'old-model', effort: '', hostId, codexRevision: randomUUID(), auth: { userId: memberId, sessionHash: 'expired-old-session', bootstrap: false, generation: 0 }, createdAt: queued.createdAt }], submissions: [main, extra, queued] } };
  seed.state.conversations.push(conversation); await seed.save();
  const codex = {
    async status() { return { available: true, authenticated: true, configured: true, mode: 'api', model: 'fixture-recovery-model' }; },
    run(args) { return new Promise((resolve, reject) => { calls.push({ args, resolve, reject }); args.onEvent('thread', { threadId: 'fixture-native-thread' }); args.onEvent('turn', { turnId: `fixture-turn-${calls.length}` }); args.signal.addEventListener('abort', () => reject(args.signal.reason), { once: true }); }); },
    async close() { for (const call of calls) call.reject(new Error('Fixture closed')); },
  };
  const app = await createPetServer({ dataDir: directory, token: bootstrap, codex, desktopTools: { specs: [], async close() {} }, automationOptions: { autoStart: false } }); await listenFixture(app.server);
  const request = async (route, { method = 'GET', body, token = bootstrap } = {}) => {
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}/api${route}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  };
  const login = await request('/auth/login', { method: 'POST', token: '', body: { username: 'recovery-member', password } }); assert.equal(login.status, 200);
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  return { request, directory, conversationId, runId, extraId, calls, memberToken: login.data.token, read: () => request(`/conversations/${conversationId}`, { token: login.data.token }) };
}

test('owning user can confirm an offline unknown task despite removed model grants and obsolete global configuration', async t => {
  const f = await fixture(t), before = (await f.read()).data;
  const result = await f.request(`/conversations/${f.conversationId}/agent/recover`, { token: f.memberToken, method: 'POST', body: { runId: f.runId, revision: before.agent.revision, confirmedStopped: true } });
  assert.equal(result.status, 200); const after = result.data.conversation;
  assert.equal(after.agent.run.status, 'cancelled'); assert.equal(after.agent.submissions.find(item => item.entryId === f.runId).status, 'cancelled');
  assert.equal(after.agent.submissions.find(item => item.entryId === f.extraId).status, 'uncertain');
  assert.equal(after.agent.paused, true); assert.deepEqual(after.agent.queue, before.agent.queue); assert.deepEqual(after.messages, before.messages);
  assert.match(after.agent.run.error, /用户已确认.*未自动重派/); assert.equal(f.calls.length, 0);
  const saved = JSON.parse(await readFile(path.join(f.directory, 'state.json'), 'utf8')).conversations.find(item => item.id === f.conversationId);
  assert.equal(saved.agent.run.status, 'cancelled'); assert.equal(saved.agent.submissions[1].status, 'uncertain');
  assert.equal(after.codexRevision, before.codexRevision); // Confirmation is not issue-3 context repair.
});

test('recovery endpoint requires login, exact conversation ownership, explicit confirmation and CAS', async t => {
  const f = await fixture(t), before = (await f.read()).data, route = `/conversations/${f.conversationId}/agent/recover`, body = { runId: f.runId, revision: before.agent.revision, confirmedStopped: true };
  assert.equal((await f.request(route, { method: 'POST', token: '', body })).status, 401);
  assert.equal((await f.request(route, { method: 'POST', body })).status, 404); // Administrator is not this conversation's owner.
  for (const change of [{ confirmedStopped: false }, { confirmedStopped: 'true' }, { hostId: 'central' }, { revision: -1 }]) assert.equal((await f.request(route, { method: 'POST', token: f.memberToken, body: { ...body, ...change } })).status, 400);
  assert.equal((await f.request(route, { method: 'POST', token: f.memberToken, body: { ...body, revision: body.revision - 1 } })).status, 409);
  assert.equal((await f.request(route, { method: 'POST', token: f.memberToken, body: { ...body, runId: randomUUID() } })).status, 409);
  assert.deepEqual((await f.read()).data.agent, before.agent); assert.equal(f.calls.length, 0);
  assert.equal((await f.request(route, { method: 'POST', token: f.memberToken, body })).status, 200);
  assert.equal((await f.request(route, { method: 'POST', token: f.memberToken, body })).status, 409);
  const state = (await f.read()).data.agent;
  const second = await f.request(route, { method: 'POST', token: f.memberToken, body: { runId: f.extraId, revision: state.revision, confirmedStopped: true } });
  assert.equal(second.status, 200); assert.equal(second.data.conversation.agent.submissions.find(item => item.entryId === f.extraId).status, 'cancelled'); assert.equal(f.calls.length, 0);
});

test('late events from a confirmed old task cannot alter the next explicitly resumed run', async t => {
  const f = await fixture(t), created = await f.request('/conversations', { method: 'POST', body: { mode: 'codex' } }); assert.equal(created.status, 201);
  const id = created.data.id, submit = content => f.request(`/conversations/${id}/agent/submit`, { method: 'POST', body: { submissionId: randomUUID(), content } });
  assert.equal((await submit('old task')).status, 200); await until(() => f.calls.length === 1); const old = f.calls[0];
  old.reject(Object.assign(new Error('Synthetic remote state unknown'), { code: 'execution_unknown' }));
  const before = await until(async () => { const c = (await f.request(`/conversations/${id}`)).data; return c.agent?.run?.status === 'unknown' && c; });
  await until(async () => {
    const recovery = await f.request(`/conversations/${id}/agent/recover`, { method: 'POST', body: { runId: before.agent.run.id, revision: before.agent.revision, confirmedStopped: true } });
    if (recovery.status === 409) assert.match(recovery.data.error, /当前任务仍在执行/);
    else assert.equal(recovery.status, 200);
    return recovery.status === 200;
  });
  assert.equal((await submit('new explicit task')).status, 200); await delay(15); assert.equal(f.calls.length, 1);
  assert.equal((await f.request(`/conversations/${id}/agent/queue/resume`, { method: 'POST', body: {} })).status, 200); await until(() => f.calls.length === 2);
  const current = (await f.request(`/conversations/${id}`)).data;
  old.args.onEvent('delta', { text: 'must not arrive in the new output' }); old.args.onEvent('approval', { id: 'late-approval', description: 'must remain absent' });
  const after = (await f.request(`/conversations/${id}`)).data;
  assert.equal(after.agent.run.id, current.agent.run.id); assert.equal(after.agent.run.status, 'running'); assert.deepEqual(after.messages, current.messages); assert.deepEqual(after.agent.approvals, []);
  f.calls[1].resolve({ text: 'New task completed', threadId: 'new-native-thread' });
});
