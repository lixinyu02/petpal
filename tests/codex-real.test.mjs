import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
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
    const result = await bridge.run({ prompt: '请调用模拟音乐工具，然后报告结果。', permissions: { access: 'full-access', approval: 'ask' }, signal: controller.signal, onEvent: (event, data) => { if (event === 'approval') { approvals++; bridge.approve(data.id, 'accept'); } } });
    assert.match(result.text, /模拟音乐工具已完成/);
    assert.equal(executes, 1); assert.equal(approvals, 1); assert.equal(requests.length, 2);
    const tools = JSON.stringify(requests[0].tools);
    assert.match(tools, /petpal_music_command/);
    assert.match(tools, /"(?:shell|exec_command|local_shell)"/, 'the native CLI exposes its execution tool under explicit full access');
    assert.doesNotMatch(tools, /"create_goal"/);
    assert.match(JSON.stringify(requests[1].input), /isolated-mock/);
    const resumed = await bridge.run({ threadId: result.threadId, prompt: '继续报告模拟结果。', signal: controller.signal });
    assert.equal(resumed.threadId, result.threadId); assert.match(resumed.text, /模拟音乐工具已完成/);
    patchProbe = true;
    await bridge.run({ prompt: 'Isolated negative test: attempt a file patch, which must be refused.', permissions: { access: 'read-only', approval: 'auto' }, signal: controller.signal, onEvent: (event) => { assert.notEqual(event, 'approval', 'automatic read-only execution must refuse elevation without prompting'); } });
    await assert.rejects(stat(patchTarget), error => error.code === 'ENOENT');
    assert.ok(requests.some(body => body.input?.some(item => item.type === 'custom_tool_call_output' && /reject|denied|approval|read.only/i.test(JSON.stringify(item.output)))), 'native file tool returned a denied result');
    const toml = await readFile(path.join(directory, 'codex', config.revision, 'config.toml'), 'utf8');
    assert.ok(!toml.includes(config.apiKey)); assert.equal(errors.length, 0, errors.map(error => error.message).join('; '));
    t.diagnostic(`native CLI completed ${requests.length} local Responses requests, ${approvals} approval, ${executes} mock execution, same-context resume, and denied file write`);
  } finally { clearTimeout(timer); }
});

