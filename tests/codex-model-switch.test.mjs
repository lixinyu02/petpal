import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { CodexBridge } from '../server/codex.mjs';
import { defaultCodexConfig, patchCodexConfig } from '../server/codex-config.mjs';
import { listenFixture } from './helpers/loopback.mjs';

const frame = value => `event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`;

test('real bundled CLI sends assigned turn models through transport and releases model grants after completion', { timeout: 60000 }, async t => {
  const prefix = path.join(tmpdir(), 'petpal-codex-model-switch-');
  const directory = await mkdtemp(prefix), requests = [];
  let bridge;
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    requests.push({ body, authorization: req.headers.authorization, path: req.url });
    const id = `resp_switch_${requests.length}`, itemId = `msg_switch_${requests.length}`;
    const text = `confirmed ${body.model}`;
    const item = { type: 'message', id: itemId, role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] };
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end([
      { type: 'response.created', response: { id, status: 'in_progress', output: [] } },
      { type: 'response.output_text.delta', item_id: itemId, output_index: 0, content_index: 0, delta: text },
      { type: 'response.output_text.done', item_id: itemId, output_index: 0, content_index: 0, text },
      { type: 'response.completed', response: { id, object: 'response', status: 'completed', output: [item] } },
    ].map(frame).join(''));
  });
  t.after(async () => {
    await bridge?.close(); server.closeAllConnections();
    if (server.listening) await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(directory), path.resolve(tmpdir()));
    assert.ok(directory.startsWith(prefix));
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  await listenFixture(server);
  const config = patchCodexConfig(defaultCodexConfig(), { mode: 'api', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'gpt-6-luna', reasoningEffort: 'max', apiKey: randomBytes(32).toString('hex') });
  const before = structuredClone(config);
  bridge = new CodexBridge({ config, dataDir: directory });
  assert.equal((await bridge.status()).available, true);
  const attemptOverride = async () => {
    const response = await fetch(`${bridge.transport.baseUrl}/responses`, { method: 'POST', headers: { Authorization: `Bearer ${bridge.transport.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'gpt-6.1-sol', stream: true, input: [] }) });
    assert.ok(response.status >= 400); await response.text();
  };
  await attemptOverride(); assert.equal(requests.length, 0);
  const first = await bridge.run({ prompt: 'Reply with confirmation only, without tools.', model: 'gpt-6.1-sol', effort: 'high', signal: AbortSignal.timeout(15000) });
  assert.equal(first.text, 'confirmed gpt-6.1-sol');
  assert.equal(bridge.runs.size, 0);
  await attemptOverride(); assert.equal(requests.length, 1);
  const second = await bridge.run({ prompt: 'Reply with confirmation only, without tools.', threadId: first.threadId, model: 'gpt-6-sol', effort: 'high', signal: AbortSignal.timeout(15000) });
  assert.equal(second.text, 'confirmed gpt-6-sol');
  assert.deepEqual(requests.map(request => request.body.model), ['gpt-6.1-sol', 'gpt-6-sol']);
  for (const request of requests) {
    assert.equal(request.path, '/v1/responses');
    assert.equal(request.authorization, `Bearer ${config.apiKey}`);
    assert.equal(request.body.reasoning.effort, 'high');
  }
  assert.deepEqual(config, before);
});
