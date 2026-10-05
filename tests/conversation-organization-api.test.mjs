import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { listenFixture } from './helpers/loopback.mjs';
import { createPetServer } from '../server/app.mjs';
import { JsonStore } from '../server/store.mjs';
import { defaultCodexConfig } from '../server/codex-config.mjs';

const bootstrap = randomUUID(), password = randomUUID();
async function until(check) { for (let index = 0; index < 250; index++) { const value = await check(); if (value) return value; await delay(5); } assert.fail('Organization API fixture did not settle'); }
async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-conversation-org-api-'));
  const control = { gate: null, requested: false }, calls = [];
  const upstream = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString()); control.requested = true;
    if (control.gate) await control.gate;
    res.setHeader('Content-Type', 'application/json');
    if (body.tools && body.tool_choice !== 'none') res.end(JSON.stringify({ status: 'completed', output: [{ type: 'function_call', id: 'fc_fixture', call_id: 'call_fixture', name: 'run_agent', arguments: JSON.stringify({ task: '打开电脑上的音乐软件' }) }] }));
    else res.end(JSON.stringify({ status: 'completed', output_text: '收到，我在这里。' }));
  });
  await listenFixture(upstream);
  const store = await new JsonStore(directory).init();
  const provider = { id: randomUUID(), name: 'Fixture Chat', protocol: 'responses', baseUrl: `http://127.0.0.1:${upstream.address().port}/v1`, model: 'fixture-chat-model', apiKey: randomUUID() };
  const agentProvider = { ...provider, id: randomUUID(), name: 'Fixture Agent', baseUrl: 'https://organization.example.test/v1' };
  store.state.providers = [provider, agentProvider]; store.state.codexConfig = { ...defaultCodexConfig(), mode: 'api', baseUrl: agentProvider.baseUrl, model: agentProvider.model, apiKey: randomUUID() }; await store.save();
  const codex = { async status() { return { available: true, configured: true, authenticated: true }; }, run(args) { return new Promise((resolve, reject) => { calls.push({ args, resolve, reject }); args.onEvent('turn', { turnId: `fixture-${calls.length}` }); args.signal.addEventListener('abort', () => reject(args.signal.reason), { once: true }); }); }, async close() { for (const call of calls) call.reject(new Error('closed fixture')); } };
  const backend = await createPetServer({ dataDir: directory, token: bootstrap, codex, automationOptions: { autoStart: false } }); await listenFixture(backend.server);
  const raw = (route, { token = bootstrap, method = 'GET', body } = {}) => fetch(`http://127.0.0.1:${backend.server.address().port}/api${route}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const request = async (route, options) => { const response = await raw(route, options); return { status: response.status, data: await response.json() }; };
  const project = async (name = '工作', token = bootstrap) => { const response = await request('/projects', { token, method: 'POST', body: { name } }); assert.equal(response.status, 201); return response.data; };
  const create = async (mode = 'chat', extra = {}, token = bootstrap) => { const response = await request('/conversations', { token, method: 'POST', body: { mode, ...(mode === 'chat' ? { providerId: provider.id } : {}), ...extra } }); assert.equal(response.status, 201); return response.data; };
  const organize = (id, body, token = bootstrap) => request(`/conversations/${id}/organization`, { token, method: 'PATCH', body });
  const submit = (id, token = bootstrap) => request(`/conversations/${id}/agent/submit`, { token, method: 'POST', body: { submissionId: randomUUID(), content: 'fixture task', ...(token !== bootstrap ? { providerId: agentProvider.id } : {}) } });
  const member = async name => { const created = await request('/admin/users', { method: 'POST', body: { username: name, password, agentAccess: 'full', providerIds: [provider.id, agentProvider.id] } }); assert.equal(created.status, 201); const login = await request('/auth/login', { token: '', method: 'POST', body: { username: name, password } }); assert.equal(login.status, 200); return { token: login.data.token, user: created.data.user }; };
  t.after(async () => { control.gate = null; await backend.close(); upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)); assert.ok(directory.startsWith(path.join(tmpdir(), 'petpal-conversation-org-api-'))); await rm(directory, { recursive: true, force: true }); });
  return { directory, backend, raw, request, create, organize, project, submit, member, calls, control, provider, agentProvider };
}

test('projects and organization preserve models, messages and Agent directory while persisting reload', async t => {
  const f = await fixture(t), project = await f.project('  音乐  '), chat = await f.create('chat', { projectId: project.id }), agent = await f.create('codex', { projectId: project.id });
  assert.equal(project.name, '音乐'); assert.equal(project.userId, undefined); assert.equal(chat.archivedAt, null); assert.equal(chat.projectId, project.id);
  const changed = await f.organize(agent.id, { title: '电脑助手', archived: true }); assert.equal(changed.status, 200); assert.equal(changed.data.title, '电脑助手'); assert.equal(changed.data.customTitle, '电脑助手'); assert.ok(changed.data.archivedAt); assert.equal(changed.data.projectId, project.id);
  assert.equal((await f.organize(agent.id, { archived: false, projectId: null })).data.archivedAt, null);
  await f.organize(chat.id, { title: '手动名称' });
  const message = await f.raw(`/conversations/${chat.id}/messages`, { method: 'POST', body: { content: '自动摘要不该覆盖手动名称' } }); assert.equal(message.status, 200); await message.text();
  const visible = (await f.request(`/conversations/${chat.id}`)).data; assert.equal(visible.title, '手动名称'); assert.equal(visible.providerId, f.provider.id); assert.equal(visible.messages.length, 2);
  assert.equal((await f.request(`/conversations/${chat.id}`, { method: 'PATCH', body: { providerId: f.agentProvider.id } })).status, 200);
  assert.equal((await f.request(`/conversations/${agent.id}`, { method: 'PATCH', body: { providerId: f.agentProvider.id } })).status, 400);
  await f.request(`/projects/${project.id}`, { method: 'PATCH', body: { name: '新版音乐' } });
  const state = (await f.request('/state')).data; assert.equal(state.projects[0].name, '新版音乐'); assert.equal(state.projects[0].userId, undefined);
  const reload = await new JsonStore(f.directory).init(); assert.equal(reload.state.projects[0].name, '新版音乐'); assert.equal(reload.state.conversations.find(item => item.id === chat.id).customTitle, '手动名称');
  assert.equal((await f.request(`/projects/${project.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await f.request(`/conversations/${chat.id}`)).data.projectId, null);
  assert.equal((await f.request(`/conversations/${chat.id}`)).data.messages.length, 2);
});

