import { listenFixture } from './helpers/loopback.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPetServer } from '../server/app.mjs';



const ownerToken = 'isolated-test-owner-token';
const password = 'test-password-123';
const stubCodex = () => ({ statusCalls: 0, approvalCalls: 0, async status() { this.statusCalls++; return { available: true, workspaceRoot: '/owner-private-workspace' }; }, async run() { return { text: 'owner reply', threadId: 'owner-thread' }; }, async approve() { this.approvalCalls++; return { ok: true }; }, async close() {} });
async function setup(t, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-users-'));
  if (options.legacy) await writeFile(path.join(directory, 'state.json'), options.legacy);
  const codex = options.codex ?? stubCodex();
  const app = await createPetServer({ dataDir: directory, token: ownerToken, codex });
  await listenFixture(app.server);
  const url = `http://127.0.0.1:${app.server.address().port}`;
  const request = (route, { token = ownerToken, method = 'GET', body } = {}) => fetch(`${url}/api${route}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const readState = async token => (await request('/state', { token })).json();
  const login = async (name, pass = password) => {
    const response = await request('/auth/login', { token: null, method: 'POST', body: { username: name, password: pass } });
    assert.equal(response.status, 200); return response.json();
  };
  const member = async (name, providerIds = []) => {
    const response = await request('/admin/users', { method: 'POST', body: { username: name, displayName: `Member ${name}`, password, providerIds } });
    assert.equal(response.status, 201); const { user } = await response.json(); return { user, ...await login(name) };
  };
  const provider = async (name = 'Fixture', baseUrl = 'https://example.com/v1', model = 'fixture') => {
    const response = await request('/providers', { method: 'POST', body: { name, baseUrl, protocol: 'chat-completions', model, apiKey: 'fixture-provider-private-key' } });
    assert.equal(response.status, 200); return response.json();
  };
  const conversation = async (token, providerId) => {
    const response = await request('/conversations', { token, method: 'POST', body: { providerId, userId: 'forged-owner', threadId: 'forged-thread' } });
    assert.equal(response.status, 201); return response.json();
  };
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  return { directory, app, request, readState, login, member, provider, conversation, codex };
}
async function hangingUpstream(t) {
  const server = http.createServer((req, res) => {
    req.resume();
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {"choices":[{"delta":{"content":"still working"}}]}\n\n');
  });
  await listenFixture(server);
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return `http://127.0.0.1:${server.address().port}/v1`;
}

test('members switch an existing chat to another assigned model while retaining context and reply attribution', async t => {
  const requests = [];
  const upstream = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString()); requests.push(body);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: `reply from ${body.model}` }, finish_reason: 'stop' }] }));
  });
  await listenFixture(upstream);
  t.after(async () => { upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)); });
  const { request, member, provider, conversation, directory } = await setup(t);
  const baseUrl = `http://127.0.0.1:${upstream.address().port}/v1`;
  const first = await provider('First', baseUrl, 'first-model'), second = await provider('Second', baseUrl, 'second-model');
  const alice = await member('alice', [first.id, second.id]);
  await request('/settings', { token: alice.token, method: 'PATCH', body: { defaultProviderId: first.id } });
  const other = await conversation(alice.token, first.id);
  const chat = await conversation(alice.token, first.id);
  await (await request(`/conversations/${chat.id}/messages`, { token: alice.token, method: 'POST', body: { content: 'first prompt' } })).text();
  const before = await (await request(`/conversations/${chat.id}`, { token: alice.token })).json();
  assert.equal(before.messages[1].model, 'first-model');
  const switched = await request(`/conversations/${chat.id}`, { token: alice.token, method: 'PATCH', body: { providerId: ` ${second.id} ` } });
  assert.equal(switched.status, 200);
  const updated = await switched.json();
  assert.equal(updated.id, before.id); assert.equal(updated.providerId, second.id);
  assert.equal(updated.title, before.title); assert.equal(updated.createdAt, before.createdAt);
  assert.deepEqual(updated.messages, before.messages); assert.ok(Date.parse(updated.updatedAt) >= Date.parse(before.updatedAt));
  assert.equal(updated.userId, undefined);
  await (await request(`/conversations/${chat.id}/messages`, { token: alice.token, method: 'POST', body: { content: 'follow-up prompt' } })).text();
  assert.deepEqual(requests.map(item => item.model), ['first-model', 'second-model']);
  assert.deepEqual(requests[1].messages.filter(item => item.role !== 'system'), [
    { role: 'user', content: 'first prompt' }, { role: 'assistant', content: 'reply from first-model' }, { role: 'user', content: 'follow-up prompt' },
  ]);
  const disk = JSON.parse(await readFile(path.join(directory, 'state.json'), 'utf8'));
  const saved = disk.conversations.find(item => item.id === chat.id);
  assert.equal(saved.providerId, second.id);
  assert.deepEqual(saved.messages.filter(item => item.role === 'assistant').map(item => item.model), ['first-model', 'second-model']);
  assert.deepEqual(saved.messages.slice(0, before.messages.length), before.messages);
  assert.equal(disk.users.find(item => item.id === alice.user.id).settings.defaultProviderId, first.id);
  const untouched = disk.conversations.find(item => item.id === other.id);
  assert.equal(untouched.providerId, first.id); assert.deepEqual(untouched.messages, []); assert.equal(untouched.updatedAt, other.updatedAt);
});

