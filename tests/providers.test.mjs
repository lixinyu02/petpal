import { listenFixture } from './helpers/loopback.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { streamProvider, normalizeBaseUrl, normalizeReasoningEffort, REASONING_EFFORTS } from '../server/providers.mjs';

async function fixture(t, handler) {
  const server = http.createServer(handler);
  await listenFixture(server);
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return `http://127.0.0.1:${server.address().port}/v1`;
}
const model = (baseUrl, protocol = 'chat-completions') => ({ baseUrl, protocol, model: 'fixture-model', apiKey: 'private-test-key' });
const input = { messages: [{ role: 'user', content: 'Hello' }], persona: 'Helpful cat' };

test('reasoning efforts are explicit supported values and missing means service default', () => {
  assert.equal(normalizeReasoningEffort(undefined), '');
  for (const effort of REASONING_EFFORTS) assert.equal(normalizeReasoningEffort(effort), effort);
  for (const value of [null, false, 1, [], {}, 'MAX', ' max ', 'auto', 'max\n']) assert.throws(() => normalizeReasoningEffort(value), /推理强度/);
});

test('both protocols send the selected effort in their native field and omit it for service default', async t => {
  const requests = [];
  const baseUrl = await fixture(t, async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    requests.push({ url: req.url, body: JSON.parse(raw) });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(req.url.endsWith('/responses')
      ? { status: 'completed', output_text: 'fixture response' }
      : { choices: [{ message: { content: 'fixture response' }, finish_reason: 'stop' }] }));
  });
  for (const protocol of ['responses', 'chat-completions']) {
    for (const reasoningEffort of [undefined, ...REASONING_EFFORTS]) {
      const provider = { ...model(baseUrl, protocol), model: 'gpt-6-luna', reasoningEffort };
      assert.equal((await streamProvider({ ...input, provider })).text, 'fixture response');
      const { body } = requests.at(-1);
      assert.equal(body.model, 'gpt-6-luna');
      if (protocol === 'responses') {
        assert.deepEqual(body.reasoning, reasoningEffort ? { effort: reasoningEffort } : undefined);
        assert.equal(body.reasoning_effort, undefined);
      } else {
        assert.equal(body.reasoning_effort, reasoningEffort || undefined);
        assert.equal(body.reasoning, undefined);
      }
    }
  }
  const count = requests.length;
  await assert.rejects(streamProvider({ ...input, provider: { ...model(baseUrl), reasoningEffort: 'invalid' } }), /推理强度/);
  assert.equal(requests.length, count);
});

test('Chat Completions parses fragmented CRLF SSE, sends only configured key, and records real text', async t => {
  let received;
  const baseUrl = await fixture(t, async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    received = { url: req.url, auth: req.headers.authorization, body: JSON.parse(raw) };
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const payload = Buffer.from('data: {"choices":[{"delta":{"content":"你好"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"，小猫"},"finish_reason":"stop"}]}\r\n\r\ndata: [DONE]\r\n\r\n');
    for (let i = 0; i < payload.length; i += 7) res.write(payload.subarray(i, i + 7));
    res.end();
  });
  const deltas = [];
  const result = await streamProvider({ ...input, provider: model(baseUrl), onEvent: (event, data) => { if (event === 'delta') deltas.push(data.text); } });
  assert.equal(result.text, '你好，小猫'); assert.deepEqual(deltas, ['你好', '，小猫']);
  assert.equal(received.url, '/v1/chat/completions'); assert.equal(received.auth, 'Bearer private-test-key');
  assert.equal(received.body.messages[0].role, 'system'); assert.equal(received.body.stream, true);
});

test('Responses waits for explicit response.completed and supports text deltas', async t => {
  let body;
  const baseUrl = await fixture(t, async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk; body = JSON.parse(raw);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end('event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"Meow"}\n\nevent: response.completed\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n');
  });
  assert.equal((await streamProvider({ ...input, provider: model(baseUrl, 'responses') })).text, 'Meow');
  assert.equal(body.store, false); assert.equal(body.instructions, 'Helpful cat'); assert.equal(body.input[0].content, 'Hello');
});

test('non-stream JSON fallback supports both protocols', async t => {
  const baseUrl = await fixture(t, (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(req.url.endsWith('/responses')
      ? { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Response text' }] }] }
      : { choices: [{ message: { content: 'Chat text' }, finish_reason: 'stop' }] }));
  });
  assert.equal((await streamProvider({ ...input, provider: model(baseUrl) })).text, 'Chat text');
  assert.equal((await streamProvider({ ...input, provider: model(baseUrl, 'responses') })).text, 'Response text');
});

test('EOF without terminal completion, incomplete responses, malformed JSON, and upstream errors reject', async t => {
  const samples = [
    ['chat-completions', 'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n', /提前结束/],
    ['responses', 'data: {"type":"response.output_text.delta","delta":"partial"}\n\ndata: [DONE]\n\n', /response.completed/],
    ['responses', 'data: {"type":"response.incomplete","response":{"incomplete_details":{"reason":"max_output_tokens"}}}\n\n', /max_output_tokens/],
    ['chat-completions', 'data: not-json\n\n', /无效的流式 JSON/],
    ['chat-completions', 'data: {"error":{"message":"secret private-test-key bad"}}\n\n', /secret \[redacted\] bad/],
  ];
  let index = 0;
  const baseUrl = await fixture(t, (req, res) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end(samples[index++][1]); });
  for (const [protocol, , expected] of samples) await assert.rejects(streamProvider({ ...input, provider: model(baseUrl, protocol) }), expected);
});

test('redirects are rejected without forwarding API key', async t => {
  let destinationHits = 0;
  const destination = await fixture(t, (req, res) => { destinationHits++; res.end('{}'); });
  const baseUrl = await fixture(t, (req, res) => { res.writeHead(307, { Location: `${destination}/capture` }); res.end(); });
  await assert.rejects(streamProvider({ ...input, provider: model(baseUrl) }), /无法连接模型服务/);
  assert.equal(destinationHits, 0);
});

test('cancellation interrupts an active provider stream', async t => {
  const controller = new AbortController();
  const baseUrl = await fixture(t, (req, res) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'); });
  await assert.rejects(streamProvider({ ...input, provider: model(baseUrl), signal: controller.signal, onEvent: () => controller.abort() }), { name: 'AbortError' });
});

test('URL validation rejects credentials and query secrets; endpoint suffixes normalize', () => {
  assert.equal(normalizeBaseUrl('https://example.com/v1/chat/completions', 'responses'), 'https://example.com/v1');
  assert.equal(normalizeBaseUrl('http://localhost:1234/v1/', 'chat-completions'), 'http://localhost:1234/v1');
  for (const invalid of ['file:///etc/passwd', 'https://user:password@example.com', 'https://example.com?key=secret', 'https://example.com/#secret']) assert.throws(() => normalizeBaseUrl(invalid, 'responses'));
});
