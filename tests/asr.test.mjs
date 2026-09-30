import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createAsrService, validateAsrAudio, ASR_AUDIO } from '../server/asr.mjs';
import { ASR_UPSTREAM_CONFIG, ASR_UPSTREAM_PROTOCOL, asrFixtureResponse } from './fixtures/asr-upstream.mjs';

export class MockSocket extends EventTarget {
  constructor({ open = true, close = true } = {}) { super(); this.readyState = 0; this.bufferedAmount = 0; this.sent = []; this.autoClose = close; if (open) queueMicrotask(() => this.open()); }
  open() { if (this.readyState !== 0) return; this.readyState = 1; this.dispatchEvent(new Event('open')); }
  send(value) { if (this.readyState !== 1) throw new Error('private upstream details'); this.sent.push(typeof value === 'string' ? value : Buffer.from(value)); }
  message(value) { this.dispatchEvent(new MessageEvent('message', { data: typeof value === 'string' ? value : JSON.stringify(value) })); }
  close() { if (this.readyState === 3) return; this.readyState = 2; if (this.autoClose) this.closed(1000); }
  terminate() { this.terminated = true; this.closed(1006); }
  closed(code) { this.readyState = 3; const event = new Event('close'); event.code = code; event.reason = 'private secret'; this.dispatchEvent(event); }
}
class ResponseStream extends EventEmitter {
  constructor({ blocked = false } = {}) { super(); this.output = ''; this.blocked = blocked; this.destroyed = false; this.writableEnded = false; }
  status() { return this; } set() { return this; } flushHeaders() {}
  write(value) { this.output += value; return !this.blocked; }
  end() { this.writableEnded = true; this.emit('close'); }
  destroy() { this.destroyed = true; this.emit('close'); }
  frames() { return [...this.output.matchAll(/^data: (.*)$/gm)].map(match => JSON.parse(match[1])); }
}
const auth = { userId: 'first', sessionHash: 'login-a', bootstrap: false };
const pcm = samples => { const bytes = Buffer.alloc(samples * 4); for (let index = 0; index < samples; index++) bytes.writeFloatLE(Math.sin(index / 10) / 4, index * 4); return bytes; };
async function fixture(t, options = {}) {
  const sockets = [], identities = new Map([['login-a', { userId: 'first' }], ['login-b', { userId: 'first' }], ['login-other', { userId: 'other' }]]);
  const store = { state: {}, async save() {} };
  const service = createAsrService({ store, authorizeSession(identity) { const user = identities.get(identity.sessionHash); if (!user || user.userId !== identity.userId || user.expiresAt <= Date.now()) throw new Error('private auth'); return user; }, webSocketFactory(url) { assert.equal(url, 'ws://127.0.0.1:40000/ws/asr'); const ws = new MockSocket(options.socket); sockets.push(ws); return ws; }, ...options });
  t.after(() => service.close());
  await service.configure({ baseUrl: 'http://127.0.0.1:40000' });
  const start = async (streamOptions = {}) => { const created = service.create(auth), res = new ResponseStream(streamOptions); service.attach(created.id, auth, res); await delay(0); return { ...created, res, ws: sockets.at(-1) }; };
  const audio = (session, bytes = pcm(6000), sequence = '0') => service.claimAudio(session.id, auth, sequence).commit(bytes);
  return { service, store, sockets, identities, start, audio };
}

test('shared ASR config defaults empty, redacts member URL, rejects unsupported credentials and rolls back failed persistence', async t => {
  const store = { state: {}, async save() {} }, service = createAsrService({ store, authorizeSession() {} }); t.after(() => service.close());
  assert.equal(service.publicConfig(true).configured, false);
  const original = service.publicConfig(true);
  await assert.rejects(service.configure({ apiKey: 'not-supported' }), { status: 400 });
  await assert.rejects(service.configure({ revision: 'outdated', baseUrl: 'http://127.0.0.1' }), { status: 409 });
  for (const baseUrl of ['http://public.example', 'https://key:secret@example.test', 'https://example.test?q=key']) await assert.rejects(service.configure({ baseUrl }), { status: 400 });
  await service.configure({ revision: original.revision, baseUrl: 'http://192.168.1.10:40000/' });
  assert.equal(service.publicConfig(false).baseUrl, ''); assert.equal(service.publicConfig(false).hasApiKey, false);
  assert.equal(service.publicConfig(true).baseUrl, 'http://192.168.1.10:40000');
  const previous = structuredClone(store.state.asrConfig); store.save = async () => { throw new Error('secret database path'); };
  await assert.rejects(service.configure({ baseUrl: 'http://127.0.0.1:1' }), error => error.status === 500 && !error.message.includes('secret'));
  assert.deepEqual(store.state.asrConfig, previous);
});

