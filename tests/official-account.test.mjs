import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { OfficialAccounts, officialRequestBody } from '../desktop/official-account.mjs';
import { streamProvider } from '../server/providers.mjs';
import { CodexBridge, resolveBundledCodex } from '../server/codex.mjs';
import { defaultCodexConfig, patchCodexConfig } from '../server/codex-config.mjs';

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
  assert.equal(body.tools[0].type, 'namespace'); assert.equal(body.tools[0].name, 'petpal'); assert.match(body.tools[0].description, /PetPal/);
  assert.deepEqual(body.tools[0].tools, [{ type: 'function', name: 'run_agent', parameters: { type: 'object' }, strict: true }]);
  assert.equal(call.init.headers.Cookie, undefined);
});

test('existing namespaces survive; hosted tools and malformed tool choices are rejected', () => {
  const models = [{ model: 'one' }], make = tools => ({ model: 'one', input: [], tools });
  const namespace = { type: 'namespace', name: 'functions', description: 'Caller-owned namespace', tools: [{ type: 'custom', name: 'apply_patch', format: { type: 'text' } }] };
  assert.deepEqual(officialRequestBody(make([namespace]), models).tools, [namespace]);
  for (const tool of [{ type: 'web_search' }, { type: 'mcp', server_url: 'https://untrusted.invalid' }, { type: 'tool_search' }, { type: 'namespace', name: 'x', tools: [{ type: 'mcp' }] }]) assert.throws(() => officialRequestBody(make([tool]), models), /工具/);
  assert.throws(() => officialRequestBody({ ...make([]), tool_choice: { type: 'web_search' } }, models), /工具/);
  assert.throws(() => officialRequestBody({ ...make([]), tool_choice: { type: 'allowed_tools', mode: 'auto', tools: [{ type: 'mcp', server_url: 'https://untrusted.invalid' }] } }, models), /工具/);
  assert.throws(() => officialRequestBody(make([{ type: 'function', name: 'same' }, { type: 'function', name: 'same' }]), models), /重复/);
});

const event = (type, value) => `event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`;
function toolResponse(name, args, namespace = 'petpal') {
  const item = { id: 'fc_official_fixture', type: 'function_call', call_id: 'call_official_fixture', name, namespace, arguments: JSON.stringify(args), status: 'completed' };
  return event('response.created', { response: { id: 'resp_tool_fixture', status: 'in_progress', output: [] } }) + event('response.output_item.added', { output_index: 0, item: { ...item, arguments: '', status: 'in_progress' } }) + event('response.function_call_arguments.delta', { item_id: item.id, output_index: 0, delta: item.arguments }) + event('response.function_call_arguments.done', { item_id: item.id, output_index: 0, arguments: item.arguments }) + event('response.output_item.done', { output_index: 0, item }) + event('response.completed', { response: { id: 'resp_tool_fixture', status: 'completed', output: [item] } });
}
function messageResponse(text) {
  const item = { id: 'msg_official_fixture', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] };
  return event('response.created', { response: { id: 'resp_message_fixture', status: 'in_progress', output: [] } }) + event('response.output_item.added', { output_index: 0, item: { ...item, content: [], status: 'in_progress' } }) + event('response.content_part.added', { item_id: item.id, output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } }) + event('response.output_text.delta', { item_id: item.id, output_index: 0, content_index: 0, delta: text }) + event('response.output_text.done', { item_id: item.id, output_index: 0, content_index: 0, text }) + event('response.content_part.done', { item_id: item.id, output_index: 0, content_index: 0, part: item.content[0] }) + event('response.output_item.done', { output_index: 0, item }) + event('response.completed', { response: { id: 'resp_message_fixture', status: 'completed', output: [item] } });
}