test('switching legacy chats preserves all messages without guessing missing historical model metadata', async t => {
  const messages = [
    { id: 'user', role: 'user', content: 'original prompt', status: 'complete' },
    { id: 'legacy', role: 'assistant', content: 'original reply', status: 'complete' },
    { id: 'known', role: 'assistant', content: 'already attributed reply', status: 'complete', model: 'recorded-model' },
  ];
  const legacy = JSON.stringify({ version: 1, settings: { petName: 'Pet', persona: 'Keep context', companionKind: 'cat' },
    providers: [{ id: 'original', name: 'Original', protocol: 'chat-completions', baseUrl: 'https://example.com/v1', model: 'original-model', apiKey: '' }],
    conversations: [{ id: 'legacy-chat', title: 'History', mode: 'chat', providerId: 'original', messages, createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z' }] });
  const { request, provider, directory } = await setup(t, { legacy });
  const next = await provider('New', 'https://example.com/v1', 'new-model');
  const response = await request('/conversations/legacy-chat', { method: 'PATCH', body: { providerId: next.id } });
  assert.equal(response.status, 200); const updated = await response.json();
  assert.deepEqual(updated.messages, messages); assert.equal(updated.providerId, next.id);
  assert.equal(updated.createdAt, '2020-01-01T00:00:00.000Z'); assert.notEqual(updated.updatedAt, updated.createdAt);
  const back = await request('/conversations/legacy-chat', { method: 'PATCH', body: { providerId: 'original' } });
  assert.deepEqual((await back.json()).messages, messages, 'unknown models stay unknown and recorded models must never be relabeled');
  assert.deepEqual(JSON.parse(await readFile(path.join(directory, 'state.json'), 'utf8')).conversations[0].messages, messages);
});

test('chat model patch rejects cross-account access, unauthorized models and every unrelated field without mutation', async t => {
  const { request, member, provider, conversation, directory } = await setup(t);
  const first = await provider('First'), second = await provider('Second'), privateModel = await provider('Private');
  const alice = await member('alice', [first.id, second.id]), bob = await member('bob', [second.id]);
  const chat = await conversation(alice.token, first.id);
  const before = await readFile(path.join(directory, 'state.json'), 'utf8');
  const attempts = [
    { token: null, body: { providerId: second.id }, status: 401 },
    { token: bob.token, body: { providerId: second.id }, status: 404 },
    { token: ownerToken, body: { providerId: second.id }, status: 404 },
    { token: alice.token, body: { providerId: privateModel.id }, status: 404 },
    { token: alice.token, body: { providerId: 'missing' }, status: 404 },
    ...[{}, { providerId: null }, { providerId: '' }, { providerId: [] }, { providerId: 1 }, { providerId: 'x'.repeat(129) },
      ...['mode', 'messages', 'userId', 'title', 'threadId', 'updatedAt'].map(key => ({ providerId: second.id, [key]: 'forged' }))]
      .map(body => ({ token: alice.token, body, status: 400 })),
  ];
  for (const { token, body, status } of attempts) {
    assert.equal((await request(`/conversations/${chat.id}`, { token, method: 'PATCH', body })).status, status, JSON.stringify(body));
    assert.equal(await readFile(path.join(directory, 'state.json'), 'utf8'), before);
  }
});

test('chat model cannot change during an active reply and can change after it stops', async t => {
  const { request, member, provider, conversation } = await setup(t);
  const first = await provider('Active', await hangingUpstream(t), 'active-model'), second = await provider('Next');
  const alice = await member('alice', [first.id, second.id]); const chat = await conversation(alice.token, first.id);
  const response = await request(`/conversations/${chat.id}/messages`, { token: alice.token, method: 'POST', body: { content: 'ongoing prompt' } });
  const stream = response.text();
  try {
    assert.equal((await request(`/conversations/${chat.id}`, { token: alice.token, method: 'PATCH', body: { providerId: second.id } })).status, 409);
    const current = await (await request(`/conversations/${chat.id}`, { token: alice.token })).json();
    assert.equal(current.providerId, first.id); assert.equal(current.messages[1].status, 'streaming'); assert.equal(current.messages[1].model, 'active-model');
  } finally { await request(`/conversations/${chat.id}/stop`, { token: alice.token, method: 'POST' }); await stream; }
  const stopped = await (await request(`/conversations/${chat.id}`, { token: alice.token })).json();
  const switched = await request(`/conversations/${chat.id}`, { token: alice.token, method: 'PATCH', body: { providerId: second.id } });
  assert.equal(switched.status, 200); assert.deepEqual((await switched.json()).messages, stopped.messages);
});

test('Codex conversations reject chat model changes without altering their thread or history', async t => {
  const { request, provider, directory } = await setup(t);
  const next = await provider();
  const chat = await (await request('/conversations', { method: 'POST', body: { mode: 'codex' } })).json();
  await (await request(`/conversations/${chat.id}/messages`, { method: 'POST', body: { content: 'owner work' } })).text();
  const before = await readFile(path.join(directory, 'state.json'), 'utf8');
  const response = await request(`/conversations/${chat.id}`, { method: 'PATCH', body: { providerId: next.id } });
  assert.equal(response.status, 400); assert.match((await response.json()).error, /Codex/);
  assert.equal(await readFile(path.join(directory, 'state.json'), 'utf8'), before);
});

for (const unavailable of ['deleted', 'revoked']) test(`legacy chat can leave a ${unavailable} model without inventing or exposing old reply attribution`, async t => {
  const { provider, member, conversation, directory, app } = await setup(t);
  const old = await provider('Old'), next = await provider('Allowed');
  const alice = await member('alice', [old.id, next.id]); const chat = await conversation(alice.token, old.id);
  await app.close();
  const file = path.join(directory, 'state.json'), disk = JSON.parse(await readFile(file, 'utf8'));
  disk.users.find(item => item.id === alice.user.id).providerIds = [next.id];
  if (unavailable === 'deleted') disk.providers = disk.providers.filter(item => item.id !== old.id);
  else disk.providers.find(item => item.id === old.id).model = 'ungranted-new-model';
  const history = [{ id: 'legacy-reply', role: 'assistant', content: 'keep this reply', status: 'complete' }];
  disk.conversations.find(item => item.id === chat.id).messages = history;
  await writeFile(file, JSON.stringify(disk));
  const restored = await createPetServer({ dataDir: directory, token: ownerToken, codex: stubCodex() });
  try {
    await listenFixture(restored.server);
    const response = await fetch(`http://127.0.0.1:${restored.server.address().port}/api/conversations/${chat.id}`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${alice.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ providerId: next.id }),
    });
    assert.equal(response.status, 200); const switched = await response.json();
    assert.equal(switched.providerId, next.id); assert.deepEqual(switched.messages, history);
    assert.equal(JSON.stringify(switched).includes('ungranted-new-model'), false);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).conversations.find(item => item.id === chat.id).messages, history);
  } finally { await restored.close(); }
});