test('ASR options precede PCM; partials are cumulative, only explicit done succeeds and end is sent once', async t => {
  const f = await fixture(t), s = await f.start();
  assert.equal(s.sampleRate, 24000); assert.equal(s.ws.sent[0], '{}');
  assert.equal(s.res.frames()[0].type, 'ready');
  assert.deepEqual(f.audio(s), { ok: true, nextSequence: 1, receivedSamples: 6000 });
  s.ws.message({ text: '你好', chunks: 1, done: false });
  s.ws.message({ text: '你好，小伴', chunks: 2 });
  assert.deepEqual(s.res.frames().filter(x => x.type === 'transcript').map(x => x.text), ['你好', '你好，小伴']);
  assert.equal(s.res.writableEnded, false);
  f.service.end(s.id, auth); f.service.end(s.id, auth);
  assert.equal(s.ws.sent.filter(x => x === 'end').length, 1);
  s.ws.message({ text: '你好，小伴。', chunks: 3, done: true });
  assert.deepEqual(s.res.frames().at(-1), { type: 'done', text: '你好，小伴。', chunks: 3, done: true });
  assert.equal(s.res.writableEnded, true); assert.equal(f.service.publicConfig().busy, false);
  const replay = new ResponseStream(); f.service.attach(s.id, auth, replay); assert.equal(replay.frames().at(-1).type, 'done');
  assert.throws(() => f.audio(s, pcm(1), '1'), { status: 409 });
});

test('partial followed by 1006 is incomplete and upstream errors never expose private details', async t => {
  const f = await fixture(t, { errorCloseTimeoutMs: 10 }), s = await f.start(); f.audio(s);
  s.ws.message({ text: '部分内容', chunks: 1 }); f.service.end(s.id, auth); s.ws.closed(1006);
  assert.equal(s.res.frames().at(-1).code, 'incomplete'); assert.ok(!s.res.frames().some(x => x.type === 'done'));
  const next = await f.start(); next.ws.message({ error: 'secret internal error http://private/path' });
  await delay(20);
  assert.equal(next.res.frames().at(-1).type, 'error'); assert.ok(!next.res.output.includes('secret')); assert.ok(!next.res.output.includes('http://private'));
});

test('an empty upstream error fails even when text and done look successful', async t => {
  const f = await fixture(t, { errorCloseTimeoutMs: 10 }), s = await f.start(); f.audio(s); f.service.end(s.id, auth);
  s.ws.message({ error: '', text: '必须忽略', chunks: 1, done: true });
  s.ws.message({ text: '也不能继续完成', chunks: 1, done: true });
  await delay(20);
  assert.equal(s.res.frames().at(-1).code, 'upstream_error');
  assert.ok(!s.res.frames().some(frame => frame.type === 'done' || frame.text?.includes('必须忽略')));
  assert.equal(f.service.publicConfig().busy, false);
});

test('an error frame then close 1013 remains busy and stops forwarding new audio', async t => {
  const f = await fixture(t), s = await f.start();
  s.ws.message({ error: 'ASR is busy; retry after the current session.' });
  assert.throws(() => f.audio(s), { code: 'upstream_error' });
  assert.throws(() => f.service.end(s.id, auth), { code: 'upstream_error' });
  assert.equal(f.service.publicConfig().busy, true);
  assert.equal(s.ws.sent.length, 1);
  s.ws.closed(1013);
  assert.equal(s.res.frames().at(-1).code, 'busy');
  assert.equal(f.service.publicConfig().busy, false);
  assert.ok(!s.res.output.includes('retry after'));
});

