import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MobileOfficialAccounts, combineOfficialAccounts } from '../server/mobile-official.mjs';
import { streamProvider } from '../server/providers.mjs';
import { createPetServer } from '../server/app.mjs';
import { listenFixture } from './helpers/loopback.mjs';

const event = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
const complete = text => event('response.completed', { response: { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }] } });
const registration = () => ({ deviceId: randomUUID(), revision: randomUUID(), models: [{ model: 'gpt-fixture', displayName: 'Fixture', supportsImages: true }] });
async function fixture(t, options = {}) {
  const sessions = new Set(['alice-session', 'bob-session']), changes = [];
  const auth = (userId = 'alice', sessionHash = `${userId}-session`) => ({ userId, sessionHash, bootstrap: false });
  const manager = await new MobileOfficialAccounts({ authorize: value => { if (value.bootstrap || !sessions.has(value.sessionHash)) throw Object.assign(new Error('Fixture revoked'), { status: 401 }); }, onChange: (userId, change) => changes.push({ userId, change }), ...options }).init();
  t.after(() => manager.close()); const data = registration(), connected = manager.connect(auth(), data), provider = manager.providers('alice')[0];
  const post = (body = { model: provider.model, input: [] }, extra = {}) => fetch(`${provider.baseUrl}/responses`, { method: 'POST', headers: { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), ...extra });
  const command = async () => (await manager.poll(connected.relayId, auth())).commands[0];
  const reply = (id, chunk, sequence = 0, done = true) => manager.reply(connected.relayId, auth(), { id, sequence, chunk, ...(done ? { done: true } : {}) });
  return { manager, sessions, changes, auth, data, connected, provider, post, command, reply };
}