test('v1 migration backs up exact original bytes and assigns all existing data to a stable owner', async t => {
  const legacy = JSON.stringify({ version: 1, settings: { petName: 'Existing pet', persona: 'Existing persona', companionKind: 'cat' }, providers: [{ id: 'old-provider', name: 'Old', protocol: 'responses', baseUrl: 'https://example.com/v1', model: 'old-model', apiKey: 'old-key' }], conversations: [{ id: 'old-chat', title: 'Old history', mode: 'chat', providerId: 'old-provider', messages: [{ id: 'm1', role: 'assistant', content: 'retain me', status: 'streaming' }], createdAt: 'old', updatedAt: 'old' }] }, null, 2);
  const { directory, app, readState, member } = await setup(t, { legacy });
  const state = await readState();
  assert.equal(state.user.isOwner, true); assert.equal(state.user.canUseCodex, true);
  assert.equal(state.settings.petName, 'Existing pet'); assert.equal(state.settings.companionKind, 'cat');
  assert.equal(state.conversations[0].messages[0].content, 'retain me'); assert.equal(state.conversations[0].messages[0].status, 'error');
  const files = await readdir(directory), backup = files.filter(name => name.startsWith('state.v1.backup-'));
  assert.equal(backup.length, 1); assert.equal(await readFile(path.join(directory, backup[0]), 'utf8'), legacy);
  const newcomer = await member('newcomer');
  const isolated = await readState(newcomer.token);
  assert.deepEqual(isolated.providers, []); assert.deepEqual(isolated.conversations, []);
  assert.notEqual(isolated.settings.petName, 'Existing pet');
  await app.close();
  const before = await readFile(path.join(directory, 'state.json'), 'utf8');
  const restarted = await createPetServer({ dataDir: directory, token: 'new-desktop-bootstrap-token', codex: stubCodex() });
  await restarted.close();
  assert.equal(await readFile(path.join(directory, 'state.json'), 'utf8'), before);
  const disk = JSON.parse(before);
  assert.equal(disk.version, 2); assert.equal(disk.instanceId, state.instanceId); assert.equal(disk.ownerId, state.user.id);
  assert.equal(disk.conversations[0].userId, state.user.id); assert.equal(disk.providers[0].apiKey, 'old-key');
});

