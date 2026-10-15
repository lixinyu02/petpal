import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { OfficialAccounts, officialRequestBody } from '../desktop/official-account.mjs';

const terminal = 'event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed","output":[]}}\n\n';
const listed = (slug = 'official-one', extra = {}) => ({ slug, display_name: `官方 ${slug}`, visibility: 'list', input_modalities: ['text', 'image'], ...extra });
const until = async predicate => { const deadline = Date.now() + 2000; while (!predicate()) { if (Date.now() > deadline) throw new Error('Fixture deadline'); await new Promise(resolve => setTimeout(resolve, 5)); } };
function authFixture() {
  const users = new Map(), accesses = [];
  const signed = (userId, profileId = `profile-${userId}`, revision = `revision-${userId}`, plan = true) => {
    const state = { state: 'signed-in', activeProfileId: profileId, revision, planUsageEnabled: plan, profiles: [{ id: profileId, email: `${userId}@example.invalid`, label: userId, signedIn: true, planUsageEnabled: plan }], accessToken: `private-status-${userId}` };
    users.set(userId, state); return state;
  };
  const auth = {
    init: async () => {}, status: async userId => users.get(userId) || { state: 'signed-out', activeProfileId: null, revision: null, planUsageEnabled: false, profiles: [] },
    access: async (userId, options = {}) => { options.signal?.throwIfAborted(); accesses.push({ userId, forceRefresh: options.forceRefresh === true }); const state = users.get(userId); return { accessToken: `access-secret-${userId}${options.forceRefresh ? '-refreshed' : ''}`, profileId: state?.activeProfileId, revision: state?.revision }; },
    close: async () => { auth.closed = true; },
  };
  return { auth, users, signed, accesses };
}
async function fixture(t, { models = [listed()], onFetch, ...options } = {}) {
  const f = authFixture(), calls = [], changes = [];
  f.signed('alice');
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const override = await onFetch?.(url, init, calls);
    if (override) return override;
    return url.endsWith('/models') ? Response.json({ models }) : new Response(terminal, { headers: { 'content-type': 'text/event-stream', 'set-cookie': 'private-cookie=1', authorization: 'upstream-private' } });
  };
  const manager = new OfficialAccounts({ auth: f.auth, fetchImpl, onChange: (userId, change) => changes.push({ userId, change }), ...options });
  await manager.init(); t.after(() => manager.close());
  const provider = async (userId = 'alice') => { await manager.status(userId); return manager.providers(userId)[0]; };
  const post = (p, body = { model: p.model, input: [{ role: 'user', content: 'hello' }] }, extra = {}) => fetch(`${p.baseUrl}/responses`, { method: 'POST', headers: { Authorization: `Bearer ${p.apiKey}`, 'Content-Type': 'application/json', ...extra.headers }, body: JSON.stringify(body), ...Object.fromEntries(Object.entries(extra).filter(([key]) => key !== 'headers')) });
  return { ...f, manager, calls, changes, provider, post };
}

