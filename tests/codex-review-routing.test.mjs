import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { CodexBridge } from '../server/codex.mjs';
import { normalizeCodexReviewConfig, codexReviewFingerprint } from '../server/codex-config.mjs';
import { createCodexTransport, codexTransportRequestIdentity } from '../server/codex-transport.mjs';

const agent = { mode: 'api', model: 'default-agent', baseUrl: 'http://192.168.60.25:8082/v1', apiKey: 'synthetic-agent-only-key', revision: '00000000-0000-4000-8000-000000000001' };
const reviewer = { providerId: 'review-qwen', model: 'qwen3.8flash', baseUrl: 'http://192.168.60.10:8082/v1', apiKey: 'synthetic-review-only-key' };
const frame = value => `event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`;
const created = { type: 'response.created', response: { id: 'resp_fixture', status: 'in_progress', output: [] } };
const complete = { type: 'response.completed', response: { id: 'resp_fixture', status: 'completed', output: [{ id: 'msg_fixture', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'fixture', annotations: [] }] }] } };
const response = () => new Response(frame(created) + frame(complete), { headers: { 'Content-Type': 'text/event-stream' } });

function nativeRequest(run, { guardian = false, subagent, childId = `child-${run.threadId}`, childTurn = 'child-turn', reasoning = { effort: 'max' } } = {}) {
  const role = guardian ? 'guardian' : subagent;
  const canonical = { session_id: run.threadId, thread_id: role ? childId : run.threadId, turn_id: role ? childTurn : run.turnId, request_kind: 'turn',
    ...(role ? { parent_thread_id: run.threadId, subagent_kind: role === 'collab_spawn' ? 'thread_spawn' : role, thread_source: 'subagent' } : {}) };
  const metadata = JSON.stringify(canonical);
  const headers = { 'thread-id': canonical.thread_id, 'x-client-request-id': canonical.thread_id, 'session-id': canonical.session_id, 'x-codex-turn-metadata': metadata,
    ...(role ? { 'x-openai-subagent': role, 'x-codex-parent-thread-id': run.threadId } : {}) };
  const body = { model: run.model, stream: true, input: [], reasoning, client_metadata: { thread_id: canonical.thread_id, session_id: canonical.session_id,
    turn_id: canonical.turn_id, 'x-codex-turn-metadata': metadata, ...(role ? { 'x-openai-subagent': role, 'x-codex-parent-thread-id': run.threadId } : {}) } };
  return { headers, body };
}

async function routingFixture(t, { fetch, capture } = {}) {
  const calls = [], bridge = new CodexBridge({ config: agent, dataDir: tmpdir() });
  bridge.child = {};
  let transport;
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = await createCodexTransport({ config: agent,
      authorizeModel: model => [...bridge.runs.values()].some(run => run.model === model && !run.aborted && !run.settled),
      captureRequest: request => { const captured = bridge._captureTransportRequest(request); capture?.(captured); return captured; },
      fetchImpl: async (url, init) => { const call = { url, init, body: JSON.parse(init.body) }; calls.push(call); return fetch ? fetch(call) : response(); } });
    try { await (await globalThis.fetch(candidate.baseUrl)).text(); transport = candidate; break; }
    catch (error) { await candidate.close(); if (error.cause?.message !== 'bad port' || attempt === 19) throw error; }
  }
  t.after(() => transport.close()); bridge.transport = transport;
  const addRun = (threadId, reviewConfig = null, authorizeReview = () => true, model = `agent-${threadId}`) => {
    const frozen = normalizeCodexReviewConfig(reviewConfig), run = { threadId, turnId: `turn-${threadId}`, model, reviewConfig: frozen, authorizeReview,
      reviewFingerprint: codexReviewFingerprint(frozen), child: bridge.child, routeKey: `route-${threadId}-1`, requestController: new AbortController(),
      nativeReviews: new Set(['native-review-id']), permissions: { approval: 'review' }, aborted: false, settled: false, finishing: false };
    bridge.runs.set(threadId, run); bridge.threadReviewBindings.set(threadId, run.reviewFingerprint); return run;
  };
  const request = async envelope => globalThis.fetch(`${transport.baseUrl}/responses`, { method: 'POST', headers: { 'Content-Type': 'application/json',
    Authorization: `Bearer ${transport.apiKey}`, ...envelope.headers }, body: JSON.stringify(envelope.body) });
  return { bridge, transport, addRun, calls, request };
}