test('busy and duplicate SSE do not steal another active slot; upstream 1013 is reported as busy', async t => {
  const f = await fixture(t), s = await f.start();
  assert.throws(() => f.service.create({ userId: 'other', sessionHash: 'login-other', bootstrap: false }), { status: 429 });
  assert.throws(() => f.service.attach(s.id, auth, new ResponseStream()), { status: 409 });
  assert.equal(s.ws.readyState, 1); s.ws.closed(1013);
  assert.equal(s.res.frames().at(-1).code, 'busy'); assert.equal(f.service.publicConfig().busy, false);
});

test('cancellation reserves the single slot until the old upstream has actually closed', async t => {
  const f = await fixture(t, { socket: { close: false } }), s = await f.start();
  f.service.cancel(s.id, auth); assert.equal(s.ws.readyState, 2);
  assert.throws(() => f.service.create(auth), { status: 429 });
  s.ws.closed(1000); assert.equal(f.service.publicConfig().busy, false);
  assert.equal(s.res.frames().at(-1).code, 'cancelled');
});

test('user and original login boundaries apply to audio, end, events and cancellation without harming the owner', async t => {
  const f = await fixture(t), s = await f.start();
  for (const foreign of [{ ...auth, sessionHash: 'login-b' }, { userId: 'other', sessionHash: 'login-other', bootstrap: false }]) {
    for (const action of [() => f.service.claimAudio(s.id, foreign, '0'), () => f.service.end(s.id, foreign), () => f.service.attach(s.id, foreign, new ResponseStream()), () => f.service.cancel(s.id, foreign)]) assert.throws(action, { status: 404 });
  }
  assert.equal(s.ws.readyState, 1); assert.equal(f.audio(s).nextSequence, 1);
});

test('revoked and expired login sessions close upstream and cannot release further transcript bytes', async t => {
  const f = await fixture(t, { authPollMs: 5 }), s = await f.start();
  f.identities.delete('login-a'); s.ws.message({ text: '不应泄露', chunks: 1 });
  assert.ok(!s.res.output.includes('不应泄露')); assert.equal(s.ws.readyState, 3);
  assert.throws(() => f.service.cancel(s.id, auth), { status: 401 });
  f.identities.set('login-a', { userId: 'first', expiresAt: Date.now() + 25 });
  const expiring = await f.start(); await delay(40); assert.equal(expiring.ws.readyState, 3); assert.equal(expiring.res.destroyed, true);
});

test('30-day sessions are not accidentally expired by the Node timer overflow limit', async t => {
  const f = await fixture(t); f.identities.set('login-a', { userId: 'first', expiresAt: Date.now() + 30 * 86400000 });
  const s = await f.start(); await delay(5); assert.equal(s.ws.readyState, 1);
});

test('malformed PCM, nonfinite samples and duplicate/out-of-order frames fail without forwarding bad bytes', async t => {
  const f = await fixture(t);
  const nonfinite = Buffer.alloc(4); nonfinite.writeFloatLE(NaN);
  const outside = Buffer.alloc(4); outside.writeFloatLE(2);
  for (const bytes of [Buffer.alloc(0), Buffer.alloc(3), Buffer.alloc(96004), nonfinite, outside]) {
    assert.throws(() => validateAsrAudio(bytes)); const s = await f.start();
    assert.throws(() => f.audio(s, bytes), { status: 400 }); assert.equal(s.ws.sent.length, 1);
  }
  const s = await f.start(); f.audio(s); assert.throws(() => f.audio(s), { status: 409 }); assert.equal(s.ws.sent.length, 2);
  const next = await f.start(); assert.throws(() => f.audio(next, pcm(1), '1'), { status: 409 }); assert.equal(next.ws.sent.length, 1);
});

