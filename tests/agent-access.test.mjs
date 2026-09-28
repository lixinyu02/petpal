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

const bootstrap = 'isolated-agent-access-bootstrap';
const password = 'isolated-agent-password';
async function until(callback) { for (let i = 0; i < 200; i++) { const result = await callback(); if (result) return result; await delay(5); } assert.fail('Agent HTTP state did not settle'); }
async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-agent-access-'));
  const store = await new JsonStore(directory).init();
  store.state.codexConfig = { ...defaultCodexConfig(), mode: 'api', baseUrl: 'https://agent.example.test/v1', model: 'default-agent', reasoningEffort: 'medium', apiKey: 'private-agent-key' };
  const definitions = [
    ['same', 'responses', 'https://agent.example.test/v1/responses', 'member-model', 'high'],
    ['foreign', 'responses', 'https://different.example.test/v1', 'foreign-model', ''],
    ['chat', 'chat-completions', 'https://agent.example.test/v1', 'chat-model', ''],
    ['unassigned', 'responses', 'https://agent.example.test/v1', 'unassigned-model', 'low'],
  ];
  const providers = Object.fromEntries(definitions.map(([name, protocol, baseUrl, model, reasoningEffort]) => [name, { id: randomUUID(), name, protocol, baseUrl, model, reasoningEffort, apiKey: `private-provider-${name}` }]));
  store.state.providers = Object.values(providers); await store.save();
  const calls = [], approvals = [];
  const codex = { async status() { return { available: true, authenticated: true, workspaceRoot: '/private-owner-workspace', pid: 999, internal: 'owner-only' }; },
    run(args) { return new Promise((resolve, reject) => { const call = { args, resolve, reject }; calls.push(call); args.onEvent('turn', { turnId: `turn-${calls.length}` }); args.signal.addEventListener('abort', () => reject(args.signal.reason), { once: true }); }); },
    async steer() { return { turnId: 'turn-1' }; },
    async approve(...args) { approvals.push(args); return { ok: true }; },
    async close() { for (const call of calls) call.reject(new Error('Fixture closed')); },
  };
  let app = await createPetServer({ dataDir: directory, token: bootstrap, codex });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const request = async (route, { token = bootstrap, method = 'GET', body } = {}) => {
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}/api${route}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  };
  const login = async username => { const result = await request('/auth/login', { token: '', method: 'POST', body: { username, password } }); assert.equal(result.status, 200); return result.data.token; };
  const member = async (username, agentAccess) => {
    const result = await request('/admin/users', { method: 'POST', body: { username, password, ...(agentAccess ? { agentAccess } : {}), providerIds: [providers.same.id, providers.foreign.id, providers.chat.id] } });
    assert.equal(result.status, 201); return { user: result.data.user, token: await login(username) };
  };
  const create = async token => { const result = await request('/conversations', { token, method: 'POST', body: { mode: 'codex' } }); assert.equal(result.status, 201); return result.data; };
  const submit = (chat, token, content = 'fixture task', extra = {}) => request(`/conversations/${chat.id}/agent/submit`, { token, method: 'POST', body: { submissionId: randomUUID(), content, ...extra } });
  t.after(async () => { await app.close(); assert.ok(directory.startsWith(path.join(tmpdir(), 'petpal-agent-access-'))); await rm(directory, { recursive: true, force: true }); });
  return { request, directory, member, create, submit, login, calls, approvals, providers, ownerId: store.state.ownerId,
    restart: async () => { await app.close(); app = await createPetServer({ dataDir: directory, token: bootstrap, codex }); await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); },
  };
}

test('members default to no Agent access and granted members cannot administer config or desktop tools', async t => {
  const f = await fixture(t), denied = await f.member('noagent'), workspace = await f.member('workspace', 'workspace');
  assert.equal(denied.user.agentAccess, 'none'); assert.equal(denied.user.canUseCodex, false);
  assert.equal((await f.request('/conversations', { token: denied.token, method: 'POST', body: { mode: 'codex' } })).status, 403);
  assert.equal((await f.request('/codex/status', { token: denied.token })).status, 403);
  assert.equal(workspace.user.canUseCodex, true);
  for (const [route, method, body] of [['/codex/config', 'PATCH', { model: 'forbidden' }], ['/desktop-tools/status', 'GET'], ['/desktop-tools/action', 'POST', { tool: 'anything', arguments: {} }], ['/admin/users', 'GET']]) assert.equal((await f.request(route, { token: workspace.token, method, body })).status, 403);
  const status = await f.request('/codex/status', { token: workspace.token }); assert.equal(status.status, 200);
  assert.deepEqual(status.data.eligibleProviderIds, [f.providers.same.id]); assert.equal(status.data.workspaceRoot, undefined); assert.equal(status.data.pid, undefined);
  assert.doesNotMatch(JSON.stringify(status.data), /private-agent-key|private-provider|owner-only/);
  const chat = await f.create(workspace.token);
  assert.equal((await f.submit(chat, workspace.token, 'elevated', { permissions: { access: 'full-access', approval: 'auto' } })).status, 403);
  assert.equal((await f.submit(chat, workspace.token, 'work', { permissions: { access: 'workspace-write', approval: 'review' } })).status, 200);
  await until(() => f.calls.length === 1); assert.deepEqual(f.calls[0].args.permissions, { access: 'workspace-write', approval: 'review' });
});

