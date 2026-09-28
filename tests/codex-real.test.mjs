import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CodexBridge, resolveBundledCodex } from '../server/codex.mjs';
import { defaultCodexConfig, patchCodexConfig } from '../server/codex-config.mjs';

test('real bundled Codex 0.143 performs Responses dynamic-tool approval and resumes in isolated home', { timeout: 90000 }, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-codex-real-'));
  const requests = [], errors = [];
  let sequence = 0, executes = 0, approvals = 0, patchProbe = false;
  const patchTarget = path.join(directory, 'must-not-be-written.txt').replaceAll('\\', '/');
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method !== 'POST' || req.url !== '/v1/responses') { res.writeHead(404); res.end('{}'); return; }
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      assert.equal(req.headers.authorization, 'Bearer isolated-test-key');
      assert.ok(!req.headers['content-encoding'], `Unexpected encoding ${req.headers['content-encoding']}`);
      const body = JSON.parse(Buffer.concat(chunks).toString()); requests.push(body);
      assert.equal(body.model, 'gpt-5.4');
      const id = `resp_fixture_${++sequence}`;
      const previous = (body.input ?? []).some(item => ['function_call_output', 'custom_tool_call_output'].includes(item.type));
      const item = previous
        ? { type: 'message', id: `msg_${sequence}`, role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '本地模拟音乐工具已完成。', annotations: [] }] }
        : patchProbe ? { type: 'custom_tool_call', id: `ctc_${sequence}`, call_id: `call_${sequence}`, name: 'apply_patch', input: `*** Begin Patch\n*** Add File: ${patchTarget}\n+Must not be written\n*** End Patch\n`, status: 'completed' }
        : { type: 'function_call', id: `fc_${sequence}`, call_id: `call_${sequence}`, name: 'petpal_music_command', arguments: JSON.stringify({ player: 'qqmusic', action: 'pause' }), status: 'completed' };
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      const send = (type, value) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`);
      send('response.created', { response: { id, object: 'response', model: body.model, status: 'in_progress', output: [] } });
      if (previous) {
        send('response.output_item.added', { output_index: 0, item: { ...item, content: [], status: 'in_progress' } });
        send('response.content_part.added', { item_id: item.id, output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
        send('response.output_text.delta', { item_id: item.id, output_index: 0, content_index: 0, delta: item.content[0].text });
        send('response.output_text.done', { item_id: item.id, output_index: 0, content_index: 0, text: item.content[0].text });
      } else if (item.type === 'custom_tool_call') {
        send('response.output_item.added', { output_index: 0, item: { ...item, input: '', status: 'in_progress' } });
        send('response.custom_tool_call_input.delta', { item_id: item.id, output_index: 0, delta: item.input });
        send('response.custom_tool_call_input.done', { item_id: item.id, output_index: 0, input: item.input });
      } else {
        send('response.output_item.added', { output_index: 0, item: { ...item, arguments: '', status: 'in_progress' } });
        send('response.function_call_arguments.delta', { item_id: item.id, output_index: 0, delta: item.arguments });
        send('response.function_call_arguments.done', { item_id: item.id, output_index: 0, arguments: item.arguments });
      }
      send('response.output_item.done', { output_index: 0, item });
      send('response.completed', { response: { id, object: 'response', model: body.model, status: 'completed', output: [item], usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 } } });
      res.end();
    } catch (error) { errors.push(error); res.writeHead(500); res.end('{}'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const config = patchCodexConfig(defaultCodexConfig(), { mode: 'api', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'gpt-5.4', apiKey: 'isolated-test-key' });
  const binary = await resolveBundledCodex(); assert.ok(binary?.file);
  const bridge = new CodexBridge({ dataDir: directory, config, command: binary.file, desktopTools: {
    specs: [{ type: 'function', name: 'petpal_music_command', description: 'Isolated test-only fake music operation. No actual player will be controlled.', inputSchema: { type: 'object', properties: { player: { type: 'string', enum: ['qqmusic'] }, action: { type: 'string', enum: ['pause'] } }, required: ['player', 'action'], additionalProperties: false } }],
    describe(name, args) { assert.equal(name, 'petpal_music_command'); assert.deepEqual(args, { player: 'qqmusic', action: 'pause' }); return { description: 'Approve simulated pause (no real software)', approvalRequired: true }; },
    async execute(name, args, { signal }) { signal.throwIfAborted(); executes++; return { ok: true, source: 'isolated-mock', simulated: true }; },
  } });
  t.after(async () => { await bridge.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); assert.ok(directory.startsWith(path.join(tmpdir(), 'petpal-codex-real-'))); await rm(directory, { recursive: true, force: true }); });
  const status = await bridge.status();
  assert.equal(status.available, true, status.error); assert.equal(status.apiVerified, false);
  assert.equal(requests.length, 0, 'status must not invoke the model');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000); timer.unref();
  try {
    const result = await bridge.run({ prompt: '请调用模拟音乐工具，然后报告结果。', signal: controller.signal, onEvent: (event, data) => { if (event === 'approval') { approvals++; bridge.approve(data.id, 'accept'); } } });
    assert.match(result.text, /模拟音乐工具已完成/);
    assert.equal(executes, 1); assert.equal(approvals, 1); assert.equal(requests.length, 2);
    const tools = JSON.stringify(requests[0].tools);
    assert.match(tools, /petpal_music_command/);
    assert.doesNotMatch(tools, /"(?:shell|exec_command|write_stdin|local_shell|create_goal)"/);
    assert.match(JSON.stringify(requests[1].input), /isolated-mock/);
    const resumed = await bridge.run({ threadId: result.threadId, prompt: '继续报告模拟结果。', signal: controller.signal });
    assert.equal(resumed.threadId, result.threadId); assert.match(resumed.text, /模拟音乐工具已完成/);
    patchProbe = true;
    await bridge.run({ prompt: 'Isolated negative test: attempt a file patch, which must be refused.', signal: controller.signal, onEvent: (event) => { assert.notEqual(event, 'approval', 'API file escalation must be rejected, never offered as a desktop action'); } });
    await assert.rejects(stat(patchTarget), error => error.code === 'ENOENT');
    assert.ok(requests.some(body => body.input?.some(item => item.type === 'custom_tool_call_output' && /reject|denied|approval|read.only/i.test(JSON.stringify(item.output)))), 'native file tool returned a denied result');
    const toml = await readFile(path.join(directory, 'codex', config.revision, 'config.toml'), 'utf8');
    assert.ok(!toml.includes(config.apiKey)); assert.equal(errors.length, 0, errors.map(error => error.message).join('; '));
    t.diagnostic(`native CLI completed ${requests.length} local Responses requests, ${approvals} approval, ${executes} mock execution, same-context resume, and denied file write`);
  } finally { clearTimeout(timer); }
});