test('server-resolved reviewer config permits saved LAN HTTP and central relay paths while rejecting unsupported or embedded credentials', () => {
  for (const baseUrl of ['http://192.168.60.230:8317/v1', 'http://192.168.60.222:4318/api/executor/runs/run-a/review', 'https://fixture.invalid/v1']) {
    const next = normalizeCodexReviewConfig({ ...reviewer, baseUrl }); assert.equal(next.baseUrl, baseUrl); assert.ok(Object.isFrozen(next));
  }
  assert.equal(normalizeCodexReviewConfig(null), null);
  for (const value of [{ ...reviewer, model: '' }, { ...reviewer, model: ' bad ' }, { ...reviewer, apiKey: 'bad\nkey' }, { ...reviewer, unknown: true },
    { ...reviewer, baseUrl: 'file:///c:/data' }, { ...reviewer, baseUrl: 'https://user:secret@fixture.invalid/v1' }, { ...reviewer, baseUrl: 'https://fixture.invalid/v1?q=x' },
    { ...reviewer, baseUrl: 'https://fixture.invalid/v1#x' }, { ...reviewer, reasoningEffort: 'unsupported' }]) assert.throws(() => normalizeCodexReviewConfig(value));
  const original = normalizeCodexReviewConfig(reviewer);
  for (const change of [{ model: 'different' }, { baseUrl: 'https://other.invalid/v1' }, { apiKey: 'different-key' }, { providerId: 'other-id' }, { reasoningEffort: 'low' }]) {
    assert.notEqual(codexReviewFingerprint(original), codexReviewFingerprint(normalizeCodexReviewConfig({ ...reviewer, ...change })));
  }
});

test('native identity cross-checks headers, flat metadata and canonical metadata instead of using output schema as authority', () => {
  const run = { threadId: 'parent', turnId: 'parent-turn', model: 'agent' }, normal = nativeRequest(run), guardian = nativeRequest(run, { guardian: true });
  assert.equal(codexTransportRequestIdentity(normal.headers, normal.body).guardian, false);
  assert.equal(codexTransportRequestIdentity(guardian.headers, guardian.body).parentThreadId, 'parent');
  for (const [headers, body] of [[{ ...guardian.headers, 'x-codex-parent-thread-id': 'foreign' }, guardian.body],
    [{ ...guardian.headers, 'x-openai-subagent': 'compact' }, guardian.body], [guardian.headers, { ...guardian.body, client_metadata: { ...guardian.body.client_metadata, thread_id: 'foreign' } }],
    [normal.headers, { ...normal.body, client_metadata: { ...normal.body.client_metadata, 'x-openai-subagent': 'guardian' } }], [ {}, guardian.body ]]) {
    assert.throws(() => codexTransportRequestIdentity(headers, body));
  }
});