test('full members use only assigned same-upstream Responses models and frozen effort', async t => {
  const f = await fixture(t), member = await f.member('fullmember', 'full'), chat = await f.create(member.token);
  for (const [key, status] of [['foreign', 400], ['chat', 400], ['unassigned', 404]]) assert.equal((await f.submit(chat, member.token, `reject ${key}`, { providerId: f.providers[key].id })).status, status);
  assert.equal(f.calls.length, 0);
  const permissions = { access: 'full-access', approval: 'auto' };
  const accepted = await f.submit(chat, member.token, 'authorized task', { providerId: f.providers.same.id, permissions }); assert.equal(accepted.status, 200);
  await until(() => f.calls.length === 1);
  assert.equal(f.calls[0].args.model, 'member-model'); assert.equal(f.calls[0].args.effort, 'high'); assert.deepEqual(f.calls[0].args.permissions, permissions);
  assert.equal(f.calls[0].args.apiKey, undefined); assert.equal(f.calls[0].args.baseUrl, undefined);
  const polled = await f.request(`/conversations/${chat.id}`, { token: member.token });
  assert.equal(polled.data.agent.run.model, 'member-model'); assert.doesNotMatch(JSON.stringify(polled.data), /sessionHash|fingerprint|private-agent-key|private-provider/);
  // The submit HTTP response has already ended; the detached task still emits output.
  f.calls[0].args.onEvent('delta', { text: 'background output' });
  assert.equal((await f.request(`/conversations/${chat.id}`, { token: member.token })).data.messages.at(-1).content, 'background output');
});

test('member Agent approvals are scoped to their conversation and disappear after stop', async t => {
  const f = await fixture(t), alice = await f.member('agentalice', 'workspace'), bob = await f.member('agentbob', 'full');
  const chat = await f.create(alice.token); await f.submit(chat, alice.token); await until(() => f.calls.length === 1);
  f.calls[0].args.onEvent('approval', { id: 'member-approval', kind: 'command', description: 'confirm fixture' });
  const route = '/codex/approvals/member-approval';
  assert.equal((await f.request(route, { token: bob.token, method: 'POST', body: { decision: 'accept' } })).status, 404);
  assert.equal((await f.request(route, { method: 'POST', body: { decision: 'accept' } })).status, 404);
  assert.equal((await f.request(`/conversations/${chat.id}`, { token: bob.token })).status, 404);
  assert.equal((await f.request(route, { token: alice.token, method: 'POST', body: { decision: 'accept' } })).status, 200); assert.equal(f.approvals.length, 1);
  f.calls[0].args.onEvent('approval', { id: 'member-stale', kind: 'command', description: 'expired fixture' });
  await f.request(`/conversations/${chat.id}/stop`, { token: alice.token, method: 'POST', body: {} });
  assert.equal((await f.request('/codex/approvals/member-stale', { token: alice.token, method: 'POST', body: { decision: 'accept' } })).status, 404);
});

for (const action of ['logout', 'downgrade', 'disable', 'password']) test(`${action} clears pending Agent tasks and revokes running access before the next task`, async t => {
  const f = await fixture(t), member = await f.member(`agent-${action}`, 'full'), chat = await f.create(member.token);
  await f.submit(chat, member.token, 'running'); await until(() => f.calls.length === 1); await f.submit(chat, member.token, 'must never run');
  const result = action === 'logout'
    ? await f.request('/auth/logout', { token: member.token, method: 'POST', body: {} })
    : await f.request(`/admin/users/${member.user.id}`, { method: 'PATCH', body: action === 'downgrade' ? { agentAccess: 'workspace' } : action === 'disable' ? { disabled: true } : { password: 'replacement-agent-password' } });
  assert.equal(result.status, 200); assert.equal(f.calls[0].args.signal.aborted, true);
  assert.equal((await f.request('/auth/me', { token: member.token })).status, 401);
  const saved = JSON.parse(await readFile(path.join(f.directory, 'state.json'), 'utf8')).conversations.find(item => item.id === chat.id);
  assert.equal(saved.agent.queue.length, 0); assert.equal(saved.agent.paused, true); assert.equal(saved.agent.run.status, 'cancelled');
  await delay(15); assert.equal(f.calls.length, 1);
});

test('server restart preserves paused queue and session authorization until explicit resume', async t => {
  const f = await fixture(t), member = await f.member('restartmember', 'workspace'), chat = await f.create(member.token);
  const running = await f.submit(chat, member.token, 'first task'); await until(() => f.calls.length === 1);
  await f.submit(chat, member.token, 'retained task', { permissions: { access: 'workspace-write', approval: 'ask' } });
  await f.restart();
  const polled = await f.request(`/conversations/${chat.id}`, { token: member.token }); assert.equal(polled.status, 200);
  assert.equal(polled.data.agent.queue.length, 1); assert.equal(polled.data.agent.paused, true); assert.equal(f.calls.length, 1);
  const duplicate = await f.request(`/conversations/${chat.id}/agent/submit`, { token: member.token, method: 'POST', body: { submissionId: running.data.submission.submissionId, content: 'first task' } });
  assert.equal(duplicate.status, 200); assert.equal(duplicate.data.submission.status, 'cancelled'); assert.equal(f.calls.length, 1);
  assert.equal((await f.request(`/conversations/${chat.id}/agent/queue/resume`, { token: member.token, method: 'POST', body: {} })).status, 200);
  await until(() => f.calls.length === 2); assert.equal(f.calls[1].args.prompt, 'retained task');
});