test('official directory filters hidden entries, preserves order, isolates users and never returns credentials in public status', async t => {
  const f = await fixture(t, { models: [listed('second'), listed('hidden', { visibility: 'hidden' }), listed('nonlisted', { visibility: 'preview' }), listed('second'), listed('first', { input_modalities: ['text'] }), listed('missing-images', { input_modalities: undefined }), listed('bad model')] });
  f.signed('bob');
  const status = await f.manager.status('alice'), alice = f.manager.providers('alice');
  assert.deepEqual(status.models.map(model => model.model), ['second', 'first', 'missing-images']);
  assert.deepEqual(status.models.map(model => model.supportsImages), [true, false, false]);
  assert.equal(status.profiles[0].email, 'alice@example.invalid');
  for (const denied of ['access-secret', 'private-status', 'apiKey', 'baseUrl', 'Bearer']) assert.equal(JSON.stringify(status).includes(denied), false);
  assert.match(alice[0].id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(alice[0].source, 'official-account'); assert.equal(alice[0].name, 'ChatGPT · 官方 second');
  assert.match(alice[0].apiKey, /^[A-Za-z0-9_-]{43}$/); assert.equal(alice[0].officialProfileId, 'profile-alice');
  assert.deepEqual(f.manager.providers('bob'), []);
  await f.manager.status('bob'); assert.notEqual(f.manager.providers('bob')[0].id, alice[0].id); assert.notEqual(f.manager.providers('bob')[0].apiKey, alice[0].apiKey);
  alice[0].model = 'mutated'; assert.equal(f.manager.providers('alice')[0].model, 'second');
  const original = f.manager.providers('alice'); await f.manager.refresh('alice');
  assert.equal(f.manager.providers('alice')[0].id, original[0].id); assert.equal(f.manager.providers('alice')[0].apiKey, original[0].apiKey);
});

test('signed-out and unconsented accounts cannot access or request an official model', async t => {
  const f = await fixture(t); f.signed('no-plan', 'profile-no-plan', 'revision-no-plan', false);
  assert.deepEqual((await f.manager.status('guest')).models, []);
  assert.deepEqual((await f.manager.status('no-plan')).models, []);
  assert.match((await f.manager.status('no-plan')).modelsError, /套餐/);
  assert.equal(f.calls.length, 0); assert.equal(f.accesses.length, 0);
  assert.deepEqual(f.manager.providers('no-plan'), []);
});

test('responses uses fixed public endpoint, bounded fields, developer input and namespaced tools', async t => {
  const f = await fixture(t), p = await f.provider();
  const response = await f.post(p, { model: p.model, input: [{ role: 'system', content: 'rules' }, { role: 'user', content: 'hello' }], stream: false, store: true, temperature: 1, top_p: 1, max_output_tokens: 20, previous_response_id: 'old', metadata: { private: true }, prompt_cache_key: 'secret', client_metadata: { transport: 'metadata' }, instructions: 'persona', reasoning: { effort: 'high' }, tools: [{ type: 'function', name: 'run_agent', parameters: { type: 'object' }, strict: true }], parallel_tool_calls: false });
  assert.equal(response.status, 200); assert.equal(await response.text(), terminal);
  assert.equal(response.headers.get('set-cookie'), null); assert.equal(response.headers.get('authorization'), null); assert.equal(response.headers.get('access-control-allow-origin'), null);
  const call = f.calls.find(item => item.url.endsWith('/responses')), body = JSON.parse(call.init.body);
  assert.equal(call.url, 'https://api.openai.com/v1/responses'); assert.equal(call.init.redirect, 'error'); assert.equal(call.init.headers.Authorization, 'Bearer access-secret-alice');
  assert.equal(body.input[0].role, 'developer'); assert.equal(body.store, false); assert.equal(body.stream, true); assert.equal(body.instructions, 'persona');
  for (const field of ['temperature', 'top_p', 'max_output_tokens', 'previous_response_id', 'metadata', 'prompt_cache_key', 'client_metadata']) assert.equal(Object.hasOwn(body, field), false);
  assert.deepEqual(body.tools, [{ type: 'namespace', name: 'petpal', tools: [{ type: 'function', name: 'run_agent', parameters: { type: 'object' }, strict: true }] }]);
  assert.equal(call.init.headers.Cookie, undefined);
});

test('existing namespaces survive; hosted tools and malformed tool choices are rejected', () => {
  const models = [{ model: 'one' }], make = tools => ({ model: 'one', input: [], tools });
  const namespace = { type: 'namespace', name: 'functions', tools: [{ type: 'custom', name: 'apply_patch', format: { type: 'text' } }] };
  assert.deepEqual(officialRequestBody(make([namespace]), models).tools, [namespace]);
  for (const tool of [{ type: 'web_search' }, { type: 'mcp', server_url: 'https://untrusted.invalid' }, { type: 'tool_search' }, { type: 'namespace', name: 'x', tools: [{ type: 'mcp' }] }]) assert.throws(() => officialRequestBody(make([tool]), models), /工具/);
  assert.throws(() => officialRequestBody({ ...make([]), tool_choice: { type: 'web_search' } }, models), /工具/);
  assert.throws(() => officialRequestBody({ ...make([]), tool_choice: { type: 'allowed_tools', mode: 'auto', tools: [{ type: 'mcp', server_url: 'https://untrusted.invalid' }] } }, models), /工具/);
  assert.throws(() => officialRequestBody(make([{ type: 'function', name: 'same' }, { type: 'function', name: 'same' }]), models), /重复/);
});

test('private gateway rejects origin, unrecognized model, caller identity, bad secret, paths and HTTP methods', async t => {
  const f = await fixture(t), p = await f.provider();
  for (const extra of [{ headers: { Origin: 'https://untrusted.invalid' } }, { headers: { Authorization: 'Bearer no-secret' } }]) assert.ok((await f.post(p, undefined, extra)).status >= 400);
  for (const body of [{ model: 'unauthorized', input: [] }, { model: p.model, input: 'text' }, { model: p.model, input: [null] }, { model: p.model, input: [], userId: 'bob' }, { model: p.model, input: [], base_url: 'https://untrusted.invalid' }, { model: p.model, input: [], token: 'stolen' }]) assert.equal((await f.post(p, body)).status, 400);
  for (const url of [`${p.baseUrl}/models`, `${p.baseUrl}/responses?x=1`, `${p.baseUrl}/responses/`]) assert.equal((await fetch(url, { method: 'POST' })).status, 403);
  assert.equal((await fetch(`${p.baseUrl}/responses`)).status, 403);
  assert.equal(f.calls.filter(item => item.url.endsWith('/responses')).length, 0);
  const wrongHost = await new Promise((resolve, reject) => { const req = http.request(`${p.baseUrl}/responses`, { method: 'POST', headers: { Host: 'evil.invalid', Authorization: `Bearer ${p.apiKey}` } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); req.end('{}'); });
  assert.equal(wrongHost, 403);
});

test('request size limit blocks content length and streamed oversized bodies without contacting official service', async t => {
  const f = await fixture(t, { maxBytes: 128 }), p = await f.provider();
  assert.equal((await f.post(p, { model: p.model, input: [{ role: 'user', content: 'x'.repeat(256) }] })).status, 413);
  const streamed = await new Promise((resolve, reject) => { const req = http.request(`${p.baseUrl}/responses`, { method: 'POST', headers: { Authorization: `Bearer ${p.apiKey}`, 'Transfer-Encoding': 'chunked' } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); req.write('{"padding":"'); req.end('a'.repeat(256) + '"}'); });
  assert.equal(streamed, 413); assert.equal(f.calls.filter(item => item.url.endsWith('/responses')).length, 0);
});

test('identity transitions synchronously revoke prior secret and use distinct stable profile model IDs', async t => {
  const f = await fixture(t), old = await f.provider();
  const state = f.signed('alice', 'different-profile', 'different-revision');
  const changing = f.manager.changed('alice', state);
  assert.deepEqual(f.manager.providers('alice'), []); assert.equal((await f.post(old)).status, 401);
  assert.deepEqual(f.changes.find(item => item.change.identityChanged), { userId: 'alice', change: { identityChanged: true, previousProviderIds: [old.id] } });
  await changing; const next = f.manager.providers('alice')[0]; assert.notEqual(next.id, old.id); assert.notEqual(next.apiKey, old.apiKey);
  f.users.delete('alice'); await f.manager.changed('alice', await f.auth.status('alice')); assert.deepEqual(f.manager.providers('alice'), []); assert.equal((await f.post(next)).status, 401);
});

test('ordinary refresh and pending-login cancellation preserve current profile secret and active stream', async t => {
  let upstreamController, requestSignal;
  const f = await fixture(t, { onFetch: (url, init) => { if (url.endsWith('/responses')) { requestSignal = init.signal; return new Response(new ReadableStream({ start(controller) { upstreamController = controller; controller.enqueue(new TextEncoder().encode('event: ping\ndata: {}\n\n')); } }), { headers: { 'content-type': 'text/event-stream' } }); } } });
  const p = await f.provider(), response = await f.post(p), reading = response.text();
  const state = { ...f.users.get('alice'), state: 'signing-in' }; f.users.set('alice', state);
  await f.manager.changed('alice', state); assert.equal(requestSignal.aborted, false); assert.equal(f.manager.providers('alice')[0].apiKey, p.apiKey);
  await f.manager.refresh('alice'); assert.equal(requestSignal.aborted, false); assert.equal(f.manager.providers('alice')[0].apiKey, p.apiKey);
  const originalFetch = f.manager.fetch;
  f.manager.fetch = async () => { throw new Error('network unavailable'); };
  await f.manager.refresh('alice'); assert.equal(requestSignal.aborted, false); assert.deepEqual(f.manager.providers('alice'), []);
  f.manager.fetch = originalFetch; await f.manager.refresh('alice'); assert.equal(f.manager.providers('alice')[0].apiKey, p.apiKey); assert.equal(requestSignal.aborted, false);
  upstreamController.enqueue(new TextEncoder().encode(terminal)); upstreamController.close(); assert.match(await reading, /response.completed/);
  assert.equal(f.changes.some(item => item.change.identityChanged), false);
});

test('401 before SSE retries at most once using force-refreshed access, never forwards error secrets', async t => {
  let attempts = 0;
  const f = await fixture(t, { onFetch: url => url.endsWith('/responses') && ++attempts <= 1 ? new Response('upstream-private-secret', { status: 401 }) : undefined });
  const p = await f.provider(), response = await f.post(p); assert.equal(response.status, 200); await response.text();
  assert.equal(attempts, 2); assert.equal(f.accesses.filter(access => access.forceRefresh).length, 1);
  assert.equal(f.calls.filter(item => item.url.endsWith('/responses'))[1].init.headers.Authorization, 'Bearer access-secret-alice-refreshed');
  f.manager.fetch = async url => url.endsWith('/responses') ? new Response('access-secret-alice private upstream message', { status: 401 }) : Response.json({ models: [listed()] });
  const failed = await f.post(p); assert.equal(failed.status, 401); const message = await failed.text(); assert.equal(message.includes('access-secret'), false); assert.equal(message.includes('private upstream'), false);
  assert.equal(f.accesses.filter(access => access.forceRefresh).length, 2);
});

test('model catalog retries 401 once, rejects API-key-shaped and oversized directories', async t => {
  let attempts = 0;
  const f = await fixture(t, { onFetch: url => url.endsWith('/models') && ++attempts === 1 ? new Response('', { status: 401 }) : undefined });
  await f.provider(); assert.equal(attempts, 2); assert.equal(f.accesses.filter(access => access.forceRefresh).length, 1);
  f.manager.fetch = async () => Response.json({ data: [{ id: 'not-chatgpt-directory' }] });
  const invalid = await f.manager.refresh('alice'); assert.match(invalid.modelsError, /目录格式/); assert.deepEqual(invalid.models, []);
  f.manager.fetch = async () => new Response('{}', { headers: { 'content-length': String(3 * 1024 * 1024), 'content-type': 'application/json' } });
  const huge = await f.manager.refresh('alice'); assert.match(huge.modelsError, /大小限制/); assert.deepEqual(f.manager.providers('alice'), []);
});

test('catalog access failure is redacted, late stale catalog cannot restore switched profile grants', async t => {
  let release;
  const f = await fixture(t), p = await f.provider();
  const delayed = new Promise(resolve => { release = resolve; });
  f.manager.fetch = async (url, init) => { if (init.headers.Authorization === 'Bearer access-secret-alice') await delayed; return Response.json({ models: [listed()] }); };
  const refresh = f.manager.refresh('alice'); await new Promise(resolve => setTimeout(resolve, 5));
  const state = f.signed('alice', 'new-profile', 'new-revision');
  // The new identity's fetch must proceed independently of the discarded one.
  f.manager.fetch = async () => Response.json({ models: [listed('new-model')] });
  await f.manager.changed('alice', state); release(); await refresh;
  assert.deepEqual(f.manager.providers('alice').map(item => item.model), ['new-model']); assert.equal((await f.post(p)).status, 401);
  f.manager.fetch = async () => { throw new Error('Bearer access-secret-alice example private details'); };
  const failed = await f.manager.refresh('alice'); assert.equal(JSON.stringify(failed).includes('access-secret'), false); assert.match(failed.modelsError, /连接失败/);
});

test('profile switch and downstream cancellation abort SSE without retry or fabricated terminal completion', async t => {
  const signals = []; let cancelled = 0;
  const f = await fixture(t, { onFetch: (url, init) => url.endsWith('/responses') ? (signals.push(init.signal), new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('event: response.output_text.delta\ndata: {"delta":"hello"}\n\n')); }, cancel() { cancelled++; } }), { headers: { 'content-type': 'text/event-stream' } })) : undefined });
  const p = await f.provider(), response = await f.post(p), reading = response.text();
  const state = f.signed('alice', 'new-profile', 'new-revision'); await f.manager.changed('alice', state);
  await assert.rejects(reading); assert.equal(signals[0].aborted, true); await until(() => cancelled >= 1);
  const next = f.manager.providers('alice')[0], controller = new AbortController(), second = await f.post(next, undefined, { signal: controller.signal });
  const secondRead = second.text(); controller.abort(); await assert.rejects(secondRead); await until(() => signals[1].aborted);
  assert.equal(f.calls.filter(item => item.url.endsWith('/responses')).length, 2); assert.equal(f.accesses.filter(access => access.forceRefresh).length, 0);
});

