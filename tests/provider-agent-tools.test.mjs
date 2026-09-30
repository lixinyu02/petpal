import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { listenFixture } from './helpers/loopback.mjs';
import { streamProvider } from '../server/providers.mjs';

const task = '在已选择的执行电脑上打开 QQ 音乐并续播当前队列。';
const fixtureApiKey = randomBytes(32).toString('hex');
const argumentsText = JSON.stringify({ task });
const receipt = { taskId: 'fixture-background-task', status: 'queued', conversationId: 'fixture-agent-conversation' };
const messages = [{ role: 'user', content: '帮我用 QQ 音乐放歌，然后继续和我聊。' }];
const ccCall = (overrides = {}) => ({ id: 'call_fixture', type: 'function', function: { name: 'run_agent', arguments: argumentsText }, ...overrides });
const responseCall = (overrides = {}) => ({ type: 'function_call', id: 'fc_fixture', call_id: 'call_fixture', name: 'run_agent', arguments: argumentsText, ...overrides });
const wire = value => `data: ${JSON.stringify(value)}\n\n`;
const json = (res, value) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
const sse = (res, frames) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end(frames); };
const ccText = text => ({ choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }] });
const ccTool = (calls = [ccCall()], finish = 'tool_calls') => ({ choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: calls }, finish_reason: finish }] });
const responseTool = (calls = [responseCall()], status = 'completed') => ({ id: 'resp_fixture', status, output: calls });

async function fixture(t, respond) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const bytes of req) raw += bytes;
    const request = { url: req.url, authorization: req.headers.authorization, body: JSON.parse(raw) };
    requests.push(request); respond(res, request, requests.length);
  });
  await listenFixture(server);
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return { requests, baseUrl: `http://127.0.0.1:${server.address().port}/v1` };
}
function input(f, protocol, overrides = {}) {
  return { provider: { baseUrl: f.baseUrl, protocol, model: 'fixture-model', apiKey: fixtureApiKey }, messages, ...overrides };
}
function assertSchema(body, protocol) {
  assert.equal(body.parallel_tool_calls, false);
  assert.equal(body.tools.length, 1);
  const tool = protocol === 'responses' ? body.tools[0] : body.tools[0].function;
  assert.equal(body.tools[0].type, 'function'); assert.equal(tool.name, 'run_agent'); assert.equal(tool.strict, true);
  assert.equal(tool.parameters.type, 'object'); assert.equal(tool.parameters.additionalProperties, false);
  assert.deepEqual(tool.parameters.required, ['task']); assert.deepEqual(Object.keys(tool.parameters.properties), ['task']);
  assert.equal(tool.parameters.properties.task.type, 'string');
}

test('Chat Completions assembles fragmented arguments, queues once, and continues with a task receipt', async t => {
  const calls = [], deltas = [];
  const f = await fixture(t, (res, _req, index) => {
    if (index === 1) {
      let frames = wire({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_fixture', type: 'function', function: { name: 'run_agent', arguments: argumentsText.slice(0, 11) } }] } }] });
      frames += wire({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: argumentsText.slice(11) } }] } }] });
      frames += wire({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }) + 'data: [DONE]\n\n';
      // Fragment the SSE byte transport as well as the function arguments.
      res.writeHead(200, { 'Content-Type': 'text/event-stream' }); const bytes = Buffer.from(frames);
      for (let offset = 0; offset < bytes.length; offset += 7) res.write(bytes.subarray(offset, offset + 7));
      res.end();
    } else sse(res, wire({ choices: [{ index: 0, delta: { content: '已交给后台 Agent，我们继续聊。' }, finish_reason: 'stop' }] }) + 'data: [DONE]\n\n');
  });
  const result = await streamProvider(input(f, 'chat-completions', { onToolCall: async value => { calls.push(value); return receipt; }, onEvent: (event, value) => { if (event === 'delta') deltas.push(value.text); } }));
  assert.deepEqual(calls, [{ task }]); assert.match(result.text, /已交给后台 Agent/); assert.equal(deltas.join(''), result.text);
  assert.equal(f.requests.length, 2); assertSchema(f.requests[0].body, 'chat-completions');
  const second = f.requests[1].body; assert.equal(second.tool_choice, 'none');
  assert.deepEqual(second.messages.at(-2).tool_calls, [ccCall()]);
  assert.equal(second.messages.at(-1).role, 'tool'); assert.equal(second.messages.at(-1).tool_call_id, 'call_fixture');
  assert.deepEqual(JSON.parse(second.messages.at(-1).content), receipt);
  assert.ok(f.requests.every(request => request.authorization === `Bearer ${fixtureApiKey}`));
});

