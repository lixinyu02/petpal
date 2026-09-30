import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { listenFixture } from './helpers/loopback.mjs';
import { createPetServer } from '../server/app.mjs';
import { JsonStore } from '../server/store.mjs';
import { defaultCodexConfig } from '../server/codex-config.mjs';

const bootstrap = randomBytes(32).toString('hex');
const password = randomBytes(32).toString('hex');
const fixtureChatApiKey = randomBytes(32).toString('hex');
const fixtureAgentProviderApiKey = randomBytes(32).toString('hex');
const fixtureAgentConfigApiKey = randomBytes(32).toString('hex');
const chosenPermissions = { access: 'read-only', approval: 'auto' };
const operation = '帮我在后台用 QQ音乐 播放晴天，前台继续陪我聊天。';
async function until(callback) {
  for (let index = 0; index < 200; index++) { const result = await callback(); if (result) return result; await delay(5); }
  assert.fail('Chat/Agent HTTP state did not settle');
}
function events(source) {
  return source.split(/\r?\n\r?\n/).flatMap(block => {
    const type = block.match(/^event:\s*(.+)$/m)?.[1];
    const data = block.match(/^data:\s*(.+)$/m)?.[1];
    return type && data ? [{ type, data: JSON.parse(data) }] : [];
  });
}

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-chat-agent-api-'));
  const upstreamRequests = [], calls = [], control = { failFollowUp: false };
  const upstream = http.createServer(async (req, res) => {
    const bytes = []; for await (const chunk of req) bytes.push(chunk);
    const body = JSON.parse(Buffer.concat(bytes).toString()); upstreamRequests.push(body);
    res.setHeader('Content-Type', 'application/json');
    if (body.tool_choice === 'none') {
      if (control.failFollowUp) { res.statusCode = 503; res.end(JSON.stringify({ error: { message: 'fixture follow-up unavailable' } })); return; }
      const output = body.input.findLast(item => item.type === 'function_call_output');
      assert.ok(output, 'follow-up must carry the dispatch receipt');
      const receipt = JSON.parse(output.output);
      if (receipt.status === 'error') { res.end(JSON.stringify({ status: 'completed', output_text: '执行电脑当前不可用，后台任务尚未派发。' })); return; }
      assert.ok(receipt.taskId); assert.ok(receipt.conversationId);
      res.end(JSON.stringify({ status: 'completed', output_text: `已派发到${receipt.hostName}，我们继续聊天。` })); return;
    }
    const latest = body.input.filter(item => item.role === 'user').at(-1)?.content ?? '';
    if (body.tools && /QQ音乐/u.test(latest)) {
      res.end(JSON.stringify({ id: 'resp_dispatch_fixture', status: 'completed', output: [{ type: 'function_call', id: 'fc_dispatch_fixture', call_id: 'call_dispatch_fixture', name: 'run_agent', arguments: JSON.stringify({ task: latest }) }] }));
    } else res.end(JSON.stringify({ status: 'completed', output_text: '我在这里，今天想聊些什么？' }));
  });
  await listenFixture(upstream);
  const modelBaseUrl = `http://127.0.0.1:${upstream.address().port}/v1`;
  const store = await new JsonStore(directory).init();
  const chatProvider = { id: randomUUID(), name: 'Fixture Chat', protocol: 'responses', baseUrl: modelBaseUrl, model: 'fixture-chat-model', apiKey: fixtureChatApiKey };
  const agentProvider = { id: randomUUID(), name: 'Fixture Agent', protocol: 'responses', baseUrl: 'https://agent.example.test/v1', model: 'fixture-granted-agent-model', reasoningEffort: 'high', apiKey: fixtureAgentProviderApiKey };
  store.state.providers = [chatProvider, agentProvider];
  store.state.codexConfig = { ...defaultCodexConfig(), mode: 'api', baseUrl: 'https://agent.example.test/v1', model: 'fixture-default-agent-model', reasoningEffort: 'medium', apiKey: fixtureAgentConfigApiKey };
  await store.save();
  const codex = {
    async status() { return { available: true, authenticated: true, configured: true }; },
    run(args) {
      return new Promise((resolve, reject) => {
        const call = { args, resolve, reject }; calls.push(call);
        args.onEvent('turn', { turnId: `fixture-turn-${calls.length}` });
        args.signal.addEventListener('abort', () => reject(args.signal.reason), { once: true });
      });
    },
    async approve() { return { ok: true }; },
    async close() { for (const call of calls) call.reject(Object.assign(new Error('Fixture closed'), { name: 'AbortError' })); },
  };
  const app = await createPetServer({ dataDir: directory, token: bootstrap, codex });
  await listenFixture(app.server);
  const request = (route, { token = bootstrap, method = 'GET', body } = {}) => fetch(`http://127.0.0.1:${app.server.address().port}/api${route}`, {
    method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = async (route, options) => { const response = await request(route, options); return { status: response.status, data: await response.json() }; };
  const createChat = async (token = bootstrap) => {
    const result = await json('/conversations', { token, method: 'POST', body: { mode: 'chat', providerId: chatProvider.id } });
    assert.equal(result.status, 201); return result.data;
  };
  const member = async (username, agentAccess = 'none') => {
    const created = await json('/admin/users', { method: 'POST', body: { username, password, agentAccess, providerIds: [chatProvider.id, agentProvider.id] } });
    assert.equal(created.status, 201);
    const login = await json('/auth/login', { token: null, method: 'POST', body: { username, password } });
    assert.equal(login.status, 200); return { user: created.data.user, token: login.data.token };
  };
  const submission = (content = operation, extra = {}) => ({ content, submissionId: randomUUID(), assistant: { enabled: true, hostId: 'central', providerId: null, permissions: { ...chosenPermissions } }, ...extra });
  const send = async (chat, body = submission(), token = bootstrap) => {
    const response = await request(`/conversations/${chat.id}/messages`, { token, method: 'POST', body });
    const text = await response.text(); return { status: response.status, text, events: response.headers.get('content-type')?.includes('text/event-stream') ? events(text) : [], contentType: response.headers.get('content-type') };
  };
  t.after(async () => {
    await app.close(); upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve));
    assert.ok(directory.startsWith(path.join(tmpdir(), 'petpal-chat-agent-api-'))); await rm(directory, { recursive: true, force: true });
  });
  return { directory, app, request, json, createChat, member, submission, send, calls, upstreamRequests, control, chatProvider, agentProvider };
}