test('members see only assigned models and private settings/history; identity body fields cannot change the target user', async t => {
  const { request, readState, member, provider, conversation, codex } = await setup(t);
  const p1 = await provider('one'), p2 = await provider('two');
  const a = await member('alice', [p1.id]), b = await member('bob', [p2.id]);
  const owner = await readState(); const calls = codex.statusCalls;
  const alice = await readState(a.token), bob = await readState(b.token);
  assert.equal(codex.statusCalls, calls, 'member state must never start or query the shared CLI');
  assert.equal(alice.instanceId, owner.instanceId); assert.notEqual(alice.user.id, bob.user.id);
  assert.equal(alice.user.canUseCodex, false); assert.equal(alice.codex.disabled, true); assert.equal(alice.codex.workspaceRoot, undefined);
  assert.deepEqual(alice.providers.map(item => item.id), [p1.id]); assert.equal(alice.providers[0].editable, false); assert.equal(alice.providers[0].testable, true);
  assert.deepEqual(bob.providers.map(item => item.id), [p2.id]);
  assert.equal((await request('/settings', { token: a.token, method: 'PATCH', body: { userId: b.user.id, petName: 'Alice only', persona: 'Alice persona', defaultProviderId: p1.id } })).status, 200);
  assert.equal((await readState(b.token)).settings.petName, '小伴');
  const chat = await conversation(a.token);
  assert.equal(chat.providerId, p1.id); assert.equal(chat.threadId, undefined); assert.equal(chat.userId, undefined);
  assert.equal((await readState(b.token)).conversations.length, 0);
  assert.equal((await readState()).conversations.length, 0, 'admin catalog access does not expose member histories');
  for (const [route, method, body] of [
    [`/conversations/${chat.id}`, 'GET'], [`/conversations/${chat.id}`, 'DELETE'], [`/conversations/${chat.id}/stop`, 'POST'], [`/conversations/${chat.id}/messages`, 'POST', { content: 'steal' }],
    [`/providers/${p1.id}/test`, 'POST'], ['/conversations', 'POST', { providerId: p1.id }], ['/settings', 'PATCH', { defaultProviderId: p1.id }],
  ]) assert.equal((await request(route, { token: b.token, method, body })).status, 404, route);
  for (const [route, method, body] of [
    ['/providers', 'POST', { name: 'intruder' }], [`/providers/${p1.id}`, 'DELETE'], ['/admin/users', 'GET'], ['/admin/users', 'POST', {}], [`/admin/users/${a.user.id}`, 'PATCH', { disabled: true }],
    ['/codex/status', 'GET'], ['/codex/approvals/guess', 'POST', { decision: 'accept' }], ['/conversations', 'POST', { mode: 'codex' }],
  ]) assert.equal((await request(route, { token: a.token, method, body })).status, 403, route);
  assert.equal(codex.statusCalls, calls + 1, 'only the explicit owner read above queried the CLI');
});