test('synthetic namespaces project only flat function/custom calls and preserve all IDs and caller-owned history', async t => {
  const models = [{ model: 'one' }], tools = [{ type: 'namespace', name: 'petpal', description: 'Original namespace', tools: [{ type: 'function', name: 'original' }] }, { type: 'function', name: 'run_agent' }, { type: 'custom', name: 'apply_patch' }];
  const input = [{ type: 'function_call', id: 'fc1', call_id: 'call1', name: 'run_agent', arguments: '{}' }, { type: 'function_call_output', call_id: 'call1', output: '{"queued":true}' }, { type: 'custom_tool_call', id: 'ct1', call_id: 'call2', name: 'apply_patch', input: 'patch bytes' }, { type: 'custom_tool_call_output', call_id: 'call2', output: 'denied' }, { type: 'function_call', id: 'fc2', call_id: 'call3', namespace: 'petpal', name: 'original', arguments: '{}' }];
  const body = officialRequestBody({ model: 'one', input, tools }, models);
  assert.equal(body.tools[1].name, 'petpal_'); assert.equal(body.input[0].namespace, 'petpal_'); assert.equal(body.input[2].namespace, 'petpal_');
  assert.deepEqual(body.input[1], input[1]); assert.deepEqual(body.input[3], input[3]); assert.deepEqual(body.input[4], input[4]);
  assert.equal(Object.hasOwn(input[0], 'namespace'), false);
  const f = await fixture(t, { onFetch: url => url.endsWith('/responses') ? new Response(toolResponse('original', {}, 'petpal'), { headers: { 'content-type': 'text/event-stream' } }) : undefined });
  const p = await f.provider(), response = await f.post(p, { model: p.model, input: [], tools }); assert.match(await response.text(), /"namespace":"petpal"/);
});

test('real Chat provider dispatches run_agent once and sends full namespaced tool history back through official gateway', async t => {
  const requests = [], dispatched = [], reasoning = { id: 'rs_fixture', type: 'reasoning', summary: [], encrypted_content: 'fixture-encrypted-reasoning' };
  const f = await fixture(t, { onFetch: (url, init) => {
    if (!url.endsWith('/responses')) return;
    const body = JSON.parse(init.body); requests.push(body); assert.equal(body.store, false); assert.equal(body.stream, true); assert.equal(body.previous_response_id, undefined);
    assert.equal(body.tools[0].type, 'namespace'); assert.equal(body.tools[0].name, 'petpal'); assert.match(body.tools[0].description, /PetPal/);
    if (requests.length === 1) {
      assert.deepEqual(body.include, ['reasoning.encrypted_content']);
      const call = { id: 'fc_chat_fixture', type: 'function_call', call_id: 'call_chat_fixture', namespace: 'petpal', name: 'run_agent', arguments: JSON.stringify({ task: '在预选电脑打开音乐。' }), status: 'completed' };
      return new Response(event('response.completed', { response: { id: 'resp_chat_fixture', status: 'completed', output: [reasoning, call] } }), { headers: { 'content-type': 'text/event-stream' } });
    }
    assert.equal(body.tool_choice, 'none'); assert.equal(body.input.length, 6); assert.deepEqual(body.input.slice(0, 3), [{ role: 'user', content: '之前的问题' }, { role: 'assistant', content: '之前的回复' }, { role: 'user', content: '打开音乐' }]);
    assert.deepEqual(body.input[3], reasoning); assert.equal(body.input[4].namespace, 'petpal'); assert.equal(body.input[4].call_id, 'call_chat_fixture');
    assert.deepEqual(body.input[5], { type: 'function_call_output', call_id: 'call_chat_fixture', output: JSON.stringify({ status: 'queued', hostName: '预选电脑' }) });
    return new Response(messageResponse('任务已经交给预选电脑。'), { headers: { 'content-type': 'text/event-stream' } });
  } });
  const provider = await f.provider();
  const result = await streamProvider({ provider, persona: 'Fixture companion', messages: [{ role: 'user', content: '之前的问题' }, { role: 'assistant', content: '之前的回复' }, { role: 'user', content: '打开音乐' }], onToolCall: async args => { dispatched.push(args); return { status: 'queued', hostName: '预选电脑' }; } });
  assert.equal(result.text, '任务已经交给预选电脑。'); assert.deepEqual(dispatched, [{ task: '在预选电脑打开音乐。' }]); assert.equal(requests.length, 2);
});

