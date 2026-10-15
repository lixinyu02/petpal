import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CodexBridge, resolveBundledCodex } from '../server/codex.mjs';
import { defaultCodexConfig, patchCodexConfig } from '../server/codex-config.mjs';
import { listenFixture } from './helpers/loopback.mjs';

for (const action of ['answer', 'skip', 'stop', 'timeout']) test(`real bundled 0.143 Default mode handles native question ${action}`, { timeout: 60000 }, async t => {
  const skip = action === 'skip', cancelled = action === 'stop' || action === 'timeout';
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-native-user-input-')), requests = [], callbacks = [], errors = [];
  const server = http.createServer(async (req, res) => {
    try {
      assert.equal(req.url, '/v1/responses'); assert.equal(req.method, 'POST'); assert.equal(req.headers.authorization, 'Bearer isolated-question-key');
      const chunks = []; for await (const bytes of req) chunks.push(bytes);
      const body = JSON.parse(Buffer.concat(chunks).toString()); requests.push(body);
      const tool = body.tools.find(item => item.name === 'request_user_input'); assert.ok(tool); assert.match(tool.description, /Default or Plan/);
      const output = body.input.findLast(item => item.type === 'function_call_output' && item.call_id === 'private_question_call');
      const item = output ? { type: 'message', id: 'msg_question_done', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '本机合成问答已完成。', annotations: [] }] }
        : { type: 'function_call', id: 'fc_private_question', call_id: 'private_question_call', name: 'request_user_input', arguments: JSON.stringify({ questions: [{ id: 'color', header: '配色', question: '本机合成测试选择配色。', options: [{ label: '奶油白', description: '选项一。' }, { label: '浅橘', description: '选项二。' }] }] }), status: 'completed' };
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const send = (type, value) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`), id = `resp_question_${requests.length}`;
      send('response.created', { response: { id, object: 'response', status: 'in_progress', output: [] } });
      send('response.output_item.added', { output_index: 0, item: { ...item, ...(output ? { content: [] } : { arguments: '' }), status: 'in_progress' } });
      if (output) {
        send('response.content_part.added', { item_id: item.id, output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
        send('response.output_text.delta', { item_id: item.id, output_index: 0, content_index: 0, delta: item.content[0].text });
        send('response.output_text.done', { item_id: item.id, output_index: 0, content_index: 0, text: item.content[0].text });
      } else {
        send('response.function_call_arguments.delta', { item_id: item.id, output_index: 0, delta: item.arguments });
        send('response.function_call_arguments.done', { item_id: item.id, output_index: 0, arguments: item.arguments });
      }
      send('response.output_item.done', { output_index: 0, item });
      send('response.completed', { response: { id, object: 'response', model: body.model, status: 'completed', output: [item] } }); res.end();
    } catch (error) { errors.push(error.message); res.writeHead(500); res.end('{}'); }
  });
  await listenFixture(server);
  const config = patchCodexConfig(defaultCodexConfig(), { mode: 'api', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'gpt-5.4', apiKey: 'isolated-question-key' });
  const binary = await resolveBundledCodex(); assert.ok(binary?.file);
  const bridge = new CodexBridge({ dataDir: directory, config, command: binary.file, ...(action === 'timeout' ? { userInputTimeoutMs: 30 } : {}) });
  t.after(async () => { await bridge.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); assert.ok(directory.startsWith(path.join(tmpdir(), 'petpal-native-user-input-'))); await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  const controller = new AbortController();
  const running = bridge.run({ prompt: 'Ask the local synthetic question and continue. Do not access files or execute any tool other than request_user_input.', permissions: { access: 'read-only', approval: 'auto' }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25000)]), onEvent: (type, value) => {
    if (type !== 'user-input') return; callbacks.push(value);
    assert.equal(bridge.userInputs.size, 1); assert.equal(value.questions[0].isOther, true);
    if (action === 'stop') { controller.abort(); return; }
    if (action === 'timeout') return;
    const answer = skip ? { skip: true } : { answers: { color: { answers: ['奶油白'] } } };
    assert.deepEqual(bridge.replyUserInput(value.id, answer), { ok: true });
    assert.deepEqual(bridge.replyUserInput(value.id, answer), { ok: true });
  } });
  if (cancelled) {
    await assert.rejects(running, error => action === 'stop' ? error.name === 'AbortError' : error.code === 'user_input_timeout');
    assert.equal(callbacks.length, 1); assert.equal(requests.length, 1); assert.equal(errors.length, 0); assert.equal(bridge.userInputs.size, 0);
    assert.throws(() => bridge.replyUserInput(callbacks[0].id, { skip: true }), { code: 'user_input_expired' });
    t.diagnostic('Real native pending question ended through an RPC error and confirmed interruption; no synthetic answer or follow-up inference was submitted.'); return;
  }
  const result = await running;
  assert.equal(result.text, '本机合成问答已完成。'); assert.equal(callbacks.length, 1); assert.equal(requests.length, 2); assert.equal(errors.length, 0, errors.join('; '));
  const output = requests[1].input.find(item => item.type === 'function_call_output' && item.call_id === 'private_question_call');
  assert.deepEqual(JSON.parse(output.output), skip ? { answers: {} } : { answers: { color: { answers: ['奶油白'] } } });
  assert.equal(bridge.userInputs.size, 0); assert.equal(bridge.userInputReceipts.size, 0);
  t.diagnostic('Real bundled CLI 0.143 invoked item/tool/requestUserInput in Default mode; explicit answer/skip continued through two loopback-only Responses requests.');
});