test('Chat Completions JSON tool calls use the same dispatch and follow-up contract', async t => {
  const calls = [];
  const f = await fixture(t, (res, _req, index) => json(res, index === 1 ? ccTool() : ccText('任务已排队，不需要等它完成。')));
  const result = await streamProvider(input(f, 'chat-completions', { onToolCall: async value => { calls.push(value); return receipt; } }));
  assert.deepEqual(calls, [{ task }]); assert.match(result.text, /任务已排队/); assert.equal(f.requests.length, 2);
  assertSchema(f.requests[0].body, 'chat-completions'); assert.equal(f.requests[1].body.tool_choice, 'none');
});

test('Responses SSE validates completed output, dispatches only once and preserves reasoning for continuation', async t => {
  const calls = [], reasoning = { type: 'reasoning', id: 'rs_fixture', summary: [], encrypted_content: 'encrypted-reasoning-fixture' };
  const fc = responseCall();
  const f = await fixture(t, (res, _req, index) => {
    if (index === 1) {
      const events = [
        { type: 'response.output_item.added', output_index: 1, item: { ...fc, arguments: '' } },
        { type: 'response.function_call_arguments.delta', output_index: 1, item_id: fc.id, delta: argumentsText.slice(0, 9) },
        { type: 'response.function_call_arguments.delta', output_index: 1, item_id: fc.id, delta: argumentsText.slice(9) },
        { type: 'response.function_call_arguments.done', output_index: 1, item_id: fc.id, arguments: argumentsText },
        { type: 'response.output_item.done', output_index: 1, item: fc },
        { type: 'response.completed', response: { id: 'resp_fixture', status: 'completed', output: [reasoning, fc] } },
      ];
      sse(res, events.map(wire).join(''));
    } else sse(res, wire({ type: 'response.output_text.delta', delta: '后台任务已创建，我们接着聊天。' }) + wire({ type: 'response.completed', response: { status: 'completed', output: [] } }));
  });
  const result = await streamProvider(input(f, 'responses', { onToolCall: async value => { calls.push(value); return receipt; } }));
  assert.deepEqual(calls, [{ task }]); assert.match(result.text, /后台任务已创建/); assert.equal(f.requests.length, 2);
  assertSchema(f.requests[0].body, 'responses');
  const second = f.requests[1].body; assert.equal(second.tool_choice, 'none');
  assert.deepEqual(second.input.find(item => item.type === 'reasoning'), reasoning);
  assert.deepEqual(second.input.find(item => item.type === 'function_call'), fc);
  const output = second.input.at(-1); assert.equal(output.type, 'function_call_output'); assert.equal(output.call_id, fc.call_id);
  assert.deepEqual(JSON.parse(output.output), receipt);
});

test('Responses JSON function calls continue without waiting for the queued Agent task', async t => {
  let dispatched = 0;
  const f = await fixture(t, (res, _req, index) => json(res, index === 1 ? responseTool() : { status: 'completed', output_text: '已经安排好了。' }));
  const result = await streamProvider(input(f, 'responses', { onToolCall: async ({ task: value }) => { assert.equal(value, task); dispatched++; return receipt; } }));
  assert.equal(dispatched, 1); assert.equal(result.text, '已经安排好了。'); assert.equal(f.requests.length, 2);
  assertSchema(f.requests[0].body, 'responses'); assert.equal(f.requests[1].body.tool_choice, 'none');
});

test('normal text keeps streaming and never dispatches despite tool availability', async t => {
  for (const protocol of ['chat-completions', 'responses']) await t.test(protocol, async t => {
    let calls = 0;
    const f = await fixture(t, res => sse(res, protocol === 'responses'
      ? wire({ type: 'response.output_text.delta', delta: '今天过得怎么样？' }) + wire({ type: 'response.completed', response: { status: 'completed' } })
      : wire({ choices: [{ index: 0, delta: { content: '今天过得怎么样？' }, finish_reason: 'stop' }] }) + 'data: [DONE]\n\n'));
    assert.equal((await streamProvider(input(f, protocol, { onToolCall: async () => { calls++; return receipt; } }))).text, '今天过得怎么样？');
    assert.equal(calls, 0); assert.equal(f.requests.length, 1); assertSchema(f.requests[0].body, protocol);
  });
});

