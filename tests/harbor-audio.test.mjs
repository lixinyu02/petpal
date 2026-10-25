import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket, { WebSocketServer } from 'ws';
import { listenFixture } from './helpers/loopback.mjs';
import { createHarborAudioService } from '../server/harbor-audio.mjs';
import { createAsrService } from '../server/asr.mjs';
import { openAsrTransport } from '../src/voice/asr-session.mjs';
import { createVoiceConversation } from '../src/voice/conversation.mjs';

const key = 'sk-harbor-' + 'H'.repeat(43);
const auth = { userId: 'first', sessionHash: 'first-login', bootstrap: false };
const speechProfile = () => ({ voices: ['alloy', 'coral'], response_formats: ['wav'], max_input_characters: 4096, max_instruction_characters: 4096,
  speed_min: .5, speed_max: 2, max_response_bytes: 1024 * 1024, response_validation: { mode: 'pcm16_wav_v1', sample_rate_hz: 24000, channels: 1 } });
const streamProfile = () => ({ server_contract: 'vibevoice_streaming_websocket_v1', input_format: 'pcm_f32le_mono_24000', checkpoint_sample_rate: 24000,
  checkpoint_chunk_samples: 48000, max_input_milliseconds: 30000, max_context_characters: 4096, max_tokens_per_chunk: 256, max_response_bytes: 1024 * 1024 });
const wav = ({ rate = 24000, channels = 1 } = {}) => {
  const count = rate / 10, bytes = Buffer.alloc(44 + count * channels * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(channels, 22); bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * channels * 2, 28);
  bytes.writeUInt16LE(channels * 2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40);
  for (let offset = 44; offset < bytes.length; offset += 2) bytes.writeInt16LE(1000, offset);
  return bytes;
};
const pcm = samples => Buffer.alloc(samples * 4);
const until = async predicate => { const end = Date.now() + 2500; while (!predicate()) { if (Date.now() >= end) throw new Error('fixture deadline'); await delay(5); } };
class ResponseStream extends EventEmitter {
  constructor({ blocked = false } = {}) { super(); this.output = ''; this.blocked = blocked; this.destroyed = false; this.writableEnded = false; }
  status() { return this; } set() { return this; } flushHeaders() {}
  write(value) { this.output += value; return !this.blocked; }
  end() { this.writableEnded = true; this.emit('close'); }
  destroy() { this.destroyed = true; this.emit('close'); }
  frames() { return [...this.output.matchAll(/^data: (.*)$/gm)].map(match => JSON.parse(match[1])); }
}