test('upstream broken SSE ends verbatim without fake completion and aborts are never retried', async t => {
  const incomplete = 'event: response.output_text.delta\ndata: {"delta":"unfinished"}\n\n';
  const f = await fixture(t, { onFetch: url => url.endsWith('/responses') ? new Response(incomplete, { headers: { 'content-type': 'text/event-stream' } }) : undefined });
  const response = await f.post(await f.provider()); assert.equal(await response.text(), incomplete); assert.equal(f.calls.filter(item => item.url.endsWith('/responses')).length, 1);
});

test('SSE error bodies redact unknown refresh secrets and known access tokens across transport chunks', async t => {
  const value = 'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"access-secret-alice"}\n\nevent: response.failed\ndata: {"type":"response.failed","response":{"error":{"message":"refresh-secret-not-visible-to-gateway access-secret-alice"}}}\n\n';
  const chunks = [value.slice(0, 91), value.slice(91, 103), value.slice(103, 130), value.slice(130)];
  const f = await fixture(t, { onFetch: url => url.endsWith('/responses') ? new Response(new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk)); controller.close(); } }), { headers: { 'content-type': 'text/event-stream' } }) : undefined });
  const response = await f.post(await f.provider()), result = await response.text();
  assert.equal(result.includes('access-secret-alice'), false); assert.equal(result.includes('refresh-secret-not-visible-to-gateway'), false); assert.match(result, /\[redacted\]/); assert.match(result, /response.failed/); assert.equal(result.includes('response.completed'), false);
});