test('all tool calls validate before side effects, including unknown names, malformed arguments and extra fields', async t => {
  const invalidArguments = ['not-json', '{"task":', JSON.stringify({ task, hostId: 'foreign-computer' }), JSON.stringify({ task, permissions: { access: 'full-access' } }), JSON.stringify({ task: '' }), JSON.stringify({ task: '   ' }), JSON.stringify({ task: 12 }), JSON.stringify(['run_agent']), JSON.stringify(null)];
  for (const protocol of ['chat-completions', 'responses']) {
    const samples = [
      { label: 'unknown tool', calls: protocol === 'responses' ? [responseCall({ name: 'run_shell' })] : [ccCall({ function: { name: 'run_shell', arguments: argumentsText } })] },
      ...invalidArguments.map((value, index) => ({ label: `invalid arguments ${index}`, calls: protocol === 'responses' ? [responseCall({ arguments: value })] : [ccCall({ function: { name: 'run_agent', arguments: value } })] })),
      { label: 'multiple calls', calls: protocol === 'responses' ? [responseCall(), responseCall({ id: 'fc_second', call_id: 'call_second' })] : [ccCall(), ccCall({ id: 'call_second' })] },
      { label: 'valid then invalid calls', calls: protocol === 'responses' ? [responseCall(), responseCall({ id: 'fc_second', call_id: 'call_second', name: 'run_shell' })] : [ccCall(), ccCall({ id: 'call_second', function: { name: 'run_shell', arguments: argumentsText } })] },
    ];
    for (const sample of samples) await t.test(`${protocol} ${sample.label}`, async t => {
      let calls = 0; const f = await fixture(t, res => json(res, protocol === 'responses' ? responseTool(sample.calls) : ccTool(sample.calls)));
      await assert.rejects(streamProvider(input(f, protocol, { onToolCall: async () => { calls++; return receipt; } })));
      assert.equal(calls, 0); assert.equal(f.requests.length, 1);
    });
  }
});

test('truncated, incomplete or length-limited tool requests never queue side effects', async t => {
  const frames = [
    ['chat-completions', wire({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, ...ccCall() }] } }] })],
    ['chat-completions', wire({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, ...ccCall() }] }, finish_reason: 'length' }] }) + 'data: [DONE]\n\n'],
    ['chat-completions', wire({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, ...ccCall() }] } }] }) + 'data: [DONE]\n\n'],
    ['responses', wire({ type: 'response.output_item.done', output_index: 0, item: responseCall() })],
    ['responses', wire({ type: 'response.output_item.done', output_index: 0, item: responseCall() }) + wire({ type: 'response.incomplete', response: { status: 'incomplete', output: [responseCall()] } })],
    ['responses', wire({ type: 'response.output_item.done', output_index: 0, item: responseCall() }) + 'data: [DONE]\n\n'],
  ];
  for (let index = 0; index < frames.length; index++) await t.test(`${frames[index][0]} sample ${index}`, async t => {
    const [protocol, frame] = frames[index]; let calls = 0; const f = await fixture(t, res => sse(res, frame));
    await assert.rejects(streamProvider(input(f, protocol, { onToolCall: async () => { calls++; return receipt; } })));
    assert.equal(calls, 0); assert.equal(f.requests.length, 1);
  });
});

test('Responses JSON requires explicit completed status before tool dispatch', async t => {
  for (const status of [undefined, 'in_progress', 'incomplete', 'failed']) await t.test(String(status), async t => {
    let calls = 0;
    const response = { id: 'resp_fixture', output: [responseCall()], ...(status === undefined ? {} : { status }) };
    const f = await fixture(t, res => json(res, response));
    await assert.rejects(streamProvider(input(f, 'responses', { onToolCall: async () => { calls++; return receipt; } })));
    assert.equal(calls, 0); assert.equal(f.requests.length, 1);
  });
});

test('tools are absent without a callback and unsolicited calls cannot invoke an Agent', async t => {
  for (const protocol of ['chat-completions', 'responses']) await t.test(protocol, async t => {
    const f = await fixture(t, res => json(res, protocol === 'responses' ? responseTool() : ccTool()));
    await assert.rejects(streamProvider(input(f, protocol)));
    assert.equal(f.requests.length, 1); assert.equal(f.requests[0].body.tools, undefined);
    assert.equal(f.requests[0].body.parallel_tool_calls, undefined);
  });
});

test('a follow-up cannot call the Agent a second time even if the provider ignores tool_choice none', async t => {
  for (const protocol of ['chat-completions', 'responses']) await t.test(protocol, async t => {
    let calls = 0; const f = await fixture(t, res => json(res, protocol === 'responses' ? responseTool() : ccTool()));
    await assert.rejects(streamProvider(input(f, protocol, { onToolCall: async () => { calls++; return receipt; } })));
    assert.equal(calls, 1); assert.equal(f.requests.length, 2); assert.equal(f.requests[1].body.tool_choice, 'none');
  });
});

test('aborting before a complete tool response prevents dispatch and follow-up', async t => {
  for (const protocol of ['chat-completions', 'responses']) await t.test(protocol, async t => {
    const controller = new AbortController(); let calls = 0;
    const f = await fixture(t, res => sse(res, protocol === 'responses'
      ? wire({ type: 'response.output_text.delta', delta: '正在考虑。' }) + wire({ type: 'response.completed', response: responseTool() })
      : wire({ choices: [{ index: 0, delta: { content: '正在考虑。' } }] }) + wire({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, ...ccCall() }] }, finish_reason: 'tool_calls' }] })));
    await assert.rejects(streamProvider(input(f, protocol, { signal: controller.signal, onEvent: event => { if (event === 'delta') controller.abort(); }, onToolCall: async () => { calls++; return receipt; } })), { name: 'AbortError' });
    assert.equal(calls, 0); assert.equal(f.requests.length, 1);
  });
});