test('Chat finishes while its Agent runs independently, allowing another Chat turn and one result handoff', async t => {
  const f = await fixture(t), chat = await f.createChat();
  const first = await f.send(chat);
  assert.equal(first.status, 200); assert.ok(first.events.some(event => event.type === 'done')); assert.ok(!first.events.some(event => event.type === 'error'));
  const background = first.events.find(event => event.type === 'task')?.data.task;
  assert.ok(background?.id); assert.ok(background.conversationId); assert.equal(background.hostId, 'central');
  await until(() => f.calls.length === 1);
  assert.equal(f.calls[0].args.signal.aborted, false); assert.equal(f.calls[0].args.prompt, operation);
  assert.equal(f.calls[0].args.model, 'fixture-default-agent-model'); assert.deepEqual(f.calls[0].args.permissions, chosenPermissions);
  const running = (await f.json(`/conversations/${background.conversationId}`)).data;
  assert.equal(running.agent.run.status, 'running');
  const second = await f.send(chat, f.submission('你好，继续聊聊今天的心情。'));
  assert.equal(second.status, 200); assert.ok(second.events.some(event => event.type === 'done')); assert.equal(f.calls.length, 1);
  assert.equal((await f.json(`/conversations/${background.conversationId}`)).data.agent.run.status, 'running');
  f.calls[0].args.onEvent('delta', { text: 'QQ 音乐任务执行结果已返回。' }); f.calls[0].resolve({ text: 'QQ 音乐任务执行结果已返回。', threadId: 'fixture-native-thread' });
  const completed = await until(async () => { const value = (await f.json(`/conversations/${chat.id}`)).data; return value.assistantTasks?.find(task => task.id === background.id)?.status === 'completed' ? value : null; });
  assert.equal(completed.messages.filter(message => message.assistantTaskId === background.id).length, 1);
  assert.match(completed.messages.find(message => message.assistantTaskId === background.id).content, /QQ 音乐任务执行结果已返回/);
  const again = (await f.json(`/conversations/${chat.id}`)).data;
  assert.equal(again.messages.filter(message => message.assistantTaskId === background.id).length, 1);
  const publicReply = JSON.stringify(again);
  assert.doesNotMatch(publicReply, /fingerprint|sessionHash/);
  for (const credential of [bootstrap, fixtureChatApiKey, fixtureAgentProviderApiKey, fixtureAgentConfigApiKey]) assert.equal(publicReply.includes(credential), false);
});