test('real bundled Codex sends gpt-6-luna reasoning max unchanged on initial and resumed Responses requests', { timeout: 30_000 }, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-codex-effort-real-'));
  const requests = [], errors = [];
  const server = http.createServer(async (req, res) => {
    try {
      assert.equal(req.url, '/v1/responses'); assert.equal(req.method, 'POST');
      assert.equal(req.headers.authorization, 'Bearer isolated-test-key');
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      requests.push({ model: body.model, effort: body.reasoning?.effort });
      assert.equal(body.model, 'gpt-6-luna'); assert.equal(body.reasoning?.effort, 'max');
      const id = `resp_effort_${requests.length}`, item = { id: `msg_effort_${requests.length}`, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Native max fixture.', annotations: [] }] };
      const frame = value => `event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(frame({ type: 'response.created', response: { id, object: 'response', status: 'in_progress', output: [] } }) +
        frame({ type: 'response.completed', response: { id, object: 'response', model: body.model, status: 'completed', output: [item] } }));
    } catch (error) { errors.push(error); res.writeHead(500); res.end('{}'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const config = patchCodexConfig(defaultCodexConfig(), { mode: 'api', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'gpt-6-luna', reasoningEffort: 'max', apiKey: 'isolated-test-key' });
  const binary = await resolveBundledCodex(); assert.ok(binary?.file);
  const bridge = new CodexBridge({ dataDir: directory, config, command: binary.file });
  t.after(async () => {
    await bridge.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    assert.ok(directory.startsWith(path.join(tmpdir(), 'petpal-codex-effort-real-'))); await rm(directory, { recursive: true, force: true });
  });
  try {
    const first = await bridge.run({ prompt: 'Return the local fixture text.', signal: AbortSignal.timeout(10_000) });
    assert.equal(first.text, 'Native max fixture.');
    const resumed = await bridge.run({ prompt: 'Repeat the local fixture text.', threadId: first.threadId, signal: AbortSignal.timeout(10_000) });
    assert.equal(resumed.text, first.text); assert.equal(resumed.threadId, first.threadId);
    assert.deepEqual(requests, [{ model: 'gpt-6-luna', effort: 'max' }, { model: 'gpt-6-luna', effort: 'max' }]);
    const toml = await readFile(path.join(directory, 'codex', config.revision, 'config.toml'), 'utf8');
    assert.match(toml, /model_reasoning_effort = "max"/); assert.match(toml, /model_supports_reasoning_summaries = true/);
    assert.equal(errors.length, 0); t.diagnostic('Native CLI emitted gpt-6-luna / reasoning.effort=max in both captured HTTP bodies; no model request left loopback.');
  } catch (error) {
    t.diagnostic(JSON.stringify({ requests, fixtureErrors: errors.map(item => item.message) })); throw error;
  }
});

async function within(promise, milliseconds = 10_000) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Local Codex fixture timed out')), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

test('real Codex accepts simplified Responses via private transport, isolates keys and cancels upstream', { timeout: 90_000 }, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-codex-transport-real-'));
  const errors = [], requests = [];
  const upstreamKey = 'isolated-transport-upstream-key';
  const capture = path.join(directory, 'runtime-environment.json');
  const wrapper = path.join(directory, 'local-cli-wrapper.mjs');
  const binary = await resolveBundledCodex(); assert.ok(binary?.file);
  // Launch the actual native CLI through a test-only transparent stdio wrapper.
  // Capture only this synthetic credential and a boolean, never a user's env.
  await writeFile(wrapper, `import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(capture)}, JSON.stringify({
  token: process.env.PETPAL_CODEX_API_KEY,
  leakedUpstreamKey: Object.values(process.env).some(value => value.includes(${JSON.stringify(upstreamKey)}))
}));
const child = spawn(${JSON.stringify(binary.file)}, process.argv.slice(2), { stdio: 'inherit', shell: false, windowsHide: true });
child.once('error', () => process.exit(1));
child.once('exit', code => process.exit(code ?? 1));
`);
  let mode = 'text', sequence = 0, executes = 0;
  let requestStarted, requestClosed;
  const server = http.createServer(async (req, res) => {
    try {
      assert.equal(req.method, 'POST'); assert.equal(req.url, '/v1/responses');
      assert.equal(req.headers.authorization, `Bearer ${upstreamKey}`);
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString()); requests.push(body);
      const id = `resp_transport_${++sequence}`;
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      const send = (type, value) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`);
      send('response.created', { response: { id, object: 'response', model: body.model, status: 'in_progress', output: [] } });
      if (mode === 'pending') {
        res.once('close', () => requestClosed?.());
        requestStarted?.();
        return;
      }
      const previous = body.input?.some(item => item.type === 'function_call_output');
      let output = [];
      if (mode === 'tool' && !previous) {
        output = [{ type: 'function_call', id: `fc_${sequence}`, call_id: `call_${sequence}`, name: 'petpal_local_probe', arguments: '{}', status: 'completed' }];
      } else if (mode !== 'empty') {
        const text = previous ? '简化工具响应已完成。' : '小猫已收到简化流式回复。';
        const item = { type: 'message', id: `msg_${sequence}`, role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] };
        output = [item];
        send('response.output_text.delta', { item_id: item.id, output_index: 0, content_index: 0, delta: text.slice(0, 4) });
        send('response.output_text.delta', { item_id: item.id, output_index: 0, content_index: 0, delta: text.slice(4) });
        send('response.output_text.done', { item_id: item.id, output_index: 0, content_index: 0, text });
      }
      const response = { id, object: 'response', model: body.model, status: 'completed', output, usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } };
      send('response.completed', { response });
      send('response.done', { response });
      res.end();
    } catch (error) { errors.push(error); if (!res.headersSent) res.writeHead(500); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const config = patchCodexConfig(defaultCodexConfig(), { mode: 'api', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'gpt-5.4', apiKey: upstreamKey });
  const bridge = new CodexBridge({ dataDir: directory, config, command: [process.execPath, wrapper], desktopTools: {
    specs: [{ type: 'function', name: 'petpal_local_probe', description: 'Local test-only tool without external effects.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }],
    describe(name, args) { assert.equal(name, 'petpal_local_probe'); assert.deepEqual(args, {}); return { description: 'Run isolated test-only probe', approvalRequired: false }; },
    async execute() { executes++; return { ok: true, source: 'local-probe' }; },
  } });
  t.after(async () => {
    await bridge.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    assert.ok(directory.startsWith(path.join(tmpdir(), 'petpal-codex-transport-real-')));
    await rm(directory, { recursive: true, force: true });
  });
  const status = await bridge.status();
  assert.equal(status.available, true, status.error); assert.equal(status.baseUrl, config.baseUrl);
  assert.equal(requests.length, 0, 'initialization must not call the upstream model');
  const runtimeEnvironment = JSON.parse(await readFile(capture, 'utf8'));
  assert.equal(runtimeEnvironment.leakedUpstreamKey, false);
  assert.ok(runtimeEnvironment.token); assert.notEqual(runtimeEnvironment.token, upstreamKey);
  const toml = await readFile(path.join(directory, 'codex', config.revision, 'config.toml'), 'utf8');
  assert.ok(!toml.includes(upstreamKey)); assert.ok(!toml.includes(config.baseUrl));
  assert.match(toml, /base_url = "http:\/\/127\.0\.0\.1:\d+/);
  const first = await bridge.run({ prompt: '请确认收到本地测试回复。' });
  assert.equal(first.text, '小猫已收到简化流式回复。');
  assert.equal(requests.length, 1, 'duplicate terminal events must not trigger a retry');
  mode = 'tool';
  const tool = await bridge.run({ prompt: '调用仅用于测试的本地 probe。' });
  assert.equal(tool.text, '简化工具响应已完成。'); assert.equal(executes, 1);
  assert.equal(requests.length, 3, 'the final-only tool call must execute once and produce one follow-up');
  mode = 'empty';
  await assert.rejects(bridge.run({ prompt: 'Empty-response negative fixture.' }), /未返回可显示的回复|Codex turn 失败/);

  mode = 'pending';
  const opened = new Promise(resolve => { requestStarted = resolve; });
  const disconnected = new Promise(resolve => { requestClosed = resolve; });
  const controller = new AbortController();
  const cancelled = bridge.run({ prompt: 'Cancellation fixture.', signal: controller.signal });
  const cancellation = assert.rejects(cancelled, { name: 'AbortError' });
  await within(opened); controller.abort(); await within(cancellation); await within(disconnected);
  assert.equal(bridge.transport.activeRequests, 0);
  mode = 'text';
  assert.equal((await bridge.run({ prompt: 'Cancellation must leave the bridge reusable.' })).text, first.text);

  const oldTransport = bridge.transport;
  bridge._fail(new Error('Test-only bridge failure'));
  const restarted = await bridge.status();
  assert.equal(restarted.available, true, restarted.error);
  assert.notEqual(bridge.transport, oldTransport); assert.equal(oldTransport.activeRequests, 0);
  await assert.rejects(fetch(`${oldTransport.baseUrl}/responses`, { method: 'POST', signal: AbortSignal.timeout(2000) }));
  assert.equal((await bridge.run({ prompt: 'Restart must use its new loopback transport.' })).text, first.text);

  mode = 'pending';
  const finalOpened = new Promise(resolve => { requestStarted = resolve; });
  const finalDisconnected = new Promise(resolve => { requestClosed = resolve; });
  const transport = bridge.transport;
  const stopped = assert.rejects(bridge.run({ prompt: 'Close fixture.' }), /后台已关闭/);
  await within(finalOpened); await bridge.close(); await within(stopped); await within(finalDisconnected);
  assert.equal(transport.activeRequests, 0); assert.equal(bridge.transport, null);
  assert.equal(errors.length, 0, errors.map(error => error.message).join('; '));
  t.diagnostic(`native CLI verified simplified text, final-only tools, empty-reply failure, private credentials, upstream cancellation and isolated restart across ${requests.length} local requests`);
});

test('an API turn cannot report success after completed with no displayable text; host behavior is preserved', async () => {
  for (const apiMode of [false, true]) {
    const config = apiMode ? patchCodexConfig(defaultCodexConfig(), { mode: 'api', baseUrl: 'http://127.0.0.1:1/v1', model: 'fixture', apiKey: 'synthetic-key' }) : undefined;
    const bridge = new CodexBridge({ config, dataDir: path.join(tmpdir(), 'petpal-unused-completion-fixture') });
    for (const text of ['', ' \n\t']) {
      let resolve, reject;
      const completion = new Promise((yes, no) => { resolve = yes; reject = no; });
      const run = { threadId: 'fixture', text: '', pendingText: text, resolve, reject, items: new Map(), dynamicCalls: new Map(), toolTasks: new Set() };
      bridge.runs.set(run.threadId, run);
      bridge._message({ method: 'turn/completed', params: { threadId: run.threadId, turn: { id: 'turn', status: 'completed' } } });
      if (apiMode) await assert.rejects(completion, /未返回可显示的回复/);
      else assert.equal((await completion).text, text);
    }
    await bridge.close();
  }
});

for (const failure of ['runtime-write', 'child-initialize']) test(`API startup ${failure} failure closes the private transport before returning`, { timeout: 15_000 }, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-codex-startup-'));
  const fixture = path.join(directory, 'failing-cli.mjs');
  await writeFile(fixture, 'process.exit(1);\n');
  if (failure === 'runtime-write') await writeFile(path.join(directory, 'codex'), 'This file deliberately prevents creating a Codex home.');
  const config = patchCodexConfig(defaultCodexConfig(), { mode: 'api', baseUrl: 'http://127.0.0.1:1/v1', model: 'fixture', apiKey: 'synthetic-key' });
  const bridge = new CodexBridge({ config, dataDir: directory, command: [process.execPath, fixture] });
  const transports = new Set();
  const dispose = bridge._disposeTransport.bind(bridge);
  bridge._disposeTransport = transport => { transports.add(transport); return dispose(transport); };
  t.after(async () => {
    await bridge.close(); assert.ok(directory.startsWith(path.join(tmpdir(), 'petpal-codex-startup-')));
    await rm(directory, { recursive: true, force: true });
  });
  const status = await bridge.status();
  assert.equal(status.available, false); assert.equal(bridge.child, null); assert.equal(bridge.transport, null);
  assert.equal(transports.size, 1); assert.equal(bridge.terminations.size, 0);
  const [transport] = transports;
  assert.equal(transport.activeRequests, 0);
  await assert.rejects(fetch(`${transport.baseUrl}/responses`, { method: 'POST', signal: AbortSignal.timeout(2000) }));
});