test('concurrent default and independent native runs keep parent, ordinary child and guardian credentials, models and efforts separate', async t => {
  const f = await routingFixture(t), independent = f.addRun('independent', { ...reviewer, reasoningEffort: 'low' }), follow = f.addRun('follow');
  const envelopes = [nativeRequest(independent), nativeRequest(independent, { guardian: true }), nativeRequest(follow), nativeRequest(follow, { guardian: true }),
    nativeRequest(independent, { subagent: 'collab_spawn', childId: 'ordinary-child' })];
  await Promise.all(envelopes.map(async envelope => { const result = await f.request(envelope); assert.equal(result.status, 200); await result.text(); }));
  assert.equal(f.calls.length, 5);
  for (const call of f.calls) {
    const mapped = call.body.client_metadata?.['x-openai-subagent'] === 'guardian' && call.body.client_metadata.session_id === independent.threadId;
    assert.equal(call.url, `${mapped ? reviewer.baseUrl : agent.baseUrl}/responses`);
    assert.equal(call.init.headers.Authorization, `Bearer ${mapped ? reviewer.apiKey : agent.apiKey}`);
    assert.equal(call.body.reasoning.effort, mapped ? 'low' : 'max');
    assert.equal(call.body.model, mapped ? reviewer.model : call.body.client_metadata.session_id === independent.threadId ? independent.model : follow.model);
    assert.equal(Object.keys(call.init.headers).some(key => /thread|subagent|cookie/i.test(key)), false);
  }
  const child = f.calls.find(call => call.body.client_metadata?.['x-openai-subagent'] === 'collab_spawn');
  assert.equal(child.body.model, independent.model); assert.equal(child.url, `${agent.baseUrl}/responses`);
});

test('unset independent effort removes only its effort and leaves the parent request and useful reasoning structure intact', async t => {
  const f = await routingFixture(t), run = f.addRun('unset', reviewer);
  for (const reasoning of [{ effort: 'max' }, { effort: 'max', summary: 'auto' }]) {
    const envelope = nativeRequest(run, { guardian: true, childTurn: `turn-${f.calls.length}`, reasoning }), result = await f.request(envelope);
    assert.equal(result.status, 200); await result.text(); assert.equal(f.calls.at(-1).body.reasoning?.effort, undefined);
    assert.deepEqual(f.calls.at(-1).body.reasoning, reasoning.summary ? { summary: 'auto' } : undefined);
    assert.equal(envelope.body.reasoning.effort, 'max');
  }
});

test('guardian requires active native pending review, current child/run and explicit synchronous reviewer authorization', async t => {
  let authorized = true;
  const f = await routingFixture(t), run = f.addRun('locked', reviewer, () => authorized), envelope = nativeRequest(run, { guardian: true });
  for (const invalidate of [() => run.nativeReviews.clear(), () => { run.nativeReviews.add('again'); authorized = false; },
    () => { authorized = true; run.permissions.approval = 'ask'; }, () => { run.permissions.approval = 'review'; run.child = {}; },
    () => { run.child = f.bridge.child; run.authorizeReview = () => Promise.resolve(true); }]) {
    invalidate(); const result = await f.request(envelope); assert.ok(result.status >= 400); await result.text();
  }
  assert.equal(f.calls.length, 0);
});

test('schema, body provider fields and another active model cannot impersonate the native guardian or replace its frozen destination', async t => {
  const f = await routingFixture(t), run = f.addRun('fixed', reviewer), foreign = f.addRun('foreign', null, () => true, 'foreign-active-model');
  const parent = nativeRequest(run); parent.body.text = { format: { schema: { properties: { risk_level: {} } } } };
  parent.body.reviewConfig = { baseUrl: 'https://attacker.invalid', apiKey: 'attacker-key', model: 'attacker' };
  const result = await f.request(parent); assert.equal(result.status, 200); await result.text();
  assert.equal(f.calls[0].url, `${agent.baseUrl}/responses`); assert.equal(f.calls[0].body.model, run.model);
  const mismatched = nativeRequest(run, { guardian: true }); mismatched.body.model = foreign.model;
  const denied = await f.request(mismatched); assert.ok(denied.status >= 400); await denied.text(); assert.equal(f.calls.length, 1);
});