test('ordinary Chat and a disabled collaborator neither expose tools nor create background Agent work', async t => {
  const f = await fixture(t), chat = await f.createChat();
  const plain = await f.send(chat, { content: operation });
  assert.ok(plain.events.some(event => event.type === 'done')); assert.equal(f.upstreamRequests.at(-1).tools, undefined);
  const ordinary = await f.send(chat, f.submission('你好，今天聊聊天。'));
  assert.ok(ordinary.events.some(event => event.type === 'done')); assert.equal(f.calls.length, 0);
  const disabled = await f.send(chat, { content: operation, assistant: { enabled: false } });
  assert.ok(disabled.events.some(event => event.type === 'done')); assert.equal(f.upstreamRequests.at(-1).tools, undefined);
  const current = (await f.json(`/conversations/${chat.id}`)).data;
  assert.equal((current.assistantTasks ?? []).length, 0);
  const disk = JSON.parse(await readFile(path.join(f.directory, 'state.json'), 'utf8'));
  const reserved = disk.conversations.find(item => item.id === chat.id).assistantTasks;
  assert.equal(reserved.length, 1); assert.equal(reserved[0].status, 'completed'); assert.equal(reserved[0].conversationId, undefined);
  assert.equal((await f.json('/state')).data.conversations.filter(item => item.mode === 'codex').length, 0);
});

test('duplicate Chat submissions preserve message IDs and never repeat model decision or Agent dispatch', async t => {
  const f = await fixture(t), chat = await f.createChat(), body = f.submission();
  const first = await f.send(chat, body); assert.ok(first.events.some(event => event.type === 'done')); await until(() => f.calls.length === 1);
  const before = (await f.json(`/conversations/${chat.id}`)).data;
  const modelRequests = f.upstreamRequests.length;
  const duplicate = await f.send(chat, body);
  assert.equal(duplicate.status, 200); assert.equal(duplicate.events.filter(event => event.type === 'done').length, 1);
  assert.deepEqual((await f.json(`/conversations/${chat.id}`)).data.messages, before.messages);
  assert.equal(f.calls.length, 1); assert.equal(f.upstreamRequests.length, modelRequests);
  const changed = await f.send(chat, { ...body, content: '不同内容也要求 QQ音乐 放歌。' });
  assert.equal(changed.status, 409); assert.equal(f.calls.length, 1); assert.equal(f.upstreamRequests.length, modelRequests);
  assert.deepEqual((await f.json(`/conversations/${chat.id}`)).data.messages, before.messages);
});

