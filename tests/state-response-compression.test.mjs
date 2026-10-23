import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { gunzipSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPetServer } from '../server/app.mjs';
import { JsonStore, defaultSettings } from '../server/store.mjs';
import { defaultVoiceSettings } from '../server/voice.mjs';
import { newSession } from '../server/auth.mjs';
import { listenFixture } from './helpers/loopback.mjs';

const token = 'isolated-compression-owner';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const parse = response => JSON.parse((response.headers['content-encoding'] === 'gzip' ? gunzipSync(response.body) : response.body).toString('utf8'));
function wav() {
  const bytes = Buffer.alloc(48044);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(24000, 24); bytes.writeUInt32LE(48000, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(48000, 40);
  for (let index = 44; index < bytes.length; index += 2) bytes.writeInt16LE(1000, index);
  return bytes;
}

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-state-compression-'));
  const chatGate = deferred(), audioGate = deferred();
  const upstream = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'first-stream-delta' } }] })}\n\n`);
    chatGate.promise.then(() => res.end('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'));
  });
  let app;
  t.after(async () => {
    chatGate.resolve(); audioGate.resolve(); await app?.close();
    upstream.closeAllConnections(); if (upstream.listening) await new Promise(resolve => upstream.close(resolve));
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir())); assert.ok(path.basename(directory).startsWith('petpal-state-compression-'));
    await rm(directory, { recursive: true, force: true });
  });
  await listenFixture(upstream);
  const store = await new JsonStore(directory).init(), ownerId = store.state.ownerId, memberId = randomUUID();
  const providers = Array.from({ length: 8 }, (_, index) => ({ id: randomUUID(), name: `Synthetic model ${index}: ${'description '.repeat(12)}`, protocol: 'chat-completions', baseUrl: `http://127.0.0.1:${upstream.address().port}/v1`, model: `fixture-${index}`, apiKey: 'private-provider-key', reasoningEffort: '' }));
  store.state.providers = providers;
  store.state.users.push({ id: memberId, username: 'member', displayName: 'Member', role: 'user', agentAccess: 'full', disabled: false, providerIds: [providers[0].id], password: null, settings: defaultSettings(), voice: defaultVoiceSettings(), createdAt: '2026-01-01T00:00:00.000Z' });
  const session = newSession(memberId); store.state.sessions.push(session.session);
  for (const userId of [ownerId, memberId]) store.state.conversations.push({ id: randomUUID(), userId, mode: 'chat', title: userId === ownerId ? 'owner-private-history' : 'member-history', providerId: providers[0].id, messages: [{ id: randomUUID(), role: 'user', content: `Synthetic body for ${userId}. `.repeat(100), status: 'complete', createdAt: '2026-01-01T00:00:00.000Z' }], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
  await store.save();
  app = await createPetServer({ dataDir: directory, token, codex: { status: async () => ({ available: false }), close: async () => {} }, desktopTools: { specs: [], close: async () => {} }, automationOptions: { autoStart: false }, cosyvoiceOptions: { fetchImpl: async url => {
    if (url.endsWith('/api/tts/capabilities')) return new Response('{}', { status: 404 });
    if (url.endsWith('/api/tts/stream')) return new Response(new ReadableStream({ start(controller) { controller.enqueue(Buffer.from([1, 2, 3, 4])); audioGate.promise.then(() => controller.close()); } }), { headers: { 'Content-Type': 'application/octet-stream', 'X-Audio-Format': 'pcm_s16le', 'X-Audio-Sample-Rate': '24000', 'X-Audio-Channels': '1' } });
    throw new Error('Unexpected synthetic voice endpoint');
  } } });
  await listenFixture(app.server);
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const open = (route, { credential = token, method = 'GET', body, headers = {} } = {}) => new Promise((resolve, reject) => {
    const raw = body === undefined ? undefined : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
    const request = http.request(`${base}/api${route}`, { method, headers: { ...(credential ? { Authorization: `Bearer ${credential}` } : {}), 'Accept-Encoding': 'gzip', ...(raw ? { 'Content-Type': Buffer.isBuffer(body) ? 'audio/wav' : 'application/json', 'Content-Length': raw.length } : {}), ...headers } }, resolve);
    request.once('error', reject); request.setTimeout(5000, () => request.destroy(new Error('Synthetic request timed out.'))); request.end(raw);
  });
  const request = async (...args) => { const response = await open(...args), chunks = []; for await (const chunk of response) chunks.push(chunk); return { status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }; };
  return { app, open, request, providers, ownerId, memberId, memberToken: session.token, ownerConversationId: store.state.conversations[0].id, chatGate, audioGate };
}

test('raw HTTP startup snapshots negotiate gzip, preserve JSON and no-store, and vary by encoding', async t => {
  const f = await fixture(t);
  for (const route of ['/bootstrap', '/state?runtime=deferred']) {
    const identity = await f.request(route, { headers: { 'Accept-Encoding': 'identity' } }), zipped = await f.request(route);
    assert.equal(identity.status, 200); assert.equal(identity.headers['content-encoding'], undefined);
    assert.equal(zipped.status, 200); assert.equal(zipped.headers['content-encoding'], 'gzip');
    assert.equal(zipped.headers['cache-control'], 'no-store'); assert.match(zipped.headers.vary, /(?:^|,\s*)Accept-Encoding(?:,|$)/i);
    assert.deepEqual(parse(zipped), parse(identity)); assert.ok(zipped.body.length < identity.body.length);
    assert.doesNotMatch(gunzipSync(zipped.body).toString(), /private-provider-key/);
  }
});

test('gzip retains member model/history isolation and never wraps unauthenticated responses', async t => {
  const f = await fixture(t);
  for (const route of ['/bootstrap', '/state?runtime=deferred']) {
    for (const credential of ['', 'unknown']) {
      const denied = await f.request(route, { credential }); assert.equal(denied.status, 401);
      assert.equal(denied.headers['content-encoding'], undefined); assert.doesNotMatch(denied.body.toString(), /owner-private-history|member-history/);
    }
    const member = await f.request(route, { credential: f.memberToken }), value = parse(member);
    assert.equal(member.headers['content-encoding'], 'gzip'); assert.equal(value.user.id, f.memberId);
    assert.deepEqual(value.providers.map(provider => provider.id), [f.providers[0].id]);
    assert.doesNotMatch(JSON.stringify(value), /owner-private-history|private-provider-key/);
    assert.deepEqual(value.conversations.map(item => item.title), route === '/bootstrap' ? [] : ['member-history']);
  }
});

test('identity negotiation and Range preserve uncompressed snapshots and incoming request headers', async t => {
  const f = await fixture(t), observed = [];
  f.app.server.on('request', req => { if (req.url.startsWith('/api/state')) observed.push(req.headers['accept-encoding']); });
  const identity = await f.request('/state?runtime=deferred', { headers: { 'Accept-Encoding': 'identity' } });
  const range = await f.request('/state?runtime=deferred', { headers: { Range: 'bytes=0-20' } });
  assert.deepEqual(observed, ['identity', 'gzip']); assert.equal(range.status, 200);
  assert.equal(identity.headers['content-encoding'], undefined); assert.equal(range.headers['content-encoding'], undefined);
  assert.deepEqual(parse(range), parse(identity));
});

test('non-200, Content-Range, no-transform and small snapshot responses bypass compression', async t => {
  const f = await fixture(t);
  f.app.server.on('request', (req, res) => {
    if (!req.url.startsWith('/api/state')) return;
    switch (req.headers['x-fixture-policy']) {
      case 'non-200': res.statusCode = 202; break;
      case 'content-range': res.setHeader('Content-Range', 'bytes 0-999/2000'); break;
      case 'no-transform': res.setHeader('Cache-Control', 'no-store, no-transform'); break;
      case 'small': { const json = res.json; res.json = () => json.call(res, { small: true }); break; }
    }
  });
  for (const policy of ['non-200', 'content-range', 'no-transform', 'small']) {
    const response = await f.request('/state?runtime=deferred', { headers: { 'X-Fixture-Policy': policy } });
    assert.equal(response.headers['content-encoding'], undefined, policy);
    assert.equal(response.status, policy === 'non-200' ? 202 : 200);
    if (policy === 'small') assert.deepEqual(parse(response), { small: true });
    else assert.equal(parse(response).user.id, f.ownerId);
  }
  const invalid = await f.request('/state?unknown=1'); assert.equal(invalid.status, 400); assert.equal(invalid.headers['content-encoding'], undefined);
});

test('other authenticated JSON routes remain outside startup compression', async t => {
  const f = await fixture(t), response = await f.request('/voice');
  assert.equal(response.status, 200); assert.equal(response.headers['content-encoding'], undefined);
  assert.equal(response.headers.vary, undefined);
});

test('Chat SSE delivers a delta while upstream is held, without negotiated compression', { timeout: 10000 }, async t => {
  const f = await fixture(t), response = await f.open(`/conversations/${f.ownerConversationId}/messages`, { method: 'POST', body: { content: 'Synthetic stream check' } });
  assert.equal(response.statusCode, 200); assert.equal(response.headers['content-encoding'], undefined); assert.equal(response.headers.vary, undefined);
  const first = deferred(), ended = deferred(); let text = '', complete = false;
  response.on('data', chunk => { text += chunk.toString(); if (text.includes('first-stream-delta')) first.resolve(); });
  response.on('end', () => { complete = true; ended.resolve(); });
  await first.promise; assert.equal(complete, false); assert.match(text, /event: delta/);
  f.chatGate.resolve(); await ended.promise; assert.match(text, /event: done/);
});

test('TTS audio frames arrive before upstream EOF and remain outside startup compression', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/voice/cosyvoice', { method: 'PATCH', body: { baseUrl: 'http://127.0.0.1:55555', referenceText: '合成参考音色。' } })).status, 200);
  assert.equal((await f.request('/voice/cosyvoice/reference', { method: 'POST', body: wav() })).status, 200);
  assert.equal((await f.request('/voice', { method: 'PATCH', body: { tts: { mode: 'cosyvoice' } } })).status, 200);
  const response = await f.open('/voice/synthesize/stream', { method: 'POST', body: { text: '你好。' } });
  assert.equal(response.statusCode, 200); assert.equal(response.headers['content-encoding'], undefined); assert.equal(response.headers.vary, undefined);
  const first = deferred(), ended = deferred(); let text = '', complete = false;
  response.on('data', chunk => { text += chunk.toString(); if (text.includes('"type":"audio"')) first.resolve(); });
  response.on('end', () => { complete = true; ended.resolve(); });
  await first.promise; assert.equal(complete, false); assert.match(text, /"data":"AQIDBA=="/);
  f.audioGate.resolve(); await ended.promise; assert.match(text, /"type":"end"/);
});
