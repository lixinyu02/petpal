import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { CodexBridge, resolveBundledCodex } from '../server/codex.mjs';
import { patchCodexConfig, defaultCodexConfig } from '../server/codex-config.mjs';
import { computerUseImage } from './helpers/computer-use-images.mjs';
import { listenFixture } from './helpers/loopback.mjs';

const image = computerUseImage();
const imageParts = value => !value || typeof value !== 'object' ? [] : [
  ...(value.type === 'input_image' ? [value] : []),
  ...Object.values(value).flatMap(item => Array.isArray(item) ? item.flatMap(imageParts) : imageParts(item)),
];

test('real bundled Codex carries Computer Use screenshot as vision content after approval and rejects limited access', { timeout: 90000 }, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-computer-vision-'));
  const requests = [], errors = []; let sequence = 0, executes = 0, approvals = 0;
  const upstream = http.createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString()); requests.push(body);
      const previous = body.input.some(item => item.type === 'function_call_output');
      const id = `response_computer_${++sequence}`;
      const item = previous
        ? { type: 'message', id: `message_${sequence}`, role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Screenshot fixture receipt completed.', annotations: [] }] }
        : { type: 'function_call', id: `function_${sequence}`, call_id: `computer_call_${sequence}`, name: 'petpal_computer_use_call', arguments: JSON.stringify({ tool: 'captureWindow', arguments: { windowId: 'test-window' } }), status: 'completed' };
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const send = (type, value) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`);
      send('response.created', { response: { id, status: 'in_progress', output: [] } });
      send('response.completed', { response: { id, status: 'completed', output: [item] } }); res.end();
    } catch (error) { errors.push(error); if (!res.headersSent) res.writeHead(500); res.end(); }
  });
  let bridge;
  t.after(async () => {
    await bridge?.close(); upstream.closeAllConnections(); if (upstream.listening) await new Promise(resolve => upstream.close(resolve));
    assert.ok(directory.startsWith(path.join(tmpdir(), 'petpal-computer-vision-'))); await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  await listenFixture(upstream);
  const config = patchCodexConfig(defaultCodexConfig(), { mode: 'api', baseUrl: `http://127.0.0.1:${upstream.address().port}/v1`, model: 'vision-fixture', apiKey: ['synthetic', 'vision', 'key'].join('-') });
  const binary = await resolveBundledCodex(); assert.ok(binary?.file);
  bridge = new CodexBridge({ dataDir: directory, config, command: binary.file, desktopTools: {
    specs: [{ type: 'function', name: 'petpal_computer_use_call', description: 'Isolated screenshot fixture; does not capture the real desktop.', inputSchema: { type: 'object', properties: { tool: { type: 'string' }, arguments: { type: 'object' } }, required: ['tool', 'arguments'], additionalProperties: false } }],
    describe() { return { description: 'Read a test-only screenshot after approval', approvalRequired: true }; },
    async execute() { executes++; return { kind: 'computer-use-mcp', ok: true, tool: 'captureWindow', content: [{ type: 'text', text: 'Synthetic screenshot metadata.' }, image] }; },
  } });
  const result = await bridge.run({ prompt: 'Inspect the isolated screenshot fixture.', permissions: { access: 'full-access', approval: 'ask' }, signal: AbortSignal.timeout(60000), onEvent: (event, data) => {
    if (event === 'approval') { assert.equal(executes, 0); approvals++; bridge.approve(data.id, 'accept'); }
  } });
  assert.match(result.text, /fixture receipt/); assert.equal(executes, 1); assert.equal(approvals, 1); assert.equal(requests.length, 2);
  const images = imageParts(requests[1].input);
  assert.equal(images.length, 1); assert.equal(images[0].image_url, `data:image/png;base64,${image.data}`);
  const textParts = requests[1].input.flatMap(item => Array.isArray(item.output) ? item.output.filter(part => part.type === 'input_text') : []);
  assert.equal(textParts.some(part => part.text.includes(image.data)), false, 'base64 never appears as tool text');
  const limited = await bridge.run({ prompt: 'Attempt a screenshot with limited access.', permissions: { access: 'workspace-write', approval: 'auto' }, signal: AbortSignal.timeout(15000), onEvent: event => assert.notEqual(event, 'approval') });
  assert.match(limited.text, /fixture receipt/); assert.equal(executes, 1); assert.equal(requests.length, 4);
  assert.equal(imageParts(requests[3].input).length, 0); assert.match(JSON.stringify(requests[3].input), /完全访问权限/);
  assert.equal(errors.length, 0, errors.map(error => error.message).join('; '));
});
