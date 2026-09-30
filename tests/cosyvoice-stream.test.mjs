import { listenFixture } from './helpers/loopback.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCosyVoiceService, COSYVOICE_AUDIO_LIMIT, COSYVOICE_STREAM_CHUNK } from '../server/cosyvoice.mjs';
import { createPetServer } from '../server/app.mjs';

const check = (name, run) => test(name, { timeout: 5000 }, run);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const baseUrl = 'http://127.0.0.1:55555';
const headers = { 'Content-Type': 'application/octet-stream', 'X-Audio-Format': 'pcm_s16le', 'X-Audio-Sample-Rate': '24000', 'X-Audio-Channels': '1' };
const format = { type: 'format', format: 'pcm_s16le', sampleRate: 24000, channels: 1 };
const wav = () => {
  const bytes = Buffer.alloc(48044); bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(24000, 24); bytes.writeUInt32LE(48000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(48000, 40);
  for (let i = 44; i < bytes.length; i += 2) bytes.writeInt16LE(1000, i);
  return bytes;
};
const json = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
async function removeTemporary(directory) {
  assert.equal(path.dirname(directory), path.resolve(tmpdir())); assert.match(path.basename(directory), /^petpal-stream-test-/);
  await rm(directory, { recursive: true, force: true });
}
async function until(predicate) {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.fail('Expected fixture event did not occur');
}
function pcm({ chunks = [Buffer.from([1, 2, 3, 4])], hold = false, fail = false, responseHeaders = {} } = {}) {
  const gate = deferred(), entered = deferred(); let index = 0;
  const state = { pulls: 0, cancelled: false, closed: false, gate, entered };
  state.response = new Response(new ReadableStream({
    async pull(controller) {
      state.pulls++; entered.resolve();
      if (index < chunks.length) { controller.enqueue(chunks[index++]); return; }
      if (hold) await gate.promise;
      if (state.cancelled) return;
      if (fail) controller.error(new Error('secret upstream diagnostic /private/token'));
      else { state.closed = true; controller.close(); }
    },
    cancel() { state.cancelled = true; gate.resolve(); },
  }, { highWaterMark: 0 }), { headers: { ...headers, ...responseHeaders } });
  return state;
}
function transport(factory) {
  const calls = [];
  return { calls, fetchImpl: async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/api/tts/capabilities')) return new Response('{}', { status: 404 });
    if (url.endsWith('/api/tts/stream')) return factory(calls.length, init);
    const cache = '/tmp/gradio/' + 'a'.repeat(64), id = '1'.repeat(32);
    if (url.endsWith('/upload')) return json([`${cache}/reference.wav`]);
    if (url.endsWith('/call/generate_audio')) return json({ event_id: id });
    if (url.endsWith('/' + id)) return new Response(`event: complete\ndata: ${JSON.stringify([{ path: `${cache}/audio.wav`, is_stream: false }])}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
    if (url.includes('/file=')) return new Response(wav(), { headers: { 'Content-Type': 'audio/wav' } });
    throw new Error('Unexpected local fixture endpoint');
  } };
}
async function fixture(t, { factory = () => pcm().response, ...options } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-stream-test-'));
  const store = { directory, state: {}, async save() {} }, upstream = transport(factory);
  const service = await createCosyVoiceService({ store, ...upstream, ...options });
  t.after(async () => { await service.close(); await removeTemporary(directory); });
  await service.configure({ baseUrl, apiKey: 'fixture-private-key', referenceText: '这是参考音色。' }); await service.setReference(wav());
  const run = args => service.synthesizeStream({ userId: 'alice', text: '你好。', onFrame() {}, ...args });
  return { directory, store, service, upstream, run };
}

check('PCM yields before EOF, preserves odd network chunks, bounds frames and pins private multipart inputs', async t => {
  const original = Buffer.alloc(24584, 123), source = pcm({ chunks: [original.subarray(0, 3), original.subarray(3, 24583), original.subarray(24583)], hold: true });
  const f = await fixture(t, { factory: () => source.response }), frames = [], first = deferred();
  const task = f.run({ onFrame(frame) { frames.push(frame); if (frame.type === 'audio') first.resolve(); } });
  await first.promise; assert.equal(source.closed, false); assert.deepEqual(frames[0], format);
  source.gate.resolve(); assert.deepEqual(await task, { bytes: original.length });
  const audio = frames.filter(frame => frame.type === 'audio').map(frame => Buffer.from(frame.data, 'base64'));
  assert.deepEqual(audio.map(chunk => chunk.length), [3, COSYVOICE_STREAM_CHUNK, 4, 1]);
  assert.deepEqual(Buffer.concat(audio), original); assert.deepEqual(frames.at(-1), { type: 'end', bytes: original.length });
  assert.equal(f.upstream.calls.length, 2);
  assert.equal(f.upstream.calls[0].url, baseUrl + '/api/tts/capabilities');
  const call = f.upstream.calls[1]; assert.equal(call.url, baseUrl + '/api/tts/stream');
  assert.equal(call.init.redirect, 'error'); assert.equal(call.init.credentials, 'omit'); assert.equal(call.init.headers.get('authorization'), 'Bearer fixture-private-key');
  assert.deepEqual([...call.init.body.keys()].sort(), ['tts_text', 'mode', 'prompt_text', 'seed', 'prompt_wav'].sort());
  assert.equal(call.init.body.get('mode'), 'zero_shot'); assert.equal(call.init.body.get('seed'), '0');
  assert.equal(call.init.body.get('prompt_text'), '这是参考音色。'); assert.deepEqual(Buffer.from(await call.init.body.get('prompt_wav').arrayBuffer()), wav());
});

check('WAV and PCM share global concurrency and the same per-user rate window', async t => {
  const source = pcm({ hold: true }); let count = 0;
  const f = await fixture(t, { factory: () => ++count === 1 ? source.response : pcm().response, rateLimit: 2 });
  const first = f.run(); await source.entered.promise;
  await assert.rejects(f.service.synthesize({ userId: 'bob', text: '你好。' }), { status: 429 });
  await assert.rejects(f.run({ userId: 'alice' }), { status: 429 });
  source.gate.resolve(); await first;
  await f.service.synthesize({ userId: 'alice', text: '你好。' });
  await assert.rejects(f.run(), { status: 429 }); await f.run({ userId: 'bob' });
});

check('non-1x streaming and changed reference fail before any network request', async t => {
  const f = await fixture(t);
  await assert.rejects(f.run({ speed: 1.1 }), error => error.status === 409 && error.message.includes('1.0'));
  await assert.rejects(f.run({ text: '' }), { status: 400 });
  const filename = path.join(f.directory, 'cosyvoice', f.store.state.cosyvoiceConfig.reference.name);
  await writeFile(filename, Buffer.alloc(wav().length));
  await assert.rejects(f.run(), { status: 409 }); assert.equal(f.upstream.calls.length, 0);
});

check('wrong PCM headers, redirects, upstream JSON and oversized declared bodies fail before format', async t => {
  const cases = [
    () => new Response('private-key', { status: 422, headers: { 'Content-Type': 'application/json' } }),
    () => new Response('', { status: 302, headers: { Location: 'https://evil.test' } }),
    ...[{ 'Content-Type': 'application/json' }, { 'X-Audio-Format': 'float32' }, { 'X-Audio-Sample-Rate': '48000' }, { 'X-Audio-Channels': '2' }, { 'Content-Length': String(COSYVOICE_AUDIO_LIMIT + 1) }, { 'Content-Length': 'NaN' }].map(responseHeaders => () => pcm({ responseHeaders }).response),
  ];
  for (const factory of cases) {
    const f = await fixture(t, { factory }), frames = [];
    await assert.rejects(f.run({ onFrame: frame => frames.push(frame) }), error => error.status === 502 && !/private|evil/.test(error.message));
    assert.deepEqual(frames, []);
  }
});

check('empty, odd, length-mismatched, interrupted and oversized PCM never emit end', async t => {
  for (const options of [
    { chunks: [] }, { chunks: [Buffer.from([1])] }, { responseHeaders: { 'Content-Length': '6' } },
    { fail: true }, { chunks: [Buffer.alloc(COSYVOICE_AUDIO_LIMIT + 2)] },
  ]) {
    const source = pcm(options), f = await fixture(t, { factory: () => source.response }), frames = [];
    await assert.rejects(f.run({ onFrame: frame => frames.push(frame) }), error => error.status === 502 && !error.message.includes('private'));
    assert.equal(frames.some(frame => frame.type === 'end'), false);
    assert.ok(frames.every(frame => frame.type !== 'audio' || Buffer.from(frame.data, 'base64').length <= COSYVOICE_STREAM_CHUNK));
  }
});

check('consumer backpressure stops upstream pulls and cancellation releases the shared slot', async t => {
  const source = pcm({ chunks: [Buffer.from([1, 2]), Buffer.from([3, 4])] }), paused = deferred(), hold = deferred(), controller = new AbortController();
  const f = await fixture(t, { factory: () => source.response });
  const task = f.run({ signal: controller.signal, onFrame(frame) { if (frame.type === 'audio') { paused.resolve(); return hold.promise; } } });
  const rejected = assert.rejects(task, { status: 409 });
  await paused.promise; await new Promise(resolve => setImmediate(resolve)); assert.equal(source.pulls, 1);
  controller.abort(new Error('private abort reason')); await rejected; assert.equal(source.cancelled, true);
  await f.service.synthesize({ userId: 'bob', text: '你好。' }); hold.resolve();
});

check('configuration, reference, timeout and service shutdown abort a blocked stream reader', async t => {
  for (const action of ['configuration', 'reference', 'timeout', 'close']) {
    const source = pcm({ hold: true }), f = await fixture(t, { factory: () => source.response, timeoutMs: action === 'timeout' ? 100 : 1000 });
    const frames = [], task = f.run({ onFrame: frame => frames.push(frame) });
    const rejected = assert.rejects(task, { status: action === 'timeout' ? 504 : action === 'close' ? 503 : 409 });
    await source.entered.promise;
    if (action === 'configuration') await f.service.configure({ referenceText: '新的参考。' });
    if (action === 'reference') await f.service.setReference(wav());
    if (action === 'close') await f.service.close();
    await rejected; assert.equal(source.cancelled, true); assert.equal(frames.some(frame => frame.type === 'end'), false);
  }
});

async function apiFixture(t, { factory = () => pcm().response, ...options } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-stream-test-')), upstream = transport(factory);
  const app = await createPetServer({ dataDir: directory, token: 'owner-test', codex: { async status() { return { available: false }; }, async close() {} }, cosyvoiceOptions: { ...options, fetchImpl: upstream.fetchImpl } });
  await listenFixture(app.server);
  t.after(async () => { await app.close(); await removeTemporary(directory); });
  const request = (route, { token = 'owner-test', method = 'GET', body, raw, signal } = {}) => fetch(`http://127.0.0.1:${app.server.address().port}/api${route}`, { method, signal, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(raw ? { 'Content-Type': 'audio/wav' } : body ? { 'Content-Type': 'application/json' } : {}) }, body: raw ?? (body ? JSON.stringify(body) : undefined) });
  assert.equal((await request('/voice/cosyvoice', { method: 'PATCH', body: { baseUrl, apiKey: 'fixture-private-key', referenceText: '参考音色。' } })).status, 200);
  assert.equal((await request('/voice/cosyvoice/reference', { method: 'POST', raw: wav() })).status, 200);
  assert.equal((await request('/admin/users', { method: 'POST', body: { username: 'alice', password: 'fixture-pass', displayName: 'Alice' } })).status, 201);
  const user = await (await request('/auth/login', { token: '', method: 'POST', body: { username: 'alice', password: 'fixture-pass' } })).json();
  for (const token of [user.token, 'owner-test']) assert.equal((await request('/voice', { token, method: 'PATCH', body: { tts: { mode: 'cosyvoice' } } })).status, 200);
  return { app, request, upstream, user, run: args => request('/voice/synthesize/stream', { token: user.token, method: 'POST', body: { text: '你好。' }, ...args }) };
}
const framesFrom = async response => (await response.text()).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));

check('HTTP stream requires auth, strict text-only input and account speed; legacy WAV still handles non-1x', async t => {
  const f = await apiFixture(t);
  assert.equal((await f.run({ token: '' })).status, 401);
  for (const body of [{ text: '你好', speed: 1 }, { text: '你好', baseUrl }, {}]) assert.equal((await f.run({ body })).status, 400);
  await f.request('/voice', { token: f.user.token, method: 'PATCH', body: { tts: { speed: 1.3 } } });
  const slow = await f.run(); assert.equal(slow.status, 409); assert.match((await slow.json()).error, /1.0/); assert.equal(f.upstream.calls.length, 0);
  const legacy = await f.request('/voice/synthesize', { token: f.user.token, method: 'POST', body: { text: '你好。' } });
  assert.equal(legacy.status, 200); assert.deepEqual(Buffer.from(await legacy.arrayBuffer()), wav());
  const normal = await f.run({ token: 'owner-test' }); assert.equal(normal.status, 200); assert.match(normal.headers.get('content-type'), /^application\/x-ndjson/);
  assert.deepEqual(await framesFrom(normal), [format, { type: 'audio', data: 'AQIDBA==' }, { type: 'end', bytes: 4 }]);
});

check('HTTP forwards audio before upstream EOF and drains before reading the next PCM chunk', async t => {
  const source = pcm({ chunks: [Buffer.from([1, 2]), Buffer.from([3, 4])], hold: true }), f = await apiFixture(t, { factory: () => source.response });
  const paused = deferred(); let responseSocket;
  f.app.server.on('request', (req, res) => {
    if (!req.url.endsWith('/voice/synthesize/stream')) return;
    const write = res.write.bind(res); let first = true;
    res.write = function (value, ...args) {
      const result = write(value, ...args);
      if (first && JSON.parse(value).type === 'audio') { first = false; responseSocket = res; paused.resolve(); return false; }
      return result;
    };
  });
  const response = await f.run(); await paused.promise;
  const reader = response.body.getReader(); let first = '';
  while (!first.includes('"type":"audio"')) { const chunk = await reader.read(); assert.equal(chunk.done, false); first += Buffer.from(chunk.value); }
  assert.equal(source.closed, false);
  assert.equal(source.pulls, 1); responseSocket.emit('drain');
  await until(() => source.pulls >= 2); source.gate.resolve();
  let rest = ''; for (;;) { const item = await reader.read(); if (item.done) break; rest += Buffer.from(item.value); }
  assert.match(rest, /"type":"end","bytes":4/); reader.releaseLock();
});

check('HTTP errors after format use one safe NDJSON error and never a JSON response or end', async t => {
  for (const sourceOptions of [{ chunks: [] }, { chunks: [Buffer.from([1])] }, { fail: true }]) {
    const source = pcm(sourceOptions), f = await apiFixture(t, { factory: () => source.response });
    const response = await f.run(), frames = await framesFrom(response);
    assert.equal(response.status, 200); assert.deepEqual(frames[0], format);
    assert.equal(frames.at(-1).type, 'error'); assert.equal(frames.filter(frame => frame.type === 'error').length, 1);
    assert.equal(frames.some(frame => frame.type === 'end'), false); assert.doesNotMatch(JSON.stringify(frames), /secret|private|token/);
  }
});

check('HTTP timeout and config cancellation interrupt drain waits, reporting a safe terminal error', async t => {
  for (const action of ['timeout', 'configuration']) {
    const source = pcm({ chunks: [Buffer.from([1, 2]), Buffer.from([3, 4])] });
    const f = await apiFixture(t, { factory: () => source.response, timeoutMs: action === 'timeout' ? 250 : 1000 }), paused = deferred();
    f.app.server.on('request', (req, res) => {
      if (!req.url.endsWith('/voice/synthesize/stream')) return;
      const write = res.write.bind(res); let first = true;
      res.write = (value, ...args) => { const result = write(value, ...args); if (first && JSON.parse(value).type === 'audio') { first = false; paused.resolve(); return false; } return result; };
    });
    const response = await f.run(); await paused.promise;
    if (action === 'configuration') assert.equal((await f.request('/voice/cosyvoice', { method: 'PATCH', body: { referenceText: '变化后的文字。' } })).status, 200);
    const frames = await framesFrom(response); assert.equal(source.pulls, 1); assert.equal(source.cancelled, true);
    assert.equal(frames.at(-1).type, 'error'); assert.equal(frames.some(frame => frame.type === 'end'), false);
    assert.match(frames.at(-1).message, action === 'timeout' ? /超时/ : /配置/);
  }
});

check('HTTP logout, disable, voice change and disconnect stop upstream and emit no successful end', async t => {
  for (const action of ['logout', 'disable', 'voice', 'disconnect']) {
    const source = pcm({ hold: true }), f = await apiFixture(t, { factory: () => source.response }), controller = new AbortController();
    const response = await f.run({ signal: controller.signal }); await source.entered.promise;
    if (action === 'logout') assert.equal((await f.request('/auth/logout', { token: f.user.token, method: 'POST' })).status, 200);
    if (action === 'disable') assert.equal((await f.request(`/admin/users/${f.user.user.id}`, { method: 'PATCH', body: { disabled: true } })).status, 200);
    if (action === 'voice') assert.equal((await f.request('/voice', { token: f.user.token, method: 'PATCH', body: { tts: { mode: 'system' } } })).status, 200);
    if (action === 'disconnect') controller.abort();
    if (action !== 'disconnect') assert.equal((await framesFrom(response)).some(frame => frame.type === 'end'), false);
    else await assert.rejects(response.text(), { name: 'AbortError' });
    await until(() => source.cancelled); assert.equal(source.cancelled, true);
  }
});

check('HTTP rechecks authorization for every frame even without a cancellation notification', async t => {
  const source = pcm({ chunks: [Buffer.from([1, 2])], hold: true }), f = await apiFixture(t, { factory: () => source.response }); let captured;
  f.app.server.on('request', req => { if (req.url.endsWith('/voice/synthesize/stream')) captured = req; });
  const response = await f.run(); await source.entered.promise;
  captured.user.disabled = true; source.gate.resolve();
  const frames = await framesFrom(response); assert.equal(frames.some(frame => frame.type === 'end' || frame.type === 'error'), false);
});