test('project and conversation APIs enforce account isolation and login', async t => {
  const f = await fixture(t), first = await f.member('organization-one'), second = await f.member('organization-two');
  const project = await f.project('私有项目', first.token), chat = await f.create('chat', { projectId: project.id }, first.token);
  assert.deepEqual((await f.request('/state', { token: second.token })).data.projects, []);
  for (const method of ['PATCH', 'DELETE']) assert.equal((await f.request(`/projects/${project.id}`, { token: second.token, method, ...(method === 'PATCH' ? { body: { name: '窃取' } } : {}) })).status, 404);
  assert.equal((await f.organize(chat.id, { title: '窃取' }, second.token)).status, 404);
  assert.equal((await f.request('/conversations', { token: second.token, method: 'POST', body: { mode: 'chat', providerId: f.provider.id, projectId: project.id } })).status, 404);
  assert.equal((await f.request('/projects', { token: '', method: 'POST', body: { name: '未登录' } })).status, 401);
  assert.equal((await f.request(`/conversations/${chat.id}`, { token: second.token, method: 'DELETE' })).status, 404);
});

test('archive and rename are allowed during Agent work but deletion rejects running and queued tasks', async t => {
  const f = await fixture(t), agent = await f.create('codex'); assert.equal((await f.submit(agent.id)).status, 200); await until(() => f.calls.length === 1);
  assert.equal((await f.organize(agent.id, { title: '执行中的任务', archived: true })).status, 200);
  assert.equal(f.calls[0].args.signal.aborted, false); assert.equal((await f.request(`/conversations/${agent.id}`, { method: 'DELETE' })).status, 409);
  assert.equal((await f.submit(agent.id)).status, 200); assert.equal((await f.request(`/conversations/${agent.id}`, { method: 'DELETE' })).status, 409);
  const stopped = await f.request(`/conversations/${agent.id}/stop`, { method: 'POST', body: {} }); assert.equal(stopped.status, 200);
  // Stopping keeps queued work; deleting cannot silently clear it.
  assert.equal((await f.request(`/conversations/${agent.id}`, { method: 'DELETE' })).status, 409);
  const entry = (await f.request(`/conversations/${agent.id}`)).data.agent.queue[0];
  assert.equal((await f.request(`/conversations/${agent.id}/agent/queue/${entry.id}`, { method: 'DELETE', body: { revision: entry.revision } })).status, 200);
  assert.equal((await f.request(`/conversations/${agent.id}`, { method: 'DELETE' })).status, 200); assert.equal((await f.request(`/conversations/${agent.id}`)).status, 404);
});

test('foreground Chat work can be archived without cancellation and cannot be deleted', async t => {
  const f = await fixture(t), chat = await f.create(); let release; f.control.gate = new Promise(resolve => { release = resolve; });
  const sending = f.raw(`/conversations/${chat.id}/messages`, { method: 'POST', body: { content: '前台生成测试' } }); await until(() => f.control.requested);
  const changed = await f.organize(chat.id, { title: '生成中', archived: true }); assert.equal(changed.status, 200);
  assert.equal((await f.request(`/conversations/${chat.id}`, { method: 'DELETE' })).status, 409);
  release(); f.control.gate = null; const response = await sending; const stream = await response.text(); assert.match(stream, /event: done/);
  const visible = (await f.request(`/conversations/${chat.id}`)).data; assert.equal(visible.title, '生成中'); assert.ok(visible.archivedAt); assert.equal(visible.messages[1].status, 'complete');
});