test('upload leases reject overlapping bodies and recheck account authorization before sending', async t => {
  const f = await fixture(t), s = await f.start(), lease = f.service.claimAudio(s.id, auth, '0');
  assert.throws(() => f.service.claimAudio(s.id, auth, '0'), { code: 'frame_in_flight' });
  assert.throws(() => f.service.end(s.id, auth), { status: 409 });
  f.identities.delete('login-a'); assert.throws(() => lease.commit(pcm(2)), { status: 401 }); assert.equal(s.ws.sent.length, 1);
});

test('PCM cap is 60 seconds; upstream and downstream buffering remain bounded', async t => {
  const f = await fixture(t, { rateLimit: 100 }), s = await f.start();
  for (let index = 0; index < 60; index++) f.audio(s, pcm(24000), String(index));
  assert.throws(() => f.audio(s, pcm(1), '60'), { status: 413 });
  const fast = await f.start(); fast.ws.bufferedAmount = ASR_AUDIO.maxFrameBytes * 4;
  assert.throws(() => f.audio(fast), { code: 'upstream_backpressure' });
  const slowFixture = await fixture(t, { drainTimeoutMs: 10 }), slow = await slowFixture.start({ blocked: true });
  for (let index = 0; index < 100; index++) slow.ws.message({ text: '字幕' + index, chunks: index });
  assert.equal(slow.res.frames().length, 1); await delay(25); assert.equal(slow.ws.readyState, 3); assert.equal(slow.res.destroyed, true);
});

test('SSE disconnect, startup deadlines, audio idle and end deadline all clean up', async t => {
  const f = await fixture(t), s = await f.start(); s.res.destroy(); assert.equal(s.ws.readyState, 3);
  for (const [option, expected] of [['attachTimeoutMs', 'attach_timeout'], ['connectTimeoutMs', 'connect_timeout'], ['idleTimeoutMs', 'audio_timeout'], ['timeoutMs', 'session_timeout'], ['endTimeoutMs', 'end_timeout']]) {
    const fixtureOptions = { [option]: 10, ...(option === 'connectTimeoutMs' ? { socket: { open: false } } : {}) };
    const timed = await fixture(t, fixtureOptions);
    let created;
    if (option === 'attachTimeoutMs') created = { ...timed.service.create(auth), res: new ResponseStream() };
    else created = await timed.start();
    if (option === 'endTimeoutMs') { timed.audio(created); timed.service.end(created.id, auth); }
    await delay(25);
    if (option === 'attachTimeoutMs') timed.service.attach(created.id, auth, created.res);
    assert.equal(created.res.frames().at(-1).code, expected, option);
  }
});

test('terminal cache expires and only one explicit successful final result can be observed', async t => {
  const f = await fixture(t, { terminalCacheMs: 10 }), s = await f.start(); f.audio(s); f.service.end(s.id, auth);
  s.ws.message({ text: '完成', chunks: 1, done: true }); s.ws.message({ text: '多余', chunks: 2, done: true });
  assert.equal(s.res.frames().filter(frame => frame.type === 'done').length, 1);
  await delay(20); assert.throws(() => f.service.attach(s.id, auth, new ResponseStream()), { status: 404 });
});

test('health probing does not open an ASR socket and hides upstream bodies and errors', async t => {
  const routes = [];
  const f = await fixture(t, { fetchImpl: async url => { routes.push(new URL(url).pathname); return asrFixtureResponse(url); } });
  const result = await f.service.test(auth); assert.equal(result.ok, true); assert.deepEqual(routes, ['/healthz', '/config', '/api/protocol']); assert.equal(f.sockets.length, 0); assert.ok(!JSON.stringify(result).includes('secret'));
  assert.equal(result.configVerified, true); assert.equal(result.protocolVerified, true); assert.equal(result.protocolVersion, 1);
  const bad = await fixture(t, { fetchImpl: async () => { throw new Error('sensitive url and secret'); } });
  await assert.rejects(bad.service.test(auth), error => error.status === 502 && !error.message.includes('secret'));
});