test('bundled Codex executes a namespaced official function once, keeps history and emits no unsupported hosted tool', { timeout: 45000 }, async t => {
  const requests = [], errors = []; let executed = 0;
  const f = await fixture(t, { models: [listed('gpt-5.4')], onFetch: (url, init) => {
    if (!url.endsWith('/responses')) return;
    try {
      const body = JSON.parse(init.body); requests.push(body);
      assert.equal(body.store, false); assert.equal(body.stream, true); assert.equal(body.previous_response_id, undefined);
      assert.ok(body.tools.every(item => item.type === 'namespace')); assert.ok(body.tools.every(item => typeof item.description === 'string' && item.description));
      assert.doesNotMatch(JSON.stringify(body.tools), /"type":"(?:tool_search|mcp|computer_use_preview|image_generation|code_interpreter|file_search)"/);
      const output = body.input.find(item => item.type === 'function_call_output' && item.call_id === 'call_official_fixture');
      if (output) {
        assert.match(JSON.stringify(output.output), /mock-execution/);
        const call = body.input.find(item => item.type === 'function_call' && item.call_id === output.call_id); assert.equal(call.name, 'petpal_probe'); assert.equal(call.namespace, 'petpal');
        return new Response(messageResponse('官方协议本地模拟工具完成。'), { headers: { 'content-type': 'text/event-stream' } });
      }
      return new Response(toolResponse('petpal_probe', { value: 'fixture' }), { headers: { 'content-type': 'text/event-stream' } });
    } catch (error) { errors.push(error); throw error; }
  } });
  const provider = await f.provider(), directory = await mkdtemp(path.join(os.tmpdir(), 'petpal-official-cli-'));
  const config = patchCodexConfig(defaultCodexConfig(), { mode: 'api', baseUrl: provider.baseUrl, model: provider.model, apiKey: provider.apiKey });
  const command = await resolveBundledCodex(); assert.ok(command?.file);
  const bridge = new CodexBridge({ dataDir: directory, config, command: command.file, desktopTools: { specs: [{ type: 'function', name: 'petpal_probe', description: 'Fixture-only local operation with no actual desktop effects.', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false } }], describe: () => ({ description: 'Fixture only', approvalRequired: false }), execute: async (name, args) => { assert.equal(name, 'petpal_probe'); assert.deepEqual(args, { value: 'fixture' }); executed++; return { ok: true, source: 'mock-execution' }; } } });
  t.after(async () => { await bridge.close(); assert.ok(directory.startsWith(path.join(os.tmpdir(), 'petpal-official-cli-'))); await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  const result = await bridge.run({ prompt: 'Call the fixture tool and summarize.', permissions: { access: 'full-access', approval: 'auto' } });
  assert.equal(result.text, '官方协议本地模拟工具完成。'); assert.equal(executed, 1); assert.equal(requests.length, 2); assert.equal(errors.length, 0, errors[0]?.message);
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

test('a transient catalog failure hides new choices but private same-identity grants can finish multi-step work', async t => {
  const f = await fixture(t), provider = await f.provider(), originalFetch = f.manager.fetch;
  assert.deepEqual(f.manager.providerFor('alice', provider.id), provider); assert.equal(f.manager.providerFor('bob', provider.id), undefined);
  const copy = f.manager.providerFor('alice', provider.id); copy.model = 'mutated'; assert.equal(f.manager.providerFor('alice', provider.id).model, provider.model);
  f.manager.fetch = async (url, init) => { if (url.endsWith('/models')) throw new Error('transient catalog outage'); return originalFetch(url, init); };
  const status = await f.manager.refresh('alice'); assert.deepEqual(status.models, []); assert.deepEqual(f.manager.providers('alice'), []); assert.match(status.modelsError, /连接失败/);
  const continuation = f.manager.providerFor('alice', provider.id); assert.deepEqual(continuation, provider);
  const response = await f.post(continuation); assert.equal(response.status, 200); assert.equal(await response.text(), terminal);
  assert.equal((await f.post(provider, { model: 'never-granted', input: [] })).status, 400); assert.equal(f.manager.providerFor('alice', 'unknown-provider'), undefined);
  f.manager.fetch = originalFetch; const state = f.signed('alice', 'different-profile', 'different-revision'); await f.manager.changed('alice', state);
  assert.equal(f.manager.providerFor('alice', provider.id), undefined); assert.equal((await f.post(provider)).status, 401);
  await f.manager.close(); assert.equal(f.manager.providerFor('alice', f.manager.providers('alice')[0]?.id), undefined);
});

test('official usage starts unverified and counts only sanitized completed-request token usage per identity', async t => {
  const complete = usage => event('response.completed', { response: { status: 'completed', output: [], usage } });
  let payload = complete({ input_tokens: 100, output_tokens: 20, total_tokens: 120 });
  const f = await fixture(t, { onFetch: url => url.endsWith('/responses') ? new Response(payload, { headers: { 'content-type': 'text/event-stream', 'x-ratelimit-remaining-tokens': '999999', 'x-ratelimit-reset-tokens': '5h' } }) : undefined });
  const provider = await f.provider(), initial = (await f.manager.status('alice')).usage;
  assert.deepEqual(initial, { state: 'unverified', checkedAt: null, lastModel: null, completedRequests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 });
  await (await f.post(provider)).text(); const first = (await f.manager.status('alice')).usage;
  assert.equal(first.state, 'available'); assert.equal(first.lastModel, provider.model); assert.ok(Number.isFinite(Date.parse(first.checkedAt))); assert.equal(first.completedRequests, 1); assert.equal(first.inputTokens, 100); assert.equal(first.outputTokens, 20); assert.equal(first.totalTokens, 120);
  assert.doesNotMatch(JSON.stringify(first), /percent|remaining|reset|999999|access-secret|apiKey/);
  assert.deepEqual((await f.manager.refresh('alice')).usage, first);
  payload = complete({ input_tokens: -1, output_tokens: 0.5, total_tokens: '300' }) + complete({ input_tokens: 999, output_tokens: 999, total_tokens: 999 });
  await (await f.post(provider)).text(); const second = (await f.manager.status('alice')).usage;
  assert.equal(second.completedRequests, 2); assert.equal(second.inputTokens, 100); assert.equal(second.outputTokens, 20); assert.equal(second.totalTokens, 120);
  f.signed('bob'); assert.deepEqual((await f.manager.status('bob')).usage, initial);
  const state = f.signed('alice', 'new-profile', 'new-revision'); await f.manager.changed('alice', state); assert.deepEqual((await f.manager.status('alice')).usage, initial);
});

test('usage-limit HTTP errors preserve the safe code, pause subsequent inference and require explicit resume', async t => {
  let failed = true;
  const f = await fixture(t, { onFetch: url => url.endsWith('/responses') && failed ? Response.json({ error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'PRIVATE-upstream-token access-secret-alice' } }, { status: 429 }) : undefined });
  const provider = await f.provider(), response = await f.post(provider); assert.equal(response.status, 429); const error = await response.json();
  assert.equal(error.error.code, 'subscription_sharing_usage_limit_exceeded'); assert.doesNotMatch(JSON.stringify(error), /PRIVATE-|access-secret/);
  const limited = (await f.manager.status('alice')).usage; assert.equal(limited.state, 'limit-reached'); assert.equal(limited.completedRequests, 0); assert.equal(limited.lastModel, provider.model); assert.ok(limited.checkedAt);
  const calls = f.calls.filter(item => item.url.endsWith('/responses')).length, accesses = f.accesses.length;
  assert.equal((await f.post(provider)).status, 429); assert.equal(f.calls.filter(item => item.url.endsWith('/responses')).length, calls); assert.equal(f.accesses.length, accesses);
  assert.equal((await f.manager.refresh('alice')).usage.state, 'limit-reached');
  const resumed = await f.manager.resumeUsage('alice'); assert.equal(resumed.usage.state, 'unverified'); assert.equal(resumed.usage.checkedAt, limited.checkedAt); assert.equal(resumed.usage.completedRequests, 0); assert.equal(f.calls.filter(item => item.url.endsWith('/responses')).length, calls);
  failed = false; await (await f.post(provider)).text(); assert.equal((await f.manager.status('alice')).usage.state, 'available');
});

test('an older in-flight successful request counts real tokens without clearing a newer usage pause', async t => {
  let controller, requests = 0;
  const f = await fixture(t, { onFetch: url => {
    if (!url.endsWith('/responses')) return;
    if (++requests === 1) return new Response(new ReadableStream({ start(source) { controller = source; source.enqueue(new TextEncoder().encode(event('response.output_text.delta', { delta: 'older request' }))); } }), { headers: { 'content-type': 'text/event-stream' } });
    return Response.json({ error: { code: 'subscription_sharing_usage_limit_exceeded' } }, { status: 429 });
  } });
  const provider = await f.provider(), older = await f.post(provider), reading = older.text();
  assert.equal((await f.post(provider)).status, 429); assert.equal((await f.manager.status('alice')).usage.state, 'limit-reached');
  controller.enqueue(new TextEncoder().encode(event('response.completed', { response: { status: 'completed', output: [], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } } }))); controller.close(); await reading;
  const usage = (await f.manager.status('alice')).usage; assert.equal(usage.state, 'limit-reached'); assert.equal(usage.completedRequests, 1); assert.equal(usage.totalTokens, 15);
  assert.equal((await f.post(provider)).status, 429); assert.equal(requests, 2);
  const resumed = (await f.manager.resumeUsage('alice')).usage; assert.equal(resumed.state, 'unverified'); assert.equal(resumed.checkedAt, usage.checkedAt); assert.equal(resumed.totalTokens, 15);
});

test('usage retry rechecks the current native session after asynchronous identity lookup', async t => {
  const f = await fixture(t, { onFetch: url => url.endsWith('/responses') ? Response.json({ error: { code: 'subscription_sharing_usage_limit_exceeded' } }, { status: 429 }) : undefined });
  const provider = await f.provider(); await f.post(provider);
  let checks = 0;
  await assert.rejects(f.manager.resumeUsage('alice', { authorize: async () => { if (++checks > 1) throw new Error('Session changed'); } }), /Session changed/);
  assert.equal((await f.manager.status('alice')).usage.state, 'limit-reached');
  assert.equal((await f.post(provider)).status, 429);
});

for (const [code, expected, status] of [['subscription_sharing_usage_limit_exceeded', 'limit-reached', 429], ['subscription_sharing_usage_unavailable', 'temporarily-unavailable', 503], ['subscription_sharing_user_not_eligible', 'not-eligible', 403]]) {
  test(`streamed ${code} updates usage without fabricating successful request or tokens`, async t => {
    const failure = event('response.output_text.delta', { delta: 'partial reply' }) + event('response.failed', { response: { status: 'failed', error: { code, message: 'PRIVATE refresh secret' }, usage: { input_tokens: 999, output_tokens: 999, total_tokens: 1998 } } });
    const f = await fixture(t, { onFetch: url => url.endsWith('/responses') ? new Response(failure, { headers: { 'content-type': 'text/event-stream' } }) : undefined });
    const provider = await f.provider(), response = await f.post(provider); assert.equal(response.status, 200); const value = await response.text(); assert.match(value, new RegExp(code)); assert.doesNotMatch(value, /PRIVATE|1998|response.completed/);
    const usage = (await f.manager.status('alice')).usage; assert.equal(usage.state, expected); assert.equal(usage.completedRequests, 0); assert.equal(usage.totalTokens, 0); assert.ok(usage.checkedAt);
    const before = f.calls.length; const next = await f.post(provider);
    if (expected === 'temporarily-unavailable') { assert.equal(next.status, 200); await next.text(); assert.equal(f.calls.length, before + 1); }
    else { assert.equal(next.status, status); await next.text(); assert.equal(f.calls.length, before); }
  });
}

test('EOF, incomplete response and unrelated HTTP failures do not manufacture quota verification or token usage', async t => {
  let value = event('response.output_text.delta', { delta: 'unfinished' });
  const f = await fixture(t, { onFetch: url => url.endsWith('/responses') ? new Response(value, { headers: { 'content-type': 'text/event-stream' } }) : undefined });
  const provider = await f.provider(); await (await f.post(provider)).text(); const initial = (await f.manager.status('alice')).usage; assert.equal(initial.state, 'unverified'); assert.equal(initial.checkedAt, null); assert.equal(initial.completedRequests, 0);
  value = event('response.incomplete', { response: { status: 'incomplete', usage: { total_tokens: 10 } } }); await (await f.post(provider)).text(); assert.deepEqual((await f.manager.status('alice')).usage, initial);
  const fetchImpl = f.manager.fetch; f.manager.fetch = async (url, init) => url.endsWith('/responses') ? Response.json({ error: { code: 'unrelated_error', message: 'PRIVATE diagnostics' } }, { status: 503 }) : fetchImpl(url, init);
  const failed = await f.post(provider); assert.equal(failed.status, 503); assert.doesNotMatch(await failed.text(), /PRIVATE|unrelated_error/); assert.deepEqual((await f.manager.status('alice')).usage, initial);
});

test('wrong MIME diagnostics reveal only safe JSON status/type/output categories without accepting success or usage', async t => {
  const f = await fixture(t, { onFetch: url => url.endsWith('/responses') ? Response.json({ object: 'response', status: 'completed', output: [{ type: 'message', content: 'PRIVATE-BODY access-secret-alice' }], usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 }, private: 'PRIVATE-BODY', error: { code: 'unknown-private-code', message: 'PRIVATE-BODY' } }, { status: 200, headers: { 'content-type': 'application/json; private=PRIVATE-HEADER' } }) : undefined });
  const p = await f.provider(), response = await f.post(p); assert.equal(response.status, 502); const text = await response.text();
  assert.match(text, /上游 HTTP 200/); assert.match(text, /内容类型 json/); assert.match(text, /status=completed/); assert.match(text, /type=response/); assert.match(text, /output=present/); assert.match(text, /json-object/);
  assert.doesNotMatch(text, /PRIVATE-|access-secret|unknown-private-code|input_tokens|120/);
  assert.deepEqual((await f.manager.status('alice')).usage, { state: 'unverified', checkedAt: null, lastModel: null, completedRequests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 });
});