test('parent Chat archive preserves background execution and idle deletion cascades completed children', async t => {
  const f = await fixture(t), chat = await f.create();
  const sent = await f.raw(`/conversations/${chat.id}/messages`, { method: 'POST', body: { content: '帮我打开音乐', submissionId: randomUUID(), assistant: { enabled: true, hostId: 'central', providerId: null, permissions: { access: 'read-only', approval: 'auto' } } } }); await sent.text(); await until(() => f.calls.length === 1);
  const parent = (await f.request(`/conversations/${chat.id}`)).data, childId = parent.assistantTasks[0].conversationId; assert.ok(childId);
  assert.equal((await f.organize(childId, { title: '不能独立整理' })).status, 409); assert.equal((await f.request(`/conversations/${childId}`, { method: 'DELETE' })).status, 409);
  assert.equal((await f.organize(chat.id, { archived: true })).status, 200); assert.equal(f.calls[0].args.signal.aborted, false);
  assert.equal((await f.request(`/conversations/${chat.id}`, { method: 'DELETE' })).status, 409);
  f.calls[0].resolve({ text: '已完成测试', threadId: 'fixture-complete' });
  await until(async () => (await f.request(`/conversations/${chat.id}`)).data.assistantTasks[0].status === 'completed');
  assert.equal((await f.request(`/conversations/${chat.id}`, { method: 'DELETE' })).status, 200); assert.equal((await f.request(`/conversations/${childId}`)).status, 404);
  const raw = JSON.parse(await readFile(path.join(f.directory, 'state.json'), 'utf8')); assert.equal(raw.conversations.some(item => [chat.id, childId].includes(item.id)), false);
});

test('pending durable delete blocks new Chat and Agent submissions, then removes conversation', async t => {
  const f = await fixture(t), agent = await f.create('codex'), original = JsonStore.prototype.save; let release, entered = false;
  JsonStore.prototype.save = function (operation) { if (this.directory === f.directory && operation?.organization?.kind === 'conversation-delete') { entered = true; return new Promise(resolve => { release = resolve; }).then(() => original.call(this, operation)); } return original.call(this, operation); };
  t.after(() => { JsonStore.prototype.save = original; release?.(); });
  const deleting = f.request(`/conversations/${agent.id}`, { method: 'DELETE' }); await until(() => entered);
  assert.equal((await f.submit(agent.id)).status, 409); assert.equal((await f.raw(`/conversations/${agent.id}/messages`, { method: 'POST', body: { content: '删除期间的新任务' } })).status, 409);
  release(); assert.equal((await deleting).status, 200); assert.equal(f.calls.length, 0);
  JsonStore.prototype.save = original;
});

test('failed Agent deletion restores availability without poisoning internal removed IDs', async t => {
  const f = await fixture(t), agent = await f.create('codex'), original = JsonStore.prototype.save;
  JsonStore.prototype.save = function (operation) { if (this.directory === f.directory && operation?.organization?.kind === 'conversation-delete') return Promise.reject(new Error('fixture disk unavailable')); return original.call(this, operation); };
  t.after(() => { JsonStore.prototype.save = original; });
  assert.equal((await f.request(`/conversations/${agent.id}`, { method: 'DELETE' })).status, 500); assert.equal((await f.request(`/conversations/${agent.id}`)).status, 200);
  JsonStore.prototype.save = original; assert.equal((await f.submit(agent.id)).status, 200); await until(() => f.calls.length === 1);
});

test('logout while an organization save is queued prevents unauthorized mutation', async t => {
  const f = await fixture(t), member = await f.member('organization-revoked'), chat = await f.create('chat', {}, member.token), original = JsonStore.prototype.save;
  let release, entered = false;
  JsonStore.prototype.save = function (operation) {
    if (this.directory === f.directory && operation?.organization?.kind === 'conversation-update') { entered = true; this.queue = new Promise(resolve => { release = resolve; }); }
    return original.call(this, operation);
  };
  t.after(() => { JsonStore.prototype.save = original; release?.(); });
  const updating = f.organize(chat.id, { title: '不应提交' }, member.token); await until(() => entered);
  const loggingOut = f.request('/auth/logout', { token: member.token, method: 'POST', body: {} }); await delay(30); release();
  assert.equal((await updating).status, 401); assert.equal((await loggingOut).status, 200); JsonStore.prototype.save = original;
  const raw = JSON.parse(await readFile(path.join(f.directory, 'state.json'), 'utf8')); assert.equal(raw.conversations.find(item => item.id === chat.id).customTitle, undefined);
});

test('organization endpoints reject invalid fields and references without side effects', async t => {
  const f = await fixture(t), chat = await f.create();
  for (const body of [{}, { archived: 'yes' }, { title: 'x'.repeat(101) }, { projectId: '' }, { providerId: f.provider.id }, { title: 'x', extra: true }]) assert.equal((await f.organize(chat.id, body)).status, 400);
  assert.equal((await f.organize(chat.id, { projectId: randomUUID() })).status, 404);
  for (const body of [{ name: '' }, { name: 'x'.repeat(61) }, { name: 'valid', extra: true }]) assert.equal((await f.request('/projects', { method: 'POST', body })).status, 400);
  assert.equal((await f.request(`/conversations/${chat.id}`)).data.title, '新的聊天'); assert.deepEqual((await f.request('/state')).data.projects, []);
});
