import { listenFixture } from './helpers/loopback.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPetServer } from '../server/app.mjs';

const mockCodex = () => ({
  async status() { return { available: true, authenticated: true }; },
  async run({ onEvent, prompt, threadId }) { onEvent('thread', { threadId: threadId ?? 'test-thread' }); onEvent('delta', { text: `Codex: ${prompt}` }); return { threadId: threadId ?? 'test-thread', text: `Codex: ${prompt}` }; },
  approve() { return { ok: true }; }, async close() {},
});
async function setup(t, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-backend-'));
  const app = await createPetServer({ dataDir: directory, token: 'backend-test-secret', codex: mockCodex(), ...options });
  await listenFixture(app.server);
  const url = `http://127.0.0.1:${app.server.address().port}`;
  const request = (route, { body, auth = true, headers = {}, method = 'GET', signal } = {}) => fetch(`${url}${route}`, { method, headers: { ...(auth ? { Authorization: `Bearer ${app.token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body), signal });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  return { app, url, request, directory };
}
async function upstream(t, mode = 'success') {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {"choices":[{"delta":{"content":"actual fixture answer"}}]}\n\n');
    if (mode === 'success') res.end('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
    if (mode === 'truncated') res.end();
  });
  await listenFixture(server);
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return `http://127.0.0.1:${server.address().port}/v1`;
}
async function configured(request, baseUrl) {
  const provider = await (await request('/api/providers', { method: 'POST', body: { name: 'Fixture', baseUrl, protocol: 'chat-completions', model: 'fixture', apiKey: 'secret-not-in-state-response' } })).json();
  const conversation = await (await request('/api/conversations', { method: 'POST', body: { mode: 'chat', providerId: provider.id } })).json();
  return { provider, conversation };
}
const events = text => text.split('\n\n').filter(value => value.startsWith('event:')).map(value => ({ event: value.split('\n')[0].slice(7), data: JSON.parse(value.split('\n').find(line => line.startsWith('data:')).slice(6)) }));

test('health is public, all state/mutation APIs authenticated, exact origin allowlist enforced', async t => {
  const { request, url } = await setup(t, { allowedOrigins: ['https://localhost'] });
  assert.equal((await request('/api/health', { auth: false })).status, 200);
  assert.equal((await request('/api/state', { auth: false })).status, 401);
  assert.equal((await request('/api/settings', { auth: false, method: 'PATCH', body: { petName: 'intruder' } })).status, 401);
  assert.equal((await request('/api/state', { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await request('/api/state', { headers: { Origin: 'null' } })).status, 403);
  assert.equal((await request('/api/state', { headers: { Origin: url } })).status, 200);
  const allowed = await request('/api/state', { headers: { Origin: 'https://localhost' } });
  assert.equal(allowed.status, 200); assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://localhost');
  const hostileHostStatus = await new Promise((resolve, reject) => {
    const probe = http.get(`${url}/api/health`, { headers: { Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); });
    probe.on('error', reject);
  });
  assert.equal(hostileHostStatus, 403);
});

test('provider secrets never roundtrip, blank preserves key, endpoint change requires fresh key', async t => {
  const { request, directory } = await setup(t);
  const { provider } = await configured(request, 'https://example.com/v1');
  assert.equal(provider.hasApiKey, true); assert.equal(provider.apiKey, undefined);
  const update = await request('/api/providers', { method: 'POST', body: { id: provider.id, name: 'Changed', apiKey: '' } });
  assert.equal(update.status, 200);
  const response = await (await request('/api/state')).text(); assert.ok(!response.includes('secret-not-in-state-response'));
  const disk = JSON.parse(await readFile(path.join(directory, 'state.json'), 'utf8')); assert.equal(disk.providers[0].apiKey, 'secret-not-in-state-response');
  const redirectKey = await request('/api/providers', { method: 'POST', body: { id: provider.id, baseUrl: 'https://other.example/v1' } });
  assert.equal(redirectKey.status, 400);
  assert.equal((await request('/api/providers', { method: 'POST', body: { id: provider.id, protocol: 'invalid' } })).status, 400);
});

test('provider reasoning persists, omitted effort preserves it, and invalid changes cannot alter any provider', async t => {
  const { request, directory, app } = await setup(t);
  const { provider: first } = await configured(request, 'https://example.com/v1');
  const { provider: other } = await configured(request, 'https://other.example/v1');
  assert.equal(first.reasoningEffort, '');
  const filename = path.join(directory, 'state.json');
  const beforeOther = JSON.parse(await readFile(filename, 'utf8')).providers.find(provider => provider.id === other.id);
  const response = await request('/api/providers', { method: 'POST', body: { id: first.id, model: 'gpt-6-luna', reasoningEffort: 'max' } });
  assert.equal(response.status, 200);
  const saved = await response.json(); assert.equal(saved.reasoningEffort, 'max'); assert.equal(saved.apiKey, undefined); assert.equal(saved.hasApiKey, true);
  const renamed = await request('/api/providers', { method: 'POST', body: { id: first.id, name: 'Renamed' } });
  assert.equal((await renamed.json()).reasoningEffort, 'max');
  const beforeInvalid = await readFile(filename, 'utf8');
  for (const reasoningEffort of [null, [], 1, 'MAX', 'auto', 'max\n']) {
    assert.equal((await request('/api/providers', { method: 'POST', body: { id: first.id, name: 'must not change', reasoningEffort } })).status, 400);
    assert.equal(await readFile(filename, 'utf8'), beforeInvalid);
  }
  const cleared = await request('/api/providers', { method: 'POST', body: { id: first.id, reasoningEffort: '' } });
  assert.equal((await cleared.json()).reasoningEffort, '');
  await request('/api/providers', { method: 'POST', body: { id: first.id, reasoningEffort: 'max' } });
  const disk = JSON.parse(await readFile(filename, 'utf8'));
  assert.deepEqual(disk.providers.find(provider => provider.id === other.id), beforeOther);
  assert.equal(disk.providers.find(provider => provider.id === first.id).apiKey, 'secret-not-in-state-response');
  assert.equal(disk.settings.defaultProviderId, null, 'Changing a connection must not silently select a default');
  assert.ok(!(await (await request('/api/state')).text()).includes('secret-not-in-state-response'));
  await app.close();
  const restarted = await createPetServer({ dataDir: directory, token: 'backend-test-secret', codex: mockCodex() });
  try {
    const restored = JSON.parse(await readFile(filename, 'utf8'));
    assert.equal(restored.providers.find(provider => provider.id === first.id).reasoningEffort, 'max');
    assert.deepEqual(restored.providers.find(provider => provider.id === other.id), beforeOther);
  } finally { await restarted.close(); }
});

test('real provider SSE persists user and complete assistant history across restart', async t => {
  const { request, directory, app } = await setup(t);
  const { conversation } = await configured(request, await upstream(t));
  const result = await request(`/api/conversations/${conversation.id}/messages`, { method: 'POST', body: { content: 'my prompt' } });
  const stream = events(await result.text()); assert.deepEqual(stream.map(item => item.event), ['meta', 'delta', 'done']);
  assert.equal(stream.at(-1).data.conversation.messages[1].content, 'actual fixture answer');
  assert.equal(stream.at(-1).data.conversation.messages[1].status, 'complete');
  await app.close();
  const second = await createPetServer({ dataDir: directory, token: 'backend-test-secret', codex: mockCodex() });
  await listenFixture(second.server);
  try {
    const restored = await (await fetch(`http://127.0.0.1:${second.server.address().port}/api/state`, { headers: { Authorization: 'Bearer backend-test-secret' } })).json();
    assert.equal(restored.conversations[0].messages[1].status, 'complete'); assert.equal(restored.conversations[0].title, 'my prompt');
  } finally { await second.close(); }
});

test('truncated stream persists partial output as error and never emits done', async t => {
  const { request, directory } = await setup(t);
  const { conversation } = await configured(request, await upstream(t, 'truncated'));
  const stream = events(await (await request(`/api/conversations/${conversation.id}/messages`, { method: 'POST', body: { content: 'go' } })).text());
  assert.deepEqual(stream.map(item => item.event), ['meta', 'delta', 'error']);
  const disk = JSON.parse(await readFile(path.join(directory, 'state.json'), 'utf8'));
  assert.equal(disk.conversations[0].messages[1].status, 'error'); assert.equal(disk.conversations[0].messages[1].content, 'actual fixture answer');
});

test('concurrent send/delete is rejected and stop cancels upstream with durable cancelled status', async t => {
  const { request } = await setup(t);
  const { conversation } = await configured(request, await upstream(t, 'hang'));
  const response = await request(`/api/conversations/${conversation.id}/messages`, { method: 'POST', body: { content: 'go' } });
  const text = response.text();
  assert.equal((await request(`/api/conversations/${conversation.id}/messages`, { method: 'POST', body: { content: 'again' } })).status, 409);
  assert.equal((await request(`/api/conversations/${conversation.id}`, { method: 'DELETE' })).status, 409);
  assert.equal((await request(`/api/conversations/${conversation.id}/stop`, { method: 'POST' })).status, 200);
  const state = await (await request('/api/state')).json(); assert.equal(state.conversations[0].messages[1].status, 'cancelled');
  const stream = events(await text); assert.equal(stream.at(-1).event, 'error');
});

test('Codex run delegates to the bridge and saves thread continuity', async t => {
  const { request } = await setup(t);
  const conversation = await (await request('/api/conversations', { method: 'POST', body: { mode: 'codex' } })).json();
  for (const content of ['first', 'second']) {
    const stream = events(await (await request(`/api/conversations/${conversation.id}/messages`, { method: 'POST', body: { content } })).text());
    assert.equal(stream.at(-1).event, 'done'); assert.equal(stream.at(-1).data.conversation.threadId, 'test-thread');
  }
  const state = await (await request('/api/state')).json(); assert.equal(state.conversations[0].messages.length, 4);
});

test('client disconnect aborts the bridge and persists cancellation', async t => {
  let started;
  const began = new Promise(resolve => { started = resolve; });
  let aborted;
  const stopped = new Promise(resolve => { aborted = resolve; });
  const codex = mockCodex();
  codex.run = ({ signal, onEvent }) => new Promise((resolve, reject) => {
    onEvent('delta', { text: 'partial work' }); started();
    signal.addEventListener('abort', () => { aborted(); reject(signal.reason); }, { once: true });
  });
  const { request } = await setup(t, { codex });
  const conversation = await (await request('/api/conversations', { method: 'POST', body: { mode: 'codex' } })).json();
  const controller = new AbortController();
  const response = await request(`/api/conversations/${conversation.id}/messages`, { method: 'POST', body: { content: 'go' }, signal: controller.signal });
  const reader = response.body.getReader(); await reader.read(); await began; controller.abort(); await stopped;
  let state;
  for (let attempt = 0; attempt < 20; attempt++) {
    state = await (await request('/api/state')).json();
    if (state.conversations[0].messages[1].status === 'cancelled') break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(state.conversations[0].messages[1].status, 'cancelled');
});

test('startup marks interrupted persisted replies as failed without fabricating completion', async t => {
  const { request, directory, app } = await setup(t);
  const conversation = await (await request('/api/conversations', { method: 'POST', body: { mode: 'codex' } })).json();
  await app.close();
  const filename = path.join(directory, 'state.json');
  const saved = JSON.parse(await readFile(filename, 'utf8'));
  saved.conversations[0].messages.push({ id: 'interrupted', role: 'assistant', content: 'partial', status: 'streaming', createdAt: new Date().toISOString() });
  await writeFile(filename, JSON.stringify(saved));
  const restored = await createPetServer({ dataDir: directory, token: 'backend-test-secret', codex: mockCodex() });
  try {
    const disk = JSON.parse(await readFile(filename, 'utf8'));
    assert.equal(disk.conversations[0].id, conversation.id); assert.equal(disk.conversations[0].messages[0].status, 'error');
    assert.equal(disk.conversations[0].messages[0].content, 'partial');
  } finally { await restored.close(); }
});

test('settings validation, provider test request, and CRUD return usable errors', async t => {
  const { request } = await setup(t);
  const { provider, conversation } = await configured(request, await upstream(t));
  assert.equal((await request('/api/settings', { method: 'PATCH', body: { petName: '咪咪', persona: 'Say meow' } })).status, 200);
  assert.equal((await request('/api/settings', { method: 'PATCH', body: { petName: '' } })).status, 400);
  assert.equal((await (await request(`/api/providers/${provider.id}/test`, { method: 'POST' })).json()).ok, true);
  assert.equal((await request(`/api/conversations/${conversation.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await request(`/api/providers/${provider.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await request('/api/conversations/missing/messages', { method: 'POST', body: { content: 'go' } })).status, 404);
});

test('companion defaults to anime and switches persist without replacing shared chat or Codex history', async t => {
  const { request, directory, app } = await setup(t);
  const initial = await (await request('/api/state')).json();
  assert.equal(initial.settings.companionKind, 'anime');
  const filename = path.join(directory, 'state.json');
  assert.equal(JSON.parse(await readFile(filename, 'utf8')).settings.companionKind, 'anime');
  const { conversation } = await configured(request, await upstream(t));
  await (await request(`/api/conversations/${conversation.id}/messages`, { method: 'POST', body: { content: 'shared chat' } })).text();
  const codex = await (await request('/api/conversations', { method: 'POST', body: { mode: 'codex' } })).json();
  await (await request(`/api/conversations/${codex.id}/messages`, { method: 'POST', body: { content: 'shared work' } })).text();
  const before = await (await request('/api/state')).json();
  for (const companionKind of ['cat', 'anime', 'cat']) {
    const response = await request('/api/settings', { method: 'PATCH', body: { companionKind } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ...initial.settings, companionKind });
    assert.equal(JSON.parse(await readFile(filename, 'utf8')).settings.companionKind, companionKind);
  }
  const after = await (await request('/api/state')).json();
  assert.deepEqual(after.providers, before.providers);
  assert.deepEqual(after.conversations, before.conversations);
  await app.close();
  const restored = await createPetServer({ dataDir: directory, token: 'backend-test-secret', codex: mockCodex() });
  try {
    await listenFixture(restored.server);
    const state = await (await fetch(`http://127.0.0.1:${restored.server.address().port}/api/state`, { headers: { Authorization: 'Bearer backend-test-secret' } })).json();
    assert.equal(state.settings.companionKind, 'cat');
    assert.deepEqual(state.conversations, before.conversations);
  } finally { await restored.close(); }
});

test('companion validation rejects invalid values atomically and omitted kind preserves the current choice', async t => {
  const { request, directory } = await setup(t);
  await request('/api/settings', { method: 'PATCH', body: { companionKind: 'cat' } });
  const before = await readFile(path.join(directory, 'state.json'), 'utf8');
  for (const companionKind of [null, '', 'Cat', ' anime ', 'dog', 1, true, [], {}]) {
    const response = await request('/api/settings', { method: 'PATCH', body: { petName: 'must-not-change', companionKind } });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /anime.*cat/);
    assert.equal(await readFile(path.join(directory, 'state.json'), 'utf8'), before);
    assert.equal((await (await request('/api/state')).json()).settings.petName, '小伴');
  }
  const response = await request('/api/settings', { method: 'PATCH', body: { petName: '小暖' } });
  assert.equal((await response.json()).companionKind, 'cat');
});

test('legacy settings migrate once to anime preserving customization; invalid saved kinds are not silently replaced', async t => {
  const { request, directory, app } = await setup(t);
  await request('/api/settings', { method: 'PATCH', body: { petName: '我的名字', persona: '保留我的自定义设定。' } });
  await app.close();
  const filename = path.join(directory, 'state.json');
  const legacy = JSON.parse(await readFile(filename, 'utf8'));
  delete legacy.settings.companionKind;
  await writeFile(filename, JSON.stringify(legacy));
  const restored = await createPetServer({ dataDir: directory, token: 'backend-test-secret', codex: mockCodex() });
  await restored.close();
  const migrated = await readFile(filename, 'utf8');
  assert.deepEqual(JSON.parse(migrated), { ...legacy, settings: { ...legacy.settings, companionKind: 'anime' } });
  const again = await createPetServer({ dataDir: directory, token: 'backend-test-secret', codex: mockCodex() });
  await again.close();
  assert.equal(await readFile(filename, 'utf8'), migrated);
  const invalid = JSON.stringify({ ...legacy, settings: { ...legacy.settings, companionKind: 'unexpected' } });
  await writeFile(filename, invalid);
  await assert.rejects(createPetServer({ dataDir: directory, token: 'backend-test-secret', codex: mockCodex() }), /companionKind/);
  assert.equal(await readFile(filename, 'utf8'), invalid);
});