test('wrong MIME SSE prefixes and known sharing error shapes stay strict failures and never print raw bodies', async t => {
  let body = event('response.completed', { response: { status: 'completed', output: [], usage: { total_tokens: 100 } }, private: 'PRIVATE-EVENT' });
  let mime = 'text/plain; secret=PRIVATE-HEADER';
  const f = await fixture(t, { onFetch: url => url.endsWith('/responses') ? new Response(body, { headers: { 'content-type': mime } }) : undefined });
  const p = await f.provider(); let response = await f.post(p), value = await response.text(); assert.equal(response.status, 502); assert.match(value, /内容类型 plain/); assert.match(value, /sse-prefix/); assert.doesNotMatch(value, /PRIVATE-|total_tokens|response.completed/);
  mime = 'application/json'; response = await f.post(p); value = await response.text(); assert.equal(response.status, 502); assert.match(value, /内容类型 json/); assert.match(value, /sse-prefix/); assert.doesNotMatch(value, /PRIVATE-|total_tokens|response.completed/);
  body = JSON.stringify({ type: 'error', error: { code: 'subscription_sharing_usage_unavailable', message: 'PRIVATE-ERROR' } }); response = await f.post(p); value = await response.text();
  assert.equal(response.status, 502); assert.match(value, /json-object/); assert.match(value, /error=subscription_sharing_usage_unavailable/); assert.doesNotMatch(value, /PRIVATE-ERROR/);
  assert.equal((await f.manager.status('alice')).usage.state, 'unverified'); assert.equal((await f.manager.status('alice')).usage.completedRequests, 0);
});

