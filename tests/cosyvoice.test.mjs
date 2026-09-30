import { listenFixture } from './helpers/loopback.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCosyVoiceService, cosyVoiceAudioUrl, validatePcmWav, REFERENCE_LIMIT, COSYVOICE_AUDIO_LIMIT } from '../server/cosyvoice.mjs';
import { createPetServer } from '../server/app.mjs';

const baseUrl = 'http://127.0.0.1:55555';
const cache = '/tmp/gradio/' + 'a'.repeat(64);
const uploadPath = `${cache}/reference.wav`, audioPath = `${cache}/audio.wav`;
const jobId = '0123456789abcdef0123456789abcdef';
const fileData = () => ({ path: audioPath, url: `${baseUrl}/gradio_api/file=${audioPath}`, is_stream: false, meta: { _type: 'gradio.FileData' } });
const json = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
const event = (name, value) => `event: ${name}\ndata: ${JSON.stringify(value)}\n\n`;
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function wav({ seconds = 1, rate = 24000, silent = false } = {}) {
  const count = Math.round(seconds * rate), bytes = Buffer.alloc(44 + count * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(count * 2, 40);
  if (!silent) for (let i = 0; i < count; i++) bytes.writeInt16LE(Math.round(Math.sin(i / 20) * 5000), 44 + i * 2);
  return bytes;
}
function transport({ override, hold = false, stream = false } = {}) {
  const calls = [], entered = deferred(); let cancelled = false, sessionHash;
  return { calls, entered, get cancelled() { return cancelled; }, fetchImpl: async (url, init) => {
    calls.push({ url, init });
    const custom = await override?.(url, init); if (custom) return custom;
    if (url.endsWith('/api/tts/capabilities')) return new Response('{}', { status: 404 });
    if (url.endsWith('/upload')) return json([uploadPath]);
    if (url.endsWith('/call/generate_audio')) { sessionHash = JSON.parse(init.body).session_hash ?? jobId; return json({ event_id: jobId }); }
    if (url.endsWith(`/${jobId}`)) {
      if (sessionHash !== jobId) return new Response(event('error', null), { headers: { 'Content-Type': 'text/event-stream' } });
      if (hold) return new Response(new ReadableStream({ start(controller) { controller.enqueue(Buffer.from(event('heartbeat', null))); entered.resolve(); }, cancel() { cancelled = true; } }), { headers: { 'Content-Type': 'text/event-stream' } });
      const streamPath = `${sessionHash}/1234567/21/playlist.m3u8`;
      const output = stream ? { path: streamPath, url: `${baseUrl}/gradio_api/stream/${streamPath}`, is_stream: true, orig_name: 'audio-stream.mp3' } : fileData();
      const text = event('generating', [output]) + event('complete', [output]);
      return new Response(new ReadableStream({ start(controller) { for (let i = 0; i < text.length; i += 7) controller.enqueue(Buffer.from(text.slice(i, i + 7))); controller.close(); } }), { headers: { 'Content-Type': 'text/event-stream' } });
    }
    if (url.includes('/file=') || url.endsWith('/playlist-file')) return new Response(wav(), { headers: { 'Content-Type': 'audio/wav' } });
    throw new Error('Unexpected fixture URL');
  } };
}
async function fixture(t, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-cosyvoice-'));
  const store = { state: {}, directory, async save() {} }, upstream = transport(options);
  const service = await createCosyVoiceService({ store, ...upstream, ...options });
  t.after(async () => { await service.close(); await rm(directory, { recursive: true, force: true }); });
  await service.configure({ baseUrl, apiKey: 'fixture-key', referenceText: '这是参考声音。' });
  await service.setReference(wav());
  return { directory, store, service, upstream, run: args => service.synthesize({ userId: 'fixture-user', text: '你好，这是小伴。', ...args }) };
}

test('CosyVoice PCM inspection rejects malformed, silent, short, long and low-rate references', () => {
  assert.equal(validatePcmWav(wav(), { reference: true }).seconds, 1);
  for (const bytes of [Buffer.alloc(44), wav({ silent: true }), wav({ seconds: 0.9 }), wav({ seconds: 30.1 }), wav({ rate: 8000 }), Buffer.concat([wav(), Buffer.from([0])])]) assert.throws(() => validatePcmWav(bytes, { reference: true }));
  const broken = wav(); broken.writeUInt32LE(1, 28); assert.throws(() => validatePcmWav(broken, { reference: true }));
  const invalidEncoding = wav(); invalidEncoding.writeUInt16LE(3, 20); assert.throws(() => validatePcmWav(invalidEncoding, { reference: true }));
  assert.throws(() => validatePcmWav(Buffer.alloc(REFERENCE_LIMIT + 1), { reference: true }));
});

test('shared configuration and references are private, revision guarded, atomic and restartable', async t => {
  const f = await fixture(t), before = f.service.publicConfig(true), publicView = f.service.publicConfig(false);
  assert.equal(publicView.baseUrl, ''); assert.equal(publicView.referenceText, ''); assert.equal(publicView.editable, false); assert.equal(publicView.hasReference, true);
  assert.equal(publicView.hasApiKey, true); assert.equal(publicView.configured, true); assert.equal('apiKey' in before, false);
  assert.deepEqual(await f.service.configure({ revision: before.revision, apiKey: '' }), before);
  await assert.rejects(f.service.configure({ revision: 'stale', referenceText: 'changed' }), { status: 409 });
  await assert.rejects(f.service.configure({ baseUrl: 'https://different.test' }), { status: 400 });
  await assert.rejects(f.service.configure({ reference: { name: '../../token' } }), { status: 400 });
  const filesBefore = await readdir(path.join(f.directory, 'cosyvoice'));
  assert.equal(filesBefore.length, 1); assert.match(filesBefore[0], /^reference-[a-f0-9-]+\.wav$/);
  assert.deepEqual(await readFile(path.join(f.directory, 'cosyvoice', filesBefore[0])), wav());
  await assert.rejects(f.service.setReference(wav({ silent: true })), { status: 400 });
  assert.deepEqual(await readdir(path.join(f.directory, 'cosyvoice')), filesBefore);
  f.store.save = async () => { throw new Error('fixture secret path'); };
  await assert.rejects(f.service.setReference(wav({ seconds: 2 })), error => error.status === 500 && !error.message.includes('fixture'));
  assert.deepEqual(await readdir(path.join(f.directory, 'cosyvoice')), filesBefore); assert.deepEqual(f.service.publicConfig(true), before);
  f.store.save = async () => {};
  const next = await f.service.setReference(wav({ seconds: 2 })); assert.notEqual(next.revision, before.revision);
  assert.equal((await readdir(path.join(f.directory, 'cosyvoice'))).length, 1);
  const restored = await createCosyVoiceService({ store: f.store }); assert.deepEqual(restored.publicConfig(true), next); await restored.close();
});

test('Gradio call uploads private PCM and pins ten zero-shot inputs, then returns verified WAV bytes', async t => {
  const f = await fixture(t); assert.deepEqual(await f.run({ speed: 1.3 }), wav());
  assert.equal(f.upstream.calls.length, 5);
  for (const { init } of f.upstream.calls) { assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit'); assert.equal(init.headers.get('authorization'), 'Bearer fixture-key'); }
  assert.equal(f.upstream.calls[0].url, `${baseUrl}/api/tts/capabilities`);
  const upload = f.upstream.calls[1].init.body.get('files'); assert.equal(upload.name, 'reference.wav'); assert.deepEqual(Buffer.from(await upload.arrayBuffer()), wav());
  const request = JSON.parse(f.upstream.calls[2].init.body);
  assert.deepEqual(request.data, ['你好，这是小伴。', '3s极速复刻', '', '这是参考声音。', { path: uploadPath, meta: { _type: 'gradio.FileData' } }, null, '', 0, false, 1.3]);
  assert.equal(Object.hasOwn(request, 'session_hash'), false);
  assert.equal(f.upstream.calls[4].url, `${baseUrl}/gradio_api/file=${audioPath}`);
});

test('malformed input, missing config and modified reference make zero upstream requests', async t => {
  const f = await fixture(t);
  for (const args of [{ text: '' }, { text: 'x'.repeat(1001) }, { text: '\0' }, { speed: 0.4 }, { speed: 2.1 }, { speed: NaN }]) await assert.rejects(f.run(args), { status: 400 });
  const file = path.join(f.directory, 'cosyvoice', f.store.state.cosyvoiceConfig.reference.name); await writeFile(file, wav({ silent: true }));
  await assert.rejects(f.run(), { status: 409 }); assert.equal(f.upstream.calls.length, 0);
  await f.service.configure({ referenceText: '' }); await assert.rejects(f.run(), { status: 409 }); assert.equal(f.upstream.calls.length, 0);
});

test('only same-origin Gradio cache WAV outputs may be downloaded', () => {
  assert.equal(cosyVoiceAudioUrl(fileData(), baseUrl), `${baseUrl}/gradio_api/file=${audioPath}`);
  for (const item of [{ ...fileData(), url: 'https://evil.test/audio.wav' }, { ...fileData(), path: '/etc/passwd' }, { ...fileData(), url: `${baseUrl}/api/private` }, { ...fileData(), url: fileData().url + '?token=hidden' }, { ...fileData(), is_stream: true }, { ...fileData(), path: `${cache}/../audio.wav` }]) assert.throws(() => cosyVoiceAudioUrl(item, baseUrl), { status: 502 });
});

test('Gradio completed stream is bound to the returned event ID and validated by real bytes', async t => {
  const f = await fixture(t, { stream: true }); assert.deepEqual(await f.run(), wav());
  assert.equal(f.upstream.calls[4].url, `${baseUrl}/gradio_api/stream/${jobId}/1234567/21/playlist-file`);
  assert.equal(f.upstream.calls.some(call => call.url.endsWith('.m3u8')), false);
  for (const mime of ['audio/mpeg', 'audio/wav']) {
    const bad = await fixture(t, { stream: true, override: url => url.endsWith('/playlist-file') && new Response(Buffer.from('ID3-not-a-wave'), { headers: { 'Content-Type': mime } }) });
    await assert.rejects(bad.run(), { status: 502 });
  }
});

test('stream paths reject another session, traversal, credentials, encoded paths and nonnumeric IDs', () => {
  const session = '1'.repeat(32), path = `${session}/123/21/playlist.m3u8`;
  const item = { path, url: `${baseUrl}/gradio_api/stream/${path}`, is_stream: true, orig_name: 'audio-stream.mp3' };
  assert.equal(cosyVoiceAudioUrl(item, baseUrl, session), `${baseUrl}/gradio_api/stream/${session}/123/21/playlist-file`);
  for (const changed of [
    { ...item, path: path.replace('123', 'other') }, { ...item, path: '../' + path },
    { ...item, url: item.url + '?x=1' }, { ...item, url: item.url + '#part' },
    { ...item, url: item.url.replace('http://', 'http://name:secret@') },
    { ...item, url: item.url.replace('/123/', '/%31%32%33/') },
    { ...item, url: item.url.replace('/123/', '/foo/../123/') },
    { ...item, url: item.url.replace(baseUrl, 'https://evil.test') },
    { ...item, url: undefined },
  ]) assert.throws(() => cosyVoiceAudioUrl(changed, baseUrl, session), { status: 502 });
  assert.throws(() => cosyVoiceAudioUrl(item, baseUrl, '2'.repeat(32)), { status: 502 });
  const old = '11111111-1111-1111-1111-111111111111';
  assert.throws(() => cosyVoiceAudioUrl({ ...item, path: `${old}/123/21/playlist.m3u8` }, baseUrl, old), { status: 502 });
});

test('Gradio 5.4 root URL alias never changes the canonical download destination', async t => {
  for (const stream of [false, true]) {
    const canonical = stream ? `${baseUrl}/gradio_api/stream/${jobId}/123/21/playlist.m3u8` : fileData().url;
    const item = stream ? { path: `${jobId}/123/21/playlist.m3u8`, url: canonical, is_stream: true } : fileData();
    const alias = canonical.replace(`${baseUrl}/`, `${baseUrl}/gradio_a/`);
    for (const url of [alias, new URL(alias).pathname]) {
      const f = await fixture(t, { override: route => route.endsWith(`/${jobId}`) && new Response(event('complete', [{ ...item, url }]), { headers: { 'Content-Type': 'text/event-stream' } }) });
      assert.deepEqual(await f.run(), wav());
      assert.equal(f.upstream.calls[4].url, canonical.replace('playlist.m3u8', 'playlist-file'));
    }
    for (const url of [alias + '?x=1', alias + '#x', alias.replace('/gradio_a/', '/different/'), alias.replace(baseUrl, 'https://evil.test'), alias.replace('http://', 'http://user:pass@'), alias.replace('/gradio_a/', '/foo/../gradio_a/'), alias.replace('/gradio_a/', '/%67radio_a/'), alias.replace('audio.wav', 'other.wav').replace('/123/', '/124/')]) {
      assert.throws(() => cosyVoiceAudioUrl({ ...item, url }, baseUrl, jobId), { status: 502 });
    }
  }
});

test('invalid event IDs and an audio stream from another request are rejected before download', async t => {
  for (const value of ['fixture-event', '../other', 'a'.repeat(33), 'A'.repeat(32), null]) {
    const f = await fixture(t, { override: url => url.endsWith('/call/generate_audio') && json({ event_id: value }) });
    await assert.rejects(f.run(), { status: 502 }); assert.equal(f.upstream.calls.length, 3);
  }
  const otherPath = `${'f'.repeat(32)}/123/21/playlist.m3u8`;
  const f = await fixture(t, { override: url => url.endsWith(`/${jobId}`) && new Response(event('complete', [{ path: otherPath, url: `${baseUrl}/gradio_api/stream/${otherPath}`, is_stream: true }]), { headers: { 'Content-Type': 'text/event-stream' } }) });
  await assert.rejects(f.run(), { status: 502 }); assert.equal(f.upstream.calls.length, 4);
});

test('Gradio null error, truncation, oversized bodies, redirects and forged output all fail closed', async t => {
  const cases = [
    (url) => url.endsWith(`/${jobId}`) && new Response(event('error', null), { headers: { 'Content-Type': 'text/event-stream' } }),
    (url) => url.endsWith(`/${jobId}`) && new Response(event('generating', [fileData()]), { headers: { 'Content-Type': 'text/event-stream' } }),
    (url) => url.endsWith(`/${jobId}`) && new Response(event('complete', [{ ...fileData(), url: 'https://evil.test/fixture-key' }]), { headers: { 'Content-Type': 'text/event-stream' } }),
    (url) => url.endsWith(`/${jobId}`) && new Response('x'.repeat(1024 * 1024 + 1), { headers: { 'Content-Type': 'text/event-stream' } }),
    (url) => url.endsWith('/upload') && new Response('fixture-key', { status: 302, headers: { Location: 'https://evil.test' } }),
    (url) => url.endsWith('/upload') && json(['/etc/secret.wav']),
    (url) => url.includes('/file=') && new Response('bad', { headers: { 'Content-Type': 'text/html' } }),
    (url) => url.includes('/file=') && new Response(wav(), { headers: { 'Content-Type': 'audio/wav', 'Content-Length': String(COSYVOICE_AUDIO_LIMIT + 1) } }),
    (url) => url.includes('/file=') && new Response(wav({ silent: true }), { headers: { 'Content-Type': 'audio/wav' } }),
  ];
  for (const override of cases) {
    const f = await fixture(t, { override });
    await assert.rejects(f.run(), error => error.status === 502 && !/fixture-key|evil\.test|\/etc\//.test(error.message));
    assert.equal(f.upstream.calls.some(item => item.url.includes('evil.test')), false);
  }
});

test('timeouts, client cancellation and config changes release concurrency without leaking upstream data', async t => {
  const timed = await fixture(t, { hold: true, timeoutMs: 25 }); await assert.rejects(timed.run(), { status: 504 }); assert.equal(timed.upstream.cancelled, true);
  const f = await fixture(t, { hold: true }), controller = new AbortController();
  const first = f.run({ signal: controller.signal }); await f.upstream.entered.promise;
  await assert.rejects(f.run(), { status: 429 }); await assert.rejects(f.run({ userId: 'another-user' }), { status: 429 });
  controller.abort(new Error('private-token-location')); await assert.rejects(first, error => error.status === 409 && !error.message.includes('private'));
  assert.equal(f.upstream.cancelled, true);
  const next = f.run(); await new Promise(resolve => setImmediate(resolve));
  await f.service.configure({ referenceText: '新的参考文字。' }); await assert.rejects(next, { status: 409 });
});

test('bounded per-user rate limit permits another user and resets after its window', async t => {
  let now = 100000; const f = await fixture(t, { now: () => now, rateLimit: 2 });
  await f.run(); await f.run(); await assert.rejects(f.run(), { status: 429 }); await f.run({ userId: 'other-user' });
  now += 60001; await f.run();
});



async function apiFixture(t, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-cosyvoice-api-')), upstream = transport(options);
  const app = await createPetServer({ dataDir: directory, token: 'owner-fixture', codex: { async status() { return { available: false }; }, async close() {} }, cosyvoiceOptions: { fetchImpl: upstream.fetchImpl, ...options } });
  await listenFixture(app.server);
  const base = `http://127.0.0.1:${app.server.address().port}/api`;
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const request = (route, { token = 'owner-fixture', method = 'GET', body, raw, signal } = {}) => fetch(base + route, { method, signal, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(raw ? { 'Content-Type': 'audio/wav' } : body ? { 'Content-Type': 'application/json' } : {}) }, body: raw ?? (body ? JSON.stringify(body) : undefined) });
  assert.equal((await request('/voice/cosyvoice', { method: 'PATCH', body: { baseUrl, apiKey: 'fixture-key', referenceText: '这是参考声音。' } })).status, 200);
  assert.equal((await request('/voice/cosyvoice/reference', { method: 'POST', raw: wav() })).status, 200);
  assert.equal((await request('/admin/users', { method: 'POST', body: { username: 'alice', password: 'fixture-pass', displayName: 'Alice' } })).status, 201);
  const user = await (await request('/auth/login', { token: '', method: 'POST', body: { username: 'alice', password: 'fixture-pass' } })).json();
  return { directory, upstream, app, request, user };
}

test('HTTP voice routes enforce owner management, per-user mode, raw upload bounds and key privacy', async t => {
  const f = await apiFixture(t), { request, user } = f;
  for (const route of ['/voice/cosyvoice', '/voice/synthesize']) assert.equal((await request(route, { token: '', method: route.endsWith('synthesize') ? 'POST' : 'GET', body: route.endsWith('synthesize') ? { text: '你好' } : undefined })).status, 401);
  const member = await (await request('/voice/cosyvoice', { token: user.token })).json(); assert.equal(member.baseUrl, ''); assert.equal(member.referenceText, ''); assert.equal(member.editable, false); assert.equal(member.configured, true);
  assert.equal((await request('/voice/cosyvoice', { token: user.token, method: 'PATCH', body: { baseUrl: 'https://evil.test' } })).status, 403);
  assert.equal((await request('/voice/cosyvoice/reference', { token: user.token, method: 'POST', raw: wav() })).status, 403);
  assert.equal((await request('/voice/cosyvoice/reference', { method: 'POST', body: { path: '../../secret.wav' } })).status, 415);
  assert.equal((await request('/voice/cosyvoice/reference', { method: 'POST', raw: Buffer.alloc(REFERENCE_LIMIT + 1) })).status, 413);
  assert.equal((await request('/voice/synthesize', { token: user.token, method: 'POST', body: { text: '你好' } })).status, 409);
  const mode = await request('/voice', { token: user.token, method: 'PATCH', body: { tts: { mode: 'cosyvoice', speed: 1 } } }); assert.equal(mode.status, 200); assert.equal((await mode.json()).runtime.tts, 'cosyvoice');
  assert.equal((await request('/voice/synthesize', { method: 'POST', body: { text: '你好' } })).status, 409, 'owner mode was not modified');
  assert.equal((await request('/voice/synthesize', { token: user.token, method: 'POST', body: { text: '你好', baseUrl: 'https://evil.test' } })).status, 400);
  const result = await request('/voice/synthesize', { token: user.token, method: 'POST', body: { text: '你好' } }); assert.equal(result.status, 200); assert.match(result.headers.get('content-type'), /^audio\/wav/); assert.deepEqual(Buffer.from(await result.arrayBuffer()), wav());
  for (const route of ['/voice', '/voice/cosyvoice', '/state']) assert.equal((await (await request(route)).text()).includes('fixture-key'), false);
});

test('logout, disable and shutdown cancel in-flight synthesis and never deliver audio', async t => {
  for (const action of ['logout', 'disable', 'shutdown']) {
    const f = await apiFixture(t, { hold: true });
    await f.request('/voice', { token: f.user.token, method: 'PATCH', body: { tts: { mode: 'cosyvoice' } } });
    const result = f.request('/voice/synthesize', { token: f.user.token, method: 'POST', body: { text: '你好' } }); await f.upstream.entered.promise;
    if (action === 'logout') await f.request('/auth/logout', { token: f.user.token, method: 'POST' });
    if (action === 'disable') await f.request(`/admin/users/${f.user.user.id}`, { method: 'PATCH', body: { disabled: true } });
    if (action === 'shutdown') await f.app.close();
    const response = await result; assert.notEqual(response.status, 200); assert.doesNotMatch(response.headers.get('content-type'), /^audio\//); assert.equal(f.upstream.cancelled, true);
  }
});

test('HTTP client disconnect cancels the upstream reader and frees the next request slot', async t => {
  const f = await apiFixture(t, { hold: true }), controller = new AbortController();
  await f.request('/voice', { token: f.user.token, method: 'PATCH', body: { tts: { mode: 'cosyvoice' } } });
  const request = f.request('/voice/synthesize', { token: f.user.token, method: 'POST', body: { text: '你好' }, signal: controller.signal });
  const rejected = assert.rejects(request, error => error.name === 'AbortError');
  await f.upstream.entered.promise; controller.abort(); await rejected;
  for (let i = 0; i < 100 && !f.upstream.cancelled; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(f.upstream.cancelled, true);
  const calls = f.upstream.calls.length;
  await f.request('/voice', { token: f.user.token, method: 'PATCH', body: { tts: { mode: 'system' } } });
  const blocked = await f.request('/voice/synthesize', { token: f.user.token, method: 'POST', body: { text: '你好' } });
  assert.equal(blocked.status, 409); assert.equal(f.upstream.calls.length, calls);
});