test('voice credentials and selected settings stay per user and every public projection excludes secrets', async t => {
  const { request, readState, member, provider, directory } = await setup(t);
  const p = await provider(); const a = await member('alice', [p.id]), b = await member('bob');
  const settings = { tts: { mode: 'remote', baseUrl: 'https://voice.example/v1', model: 'voice-model', voice: 'warm', apiKey: 'alice-private-voice-key' }, asr: { mode: 'remote', baseUrl: 'https://asr.example/v1', model: 'asr-model', language: 'zh-CN', apiKey: 'alice-private-asr-key' }, userId: b.user.id };
  const saved = await request('/voice', { token: a.token, method: 'PATCH', body: settings });
  assert.equal(saved.status, 200); const voice = await saved.json();
  assert.equal(voice.tts.hasApiKey, true); assert.equal(voice.tts.apiKey, undefined); assert.equal(voice.runtime.remoteConfiguredOnly, true);
  const bob = await (await request('/voice', { token: b.token })).json(); assert.equal(bob.tts.mode, 'system'); assert.equal(bob.tts.hasApiKey, false);
  assert.equal((await request('/voice', { token: a.token, method: 'PATCH', body: { tts: { baseUrl: 'https://other.example/v1', apiKey: '' } } })).status, 400);
  const texts = [JSON.stringify(await readState(a.token)), JSON.stringify(await readState()), JSON.stringify(voice), await (await request('/admin/users')).text()];
  for (const text of texts) for (const secret of [password, a.token, b.token, 'fixture-provider-private-key', 'alice-private-voice-key', 'alice-private-asr-key', '"password":', '"salt":', '"tokenHash":']) assert.equal(text.includes(secret), false, secret);
  const disk = await readFile(path.join(directory, 'state.json'), 'utf8');
  assert.equal(disk.includes(password), false); assert.equal(disk.includes(a.token), false);
  const users = JSON.parse(disk).users;
  assert.equal(users.find(user => user.id === a.user.id).voice.tts.apiKey, 'alice-private-voice-key');
  assert.notEqual(users.find(user => user.id === a.user.id).password.salt, users.find(user => user.id === b.user.id).password.salt);
});

test('cross-user stop is denied; model revocation cancels only that user and invalidates their sessions', async t => {
  const { request, readState, member, provider, conversation, login } = await setup(t);
  const p = await provider('hang', await hangingUpstream(t));
  const a = await member('alice', [p.id]), b = await member('bob', [p.id]);
  await request('/settings', { token: a.token, method: 'PATCH', body: { defaultProviderId: p.id } });
  const ca = await conversation(a.token, p.id), cb = await conversation(b.token, p.id);
  const ra = await request(`/conversations/${ca.id}/messages`, { token: a.token, method: 'POST', body: { content: 'A private prompt' } }); const streamA = ra.text();
  const rb = await request(`/conversations/${cb.id}/messages`, { token: b.token, method: 'POST', body: { content: 'B private prompt' } }); const streamB = rb.text();
  assert.equal((await request(`/conversations/${ca.id}/stop`, { token: b.token, method: 'POST' })).status, 404);
  assert.equal((await readState(a.token)).conversations[0].messages.at(-1).status, 'streaming');
  assert.equal((await request(`/admin/users/${a.user.id}`, { method: 'PATCH', body: { providerIds: [] } })).status, 200);
  assert.match(await streamA, /cancelled/);
  assert.equal((await request('/state', { token: a.token })).status, 401);
  assert.equal((await readState(b.token)).conversations[0].messages.at(-1).status, 'streaming');
  const fresh = await login('alice'); const restored = await readState(fresh.token);
  assert.equal(restored.settings.defaultProviderId, null); assert.deepEqual(restored.providers, []);
  assert.equal((await request(`/conversations/${ca.id}/messages`, { token: fresh.token, method: 'POST', body: { content: 'unauthorized reuse' } })).status, 404);
  await request(`/conversations/${cb.id}/stop`, { token: b.token, method: 'POST' }); assert.match(await streamB, /cancelled/);
});