async function fixture(t, options = {}) {
  const httpCalls = [], sockets = [], fallbacks = [], services = [], identities = new Set(['first-login', 'other-login']);
  const server = http.createServer(async (req, res) => {
    try {
      const buffers = []; for await (const part of req) buffers.push(part);
      const call = { path: req.url, headers: req.headers, body: Buffer.concat(buffers) }; httpCalls.push(call);
      if (options.httpHandler) return await options.httpHandler(req, res, call);
      res.writeHead(200, { 'Content-Type': 'audio/wav' }); res.end(wav());
    } catch { if (!res.headersSent) res.writeHead(500); res.end(); }
  });
  const wss = new WebSocketServer({ server });
  wss.on('connection', (ws, req) => {
    const peer = { ws, path: req.url, headers: req.headers, config: undefined, binary: [], messages: [], ended: false }; sockets.push(peer);
    ws.on('message', (bytes, binary) => {
      if (binary) { peer.binary.push(Buffer.from(bytes)); return; }
      const text = bytes.toString(); peer.messages.push(text);
      if (peer.config === undefined) { try { peer.config = JSON.parse(text); } catch { ws.close(); } return; }
      if (text === 'end') {
        peer.ended = true;
        if (!peer.binary.length) ws.send(JSON.stringify({ done: true, total_chunks: 0, text: '', segments: [], srt: '' }));
      }
    });
    options.onSocket?.(peer);
  });
  await listenFixture(server);
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  const descriptors = new Map();
  const descriptor = (protocol, profile) => ({ model: protocol === 'speech' ? 'voice-model' : 'recognition-model', baseUrl, apiKey: key,
    receiverInstanceId: 'petpal-fixture', linkRevision: 'revision-1', source: 'api-harbor', capabilities: { stream: protocol === 'asr_stream', tools: false, nativeProfile: profile } });
  descriptors.set('speech', descriptor('speech', speechProfile())); descriptors.set('asr_stream', descriptor('asr_stream', streamProfile()));
  const serviceModels = { forProtocol(protocol, { model } = {}) { const value = descriptors.get(protocol); return value && (!model || value.model === model) ? value : undefined; } };
  const cosyvoice = {
    publicConfig: () => ({ configured: Boolean(options.legacyConfigured), baseUrl: '', apiKey: undefined }),
    async synthesize(args) { fallbacks.push({ kind: 'buffered', args }); return wav(); },
    async synthesizeStream(args) { fallbacks.push({ kind: 'stream', args }); await args.onFrame?.({ type: 'end' }, args.signal); return { bytes: 0 }; },
  };
  const audio = createHarborAudioService({ serviceModels, cosyvoice, authPollMs: 5, ...options.audioOptions });
  const store = { state: {}, async save() {} };
  const asr = createAsrService({ store, authorizeSession(identity) { if (!identities.has(identity.sessionHash)) throw new Error('private auth details'); return {}; },
    resolveTransport: () => audio.resolveAsrTransport(), authPollMs: 5, closeTimeoutMs: 50, terminalCacheMs: 100, ...options.asrOptions });
  services.push(asr);
  t.after(async () => { await audio.close(); await Promise.all(services.map(service => service.close())); for (const peer of sockets) peer.ws.terminate();
    await new Promise(resolve => wss.close(resolve)); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const run = (args = {}) => audio.synthesize({ userId: 'first', text: '你好，小伴。', emotion: 'auto', speed: 1, ...args });
  const start = async (streamOptions = {}) => {
    const before = sockets.length, created = asr.create(auth), res = new ResponseStream(streamOptions); asr.attach(created.id, auth, res);
    await until(() => sockets.length > before && res.frames().some(frame => frame.type === 'ready'));
    return { ...created, res, peer: sockets.at(-1) };
  };
  const send = (session, value) => session.peer.ws.send(JSON.stringify(value));
  const frame = (session, bytes = pcm(2400), sequence = '0') => asr.claimAudio(session.id, auth, sequence).commit(bytes);
  return { server, wss, baseUrl, descriptors, serviceModels, audio, asr, store, identities, httpCalls, sockets, fallbacks, services, run, start, send, frame };
}

test('buffered speech uses real HTTP Bearer only on server, checks WAV and works without CosyVoice configuration', async t => {
  const f = await fixture(t), result = await f.run();
  assert.equal(result.equals(wav()), true); assert.equal(result.audioSource, 'api-harbor'); assert.equal(result.speechEmotion, undefined);
  assert.equal(f.fallbacks.length, 0); assert.equal(f.httpCalls.length, 1);
  const call = f.httpCalls[0]; assert.equal(call.path, '/v1/audio/speech'); assert.equal(call.headers.authorization, `Bearer ${key}`);
  assert.equal(call.headers.cookie, undefined); assert.deepEqual(JSON.parse(call.body), { model: 'voice-model', input: '你好，小伴。', voice: 'alloy', response_format: 'wav', speed: 1 });
  const view = f.audio.publicConfig(false); assert.equal(view.configured, true); assert.equal(view.source, 'api-harbor'); assert.equal(view.streamingAvailable, false);
  assert.ok(!JSON.stringify(view).includes(key)); assert.ok(!JSON.stringify(view).includes('Authorization'));
});

test('model, voice, response format, geometry and expressive controls fall back before any Harbor request', async t => {
  for (const args of [{ model: 'original-model' }, { voice: 'not-granted' }, { emotion: 'happy' }, { emotionIntensity: 'strong' }]) {
    const f = await fixture(t); const result = await f.run(args); assert.equal(result.audioSource, 'cosyvoice'); assert.equal(f.httpCalls.length, 0); assert.equal(f.fallbacks.length, 1);
  }
  for (const mutate of [profile => profile.response_formats = ['mp3'], profile => profile.speed_max = 1, profile => profile.max_input_characters = 1,
    profile => profile.response_validation.sample_rate_hz = 8000]) {
    const f = await fixture(t); mutate(f.descriptors.get('speech').capabilities.nativeProfile);
    const result = await f.run({ speed: 1.5 }); assert.equal(result.audioSource, 'cosyvoice'); assert.equal(f.httpCalls.length, 0);
  }
  const f = await fixture(t); f.descriptors.delete('speech'); assert.equal((await f.run()).audioSource, 'cosyvoice'); assert.equal(f.httpCalls.length, 0);
});

test('sent speech errors, invalid PCM and oversized/truncated responses never replay to CosyVoice', async t => {
  const cases = [
    (req, res) => { res.writeHead(503); res.end('private upstream error'); },
    (req, res) => { res.writeHead(200, { 'Content-Type': 'audio/wav' }); res.end('RIFF-not-real-PCM'); },
    (req, res) => { res.writeHead(200, { 'Content-Type': 'audio/wav' }); res.end(wav({ rate: 48000 })); },
    (req, res) => { res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': 2000000 }); res.end(); },
    (req, res) => { res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': wav().length + 4 }); res.write(wav()); res.destroy(); },
  ];
  for (const httpHandler of cases) {
    const f = await fixture(t, { httpHandler }); await assert.rejects(f.run(), error => error.status === 502 && !error.message.includes('private'));
    assert.equal(f.httpCalls.length, 1); assert.equal(f.fallbacks.length, 0);
  }
});

test('speech validation and shared rate/concurrency gate run before dispatch; stream stays CosyVoice', async t => {
  const f = await fixture(t, { audioOptions: { rateLimit: 1 } });
  for (const args of [{ text: '' }, { text: '\0' }, { text: 'a'.repeat(1001) }, { speed: NaN }, { emotion: 'fake' }]) await assert.rejects(f.run(args), { status: 400 });
  assert.equal(f.httpCalls.length, 0); await f.run();
  await assert.rejects(f.audio.synthesizeStream({ userId: 'first', text: '测试', onFrame() {} }), { status: 429 });
  await f.audio.synthesizeStream({ userId: 'other', text: '测试', onFrame() {} });
  assert.equal(f.httpCalls.length, 1); assert.equal(f.fallbacks[0].kind, 'stream');
});

test('speech cancellation, logout and changed/revoked link cancel body delivery without fallback', async t => {
  for (const invalidate of ['cancel', 'logout', 'revision', 'revocation']) {
    let entered, stopped; const arrived = new Promise(resolve => { entered = resolve; }), ended = new Promise(resolve => { stopped = resolve; });
    const f = await fixture(t, { httpHandler(req, res) { res.writeHead(200, { 'Content-Type': 'audio/wav' }); res.write(wav().subarray(0, 44)); res.on('close', stopped); entered(); } });
    const abort = new AbortController(); let authorized = true;
    const pending = f.run({ signal: abort.signal, authorize() { if (!authorized) throw new Error('private login'); } }); await arrived;
    if (invalidate === 'cancel') abort.abort(); else if (invalidate === 'logout') authorized = false;
    else if (invalidate === 'revision') f.descriptors.set('speech', { ...f.descriptors.get('speech'), linkRevision: 'revision-2' }); else f.descriptors.delete('speech');
    await assert.rejects(pending, error => [409, 502].includes(error.status)); await ended; assert.equal(f.fallbacks.length, 0);
  }
});

test('Harbor and fallback speech share per-user and total concurrency until cancellation settles', async t => {
  let entered; const arrived = new Promise(resolve => { entered = resolve; });
  const f = await fixture(t, { audioOptions: { maxConcurrent: 1 }, httpHandler(req, res) { res.writeHead(200, { 'Content-Type': 'audio/wav' }); res.write(wav().subarray(0, 44)); entered(); } });
  const controller = new AbortController(), pending = f.run({ signal: controller.signal }); await arrived;
  await assert.rejects(f.run(), { status: 429 });
  await assert.rejects(f.audio.synthesizeStream({ userId: 'first', text: '测试' }), { status: 429 });
  await assert.rejects(f.run({ userId: 'another' }), { status: 429 });
  controller.abort(); await assert.rejects(pending, { status: 409 });
  f.descriptors.delete('speech'); assert.equal((await f.run()).audioSource, 'cosyvoice');
});

test('native Harbor ASR negotiates only model, splits 24kHz f32 frames and accumulates sequential deltas', async t => {
  const f = await fixture(t), s = await f.start();
  assert.equal(s.maxSeconds, 30); assert.equal(s.sampleRate, 24000); assert.equal(s.source, 'api-harbor'); assert.equal(s.peer.path, '/v1/stream');
  assert.equal(s.peer.headers.authorization, `Bearer ${key}`); assert.equal(s.peer.headers.cookie, undefined);
  f.frame(s, pcm(24000)); await until(() => s.peer.binary.length === 2);
  assert.deepEqual(s.peer.config, { model: 'recognition-model' }); assert.deepEqual(s.peer.binary.map(bytes => bytes.length), [64000, 32000]);
  f.send(s, { chunk: 0, text: '你好', segments: [{ Start: 0, End: .1, Speaker: '0', Content: '你好' }] });
  await until(() => s.res.frames().some(frame => frame.text === '你好'));
  f.send(s, { chunk: 1, text: '小伴', segments: [] }); await until(() => s.res.frames().some(frame => frame.text === '你好小伴'));
  f.asr.end(s.id, auth); await until(() => s.peer.ended);
  f.send(s, { done: true, total_chunks: 2, text: '你好小伴', segments: [], srt: '' }); await until(() => s.res.writableEnded);
  assert.deepEqual(s.res.frames().filter(frame => frame.type === 'transcript').map(frame => frame.text), ['你好', '你好小伴']);
  assert.deepEqual(s.res.frames().at(-1), { type: 'done', text: '你好小伴', chunks: 2, done: true });
  assert.ok(!s.res.output.includes(key)); assert.ok(!s.res.output.includes('Authorization'));
});

test('native ASR rejects missing, repeated and conflicting chunks/finals without switching source', async t => {
  for (const invalid of [
    [{ chunk: 1, text: 'bad', segments: [] }],
    [{ chunk: 0, text: 'first', segments: [] }, { chunk: 0, text: 'repeat', segments: [] }],
    [{ chunk: 0, text: 'first', segments: [] }, { done: true, total_chunks: 2, text: 'first', segments: [], srt: '' }],
    [{ chunk: 0, text: 'first', segments: [] }, { done: true, total_chunks: 1, text: 'different', segments: [], srt: '' }],
    [{ done: true, total_chunks: 0, text: '', segments: [], srt: '' }],
    [{ chunk: 0, text: 'first', segments: [] }, { done: true, total_chunks: 1, text: 'first', segments: [], srt: 'forged' }],
    [{ chunk: 0, text: 'first', segments: [{ Start: 0, End: .1, Speaker: '0', Content: 'first' }] }, { done: true, total_chunks: 1, text: 'first', segments: [], srt: '' }],
  ]) {
    const f = await fixture(t), s = await f.start(); f.frame(s); f.asr.end(s.id, auth);
    for (const value of invalid) f.send(s, value);
    await until(() => s.res.writableEnded); assert.equal(s.res.frames().at(-1).code, 'invalid_response'); assert.equal(f.sockets.length, 1);
    assert.ok(!s.res.frames().some(frame => frame.type === 'done'));
  }
});

test('native ASR retains finite PCM, declared limits, session ownership, cancellation and revocation fences', async t => {
  const f = await fixture(t), s = await f.start();
  assert.throws(() => f.asr.claimAudio(s.id, { ...auth, sessionHash: 'other-login' }, '0'), { status: 404 });
  const bad = pcm(1); bad.writeFloatLE(NaN); assert.throws(() => f.frame(s, bad), { status: 400 }); assert.equal(s.peer.binary.length, 0);
  await until(() => f.asr.publicConfig().busy === false);
  const active = await f.start(); f.frame(active); f.asr.cancel(active.id, auth); await until(() => active.res.writableEnded);
  assert.equal(active.res.frames().at(-1).code, 'cancelled'); await until(() => f.asr.publicConfig().busy === false);
  const revoked = await f.start(); f.frame(revoked); f.descriptors.delete('asr_stream');
  f.send(revoked, { chunk: 0, text: 'must not escape', segments: [] }); await until(() => revoked.res.destroyed);
  assert.ok(!revoked.res.output.includes('must not escape'));
});

test('native ASR session reports lower configured limits and cannot exceed them', async t => {
  const f = await fixture(t); f.descriptors.get('asr_stream').capabilities.nativeProfile.max_input_milliseconds = 1000;
  const s = await f.start(); assert.equal(s.maxSeconds, 1); f.frame(s, pcm(24000));
  assert.throws(() => f.frame(s, pcm(1), '1'), { status: 413 });
  await until(() => s.res.writableEnded); assert.equal(s.res.frames().at(-1).code, 'audio_limit');
});

test('native ASR login and catalog revision changes fence late partial results', async t => {
  for (const invalidate of ['logout', 'revision']) {
    const f = await fixture(t), s = await f.start(); f.frame(s);
    if (invalidate === 'logout') f.identities.delete(auth.sessionHash);
    else f.descriptors.set('asr_stream', { ...f.descriptors.get('asr_stream'), linkRevision: 'revision-2' });
    f.send(s, { chunk: 0, text: 'late private transcript', segments: [] }); await until(() => s.res.destroyed);
    assert.ok(!s.res.output.includes('late private transcript')); assert.equal(f.sockets.length, 1);
  }
});

test('native ASR preserves bounded upstream buffering and blocked SSE cancellation', async t => {
  let client;
  const f = await fixture(t, { asrOptions: { webSocketFactory(url, options) { client = new WebSocket(url, options); return client; } } }), s = await f.start();
  Object.defineProperty(client, 'bufferedAmount', { value: 96000 * 4 });
  assert.throws(() => f.frame(s), { code: 'upstream_backpressure' }); assert.equal(s.peer.binary.length, 0);
  const slow = await fixture(t, { asrOptions: { drainTimeoutMs: 15 } }), active = await slow.start({ blocked: true });
  slow.frame(active); slow.send(active, { chunk: 0, text: 'not yet delivered', segments: [] });
  await until(() => active.res.destroyed); assert.equal(active.res.frames().length, 1); assert.ok(!active.res.output.includes('not yet delivered'));
});

test('Harbor ASR health test is a real bounded empty WS session, with no nonexistent HTTP discovery', async t => {
  const f = await fixture(t), result = await f.asr.test(auth);
  assert.equal(result.ok, true); assert.equal(result.source, 'api-harbor'); assert.equal(result.audio.maxSeconds, 30);
  assert.equal(f.httpCalls.length, 0); assert.equal(f.sockets.length, 1); assert.deepEqual(f.sockets[0].messages, [JSON.stringify({ model: 'recognition-model' }), 'end']);
  assert.ok(!JSON.stringify(result).includes(key));
});

test('Harbor ASR probing is bounded and cancellable without HTTP discovery or source retry', async t => {
  for (const cancel of [false, true]) {
    const f = await fixture(t, { asrOptions: { testTimeoutMs: 50 }, onSocket(peer) { peer.ws.removeAllListeners('message'); } });
    const controller = new AbortController(), pending = f.asr.test(auth, controller.signal);
    await until(() => f.sockets.length === 1); if (cancel) controller.abort();
    await assert.rejects(pending); assert.equal(f.httpCalls.length, 0); assert.equal(f.sockets.length, 1);
    assert.equal(f.audio.resolveAsrTransport({ model: 'not-granted' }), undefined);
  }
});

test('missing/incompatible Harbor ASR retains the original WS transport and 60-second contract', async t => {
  const f = await fixture(t); f.descriptors.get('asr_stream').capabilities.nativeProfile.input_format = 'unsupported';
  await f.asr.configure({ baseUrl: f.baseUrl.slice(0, -3) });
  const s = await f.start(); assert.equal(s.maxSeconds, 60); assert.equal(s.source, undefined); assert.equal(s.peer.path, '/ws/asr');
  assert.equal(s.peer.headers.authorization, undefined); assert.deepEqual(s.peer.config, {});
  f.frame(s); f.send(s, { text: '原服务', chunks: 1 }); await until(() => s.res.frames().some(frame => frame.text === '原服务'));
  f.asr.end(s.id, auth); f.send(s, { text: '原服务', chunks: 1, done: true }); await until(() => s.res.writableEnded);
  assert.equal(s.res.frames().at(-1).type, 'done');
});

test('Harbor-only UI selects buffered playback and reports the actual per-request fallback source', async t => {
  const { build } = await import('esbuild'), { fileURLToPath } = await import('node:url');
  const modules = {
    react: `export const useRef=(...a)=>globalThis.__harborAudioHook.useRef(...a);export const useState=(...a)=>globalThis.__harborAudioHook.useState(...a);export const useEffect=(...a)=>globalThis.__harborAudioHook.useEffect(...a);export const useCallback=(...a)=>globalThis.__harborAudioHook.useCallback(...a);`,
    api: `export const api=(...a)=>globalThis.__harborAudioHook.api(...a);export const apiSpeechAudio=(...a)=>globalThis.__harborAudioHook.apiSpeechAudio(...a);export const apiSpeechStream=()=>{throw Error('Harbor has no realtime PCM');};export const getConnection=()=>({token:'fixture'});export const getIdentity=()=>({userId:'first'});export const getSessionEpoch=()=>globalThis.__harborAudioHook.epoch;export const isSessionChanged=()=>false;`,
    player: `export const createSpeechController=o=>globalThis.__harborAudioHook.player('system',o);export const selectSpeechVoice=()=>null;`,
    remote: `export const createRemoteSpeechController=o=>globalThis.__harborAudioHook.player('buffered',o);`,
    stream: `export const createStreamingSpeechController=o=>globalThis.__harborAudioHook.player('stream',o);`,
  };
  const compiled = await build({ entryPoints: [fileURLToPath(new URL('../src/avatar/useSpeech.ts', import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'node', plugins: [{ name: 'harbor-audio-hook', setup(plugin) {
    plugin.onResolve({ filter: /.*/ }, args => {
      if (args.path === 'react') return { path: 'react', namespace: 'harbor-audio-hook' };
      if (!args.importer.replaceAll('\\', '/').endsWith('/src/avatar/useSpeech.ts')) return;
      const key = { '../api': 'api', './speech.mjs': 'player', './remote-speech.mjs': 'remote', './stream-speech.mjs': 'stream' }[args.path];
      if (key) return { path: key, namespace: 'harbor-audio-hook' };
    }); plugin.onLoad({ filter: /.*/, namespace: 'harbor-audio-hook' }, args => ({ contents: modules[args.path], loader: 'js' }));
  } }] });
  const { useSpeech } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
  const f = await fixture(t); f.descriptors.get('speech').capabilities.nativeProfile.max_input_characters = 1;
  const slots = [], effects = [], players = []; let cursor = 0, dirty = false, voice;
  const same = (a, b) => a && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const runtime = {
    epoch: 1,
    useRef(value) { return slots[cursor++] ??= { current: value }; },
    useState(initial) { const index = cursor++; slots[index] ??= { value: initial }; return [slots[index].value, next => { slots[index].value = typeof next === 'function' ? next(slots[index].value) : next; dirty = true; }]; },
    useCallback(callback, deps) { const index = cursor++; if (!same(slots[index]?.deps, deps)) slots[index] = { callback, deps }; return slots[index].callback; },
    useEffect(callback, deps) { const index = cursor++, previous = slots[index]; if (!same(previous?.deps, deps)) { const next = { deps }; slots[index] = next; effects.push(() => { previous?.cleanup?.(); next.cleanup = callback(); }); } },
    async api(path) { assert.equal(path,'/voice');const audio=f.audio.publicConfig(false);return { tts: { mode: 'cosyvoice', speed: 1 },runtime:{ttsSource:audio.source,streamingAvailable:audio.streamingAvailable} }; },
    async apiSpeechAudio() { const audio = await f.run({ text: '超过本模型限制' }); return { blob: new Blob([audio]), emotion: null, source: audio.audioSource }; },
    player(kind, options) { const player = { kind, options, dispose() {}, stop() {} }; players.push(player); return player; },
  };
  const window = new EventTarget(), document = new EventTarget(); document.hidden = false; window.localStorage = { getItem() { return null; } };
  const globals = { __harborAudioHook: runtime, window, document, navigator: { language: 'zh-CN' }, Audio: class {}, AudioContext: class {} };
  const originals = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true });
  t.after(() => { for (const slot of slots) slot?.cleanup?.(); for (const [key, value] of originals) { if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key]; } });
  const render = () => { cursor = 0; dirty = false; voice = useSpeech(true, 'fixture:first'); while (effects.length) effects.shift()(); };
  const settle = async () => { for (let index = 0; index < 25; index++) await Promise.resolve(); let limit = 20; while (dirty && limit-- > 0) render(); assert.ok(limit > 0); };
  render(); await settle(); assert.equal(players.at(-1).kind, 'buffered'); assert.equal(voice.streamingEnabled, false); assert.match(voice.feedback, /API Harbor/);
  await players.at(-1).options.requestAudio('超过本模型限制', new AbortController().signal); await settle();
  assert.equal(f.httpCalls.length, 0); assert.equal(f.fallbacks.length, 1); assert.match(voice.feedback, /CosyVoice|完整合成/); assert.doesNotMatch(voice.feedback, /API Harbor/);
  let release; runtime.apiSpeechAudio = () => new Promise(resolve => { release = resolve; });
  const old = players.at(-1).options.requestAudio('旧账号', new AbortController().signal); runtime.epoch++;
  release({ blob: new Blob(['old']), emotion: null, source: 'api-harbor' }); await old; await settle(); assert.doesNotMatch(voice.feedback, /API Harbor/);
});

test('client ASR session adopts the smaller legal create/ready limit and preserves old missing metadata', async () => {
  for (const [created, ready, expected] of [[30, 20, 20], [30, 60, 30], [60, undefined, 60], [undefined, 30, 30], ['30', Infinity, undefined], [0, -1, undefined], [61, .000001, undefined]]) {
    const controller = new AbortController();
    const response = new Response(new ReadableStream({ start(stream) { stream.enqueue(new TextEncoder().encode(`event: ready\ndata: ${JSON.stringify({ maxSeconds: ready })}\n\n`)); } }));
    const session = await openAsrTransport({ signal: controller.signal, assertCurrent() {}, onTranscript() {}, onClose() {},
      request: async () => ({ id: 'client-fixture', sampleRate: 24000, maxSeconds: created }), openEvents: async () => response, remove: async () => {} });
    assert.equal(session.maxSeconds, expected); session.cancel();
  }
});

function captureLimitHarness(t, { sessionLimit, verifiedLimit, open } = {}) {
  const sessions = []; let capture, valid = true;
  const makeSession = maxSeconds => {
    let resolveFinal; const final = new Promise(resolve => { resolveFinal = resolve; });
    return { maxSeconds, frames: [], ends: 0, cancelled: 0, resolveFinal,
      async send(frame) { this.frames.push(frame); }, finish() { this.ends++; return final; }, cancel() { this.cancelled++; resolveFinal(''); } };
  };
  const machine = createVoiceConversation({ id: () => 'limit-fixture', onState() {}, isCurrent: () => valid, isAllowed: () => true, getProviderId: () => 'model', getDeviceId: () => '',
    createCapture(callbacks) { capture = callbacks; return { async start() {}, pause() {}, stop() {} }; }, unlock: async () => true,
    verify: async () => ({ maxSeconds: verifiedLimit }), stopSpeech() {}, openAsr: open ?? (async () => { const session = makeSession(sessionLimit); sessions.push(session); return session; }),
    createChat: async () => { throw new Error('No unsolicited chat'); }, streamChat: async () => {}, play: async () => {} });
  t.after(() => machine.dispose());
  return { machine, sessions, makeSession, expire() { valid = false; }, feed() { capture.onFrame(new Float32Array(6000).fill(.1), .1); } };
}

test('normal capture finishes exactly at the current 30-second limit; old 60-second servers retain the 45-second gate', async t => {
  for (const [sessionLimit, verifiedLimit, expected] of [[30, 60, 30], [60, 30, 45], [undefined, undefined, 45], [NaN, 30, 30]]) {
    const h = captureLimitHarness(t, { sessionLimit, verifiedLimit }); await h.machine.start(); h.feed(); h.feed(); await delay(0);
    for (let index = 0; index < 200; index++) h.feed(); await delay(0);
    assert.equal(h.sessions.length, 1); assert.equal(h.sessions[0].ends, 1); assert.equal(h.machine.snapshot().phase, 'recognizing');
    assert.equal(h.sessions[0].frames.reduce((sum, frame) => sum + frame.length, 0), 24000 * expected);
    assert.equal(h.machine.snapshot().error, ''); h.sessions[0].resolveFinal(''); await delay(0);
    assert.equal(h.machine.snapshot().phase, 'listening'); h.machine.stop();
  }
});

test('a smaller per-session limit trims already captured startup audio and ends normally', async t => {
  let release, h; const opening = new Promise(resolve => { release = resolve; });
  h = captureLimitHarness(t, { verifiedLimit: 60, open: () => opening });
  await h.machine.start(); for (let index = 0; index < 7; index++) h.feed();
  const session = h.makeSession(1); release(session); await delay(0);
  assert.equal(session.frames.reduce((sum, frame) => sum + frame.length, 0), 24000); assert.equal(session.ends, 1); assert.equal(h.machine.snapshot().error, '');
  session.resolveFinal(''); await delay(0); assert.equal(h.machine.snapshot().phase, 'listening');
});

test('a cancelled old session cannot impose its late limit or audio on a replacement capture', async t => {
  let release, calls = 0, h;
  const late = new Promise(resolve => { release = resolve; });
  h = captureLimitHarness(t, { open: async () => { if (++calls === 1) return late; const session = h.makeSession(60); h.sessions.push(session); return session; } });
  await h.machine.start(); h.feed(); h.feed(); await delay(0); h.machine.stop();
  await h.machine.start(); h.feed(); h.feed(); await delay(0);
  const old = h.makeSession(1); release(old); await delay(0);
  for (let index = 0; index < 200; index++) h.feed(); await delay(0);
  assert.equal(old.cancelled, 1); assert.equal(old.frames.length, 0); assert.equal(h.sessions[0].frames.reduce((sum, frame) => sum + frame.length, 0), 24000 * 45);
  assert.equal(h.sessions[0].ends, 1); assert.equal(h.machine.snapshot().error, '');
});