test('Agent grants, chosen model and conversation/computer ownership are enforced before any model request', async t => {
  const f = await fixture(t), denied = await f.member('hybrid-none'), workspace = await f.member('hybrid-workspace', 'workspace'), foreign = await f.member('hybrid-foreign', 'full');
  const ownerChat = await f.createChat(), deniedChat = await f.createChat(denied.token), memberChat = await f.createChat(workspace.token);
  const selected = { enabled: true, hostId: 'central', providerId: f.agentProvider.id, permissions: { ...chosenPermissions } };
  const deniedResult = await f.send(deniedChat, f.submission(operation, { assistant: selected }), denied.token); assert.equal(deniedResult.status, 403);
  const escalated = await f.send(memberChat, f.submission(operation, { assistant: { ...selected, permissions: { access: 'full-access', approval: 'auto' } } }), workspace.token); assert.equal(escalated.status, 403);
  const missingModel = await f.send(memberChat, f.submission(), workspace.token); assert.equal(missingModel.status, 403);
  const crossed = await f.send(ownerChat, f.submission(), foreign.token); assert.equal(crossed.status, 404);
  const anonymous = await f.send(ownerChat, f.submission(), null); assert.equal(anonymous.status, 401);
  const registration = await f.json('/agent/executors/register', { token: foreign.token, method: 'POST', body: { deviceId: randomUUID(), name: 'Another account computer', platform: 'win32', arch: 'x64' } });
  assert.equal(registration.status, 200);
  const hostForgery = await f.send(ownerChat, f.submission(operation, { assistant: { ...selected, hostId: registration.data.hostId } })); assert.equal(hostForgery.status, 404);
  assert.equal(f.calls.length, 0); assert.equal(f.upstreamRequests.length, 0);
  for (const [chat, token] of [[ownerChat, bootstrap], [deniedChat, denied.token], [memberChat, workspace.token]]) {
    const current = (await f.json(`/conversations/${chat.id}`, { token })).data; assert.deepEqual(current.messages, []); assert.equal(current.assistantTasks, undefined);
  }
  const allowed = await f.send(memberChat, f.submission(operation, { assistant: selected }), workspace.token);
  assert.ok(allowed.events.some(event => event.type === 'done')); await until(() => f.calls.length === 1);
  assert.equal(f.calls[0].args.model, 'fixture-granted-agent-model'); assert.equal(f.calls[0].args.effort, 'high'); assert.deepEqual(f.calls[0].args.permissions, chosenPermissions);
  const child = allowed.events.find(event => event.type === 'task').data.task;
  assert.equal((await f.json(`/conversations/${child.conversationId}`, { token: foreign.token })).status, 404);
  assert.equal((await f.json(`/conversations/${memberChat.id}/assistant/tasks/${child.id}/stop`, { token: foreign.token, method: 'POST', body: {} })).status, 404);
});

test('deleting a parent Chat first clears its running child and cannot leave orphaned tasks', async t => {
  const f = await fixture(t), chat = await f.createChat();
  const first = await f.send(chat); const background = first.events.find(event => event.type === 'task').data.task; await until(() => f.calls.length === 1);
  assert.equal((await f.json(`/conversations/${background.conversationId}`, { method: 'DELETE' })).status, 409);
  assert.equal(f.calls[0].args.signal.aborted, false);
  assert.equal((await f.json(`/conversations/${chat.id}`, { method: 'DELETE' })).status, 200);
  assert.equal(f.calls[0].args.signal.aborted, true);
  assert.equal((await f.json(`/conversations/${chat.id}`)).status, 404); assert.equal((await f.json(`/conversations/${background.conversationId}`)).status, 404);
  const disk = JSON.parse(await readFile(path.join(f.directory, 'state.json'), 'utf8'));
  assert.equal(disk.conversations.some(item => item.id === chat.id || item.id === background.conversationId || item.backgroundParentId === chat.id), false);
  assert.equal(f.calls.length, 1);
});