test('missing MIME validates fragmented BOM, comments and complete SSE frames before real Chat replay and usage', async t => {
  const source = '\uFEFF\n: keepalive\n\nid: fixture\nretry: 1000\n' + event('response.created', { response: { status: 'in_progress', output: [] } }) + event('response.output_text.delta', { delta: '你好，官方模型。' }) + event('response.completed', { response: { status: 'completed', output: [], usage: { input_tokens: 11, output_tokens: 7, total_tokens: 18 } } });
  const bytes = new TextEncoder().encode(source), chunks = [];
  // Split all three BOM bytes, field names, JSON and multibyte text across reads.
  for (let offset = 0; offset < bytes.length; offset += 1) chunks.push(bytes.subarray(offset, offset + 1));
  const f = await fixture(t, { onFetch: url => url.endsWith('/responses') ? new Response(new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); } })) : undefined });
  const deltas = [], result = await streamProvider({ provider: await f.provider(), messages: [{ role: 'user', content: 'hello' }], onEvent: (type, value) => { if (type === 'delta') deltas.push(value.text); } });
  assert.equal(result.text, '你好，官方模型。'); assert.deepEqual(deltas, ['你好，官方模型。']);
  const usage = (await f.manager.status('alice')).usage;
  assert.equal(usage.state, 'available'); assert.equal(usage.completedRequests, 1); assert.equal(usage.inputTokens, 11); assert.equal(usage.outputTokens, 7); assert.equal(usage.totalTokens, 18);
  assert.equal(f.calls.filter(item => item.url.endsWith('/responses')).length, 1);
});

