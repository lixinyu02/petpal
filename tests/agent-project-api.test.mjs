import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { listenFixture } from './helpers/loopback.mjs';
import { createPetServer } from '../server/app.mjs';
import { JsonStore } from '../server/store.mjs';
import { defaultCodexConfig } from '../server/codex-config.mjs';
import { resolveProjectDirectory } from '../server/project-directory.mjs';

const bootstrap = 'isolated-project-api-owner';
const password = randomUUID();
async function until(callback) {
  for (let attempt = 0; attempt < 200; attempt++) { const value = await callback(); if (value) return value; await delay(5); }
  assert.fail('Project API fixture did not settle');
}

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-project-api-'));
  const dataDir = path.join(directory, 'data'), workspaceRoot = path.join(directory, 'workspace');
  const inside = path.join(workspaceRoot, 'inside'), outside = path.join(directory, 'outside');
  await Promise.all([mkdir(inside, { recursive: true }), mkdir(outside)]);
  const store = await new JsonStore(dataDir).init();
  store.state.codexConfig = { ...defaultCodexConfig(), mode: 'api', baseUrl: 'https://project-model.example/v1', model: 'fixture-default-agent', apiKey: ['fixture', 'private', 'project', 'key'].join('-') };
  const provider = { id: randomUUID(), name: 'Assigned project agent', protocol: 'responses', baseUrl: store.state.codexConfig.baseUrl, model: 'fixture-member-agent', apiKey: ['fixture', 'private', 'provider'].join('-') };
  store.state.providers = [provider]; await store.save();
  const calls = [], attempts = [];
  const codex = {
    async status() { return { available: true, authenticated: true, workspaceRoot }; },
    async run(args) {
      attempts.push(args);
      const cwd = await resolveProjectDirectory(args.projectDirectory, { workspaceRoot, allowExternal: args.projectAccess === 'full' });
      if (args.signal.aborted) throw args.signal.reason;
      return new Promise((resolve, reject) => {
        calls.push({ args, cwd, resolve, reject });
        args.onEvent('turn', { turnId: `project-turn-${calls.length}` });
        args.signal.addEventListener('abort', () => reject(args.signal.reason), { once: true });
      });
    },
    async close() { for (const call of calls) call.reject(new Error('Fixture closed')); },
  };
  const app = await createPetServer({ dataDir, token: bootstrap, workspaceRoot, codex });
  await listenFixture(app.server);
  const raw = (route, { token = bootstrap, method = 'GET', body } = {}) => fetch(`http://127.0.0.1:${app.server.address().port}/api${route}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const request = async (route, options) => { const response = await raw(route, options); return { status: response.status, data: await response.json() }; };
  const member = async (username, agentAccess) => {
    const created = await request('/admin/users', { method: 'POST', body: { username, password, agentAccess, providerIds: [provider.id] } });
    assert.equal(created.status, 201);
    const login = await request('/auth/login', { token: '', method: 'POST', body: { username, password } }); assert.equal(login.status, 200);
    return { user: created.data.user, token: login.data.token };
  };
  const create = async (token = bootstrap) => { const response = await request('/conversations', { token, method: 'POST', body: { mode: 'codex' } }); assert.equal(response.status, 201); return response.data; };
  const submit = (conversation, token = bootstrap, extra = {}) => request(`/conversations/${conversation.id}/agent/submit`, { token, method: 'POST', body: {
    submissionId: randomUUID(), content: 'Read the test project marker', ...(token !== bootstrap ? { providerId: provider.id } : {}), ...extra,
  } });
  const register = async (token, extra = {}) => {
    const response = await request('/agent/executors/register', { token, method: 'POST', body: { deviceId: randomUUID(), name: 'Fixture project PC', platform: process.platform, arch: process.arch, ...extra } });
    assert.equal(response.status, 200); return response.data;
  };
  t.after(async () => { await app.close(); assert.ok(directory.startsWith(path.join(tmpdir(), 'petpal-project-api-'))); await rm(directory, { recursive: true, force: true }); });
  return { request, raw, member, create, submit, register, calls, attempts, directory, dataDir, workspaceRoot, inside, outside, provider };
}

test('full account grant allows an external project with read-only or workspace-write turn permissions', async t => {
  const f = await fixture(t), member = await f.member('project-full', 'full');
  for (const access of ['read-only', 'workspace-write']) {
    const conversation = await f.create(member.token), count = f.calls.length;
    const accepted = await f.submit(conversation, member.token, { projectDirectory: f.outside, permissions: { access, approval: 'ask' } });
    assert.equal(accepted.status, 200); await until(() => f.calls.length === count + 1);
    const call = f.calls.at(-1); assert.equal(call.args.projectAccess, 'full'); assert.equal(call.args.projectDirectory, f.outside);
    assert.equal(call.cwd, await realpath(f.outside)); assert.equal(call.args.permissions.access, access);
    const visible = (await f.request(`/conversations/${conversation.id}`, { token: member.token })).data;
    assert.equal(visible.agent.run.projectDirectory, f.outside); assert.equal(visible.agent.run.projectAccess, undefined);
  }
});

test('project access is derived from the account; request bodies cannot assert or overwrite the grant', async t => {
  const f = await fixture(t), member = await f.member('project-workspace', 'workspace'), conversation = await f.create(member.token);
  for (const projectAccess of ['full', 'workspace', null]) {
    assert.equal((await f.submit(conversation, member.token, { projectDirectory: f.outside, projectAccess })).status, 400);
  }
  assert.equal(f.attempts.length, 0);
  assert.equal((await f.submit(conversation, member.token, { projectDirectory: f.inside, permissions: { access: 'workspace-write', approval: 'ask' } })).status, 200);
  await until(() => f.calls.length === 1);
  assert.equal(f.calls[0].args.projectAccess, 'workspace'); assert.equal(f.calls[0].cwd, await realpath(f.inside));
  const saved = JSON.parse(await readFile(path.join(f.dataDir, 'state.json'), 'utf8')).conversations.find(item => item.id === conversation.id);
  assert.equal(saved.agent.run.projectDirectory, f.inside);
});

test('workspace account external directory reaches the real resolver and is rejected without default fallback', async t => {
  const f = await fixture(t), member = await f.member('project-boundary', 'workspace'), conversation = await f.create(member.token);
  assert.equal((await f.submit(conversation, member.token, { projectDirectory: f.outside })).status, 200);
  const outcome = await until(async () => {
    const visible = (await f.request(`/conversations/${conversation.id}`, { token: member.token })).data;
    return visible.agent.run?.status === 'error' && visible;
  });
  assert.equal(f.attempts.length, 1); assert.equal(f.attempts[0].projectAccess, 'workspace'); assert.equal(f.calls.length, 0);
  assert.equal(outcome.agent.paused, true); assert.match(outcome.agent.run.error, /外部项目|默认工作区/);
  assert.equal(outcome.agent.run.projectDirectory, f.outside);
});

test('revoking a full account grant stops the external-project run and prevents its queued task', async t => {
  const f = await fixture(t), member = await f.member('project-revoke', 'full'), conversation = await f.create(member.token);
  assert.equal((await f.submit(conversation, member.token, { projectDirectory: f.outside })).status, 200); await until(() => f.calls.length === 1);
  assert.equal((await f.submit(conversation, member.token, { content: 'Must stay unexecuted', projectDirectory: f.outside, permissions: { access: 'workspace-write', approval: 'ask' } })).status, 200);
  const before = (await f.request(`/conversations/${conversation.id}`, { token: member.token })).data;
  assert.equal(before.agent.queue.length, 1); assert.equal(before.agent.queue[0].projectDirectory, f.outside);
  assert.equal((await f.request(`/admin/users/${member.user.id}`, { method: 'PATCH', body: { agentAccess: 'workspace' } })).status, 200);
  assert.equal(f.calls[0].args.signal.aborted, true); assert.equal((await f.request('/auth/me', { token: member.token })).status, 401);
  const saved = JSON.parse(await readFile(path.join(f.dataDir, 'state.json'), 'utf8')).conversations.find(item => item.id === conversation.id);
  assert.equal(saved.agent.queue.length, 0); assert.equal(saved.agent.paused, true); assert.equal(saved.agent.run.status, 'cancelled');
  await delay(20); assert.equal(f.calls.length, 1); assert.equal(f.attempts.length, 1);
});

test('project directory selection rejects foreign computers and old clients before execution', async t => {
  const f = await fixture(t), alice = await f.member('project-alice', 'full'), bob = await f.member('project-bob', 'full');
  const conversation = await f.create(alice.token), foreign = await f.register(bob.token, { capabilities: { projectDirectory: true } }), older = await f.register(alice.token);
  const foreignResult = await f.submit(conversation, alice.token, { hostId: foreign.hostId, projectDirectory: f.outside }); assert.equal(foreignResult.status, 404);
  const olderResult = await f.submit(conversation, alice.token, { hostId: older.hostId, projectDirectory: f.outside }); assert.equal(olderResult.status, 409); assert.match(olderResult.data.error, /升级|不支持/);
  assert.equal(f.attempts.length, 0);
  const hosts = (await f.request('/agent/hosts', { token: alice.token })).data.hosts;
  assert.equal(hosts[0].codex.projectDirectory, true); assert.equal(hosts.find(host => host.id === older.hostId).codex.projectDirectory, false);
});

test('legacy messages cannot silently drop an explicit or remembered project directory', async t => {
  const f = await fixture(t), conversation = await f.create();
  const explicit = await f.raw(`/conversations/${conversation.id}/messages`, { method: 'POST', body: { content: 'Legacy attempt', projectDirectory: f.outside } });
  assert.equal(explicit.status, 409); assert.match((await explicit.json()).error, /项目目录/); assert.equal(f.attempts.length, 0);
  assert.equal((await f.submit(conversation, bootstrap, { projectDirectory: f.outside })).status, 200); await until(() => f.calls.length === 1);
  f.calls[0].resolve({ threadId: 'project-native-thread', text: 'marker read' });
  await until(async () => (await f.request(`/conversations/${conversation.id}`)).data.agent.run?.status === 'completed');
  // Completion is visible before its durable save releases the active slot.
  const remembered = await until(async () => {
    const response = await f.raw(`/conversations/${conversation.id}/messages`, { method: 'POST', body: { content: 'Legacy follow-up with no directory' } });
    assert.equal(response.status, 409); const body = await response.json();
    if (/正在回复/.test(body.error)) return false;
    return body.error;
  });
  assert.match(remembered, /项目目录/); assert.equal(f.attempts.length, 1);
});