for (const mutation of ['disable', 'password']) test(`${mutation} revokes sessions and cancels an active request without exposing credentials`, async t => {
  const { request, member, provider, conversation, login } = await setup(t);
  const p = await provider('hang', await hangingUpstream(t)); const a = await member('alice', [p.id]);
  const chat = await conversation(a.token, p.id);
  const response = await request(`/conversations/${chat.id}/messages`, { token: a.token, method: 'POST', body: { content: 'active' } }); const stream = response.text();
  const body = mutation === 'disable' ? { disabled: true } : { password: 'replacement-password' };
  assert.equal((await request(`/admin/users/${a.user.id}`, { method: 'PATCH', body })).status, 200);
  assert.match(await stream, /cancelled/); assert.equal((await request('/auth/me', { token: a.token })).status, 401);
  assert.equal((await request('/auth/login', { token: null, method: 'POST', body: { username: 'alice', password } })).status, 401);
  if (mutation === 'disable') await request(`/admin/users/${a.user.id}`, { method: 'PATCH', body: { disabled: false } });
  const fresh = await login('alice', mutation === 'password' ? 'replacement-password' : password);
  assert.equal((await request('/auth/me', { token: fresh.token })).status, 200);
});

test('logout cancels only requests from that session while another login remains usable', async t => {
  const { request, member, provider, conversation, login, readState } = await setup(t);
  const p = await provider('hang', await hangingUpstream(t)); const a = await member('alice', [p.id]), other = await login('alice');
  const c1 = await conversation(a.token, p.id), c2 = await conversation(other.token, p.id);
  const r1 = await request(`/conversations/${c1.id}/messages`, { token: a.token, method: 'POST', body: { content: 'one' } }); const s1 = r1.text();
  const r2 = await request(`/conversations/${c2.id}/messages`, { token: other.token, method: 'POST', body: { content: 'two' } }); const s2 = r2.text();
  assert.equal((await request('/auth/logout', { token: a.token, method: 'POST' })).status, 200); assert.match(await s1, /cancelled/);
  assert.equal((await request('/state', { token: a.token })).status, 401);
  assert.equal((await readState(other.token)).conversations.find(item => item.id === c2.id).messages.at(-1).status, 'streaming');
  await request(`/conversations/${c2.id}/stop`, { token: other.token, method: 'POST' }); await s2;
});

test('owner password can be set while pairing remains owner; identity elevation and invalid updates are atomic', async t => {
  const { request, readState, login, member, directory } = await setup(t);
  const state = await readState();
  const update = await request(`/admin/users/${state.user.id}`, { method: 'PATCH', body: { password } });
  assert.equal(update.status, 200); assert.equal((await update.json()).user.hasPassword, true);
  const account = await login('owner'); assert.equal(account.user.isOwner, true);
  const a = await member('alice');
  for (const [id, body] of [[state.user.id, { disabled: true }], [a.user.id, { role: 'admin' }], [a.user.id, { providerIds: ['not-a-model'] }], [a.user.id, { password: 'short', displayName: 'must not write' }]]) {
    const before = await readFile(path.join(directory, 'state.json'), 'utf8');
    assert.equal((await request(`/admin/users/${id}`, { method: 'PATCH', body })).status, 400);
    assert.equal(await readFile(path.join(directory, 'state.json'), 'utf8'), before);
  }
  assert.equal((await request('/admin/users', { method: 'POST', body: { username: 'Alice', password } })).status, 409);
  assert.equal((await request('/admin/users', { method: 'POST', body: { username: 'eve', password, role: 'admin' } })).status, 400);
  await request(`/admin/users/${state.user.id}`, { method: 'PATCH', body: { password: 'owner-new-password' } });
  assert.equal((await request('/auth/me', { token: account.token })).status, 401);
  assert.equal((await request('/auth/me')).status, 200);
});

test('login is limited, passwords and bearer sessions are absent from persisted plaintext, expired sessions fail after restart', async t => {
  const { request, member, directory, app } = await setup(t);
  const a = await member('alice');
  for (let attempt = 0; attempt < 8; attempt++) assert.equal((await request('/auth/login', { token: null, method: 'POST', body: { username: 'unknown', password: 'incorrect-password' } })).status, 401);
  assert.equal((await request('/auth/login', { token: null, method: 'POST', body: { username: 'unknown', password } })).status, 429);
  await app.close();
  const file = path.join(directory, 'state.json'), disk = JSON.parse(await readFile(file, 'utf8'));
  assert.ok(disk.sessions.length); assert.equal(JSON.stringify(disk).includes(a.token), false);
  disk.sessions.forEach(session => { session.expiresAt = 0; }); await writeFile(file, JSON.stringify(disk));
  const restarted = await createPetServer({ dataDir: directory, token: ownerToken, codex: stubCodex() });
  try {
    await listenFixture(restarted.server);
    const response = await fetch(`http://127.0.0.1:${restarted.server.address().port}/api/state`, { headers: { Authorization: `Bearer ${a.token}` } });
    assert.equal(response.status, 401);
  } finally { await restarted.close(); }
});