test('only optional discovery 404 is legacy; HTTP errors and malformed bodies fail closed', async t => {
  const legacy = await fixture(t, { fetchImpl: async url => asrFixtureResponse(url, { legacy: true }) });
  const result = await legacy.service.test(auth);
  assert.equal(result.ok, true); assert.equal(result.configVerified, false); assert.equal(result.protocolVerified, false);
  assert.equal(result.audio.maxSeconds, 60); assert.equal(legacy.sockets.length, 0);
  for (const status of [401, 429, 500]) {
    const failed = await fixture(t, { fetchImpl: async url => new URL(url).pathname === '/healthz' ? asrFixtureResponse(url) : new Response('private upstream body', { status }) });
    await assert.rejects(failed.service.test(auth), error => error.status === 502 && !error.message.includes('private'));
  }
  const malformed = await fixture(t, { fetchImpl: async url => new URL(url).pathname === '/healthz' ? asrFixtureResponse(url) : new Response('not JSON secret') });
  await assert.rejects(malformed.service.test(auth), { code: 'upstream_error' });
});

test('discovery rejects PCM and end-protocol drift without changing state or opening recognition', async t => {
  for (const change of [{ sample_rate: 16000 }, { audio_format: 'pcm_s16le' }, { channels: 2 }, { max_session_seconds: 20 }]) {
    const f = await fixture(t, { fetchImpl: async url => new URL(url).pathname === '/config' ? Response.json({ ...ASR_UPSTREAM_CONFIG, ...change }) : asrFixtureResponse(url) });
    const previous = structuredClone(f.store.state);
    await assert.rejects(f.service.test(auth), { code: 'incompatible_audio' });
    assert.deepEqual(f.store.state, previous); assert.equal(f.sockets.length, 0);
  }
  for (const mutate of [value => { value.version = 2; }, value => { value.audio.bytes_per_sample = 2; }, value => { value.client_messages[2].literal = 'flush'; }, value => { value.server_messages.final_example.done = false; }]) {
    const changed = structuredClone(ASR_UPSTREAM_PROTOCOL); mutate(changed);
    const f = await fixture(t, { fetchImpl: async url => new URL(url).pathname === '/api/protocol' ? Response.json(changed) : asrFixtureResponse(url) });
    await assert.rejects(f.service.test(auth), { code: 'incompatible_protocol' }); assert.equal(f.sockets.length, 0);
  }
});

test('discovery health reports an occupied upstream without reserving its session', async t => {
  const f = await fixture(t, { fetchImpl: async url => asrFixtureResponse(url, { active: true }) });
  const result = await f.service.test(auth); assert.equal(result.busy, true); assert.equal(f.service.publicConfig().busy, false); assert.equal(f.sockets.length, 0);
});

test('discovery bodies are bounded and redirects cannot masquerade as legacy 404', async t => {
  const large = await fixture(t, { fetchImpl: async url => new URL(url).pathname === '/config' ? Response.json({ ...ASR_UPSTREAM_CONFIG, private: 'x'.repeat(17000) }) : asrFixtureResponse(url) });
  await assert.rejects(large.service.test(auth), { code: 'upstream_error' });
  const redirected = await fixture(t, { fetchImpl: async url => {
    if (new URL(url).pathname === '/healthz') return asrFixtureResponse(url);
    const response = new Response('private redirect', { status: 404 }); Object.defineProperty(response, 'redirected', { value: true }); return response;
  } });
  await assert.rejects(redirected.service.test(auth), { code: 'upstream_error' });
});

test('revocation during discovery cancels its body and prevents later requests', async t => {
  let f, cancelled = false, calls = 0;
  f = await fixture(t, { fetchImpl: async () => {
    calls++; f.identities.delete('login-a');
    return new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  } });
  await assert.rejects(f.service.test(auth), { code: 'auth_expired' });
  assert.equal(calls, 1); assert.equal(cancelled, true); assert.equal(f.sockets.length, 0);
});

test('discovery timeout cancels a stalled body and releases the probe', async t => {
  let stalled = true, cancelled = false;
  const f = await fixture(t, { testTimeoutMs: 5, fetchImpl: async url => {
    if (!stalled) return asrFixtureResponse(url);
    return new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  } });
  await Promise.all([assert.rejects(f.service.test(auth), { code: 'upstream_error' }), delay(20)]);
  assert.equal(cancelled, true); stalled = false;
  assert.equal((await f.service.test(auth)).ok, true);
});