test('missing MIME accepts a cold complete SSE prefix after the short diagnostic body deadline', async t => {
  const f = await fixture(t, { requestTimeoutMs: 5000, onFetch: url => url.endsWith('/responses') ? new Response(new ReadableStream({ async start(controller) { await new Promise(resolve => setTimeout(resolve, 1700)); controller.enqueue(new TextEncoder().encode(messageResponse('冷启动正常。'))); controller.close(); } })) : undefined });
  const result = await streamProvider({ provider: await f.provider(), messages: [{ role: 'user', content: 'hello' }], timeoutMs: 5000 });
  assert.equal(result.text, '冷启动正常。'); assert.equal((await f.manager.status('alice')).usage.completedRequests, 1);
});

test('missing MIME accepts a large first official frame within the normal SSE frame bound', async t => {
  const source = event('response.created', { response: { status: 'in_progress', output: [], metadata: 'x'.repeat(70000) } }) + messageResponse('大型首帧正常。');
  const f = await fixture(t, { onFetch: url => url.endsWith('/responses') ? new Response(new TextEncoder().encode(source)) : undefined });
  const result = await streamProvider({ provider: await f.provider(), messages: [{ role: 'user', content: 'hello' }] });
  assert.equal(result.text, '大型首帧正常。'); assert.equal((await f.manager.status('alice')).usage.completedRequests, 1);
});

