import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCosyVoiceService } from '../server/cosyvoice.mjs';
import { createPetServer } from '../server/app.mjs';
import { listenFixture } from './helpers/loopback.mjs';

const baseUrl = 'http://127.0.0.1:55555', requestId = '1'.repeat(32), cache = '/tmp/gradio/' + 'a'.repeat(64);
const format = { type: 'format', format: 'pcm_s16le', sampleRate: 24000, channels: 1 };
const selected = { emotion: 'happy', intensity: 'natural', source: 'rules' };
const capability = { model: 'CosyVoice3', modes: ['zero_shot', 'cross_lingual', 'instruct2'], instruct2: true };
const receipt = overrides => ({ request_id: requestId, state: 'succeeded', error_type: null, runtime: { request_id: requestId, cancelled: false, timed_out: false }, ...overrides });
const json = (value, status = 200) => Response.json(value, { status });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function wav() {
  const bytes = Buffer.alloc(48044); bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(24000, 24); bytes.writeUInt32LE(48000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(48000, 40);
  for (let index = 44; index < bytes.length; index += 2) bytes.writeInt16LE(1000, index);
  return bytes;
}
function pcm({ headers = {}, metadata = selected, body = Buffer.from([1, 2, 3, 4]) } = {}) {
  return new Response(body, { headers: { 'Content-Type': 'application/octet-stream', 'X-Audio-Format': 'pcm_s16le', 'X-Audio-Sample-Rate': '24000', 'X-Audio-Channels': '1', 'X-Request-ID': requestId,
    ...(metadata ? { 'X-TTS-Emotion': metadata.emotion, 'X-TTS-Emotion-Intensity': metadata.intensity, 'X-TTS-Emotion-Source': metadata.source } : {}), ...headers } });
}
async function fixture(t, { onCapability, onEmotion, onStream, onStatus, ...options } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-emotion-test-')), calls = [];
  const store = { directory, state: {}, async save() {} };
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/api/tts/capabilities')) return onCapability ? onCapability(init) : json(capability);
    if (url.endsWith('/api/tts/emotion')) return onEmotion ? onEmotion(init) : json({ ...selected, instruct_text: '请用开心的语气自然地说一句话。', requires_prompt_wav: true, reason: 'private explanation not forwarded', signals: ['happy'] });
    if (url.endsWith('/api/tts/stream')) return onStream ? onStream(init) : pcm();
    if (url.endsWith('/api/tts/status')) return onStatus ? onStatus(init) : json({ recent: [receipt()] });
    if (url.endsWith('/upload')) return json([`${cache}/reference.wav`]);
    if (url.endsWith('/call/generate_audio')) return json({ event_id: requestId });
    if (url.endsWith('/call/generate_audio/' + requestId)) return new Response(`event: complete\ndata: ${JSON.stringify([{ path: `${cache}/audio.wav`, is_stream: false }])}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
    if (url.includes('/file=')) return new Response(wav(), { headers: { 'Content-Type': 'audio/wav' } });
    throw new Error('Unexpected isolated upstream endpoint');
  };
  const service = await createCosyVoiceService({ store, fetchImpl, completionTimeoutMs: 80, completionPollMs: 5, ...options });
  t.after(async () => { await service.close(); assert.equal(path.dirname(directory), path.resolve(tmpdir())); assert.match(path.basename(directory), /^petpal-emotion-test-/); await rm(directory, { recursive: true, force: true }); });
  await service.configure({ baseUrl, apiKey: 'private-fixture-key', referenceText: '已有参考文字。' }); await service.setReference(wav());
  const stream = async (args = {}, frames = []) => { const result = await service.synthesizeStream({ userId: 'alice', text: '今天很开心。', onFrame: frame => frames.push(frame), ...args }); return { result, frames }; };
  return { service, calls, fetchImpl, stream, wav: args => service.synthesize({ userId: 'alice', text: '今天很开心。', ...args }) };
}

test('default auto uses the same reference and raw text, forwards only selected emotion and waits for its own completion receipt', async t => {
  let checks = 0;
  const f = await fixture(t, { onStatus: () => json({ recent: ++checks === 1 ? [receipt({ request_id: '2'.repeat(32) })] : [receipt()] }) });
  const { result, frames } = await f.stream();
  assert.deepEqual(result, { bytes: 4 }); assert.deepEqual(frames, [{ ...format, emotion: selected }, { type: 'audio', data: 'AQIDBA==' }, { type: 'end', bytes: 4 }]);
  assert.equal(checks, 2);
  const call = f.calls.find(item => item.url.endsWith('/api/tts/stream'));
  assert.equal(call.init.body.get('mode'), 'instruct2'); assert.equal(call.init.body.get('emotion'), 'auto'); assert.equal(call.init.body.get('emotion_intensity'), 'natural');
  assert.equal(call.init.body.get('tts_text'), '今天很开心。'); assert.equal(call.init.body.has('prompt_text'), false); assert.equal(call.init.body.has('instruct_text'), false);
  assert.deepEqual(Buffer.from(await call.init.body.get('prompt_wav').arrayBuffer()), wav());
  assert.equal(JSON.stringify(frames).includes('private'), false);
});

test('original keeps zero-shot voice on modern services while capability cache and completion checks remain active', async t => {
  const f = await fixture(t);
  for (const userId of ['alice', 'bob']) {
    const { frames } = await f.stream({ userId, emotion: 'original' }); assert.deepEqual(frames[0], format);
  }
  assert.equal(f.calls.filter(item => item.url.endsWith('/capabilities')).length, 1);
  assert.equal(f.calls.filter(item => item.url.endsWith('/status')).length, 2);
  for (const call of f.calls.filter(item => item.url.endsWith('/api/tts/stream'))) {
    assert.equal(call.init.body.get('mode'), 'zero_shot'); assert.equal(call.init.body.get('prompt_text'), '已有参考文字。'); assert.equal(call.init.body.has('emotion'), false);
  }
});

test('only old capability 404 permits auto/original fallback, and explicit emotion never silently falls back', async t => {
  const f = await fixture(t, { onCapability: () => json({}, 404), onStream: () => { const value = pcm({ metadata: null }); value.headers.delete('x-request-id'); return value; } });
  assert.deepEqual((await f.stream()).frames[0], format);
  assert.deepEqual((await f.stream({ emotion: 'original' })).frames[0], format);
  await assert.rejects(f.stream({ emotion: 'happy' }), { status: 409 });
  assert.equal(f.calls.filter(item => item.url.endsWith('/capabilities')).length, 1); assert.equal(f.calls.filter(item => item.url.endsWith('/api/tts/stream')).length, 2);
  assert.equal(f.calls.some(item => item.url.endsWith('/status')), false);
  for (const bad of [() => json({}, 500), () => json({ modes: ['instruct2'] }), () => new Response('x'.repeat(131073))]) {
    const broken = await fixture(t, { onCapability: bad }); await assert.rejects(broken.stream(), { status: 502 }); assert.equal(broken.calls.length, 1);
  }
});

test('capabilities expire by bounded TTL and are invalidated by shared configuration revision', async t => {
  let clock = 0;
  const f = await fixture(t, { now: () => clock, capabilityTtlMs: 50 });
  await f.stream(); clock = 10; await f.stream(); assert.equal(f.calls.filter(item => item.url.endsWith('/capabilities')).length, 1);
  clock = 60; await f.stream(); assert.equal(f.calls.filter(item => item.url.endsWith('/capabilities')).length, 2);
  await f.service.configure({ referenceText: '更新后的参考文字。' }); await f.stream(); assert.equal(f.calls.filter(item => item.url.endsWith('/capabilities')).length, 3);
});

test('non-default speed WAV freezes the same upstream choice without putting instructions in the spoken text', async t => {
  const f = await fixture(t), audio = await f.wav({ speed: 1.3 });
  assert.deepEqual(audio, wav()); assert.deepEqual(audio.speechEmotion, selected); assert.equal(Object.keys(audio).includes('speechEmotion'), false);
  const preview = f.calls.find(item => item.url.endsWith('/api/tts/emotion')); assert.deepEqual(JSON.parse(preview.init.body), { tts_text: '今天很开心。', emotion: 'auto', emotion_intensity: 'natural' });
  const data = JSON.parse(f.calls.find(item => item.url.endsWith('/call/generate_audio')).init.body).data;
  assert.equal(data.length, 10); assert.equal(data[0], '今天很开心。'); assert.equal(data[1], '自然语言控制'); assert.equal(data[3], ''); assert.equal(data[6], '请用开心的语气自然地说一句话。'); assert.equal(data[8], false); assert.equal(data[9], 1.3);
});

test('neutral/gentle use natural metadata even when strong is requested, and invalid preference or upstream choices fail closed', async t => {
  const f = await fixture(t, { onStream: () => pcm({ metadata: { emotion: 'gentle', intensity: 'natural', source: 'choice' } }) });
  assert.deepEqual((await f.stream({ emotion: 'gentle', emotionIntensity: 'strong' })).frames[0].emotion, { emotion: 'gentle', intensity: 'natural', source: 'choice' });
  const before = f.calls.length;
  for (const args of [{ emotion: 'shy' }, { emotion: 'manual' }, { emotionIntensity: 'custom' }, { emotion: null }]) await assert.rejects(f.stream(args), { status: 400 });
  assert.equal(f.calls.length, before);
  for (const change of [{ emotion: 'surprised' }, { source: 'private-source' }, { intensity: 'custom' }, { instruct_text: '' }, { instruct_text: '\0' }]) {
    const bad = await fixture(t, { onEmotion: () => json({ ...selected, instruct_text: '固定安全指令。', ...change }) }); await assert.rejects(bad.wav(), { status: 502 });
    assert.equal(bad.calls.some(item => item.url.endsWith('/upload')), false);
  }
});

test('modern streams reject missing IDs or unsafe emotion metadata before delivering any format/audio', async t => {
  for (const change of [{ 'X-Request-ID': '' }, { 'X-Request-ID': '../private' }, { 'X-TTS-Emotion': 'shy' }, { 'X-TTS-Emotion-Source': 'untrusted' }, { 'X-TTS-Emotion-Intensity': 'custom' }]) {
    const frames = [], f = await fixture(t, { onStream: () => pcm({ headers: change }) }); await assert.rejects(f.stream({}, frames), { status: 502 }); assert.deepEqual(frames, []);
  }
});

test('clean PCM EOF does not emit end for failed, cancelled, missing or conflicting completion receipts', async t => {
  const failed = [receipt({ state: 'failed', error_type: 'private diagnosis' }), receipt({ runtime: { cancelled: true, timed_out: false } }), receipt({ runtime: { cancelled: false, timed_out: true } }), receipt({ runtime: null })];
  for (const records of [...failed.map(value => [value]), [], [receipt({ request_id: '2'.repeat(32) })], [receipt(), receipt()]]) {
    const frames = [], f = await fixture(t, { completionTimeoutMs: 20, onStatus: () => json({ recent: records }) });
    await assert.rejects(f.stream({}, frames), error => error.status === 502 && !/private|request_id/.test(error.message));
    assert.equal(frames.some(frame => frame.type === 'audio'), true); assert.equal(frames.some(frame => frame.type === 'end'), false);
  }
});

test('cancellation while reading completion receipt cancels the reader and releases the shared slot', async t => {
  const entered = deferred(); let cancelled = false, first = true;
  const f = await fixture(t, { onStatus: () => {
    if (!first) return json({ recent: [receipt()] }); first = false;
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(Buffer.from('{"recent":[')); entered.resolve(); }, cancel() { cancelled = true; } }));
  } });
  const controller = new AbortController(), frames = [], pending = f.stream({ signal: controller.signal }, frames);
  await entered.promise; controller.abort(new Error('private abort reason')); await assert.rejects(pending, { status: 409 });
  assert.equal(cancelled, true); assert.equal(frames.some(frame => frame.type === 'end'), false);
  assert.equal((await f.stream({ userId: 'bob' })).frames.at(-1).type, 'end');
});

test('capability probe cancellation does not cache an incomplete response or hold concurrency', async t => {
  const entered = deferred(); let cancelled = false, first = true;
  const f = await fixture(t, { onCapability: () => {
    if (!first) return json(capability); first = false;
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(Buffer.from('{"modes":[')); entered.resolve(); }, cancel() { cancelled = true; } }));
  } });
  const controller = new AbortController(), task = f.stream({ signal: controller.signal }); await entered.promise; controller.abort(); await assert.rejects(task, { status: 409 });
  assert.equal(cancelled, true); assert.equal((await f.stream()).frames.at(-1).type, 'end'); assert.equal(f.calls.filter(item => item.url.endsWith('/capabilities')).length, 2);
});

test('upstream queue or worker 503 stays safely unavailable without any automatic replay', async t => {
  for (const stage of ['onCapability', 'onStream', 'onStatus', 'onEmotion']) {
    const f = await fixture(t, { [stage]: () => json({ diagnostic: 'private upstream failure' }, 503) }), frames = [];
    await assert.rejects(stage === 'onEmotion' ? f.wav() : f.stream({}, frames), error => error.status === 503 && /繁忙|就绪/.test(error.message) && !error.message.includes('private'));
    const suffix = { onCapability: '/capabilities', onStream: '/api/tts/stream', onStatus: '/status', onEmotion: '/emotion' }[stage];
    assert.equal(f.calls.filter(item => item.url.endsWith(suffix)).length, 1); assert.equal(frames.some(frame => frame.type === 'end'), false);
  }
});

test('capability body has its own short deadline and a timed-out result cannot poison the next probe', async t => {
  let first = true, cancelled = false;
  const f = await fixture(t, { capabilityTimeoutMs: 20, onCapability: () => {
    if (!first) return json(capability); first = false;
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(Buffer.from('{')); }, cancel() { cancelled = true; } }));
  } });
  await assert.rejects(f.stream(), { status: 502 }); assert.equal(cancelled, true);
  assert.equal((await f.stream()).frames.at(-1).type, 'end'); assert.equal(f.calls.filter(item => item.url.endsWith('/capabilities')).length, 2);
});

test('HTTP synthesis uses only saved account emotion, rejects body overrides and exposes the frozen WAV selection', async t => {
  const strong = { emotion: 'happy', intensity: 'strong', source: 'choice' };
  const f = await fixture(t, { onStream: () => pcm({ metadata: strong }), onEmotion: () => json({ ...strong, instruct_text: '请非常开心地说一句话。' }) });
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-emotion-test-'));
  const app = await createPetServer({ dataDir: directory, token: 'isolated-owner', codex: { async status() { return { available: false }; }, async close() {} }, cosyvoiceOptions: { fetchImpl: f.fetchImpl } });
  await listenFixture(app.server);
  t.after(async () => { await app.close(); assert.equal(path.dirname(directory), path.resolve(tmpdir())); assert.match(path.basename(directory), /^petpal-emotion-test-/); await rm(directory, { recursive: true, force: true }); });
  const request = (route, { token = 'isolated-owner', method = 'GET', body, raw, accept } = {}) => fetch(`http://127.0.0.1:${app.server.address().port}/api${route}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(accept ? { Accept: accept } : {}), ...(raw ? { 'Content-Type': 'audio/wav' } : body ? { 'Content-Type': 'application/json' } : {}) }, body: raw ?? (body ? JSON.stringify(body) : undefined) });
  assert.equal((await request('/voice/cosyvoice', { method: 'PATCH', body: { baseUrl, referenceText: '相同参考文字。' } })).status, 200);
  assert.equal((await request('/voice/cosyvoice/reference', { method: 'POST', raw: wav() })).status, 200);
  const accounts = {};
  for (const username of ['alice', 'bob']) {
    assert.equal((await request('/admin/users', { method: 'POST', body: { username, password: 'isolated-password', displayName: username } })).status, 201);
    accounts[username] = await (await request('/auth/login', { token: '', method: 'POST', body: { username, password: 'isolated-password' } })).json();
  }
  assert.equal((await request('/voice', { token: accounts.alice.token, method: 'PATCH', body: { tts: { mode: 'cosyvoice', emotion: 'happy', emotionIntensity: 'strong' } } })).status, 200);
  assert.equal((await request('/voice', { token: accounts.bob.token, method: 'PATCH', body: { tts: { mode: 'cosyvoice', emotion: 'original' } } })).status, 200);
  const before = f.calls.length;
  for (const extra of [{ emotion: 'original' }, { emotionIntensity: 'natural' }, { userId: accounts.bob.user.id }]) {
    assert.equal((await request('/voice/synthesize/stream', { token: accounts.alice.token, method: 'POST', body: { text: '你好。', ...extra } })).status, 400);
    assert.equal((await request('/voice/synthesize', { token: accounts.alice.token, method: 'POST', body: { text: '你好。', ...extra } })).status, 400);
  }
  assert.equal(f.calls.length, before);
  const response = await request('/voice/synthesize/stream', { token: accounts.alice.token, method: 'POST', accept: 'application/x-petpal-speech-v2+ndjson', body: { text: '同一条正文。' } });
  assert.equal(response.status, 200); const frames = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(frames[0].emotion, strong); assert.equal(frames.at(-1).type, 'end');
  const alice = f.calls.filter(item => item.url.endsWith('/api/tts/stream')).at(-1).init.body;
  assert.equal(alice.get('mode'), 'instruct2'); assert.equal(alice.get('emotion'), 'happy'); assert.equal(alice.get('emotion_intensity'), 'strong'); assert.equal(alice.get('tts_text'), '同一条正文。');
  const legacyResponse = await request('/voice/synthesize/stream', { token: accounts.alice.token, method: 'POST', body: { text: '同一条正文。' } });
  assert.equal(legacyResponse.status, 200);
  const legacyFrames = (await legacyResponse.text()).trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(legacyFrames, [format, { type: 'audio', data: 'AQIDBA==' }, { type: 'end', bytes: 4 }], 'an existing client receives the exact old format even when this account uses emotional speech');
  const bobResponse = await request('/voice/synthesize/stream', { token: accounts.bob.token, method: 'POST', body: { text: '另一个账号。' } });
  assert.equal(bobResponse.status, 200); assert.equal(JSON.parse((await bobResponse.text()).split('\n')[0]).emotion, undefined);
  const bob = f.calls.filter(item => item.url.endsWith('/api/tts/stream')).at(-1).init.body; assert.equal(bob.get('mode'), 'zero_shot'); assert.equal(bob.has('emotion'), false);
  assert.equal((await request('/voice', { token: accounts.alice.token, method: 'PATCH', body: { tts: { speed: 1.3 } } })).status, 200);
  const audio = await request('/voice/synthesize', { token: accounts.alice.token, method: 'POST', body: { text: '同一条正文。' } });
  assert.equal(audio.status, 200); assert.deepEqual(Buffer.from(await audio.arrayBuffer()), wav());
  assert.equal(audio.headers.get('x-petpal-speech-emotion'), 'happy'); assert.equal(audio.headers.get('x-petpal-speech-intensity'), 'strong'); assert.equal(audio.headers.get('x-petpal-speech-source'), 'choice');
  const full = JSON.parse(f.calls.findLast(item => item.url.endsWith('/call/generate_audio')).init.body).data;
  assert.equal(full[0], '同一条正文。'); assert.equal(full[1], '自然语言控制'); assert.equal(full[6], '请非常开心地说一句话。'); assert.equal(full[9], 1.3);
});