test('streaming timeout closes an idle upstream and oversized SSE frames terminate without completion', async t => {
  let signal, cancelled = false;
  const f = await fixture(t, { requestTimeoutMs: 80, onFetch: (url, init) => url.endsWith('/responses') ? (signal = init.signal, new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('event: ping\ndata: {}\n\n')); }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/event-stream' } })) : undefined });
  const response = await f.post(await f.provider()); await assert.rejects(response.text()); await until(() => signal.aborted && cancelled);
  f.manager.fetch = async () => new Response(`data: ${'x'.repeat(2 * 1024 * 1024 + 1)}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  const huge = await f.post(f.manager.providers('alice')[0]); await assert.rejects(huge.text());
});

test('slow downstream applies backpressure, client disconnect cancels source, close revokes all providers', async t => {
  let pulled = 0, cancelled = false, signal;
  const f = await fixture(t, { onFetch: (url, init) => {
    if (!url.endsWith('/responses')) return;
    signal = init.signal;
    const chunk = new TextEncoder().encode(`data: ${'x'.repeat(65536)}\n\n`);
    return new Response(new ReadableStream({ pull(controller) { pulled++; if (pulled > 2000) controller.close(); else controller.enqueue(chunk); }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/event-stream' } });
  } });
  const p = await f.provider();
  const request = http.request(`${p.baseUrl}/responses`, { method: 'POST', headers: { Authorization: `Bearer ${p.apiKey}`, 'Content-Type': 'application/json' } });
  request.on('error', () => {});
  const received = new Promise(resolve => request.once('response', response => { response.pause(); resolve(response); }));
  request.end(JSON.stringify({ model: p.model, input: [] })); const response = await received;
  await new Promise(resolve => setTimeout(resolve, 25)); assert.ok(pulled < 2000, `reads should stop while the client is paused: ${pulled}`);
  response.destroy(); request.destroy(); await until(() => signal.aborted && cancelled);
  await f.manager.close(); assert.deepEqual(f.manager.providers('alice'), []); assert.equal(f.auth.closed, true); assert.deepEqual((await f.manager.status('alice')).models, []); await assert.rejects(f.manager.init(), /关闭/);
});