test('missing MIME never accepts JSON, HTML, malformed SSE or invalid UTF-8 as a successful response', async t => {
  let bytes;
  const f = await fixture(t, { onFetch: url => url.endsWith('/responses') ? new Response(bytes) : undefined }), provider = await f.provider();
  for (const source of [
    JSON.stringify({ type: 'response', status: 'completed', output: [], usage: { total_tokens: 100 }, private: 'PRIVATE-BODY access-secret-alice' }),
    '<html>PRIVATE-HTML access-secret-alice</html>',
    'PRIVATE-TEXT access-secret-alice\n',
    'event: response.completed\ndata: {"type":"response.failed","private":"PRIVATE-SSE"}\n\n',
    'event: response.completed\ndata: ["PRIVATE-ARRAY"]\n\n',
    'event: response.completed\ndata: {"type":"response.completed","private":"PRIVATE-INCOMPLETE"}',
  ]) {
    bytes = new TextEncoder().encode(source);
    const response = await f.post(provider), value = await response.text(); assert.equal(response.status, 502); assert.match(value, /内容类型 empty/); assert.doesNotMatch(value, /PRIVATE-|access-secret|total_tokens/);
  }
  bytes = new Uint8Array([0xff, 0xfe, 0x0a]);
  const invalid = await f.post(provider); assert.equal(invalid.status, 502); assert.match(await invalid.text(), /invalid-sse-prefix/);
  assert.equal((await f.manager.status('alice')).usage.completedRequests, 0);
});