test('a body delayed after authenticated headers remains attached to its captured old run', async t => {
  let captured;
  const ready = new Promise(resolve => { captured = resolve; });
  const f = await routingFixture(t, { capture: () => captured() }), run = f.addRun('late-body', reviewer), envelope = nativeRequest(run, { guardian: true });
  const data = JSON.stringify(envelope.body);
  let sendBody;
  const completed = new Promise((resolve, reject) => {
    const request = http.request(`${f.transport.baseUrl}/responses`, { method: 'POST', headers: { ...envelope.headers, 'Content-Type': 'application/json',
      Authorization: `Bearer ${f.transport.apiKey}`, 'Content-Length': Buffer.byteLength(data) } }, result => { result.resume(); result.once('end', () => resolve(result.statusCode)); });
    request.once('error', reject); request.flushHeaders(); sendBody = () => request.end(data);
  });
  await ready;
  const next = f.addRun(run.threadId, reviewer); next.routeKey = 'replacement-run'; next.turnId = 'replacement-parent-turn';
  sendBody(); assert.ok(await completed >= 400); assert.equal(f.calls.length, 0);
});

test('an observed stale guardian turn cannot rebind to a later run while a fresh review on that same fingerprint can proceed', async t => {
  const f = await routingFixture(t), first = f.addRun('reused', reviewer), old = nativeRequest(first, { guardian: true });
  await (await f.request(old)).text(); assert.equal(f.calls.length, 1);
  const next = f.addRun(first.threadId, reviewer); next.routeKey = 'replacement-run'; next.turnId = 'replacement-parent-turn';
  const stale = await f.request(old); assert.ok(stale.status >= 400); await stale.text(); assert.equal(f.calls.length, 1);
  const fresh = await f.request(nativeRequest(next, { guardian: true, childTurn: 'fresh-review-turn' }));
  assert.equal(fresh.status, 200); await fresh.text(); assert.equal(f.calls.length, 2);
});

test('revocation after upstream headers closes its body and suppresses every success frame', async t => {
  let authorized = true, canceled = false;
  const f = await routingFixture(t, { fetch: () => { authorized = false; return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(frame(created) + frame(complete))); }, cancel() { canceled = true; } }), { headers: { 'Content-Type': 'text/event-stream' } }); } });
  const run = f.addRun('revoke', reviewer, () => authorized), result = await f.request(nativeRequest(run, { guardian: true }));
  assert.ok(result.status >= 400); assert.doesNotMatch(await result.text(), /response.completed|synthetic-review-only-key|192\.168/);
  await f.transport.cancelAll(); assert.equal(canceled, true); assert.equal(f.calls.length, 1);
});

test('canceling one run aborts only its owned reviewer stream and leaves concurrent default runs available', async t => {
  let entered, canceled = false; const ready = new Promise(resolve => { entered = resolve; });
  const f = await routingFixture(t, { fetch: call => call.body.model === reviewer.model ? new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(frame(created))); entered(); }, cancel() { canceled = true; } }), { headers: { 'Content-Type': 'text/event-stream' } }) : response() });
  const selected = f.addRun('cancel', reviewer), follow = f.addRun('continue'), incoming = f.request(nativeRequest(selected, { guardian: true }));
  const body = incoming.then(result => result.text()).catch(() => 'closed'); await ready; await incoming;
  selected.requestController.abort(); await f.transport.cancelScope(selected); assert.doesNotMatch(await body, /response.completed/); assert.equal(canceled, true);
  const next = await f.request(nativeRequest(follow, { guardian: true })); assert.equal(next.status, 200); assert.match(await next.text(), /response.completed/);
});

test('unknown or changed independent reviewer bindings require a new native thread before any RPC or process starts', async () => {
  const bridge = new CodexBridge({ config: agent, dataDir: tmpdir() }); let starts = 0; bridge._ensureStarted = async () => { starts++; throw new Error('unexpected process start'); };
  const first = normalizeCodexReviewConfig(reviewer); bridge.threadReviewBindings.set('known-thread', codexReviewFingerprint(first));
  for (const [threadId, reviewConfig] of [['unknown-thread', first], ['known-thread', { ...reviewer, apiKey: 'rotated-key' }], ['known-thread', null]]) {
    await assert.rejects(bridge.run({ prompt: 'fixture', threadId, reviewConfig, authorizeReview: () => true }), error => error.status === 409 && error.code === 'review_thread_changed');
  }
  assert.equal(starts, 0);
});