test('Codex approval requires a live owner task and stale or guessed IDs never reach the bridge', async t => {
  let approveRun;
  const codex = stubCodex();
  codex.run = ({ signal, onEvent }) => new Promise((resolve, reject) => {
    approveRun = () => resolve({ text: 'approved', threadId: 'owner-thread' });
    onEvent('approval', { id: 'test-approval', kind: 'command', description: 'test command' });
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  codex.approve = async () => { codex.approvalCalls++; approveRun(); return { ok: true }; };
  const { request, member } = await setup(t, { codex }); const a = await member('alice');
  assert.equal((await request('/codex/approvals/guess', { method: 'POST', body: { decision: 'accept' } })).status, 404);
  const chat = await (await request('/conversations', { method: 'POST', body: { mode: 'codex' } })).json();
  const response = await request(`/conversations/${chat.id}/messages`, { method: 'POST', body: { content: 'owner only' } });
  const reader = response.body.getReader(); let output = '';
  while (!output.includes('test-approval')) output += new TextDecoder().decode((await reader.read()).value);
  assert.equal((await request('/codex/approvals/test-approval', { token: a.token, method: 'POST', body: { decision: 'accept' } })).status, 403);
  assert.equal(codex.approvalCalls, 0);
  assert.equal((await request('/codex/approvals/test-approval', { method: 'POST', body: { decision: 'accept' } })).status, 200);
  while (!(await reader.read()).done) {} reader.releaseLock();
  assert.equal((await request('/codex/approvals/test-approval', { method: 'POST', body: { decision: 'accept' } })).status, 404); assert.equal(codex.approvalCalls, 1);
});

test('deleting a catalog model revokes assigned member sessions and clears their saved default', async t => {
  const { request, provider, member, login, readState } = await setup(t);
  const p = await provider(); const a = await member('alice', [p.id]);
  await request('/settings', { token: a.token, method: 'PATCH', body: { defaultProviderId: p.id } });
  assert.equal((await request(`/providers/${p.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await request('/state', { token: a.token })).status, 401);
  const fresh = await login('alice'); const state = await readState(fresh.token);
  assert.deepEqual(state.providers, []); assert.equal(state.settings.defaultProviderId, null);
});

test('member login session, default model, profile, voice and owned history survive a restart', async t => {
  const { request, provider, member, conversation, directory, app, readState } = await setup(t);
  const p = await provider(); const a = await member('alice', [p.id]);
  await request('/settings', { token: a.token, method: 'PATCH', body: { petName: 'Persistent Alice', companionKind: 'cat', defaultProviderId: ` ${p.id} ` } });
  const chat = await conversation(a.token);
  await request('/voice', { token: a.token, method: 'PATCH', body: { tts: { voice: 'Persistent local voice' }, asr: { language: 'en-US' } } });
  const before = await readState(a.token); await app.close();
  const restarted = await createPetServer({ dataDir: directory, token: 'replacement-local-owner-token', codex: stubCodex() });
  try {
    await listenFixture(restarted.server);
    const base = `http://127.0.0.1:${restarted.server.address().port}/api`;
    const state = await (await fetch(`${base}/state`, { headers: { Authorization: `Bearer ${a.token}` } })).json();
    assert.deepEqual(state, before); assert.equal(state.conversations[0].id, chat.id); assert.equal(state.settings.defaultProviderId, p.id);
    const voice = await (await fetch(`${base}/voice`, { headers: { Authorization: `Bearer ${a.token}` } })).json();
    assert.equal(voice.tts.voice, 'Persistent local voice'); assert.equal(voice.asr.language, 'en-US');
    assert.equal((await fetch(`${base}/state`, { headers: { Authorization: `Bearer ${ownerToken}` } })).status, 401, 'old ephemeral desktop bootstrap does not become a persisted member session');
  } finally { await restarted.close(); }
});