test('phone catalogs isolate accounts, reject bootstrap and avoid retaining OAuth fields', async t => {
  const f = await fixture(t); assert.equal(f.manager.providers('bob').length, 0); assert.equal(f.manager.providerFor('bob', f.provider.id), undefined);
  assert.throws(() => f.manager.connect({ ...f.auth(), bootstrap: true }, registration()), /账号密码/);
  assert.throws(() => f.manager.connect(f.auth(), { ...registration(), accessToken: 'must-never-be-accepted' }), /登记字段/);
  assert.throws(() => f.manager.connect(f.auth(), { ...registration(), models: [{ ...f.data.models[0], endpoint: 'https://invalid.invalid' }] }), /目录/);
  assert.equal(f.connected.models[0].id, f.provider.id); assert.equal(f.connected.models[0].apiKey, undefined);
  assert.match(f.provider.apiKey, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(combineOfficialAccounts({ providers: () => [{ id: 'desktop' }] }, f.manager).providers('alice').length, 2);
  await assert.rejects(f.manager.poll(f.connected.relayId, f.auth('bob')), /连接不存在/);
});

test('same registration is idempotent; replacement revokes capability and never revives old work', async t => {
  const f = await fixture(t), again = f.manager.connect(f.auth(), f.data);
  assert.equal(again.relayId, f.connected.relayId); assert.equal(f.manager.providers('alice')[0].apiKey, f.provider.apiKey);
  const pending = f.post(), request = await f.command(); assert.equal(request.type, 'request');
  const replacement = f.manager.connect(f.auth(), { ...f.data, revision: randomUUID() });
  assert.notEqual(replacement.models[0].id, f.provider.id); assert.equal(f.manager.providerFor('alice', f.provider.id), undefined);
  assert.equal((await pending).status, 409); assert.equal((await f.post()).status, 409);
  await assert.rejects(f.manager.reply(f.connected.relayId, f.auth(), { id: request.id, sequence: 0, done: true }), /连接不存在/);
  await new Promise(resolve => setImmediate(resolve)); assert.ok(f.changes.some(item => item.change.previousProviderIds.includes(f.provider.id)));
});

test('Responses input is normalized, image content preserved, ordered chunks stream through standard Chat provider', async t => {
  const f = await fixture(t), events = [], run = streamProvider({ provider: f.provider, messages: [{ role: 'user', content: 'Describe', images: [{ dataUrl: 'data:image/png;base64,AAAA' }] }], persona: 'Be kind', onEvent: (type, data) => events.push({ type, data }) });
  const request = await f.command(); assert.equal(request.body.store, false); assert.equal(request.body.stream, true); assert.equal(request.body.instructions, 'Be kind'); assert.equal(request.body.input[0].content[1].type, 'input_image');
  const frame = complete('Hello phone'); await f.reply(request.id, frame.slice(0, 13), 0, false); await f.reply(request.id, frame.slice(13), 1);
  assert.equal((await run).text, 'Hello phone'); assert.equal(f.manager.requests.size, 0);
});

test('flat Chat tools project their synthetic namespace and preserve completed tool history', async t => {
  const f = await fixture(t), dispatched = [];
  const run = streamProvider({ provider: f.provider, messages: [{ role: 'user', content: 'Play music' }], onToolCall: async value => { dispatched.push(value); return { queued: true }; } });
  const first = await f.command(); assert.equal(first.body.tools[0].type, 'namespace');
  const tool = { type: 'function_call', call_id: 'fixture-call', name: 'run_agent', namespace: 'petpal', arguments: JSON.stringify({ task: 'Play requested music' }) };
  await f.reply(first.id, event('response.completed', { response: { status: 'completed', output: [tool] } }));
  const next = await f.command(); assert.equal(next.body.input.at(-2).namespace, 'petpal'); assert.equal(next.body.input.at(-1).type, 'function_call_output');
  await f.reply(next.id, complete('Queued')); assert.equal((await run).text, 'Queued'); assert.deepEqual(dispatched, [{ task: 'Play requested music' }]);
});

test('bad ordering, oversized chunks and incomplete EOF fail instead of completing a request', async t => {
  for (const invalid of [{ sequence: 1, chunk: complete('bad'), done: true }, { sequence: 0, chunk: 'x'.repeat(48 * 1024 + 1) }, { sequence: 0, chunk: ': heartbeat\n\n', done: true }]) {
    const f = await fixture(t), pending = f.post(), request = await f.command();
    await assert.rejects(f.manager.reply(f.connected.relayId, f.auth(), { id: request.id, ...invalid }), /顺序|未完成/);
    const response = await pending, body = await response.text(); assert.equal(body.includes('"status":"completed"'), false); assert.match(body, /手机官方模型/);
    assert.equal(f.manager.requests.size, 0);
  }
});

test('a completed frame is withheld until native done and invalid trailing data cannot dispatch tools', async t => {
  const f = await fixture(t), dispatched = [];
  const run = streamProvider({ provider: f.provider, messages: [{ role: 'user', content: 'Music' }], onToolCall: async value => dispatched.push(value) }).catch(error => error);
  const request = await f.command(), tool = { type: 'function_call', call_id: 'must-not-dispatch', name: 'run_agent', namespace: 'petpal', arguments: '{"task":"Play music"}' };
  await f.reply(request.id, event('response.completed', { response: { status: 'completed', output: [tool] } }), 0, false);
  await new Promise(resolve => setTimeout(resolve, 10)); assert.deepEqual(dispatched, []);
  await assert.rejects(f.reply(request.id, event('response.output_text.delta', { item_id: 'late', output_index: 0, content_index: 0, delta: 'late' }), 1), /未完成/);
  assert.ok(await run instanceof Error); assert.deepEqual(dispatched, []);
});

test('native error details never escape; revoked sessions and expired leases withdraw models', async t => {
  let now = 1000; const f = await fixture(t, { clock: () => now, leaseMs: 1000, pollMs: 100 });
  const pending = f.post(), request = await f.command(); await f.manager.reply(f.connected.relayId, f.auth(), { id: request.id, sequence: 0, error: 'private-debug-value' });
  const response = await pending; assert.equal(response.status, 502); assert.equal((await response.text()).includes('private-debug-value'), false);
  f.sessions.delete('alice-session'); assert.deepEqual(f.manager.providers('alice'), []); await assert.rejects(f.manager.poll(f.connected.relayId, f.auth()), /不存在/);
  f.sessions.add('alice-session'); f.manager.connect(f.auth(), registration()); now += 1001; assert.deepEqual(f.manager.providers('alice'), []);
});

test('HTTP cancellation propagates to phone; concurrent active model requests are bounded', async t => {
  const f = await fixture(t), abort = new AbortController(), pending = f.post(undefined, { signal: abort.signal }).catch(error => error), request = await f.command();
  abort.abort(); await pending;
  for (let count = 0; count < 100 && f.manager.requests.size; count++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.deepEqual((await f.command()), { type: 'cancel', id: request.id });
  const one = f.post(), first = await f.command(), two = f.post(), second = await f.command(); assert.notEqual(first.id, second.id);
  assert.equal((await f.post()).status, 429);
  await f.reply(first.id, complete('One')); await f.reply(second.id, complete('Two')); await Promise.all([one.then(value => value.text()), two.then(value => value.text())]);
});

test('request timeout cancels phone work and close settles outstanding gateway reads', async t => {
  const f = await fixture(t, { requestTimeoutMs: 25 }); const pending = f.post(), request = await f.command();
  assert.equal((await pending).status, 504); assert.equal((await f.command()).id, request.id);
  const another = f.post(); await f.command(); await f.manager.close(); const response = await another; assert.equal(response.status, 409); await response.text();
});

test('gateway rejects caller addresses and unknown models before placing any phone command', async t => {
  const f = await fixture(t);
  for (const value of [{ model: 'not-listed', input: [] }, { model: f.provider.model, input: [], baseUrl: 'https://must-not-fetch.invalid' }, { model: f.provider.model, input: [], profileId: 'another-profile' }]) assert.equal((await f.post(value)).status, 400);
  assert.equal(f.manager.connections.get(f.connected.relayId).commands.length, 0);
  assert.equal((await fetch(`${f.provider.baseUrl}/responses`, { method: 'POST', headers: { Origin: 'https://untrusted.invalid', Authorization: `Bearer ${f.provider.apiKey}`, 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  assert.equal((await f.post({ model: f.provider.model, input: [{ role: 'user', content: 'x'.repeat(16 * 1024 * 1024) }] })).status, 413);
  assert.equal(f.manager.requests.size, 0);
});

test('paused consumer applies real gateway backpressure to native replies and disconnect releases the blocked reply', async t => {
  const f = await fixture(t);
  const request = http.request(`${f.provider.baseUrl}/responses`, { method: 'POST', headers: { Authorization: `Bearer ${f.provider.apiKey}`, 'Content-Type': 'application/json' } }); request.on('error', () => {});
  const received = new Promise(resolve => request.once('response', response => { response.pause(); resolve(response); }));
  request.end(JSON.stringify({ model: f.provider.model, input: [] })); const command = await f.command();
  await f.manager.reply(f.connected.relayId, f.auth(), { id: command.id, sequence: 0, status: 200 }); const response = await received;
  const chunk = event('response.output_text.delta', { item_id: 'pressure-fixture', output_index: 0, content_index: 0, delta: 'x'.repeat(45000) }); let sent = 0;
  const writer = (async () => { try { for (; sent < 500; sent++) await f.reply(command.id, chunk, sent + 1, false); } catch {} })();
  let blocked = false;
  for (let attempt = 0; attempt < 400; attempt++) { const run = f.manager.requests.get(command.id); if (run?.writing && run.response.writableNeedDrain) { const before = sent; await new Promise(resolve => setTimeout(resolve, 25)); if (sent === before && f.manager.requests.has(command.id)) { blocked = true; break; } } await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.equal(blocked, true, 'native reply must await the paused consumer');
  response.destroy(); request.destroy(); await writer;
  assert.equal(f.manager.requests.size, 0); assert.equal((await f.command()).type, 'cancel');
});

async function appFixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'petpal-mobile-relay-')), bootstrap = 'fixture-owner-bootstrap';
  const bridge = { async status() { return { available: true }; }, async close() {} };
  const app = await createPetServer({ dataDir: directory, token: bootstrap, codex: bridge, codexFactory: () => bridge, desktopTools: { specs: [], async close() {} }, automationOptions: { autoStart: false } }); await listenFixture(app.server);
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  const request = (route, token = bootstrap, body, method = body === undefined ? 'GET' : 'POST') => fetch(`${origin}/api${route}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const json = async (...args) => { const response = await request(...args); return { status: response.status, data: await response.json() }; };
  const member = async name => { const created = await json('/admin/users', bootstrap, { username: name, password: 'fixture-password-123', providerIds: [] }); assert.equal(created.status, 201); const login = await json('/auth/login', bootstrap, { username: name, password: 'fixture-password-123' }); return login.data.token; };
  t.after(async () => { await app.close(); assert.equal(path.dirname(directory), path.resolve(os.tmpdir())); assert.ok(path.basename(directory).startsWith('petpal-mobile-relay-')); await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  return { app, directory, bootstrap, request, json, member };
}

test('real backend exposes session-bound mobile models only to their account and preserves Chat history without OAuth', async t => {
  const f = await appFixture(t), alice = await f.member('mobile-alice'), bob = await f.member('mobile-bob');
  assert.equal((await f.json('/mobile-official/connect', f.bootstrap, registration())).status, 403);
  const connected = await f.json('/mobile-official/connect', alice, registration()); assert.equal(connected.status, 200);
  const { relayId, models } = connected.data, providerId = models[0].id;
  for (const token of [f.bootstrap, bob]) assert.equal((await f.json('/state', token)).data.providers.some(item => item.id === providerId), false);
  const state = (await f.json('/state', alice)).data, p = state.providers.find(item => item.id === providerId); assert.equal(p.baseUrl, 'https://api.openai.com/v1'); assert.equal(p.hasApiKey, false);
  const chat = await f.json('/conversations', alice, { mode: 'chat', providerId }); assert.equal(chat.status, 201);
  const pending = f.request(`/conversations/${chat.data.id}/messages`, alice, { content: 'Phone message' });
  const command = (await f.json(`/mobile-official/${relayId}/poll`, alice)).data.commands[0];
  assert.equal((await f.json(`/mobile-official/${relayId}/reply`, bob, { id: command.id, sequence: 0, done: true })).status, 404);
  assert.equal((await f.json(`/mobile-official/${relayId}/reply`, alice, { id: command.id, sequence: 0, chunk: complete('Phone reply'), done: true })).status, 200);
  assert.match(await (await pending).text(), /Phone reply/);
  const saved = JSON.parse(await readFile(path.join(f.directory, 'state.json'), 'utf8')); assert.equal(saved.providers.length, 0); assert.equal(saved.conversations[0].messages.at(-1).content, 'Phone reply'); assert.equal(JSON.stringify(saved).includes('Bearer'), false);
  assert.equal((await f.json('/auth/logout', alice, {})).status, 200); assert.equal((await f.json(`/mobile-official/${relayId}/poll`, alice)).status, 401);
});

test('real backend routes remote PC Agent and independent review model through the phone without exposing its capability', async t => {
  const f = await appFixture(t), alice = await f.member('mobile-agent');
  const phone = (await f.json('/mobile-official/connect', alice, registration())).data, providerId = phone.models[0].id;
  const pc = await f.json('/agent/executors/register', alice, { deviceId: randomUUID(), name: 'Fixture PC', platform: 'linux', arch: 'arm64', capabilities: { projectDirectory: true, approvalReview: true, independentReviewModel: true } }); assert.equal(pc.status, 200);
  const chat = (await f.json('/conversations', alice, { mode: 'codex' })).data;
  const submitted = await f.json(`/conversations/${chat.id}/agent/submit`, alice, { submissionId: randomUUID(), hostId: pc.data.hostId, providerId, content: 'Agent phone fixture', permissions: { access: 'read-only', approval: 'review', reviewProviderId: providerId } }); assert.equal(submitted.status, 200);
  const command = (await f.json(`/agent/executors/${pc.data.connectionId}/poll`, alice)).data.commands[0]; assert.equal(command.type, 'run'); assert.equal(command.model, phone.models[0].model); assert.equal(command.reviewModel, phone.models[0].model); assert.equal(JSON.stringify(command).includes('127.0.0.1'), false);
  assert.equal((await f.json(`/agent/executors/${pc.data.connectionId}/events`, alice, { runId: command.runId, sequence: 1, event: 'started', data: {} })).status, 200);
  for (const kind of ['model', 'review']) {
    const pending = f.request(`/agent/executors/${pc.data.connectionId}/runs/${command.runId}/${kind}/responses`, command.relayToken, { model: command.model, stream: true, input: [{ role: 'user', content: `${kind} fixture` }] });
    const native = (await f.json(`/mobile-official/${phone.relayId}/poll`, alice)).data.commands[0]; assert.equal(native.type, 'request'); assert.equal(native.body.input[0].content, `${kind} fixture`);
    assert.equal((await f.json(`/mobile-official/${phone.relayId}/reply`, alice, { id: native.id, sequence: 0, chunk: complete(`${kind} complete`), done: true })).status, 200);
    const response = await pending; assert.equal(response.status, 200); assert.match(await response.text(), new RegExp(`${kind} complete`));
  }
  assert.equal((await f.json(`/agent/executors/${pc.data.connectionId}/events`, alice, { runId: command.runId, sequence: 2, event: 'complete', data: { text: 'Agent completed through phone' } })).status, 200);
  for (let count = 0; count < 100; count++) { const state = (await f.json(`/conversations/${chat.id}`, alice)).data; if (state.agent.run?.status === 'completed') { assert.equal(state.messages.at(-1).content, 'Agent completed through phone'); return; } await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.fail('Agent completion did not persist');
});