test('missing MIME prefix inspection obeys downstream cancellation and the enclosing request deadline', async t => {
  const signals = []; let cancelled = 0;
  const f = await fixture(t, { onFetch: (url, init) => url.endsWith('/responses') ? (signals.push(init.signal), new Response(new ReadableStream({ cancel() { cancelled++; } }))) : undefined });
  const provider = await f.provider(), controller = new AbortController();
  const rejected = assert.rejects(f.post(provider, undefined, { signal: controller.signal }), error => error.name === 'AbortError');
  await until(() => signals.length === 1); controller.abort(); await rejected; await until(() => signals[0].aborted && cancelled === 1);
  f.manager.requestTimeoutMs = 80;
  const expired = await f.post(provider); assert.equal(expired.status, 499); assert.doesNotMatch(await expired.text(), /access-secret|PRIVATE/); await until(() => signals[1].aborted && cancelled === 2);
  assert.equal((await f.manager.status('alice')).usage.completedRequests, 0); assert.equal(f.accesses.filter(item => item.forceRefresh).length, 0);
});

test('missing MIME bounded prefix rejection cancels oversized input without counting usage', async t => {
  let cancelled = false;
  const f = await fixture(t, { onFetch: url => url.endsWith('/responses') ? new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(`: ${'x'.repeat(2 * 1024 * 1024)}\n\n`)); }, cancel() { cancelled = true; } })) : undefined });
  const response = await f.post(await f.provider()); assert.equal(response.status, 502); assert.match(await response.text(), /prefix-size-limit/); await until(() => cancelled);
  assert.equal((await f.manager.status('alice')).usage.completedRequests, 0);
});

test('missing MIME valid first delta followed by EOF is still an incomplete provider response', async t => {
  const f = await fixture(t, { onFetch: url => url.endsWith('/responses') ? new Response(new TextEncoder().encode(event('response.output_text.delta', { delta: '未完成' }))) : undefined });
  const deltas = [];
  await assert.rejects(streamProvider({ provider: await f.provider(), messages: [{ role: 'user', content: 'hello' }], onEvent: (type, value) => { if (type === 'delta') deltas.push(value.text); } }), /提前结束/);
  assert.deepEqual(deltas, ['未完成']); assert.equal((await f.manager.status('alice')).usage.completedRequests, 0); assert.equal(f.calls.filter(item => item.url.endsWith('/responses')).length, 1);
});

test('HTML and missing-body diagnostic categories do not echo unknown header, JSON or HTML fields', async t => {
  let upstream = new Response('<html>PRIVATE-HTML access-secret-alice</html>', { headers: { 'content-type': 'text/html; private=PRIVATE-HEADER' } });
  const f = await fixture(t, { onFetch: url => url.endsWith('/responses') ? upstream : undefined }), p = await f.provider();
  let response = await f.post(p), value = await response.text(); assert.match(value, /内容类型 html/); assert.doesNotMatch(value, /PRIVATE-|access-secret/);
  upstream = new Response(null, { status: 204 }); response = await f.post(p); value = await response.text(); assert.match(value, /上游 HTTP 204/); assert.match(value, /内容类型 empty/); assert.match(value, /empty-body/);
  assert.equal((await f.manager.status('alice')).usage.completedRequests, 0);
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
