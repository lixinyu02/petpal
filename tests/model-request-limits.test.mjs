import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MODEL_REQUEST_BYTES } from '../server/model-request-limits.mjs';
import { createCodexTransport } from '../server/codex-transport.mjs';
import { createPetServer } from '../server/app.mjs';
import { defaultCodexConfig } from '../server/codex-config.mjs';
import { JsonStore } from '../server/store.mjs';
import { computerUsePng } from './helpers/computer-use-images.mjs';
import { listenFixture } from './helpers/loopback.mjs';

const model = 'bounded-vision-fixture';
const completed = 'event: response.completed\ndata: {"type":"response.completed","response":{"id":"response-budget-fixture","status":"completed","output":[{"id":"message-budget","type":"message","role":"assistant","status":"completed","content":[{"type":"output_text","text":"Budget fixture completed.","annotations":[]}]}]}}\n\n';
const dataUrl = `data:image/png;base64,${computerUsePng(1_100_000).toString('base64')}`;
const visionBody = () => JSON.stringify({ model, stream: true, input: [0, 1, 2].map(index => ({ type: 'function_call_output', call_id: `call_${index}`, output: [{ type: 'input_image', image_url: dataUrl }] })) });

test('local Responses transport accepts accumulated screenshot context over 4 MiB and rejects above shared 16 MiB', { timeout: 30000 }, async t => {
  assert.equal(MODEL_REQUEST_BYTES, 16 * 1024 * 1024); const requests = [];
  let transport;
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = await createCodexTransport({ config: { mode: 'api', model, baseUrl: 'https://fixed.invalid/v1', apiKey: '' }, fetchImpl: async (_url, init) => { requests.push(init.body); return new Response(completed, { headers: { 'Content-Type': 'text/event-stream' } }); } });
    try { await (await fetch(candidate.baseUrl, { signal: AbortSignal.timeout(3000) })).arrayBuffer(); transport = candidate; break; }
    catch (error) { await candidate.close(); if (error.cause?.message !== 'bad port' || attempt === 19) throw error; }
  }
  t.after(() => transport.close());
  const request = body => fetch(transport.baseUrl + '/responses', { method: 'POST', headers: { Authorization: `Bearer ${transport.apiKey}`, 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(10000) });
  const body = visionBody(); assert.ok(Buffer.byteLength(body) > 4 * 1024 * 1024);
  const response = await request(body); assert.equal(response.status, 200); await response.text(); assert.equal(requests[0], body);
  const rejected = await request(JSON.stringify({ model, stream: true, input: 'a'.repeat(MODEL_REQUEST_BYTES) })); assert.ok(rejected.status >= 400); await rejected.text(); assert.equal(requests.length, 1);
  await assert.rejects(createCodexTransport({ config: { mode: 'api', model, baseUrl: 'https://fixed.invalid/v1', apiKey: '' }, limits: { requestBytes: MODEL_REQUEST_BYTES + 1 } }), /大小限制无效/);
});

test('selected executor relay retains image context over 4 MiB and rejects more than 16 MiB before upstream', { timeout: 30000 }, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-vision-relay-')), owner = ['synthetic', 'budget', 'owner'].join('-');
  const store = await new JsonStore(directory).init(); store.state.codexConfig = { ...defaultCodexConfig(), mode: 'api', baseUrl: 'https://fixed.invalid/v1', model, apiKey: '' }; await store.save();
  const requests = []; const server = await createPetServer({ dataDir: directory, token: owner, codex: { async status() { return { available: true, authenticated: true }; }, async close() {}, run() { throw new Error('selected PC must execute'); } }, executorsOptions: { pollMs: 5, fetchImpl: async (_url, init) => { requests.push(init.body); return new Response(completed, { headers: { 'Content-Type': 'text/event-stream' } }); } } });
  t.after(async () => { await server.close(); assert.ok(directory.startsWith(path.join(tmpdir(), 'petpal-vision-relay-'))); await rm(directory, { recursive: true, force: true }); });
  await listenFixture(server.server); const origin = `http://127.0.0.1:${server.server.address().port}`;
  const request = async (route, body, token = owner) => { const response = await fetch(origin + '/api' + route, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000) }); return { status: response.status, body: await response.json() }; };
  const { body: { hostId, connectionId } } = await request('/agent/executors/register', { deviceId: randomUUID(), name: 'Vision budget PC', platform: 'win32', arch: 'x64' });
  const conversation = (await request('/conversations', { mode: 'codex' })).body;
  assert.equal((await request(`/conversations/${conversation.id}/agent/submit`, { submissionId: randomUUID(), hostId, content: 'Isolated relay fixture.' })).status, 200);
  const command = (await request(`/agent/executors/${connectionId}/poll`)).body.commands[0];
  assert.equal((await request(`/agent/executors/${connectionId}/events`, { runId: command.runId, sequence: 1, event: 'started', data: {} })).status, 200);
  const relay = origin + `/api/agent/executors/${connectionId}/runs/${command.runId}/model/responses`;
  const send = body => fetch(relay, { method: 'POST', headers: { Authorization: `Bearer ${command.relayToken}`, 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(10000) });
  const body = visionBody(), response = await send(body); assert.equal(response.status, 200); await response.text(); assert.equal(requests[0], body);
  const rejected = await send(JSON.stringify({ model, stream: true, input: 'a'.repeat(MODEL_REQUEST_BYTES) })); assert.equal(rejected.status, 413); await rejected.text(); assert.equal(requests.length, 1);
  assert.equal((await request(`/agent/executors/${connectionId}/events`, { runId: command.runId, sequence: 2, event: 'complete', data: { threadId: 'budget-thread' } })).status, 200);
});