test('cancel during connection terminates the pending handshake before any options or PCM can be sent', async t => {
  const f = await fixture(t, { socket: { open: false, close: false } }), s = await f.start();
  assert.equal(s.ws.readyState, 0); f.service.cancel(s.id, auth);
  assert.equal(s.ws.terminated, true); assert.equal(s.ws.readyState, 3); assert.equal(f.service.publicConfig().busy, false);
  s.ws.open(); assert.equal(s.ws.sent.length, 0); assert.equal(s.res.frames().at(-1).code, 'cancelled');
});

test('stalled close handshakes terminate on deadline, including after the terminal cache is gone', async t => {
  const f = await fixture(t, { socket: { close: false }, closeTimeoutMs: 20, terminalCacheMs: 5 }), s = await f.start();
  f.service.cancel(s.id, auth); assert.equal(f.service.publicConfig().busy, true);
  await delay(35); assert.equal(s.ws.terminated, true); assert.equal(f.service.publicConfig().busy, false);
  assert.throws(() => f.service.attach(s.id, auth, new ResponseStream()), { status: 404 });
  const next = await f.start(); await f.service.close(); assert.equal(next.ws.terminated, true); assert.equal(next.ws.readyState, 3);
});

test('SSE drain coalesces stale partials and still delivers the final result exactly once', async t => {
  const f = await fixture(t), s = await f.start({ blocked: true }); f.audio(s);
  s.ws.message({ text: '早期字幕', chunks: 1 }); s.ws.message({ text: '最新字幕', chunks: 2 });
  s.res.blocked = false; s.res.emit('drain');
  assert.deepEqual(s.res.frames().filter(frame => frame.type === 'transcript').map(frame => frame.text), ['最新字幕']);
  s.res.blocked = true; s.ws.message({ text: '最后字幕', chunks: 3 });
  f.service.end(s.id, auth); s.ws.message({ text: '完整结果。', chunks: 4, done: true });
  assert.equal(s.res.writableEnded, false); s.res.blocked = false; s.res.emit('drain');
  assert.equal(s.res.writableEnded, true); assert.equal(s.res.frames().filter(frame => frame.type === 'done').length, 1);
  assert.equal(s.res.frames().at(-1).text, '完整结果。');
});

test('a synchronously broken SSE writer closes its upstream without throwing from an event callback', async t => {
  const f = await fixture(t), s = await f.start();
  s.res.write = () => { throw new Error('broken socket'); };
  assert.doesNotThrow(() => s.ws.message({ text: '后续字幕', chunks: 1 }));
  assert.equal(s.res.destroyed, true); assert.equal(s.ws.readyState, 3); assert.equal(f.service.publicConfig().busy, false);
});

test('malformed or prematurely final upstream responses never turn into successful transcripts', async t => {
  const f = await fixture(t);
  for (const value of ['not json', { text: 'too soon', chunks: 1, done: true }, { text: 'bad chunks', chunks: 0.5 }, { text: 'bad control\u0000', chunks: 1 }, { text: 'bad done', chunks: 1, done: 'true' }, { text: 'x'.repeat(16001), chunks: 1 }]) {
    const s = await f.start(); s.ws.message(value);
    assert.equal(s.res.frames().at(-1).code, 'invalid_response'); assert.ok(!s.res.frames().some(frame => frame.type === 'done'));
  }
});

test('configuration mutation cancels the old recognition and rejects new sessions until persistence settles', async t => {
  const f = await fixture(t), s = await f.start(); let saved;
  f.store.save = () => new Promise(resolve => { saved = resolve; });
  const mutation = f.service.configure({ baseUrl: 'http://127.0.0.1:40001' });
  assert.equal(s.ws.readyState, 3); assert.throws(() => f.service.create(auth), { code: 'config_changing' });
  saved(); await mutation;
  assert.throws(() => f.service.attach(s.id, auth, new ResponseStream()), { status: 404 });
});