test('a failed Chat follow-up keeps the already queued Agent visible and independently stoppable', async t => {
  const f = await fixture(t), chat = await f.createChat(); f.control.failFollowUp = true;
  const first = await f.send(chat); assert.ok(first.events.some(event => event.type === 'error')); assert.ok(!first.events.some(event => event.type === 'done'));
  const background = first.events.find(event => event.type === 'task').data.task; await until(() => f.calls.length === 1);
  const tracked = (await f.json(`/conversations/${chat.id}`)).data;
  assert.equal(tracked.assistantTasks[0].id, background.id); assert.equal(tracked.assistantTasks[0].status, 'running'); assert.equal(f.calls[0].args.signal.aborted, false);
  assert.equal(tracked.messages.at(-1).status, 'error');
  const stopped = await f.json(`/conversations/${chat.id}/assistant/tasks/${background.id}/stop`, { method: 'POST', body: {} });
  assert.equal(stopped.status, 200); assert.equal(stopped.data.conversation.assistantTasks[0].status, 'cancelled'); assert.equal(f.calls[0].args.signal.aborted, true);
  const child = (await f.json(`/conversations/${background.conversationId}`)).data;
  assert.equal(child.agent.paused, true); assert.equal(child.agent.queue.length, 0); assert.equal(child.agent.run.status, 'cancelled');
  assert.equal((await f.json(`/conversations/${chat.id}/assistant/tasks/${background.id}/stop`, { method: 'POST', body: {} })).status, 200);
  assert.equal(f.calls.length, 1);
});

test('stopping foreground Chat after completion leaves its background work until the task stop control is used', async t => {
  const f = await fixture(t), chat = await f.createChat(), result = await f.send(chat);
  const background = result.events.find(event => event.type === 'task').data.task; await until(() => f.calls.length === 1);
  assert.equal((await f.json(`/conversations/${chat.id}/stop`, { method: 'POST', body: {} })).status, 200);
  assert.equal(f.calls[0].args.signal.aborted, false);
  const stop = await f.json(`/conversations/${chat.id}/assistant/tasks/${background.id}/stop`, { method: 'POST', body: {} });
  assert.equal(stop.status, 200); assert.equal(f.calls[0].args.signal.aborted, true);
  assert.equal((await f.json(`/conversations/${background.conversationId}`)).data.agent.paused, true);
});

test('an offline preselected computer still allows ordinary Chat and never falls back to another host for tasks', async t => {
  const f = await fixture(t), chat = await f.createChat();
  const registered = await f.json('/agent/executors/register', { method: 'POST', body: { deviceId: randomUUID(), name: 'Offline selected computer', platform: 'win32', arch: 'x64' } });
  assert.equal(registered.status, 200);
  assert.equal((await f.json(`/agent/executors/${registered.data.connectionId}`, { method: 'DELETE' })).status, 200);
  const selection = { enabled: true, hostId: registered.data.hostId, providerId: null, permissions: { ...chosenPermissions } };
  const ordinary = await f.send(chat, f.submission('你好，我们继续聊一聊。', { assistant: selection }));
  assert.equal(ordinary.status, 200); assert.ok(ordinary.events.some(event => event.type === 'done')); assert.equal(f.calls.length, 0);
  const operationResult = await f.send(chat, f.submission(operation, { assistant: selection }));
  assert.ok(operationResult.events.some(event => event.type === 'done')); assert.equal(f.calls.length, 0);
  const failedTask = operationResult.events.find(event => event.type === 'task')?.data.task;
  assert.equal(failedTask?.status, 'error'); assert.equal(failedTask.conversationId, undefined);
  assert.match(operationResult.events.filter(event => event.type === 'delta').map(event => event.data.text).join(''), /尚未派发/);
  const current = (await f.json(`/conversations/${chat.id}`)).data;
  assert.equal(current.assistantTasks.length, 1); assert.equal(current.assistantTasks[0].hostId, registered.data.hostId); assert.equal(current.assistantTasks[0].status, 'error');
  assert.equal((await f.json('/state')).data.conversations.filter(item => item.mode === 'codex').length, 0);
});
