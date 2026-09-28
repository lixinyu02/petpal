import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createDesktopRemoteHttp, validateRemoteRequest, isPetPalReleaseUrl, REMOTE_LIMITS } = require('../desktop/remote-http.cjs');
const input = extra => ({ id: 'request-1', url: 'https://remote.example/api/state', method: 'GET', headers: { Authorization: 'Bearer remote-session' }, ...extra });
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { resolve, promise }; };
function fixture(t, options = {}) {
  const owner = new EventEmitter(), events = [];
  let destroyed = false, authorized = true;
  owner.isDestroyed = () => destroyed;
  const event = { sender: owner, senderFrame: { send: (channel, id, payload) => { assert.equal(channel, 'petpal:remote:event'); events.push({ id, ...payload }); options.onEvent?.(payload); } } };
  const manager = createDesktopRemoteHttp({ isAllowed: candidate => authorized && candidate === event, ...options });
  t.after(() => manager.close());
  return { manager, event, owner, events, revoke: () => { authorized = false; }, destroy: () => { destroyed = true; owner.emit('destroyed'); } };
}
async function serve(t, handler) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}

test('request validation restricts transport, API path, caller headers, methods, encodings and sizes', () => {
  for (const url of ['file:///api/state', 'ftp://host/api/state', 'https://user:password@host/api/state', 'https://host/api/state#token', 'https://host/api/state#', 'https://host/private', 'https://host/api/../private', 'https://host/api/%2e%2e/private', 'https://host/api/%2Fprivate', 'https://host\\api/state']) assert.throws(() => validateRemoteRequest(input({ url })), url);
  for (const headers of [{ Cookie: 'session=local' }, { Origin: 'http://localhost' }, { Host: 'other' }, { Authorization: 'Bearer secret\r\nHost: other' }, { Authorization: 'a', authorization: 'b' }]) assert.throws(() => validateRemoteRequest(input({ headers })));
  for (const method of ['CONNECT', 'TRACE', 'OPTIONS', 'GET ']) assert.throws(() => validateRemoteRequest(input({ method })));
  for (const id of ['', 'a/b', 'x'.repeat(129)]) assert.throws(() => validateRemoteRequest(input({ id })));
  assert.throws(() => validateRemoteRequest(input({ body: 'unexpected' })));
  assert.throws(() => validateRemoteRequest(input({ method: 'POST', body: 'a', bodyEncoding: 'utf16' })));
  assert.throws(() => validateRemoteRequest(input({ method: 'POST', body: '猫'.repeat(4) }), { ...REMOTE_LIMITS, requestBytes: 10 }));
  for (const body of ['a', 'YQ=', 'Y!==', 'YR==', 'YQ==\n']) assert.throws(() => validateRemoteRequest(input({ method: 'POST', body, bodyEncoding: 'base64' })));
  assert.deepEqual(validateRemoteRequest(input({ method: 'POST', body: 'AP8K', bodyEncoding: 'base64' })).body, Buffer.from([0, 255, 10]));
  assert.equal(validateRemoteRequest(input({ method: 'post', body: '你好' })).body, '你好');
  for (const flowControl of [true, false, null, 'ack-v2', {}, 1]) assert.throws(() => validateRemoteRequest(input({ flowControl })), /流控制/);
  assert.equal(validateRemoteRequest(input({ flowControl: 'ack-v1' })).flowControl, 'ack-v1');
  assert.equal(validateRemoteRequest(input()).flowControl, undefined);
});

test('untrusted/pet frames cannot initiate or cancel requests and validation precedes fetch', async t => {
  let calls = 0;
  const f = fixture(t, { fetchImpl: async () => { calls++; return new Response('ok'); } });
  await assert.rejects(f.manager.request({ ...f.event }, input()), /可信主窗口/);
  await assert.rejects(f.manager.abort({ ...f.event }, 'request-1'), /可信主窗口/);
  await assert.rejects(f.manager.acknowledge({ ...f.event }, 'request-1', 1), /可信主窗口/);
  await assert.rejects(f.manager.request(f.event, input({ url: 'file:///api/state' })), /HTTP|地址/);
  assert.equal(calls, 0);
});

test('SSE reaches the renderer before completion with caller authorization and no local credentials', async t => {
  const firstChunk = deferred(); let stream;
  const f = fixture(t, { onEvent: event => { if (event.type === 'chunk') firstChunk.resolve(); }, fetchImpl: async (url, init) => {
    assert.equal(url, 'https://remote.example/api/state');
    assert.deepEqual({ ...init.headers }, { authorization: 'Bearer remote-session' });
    assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit'); assert.equal(init.referrerPolicy, 'no-referrer');
    return new Response(new ReadableStream({ start(controller) { stream = controller; controller.enqueue(new TextEncoder().encode('event: delta\ndata: {"text":"猫"}\n\n')); } }), { headers: { 'content-type': 'text/event-stream', 'set-cookie': 'private=forbidden', 'x-secret': 'hidden' } });
  } });
  let complete = false;
  const request = f.manager.request(f.event, input()).then(() => { complete = true; });
  await firstChunk.promise;
  assert.equal(complete, false); assert.equal(f.events[0].type, 'headers');
  assert.deepEqual({ ...f.events[0].headers }, { 'content-type': 'text/event-stream' });
  assert.match(Buffer.from(f.events[1].bytes).toString('utf8'), /猫/);
  stream.close(); await request;
  assert.equal(f.events.at(-1).type, 'end'); assert.equal(f.owner.listenerCount('destroyed'), 0);
});

test('binary upload/download preserves bytes without forwarding a Cookie or adding owner authorization', async t => {
  const bytes = Buffer.from([0, 255, 10, 128, 1]); let received;
  const origin = await serve(t, (req, res) => {
    const chunks = []; req.on('data', chunk => chunks.push(chunk)); req.on('end', () => {
      received = { bytes: Buffer.concat(chunks), authorization: req.headers.authorization, cookie: req.headers.cookie, origin: req.headers.origin };
      res.writeHead(200, { 'content-type': 'image/png' }); res.end(bytes);
    });
  });
  const f = fixture(t);
  await f.manager.request(f.event, input({ url: `${origin}/api/attachments`, method: 'POST', headers: { 'Content-Type': 'image/png' }, body: bytes.toString('base64'), bodyEncoding: 'base64' }));
  assert.deepEqual(received.bytes, bytes); assert.equal(received.authorization, undefined); assert.equal(received.cookie, undefined); assert.equal(received.origin, undefined);
  assert.deepEqual(Buffer.concat(f.events.filter(event => event.type === 'chunk').map(event => Buffer.from(event.bytes))), bytes);
  assert.equal(f.events.at(-1).type, 'end');
});

test('real HTTP redirect is rejected before a credential can reach another origin', async t => {
  let leaked = 0;
  const other = await serve(t, (_req, res) => { leaked++; res.end('wrong host'); });
  const first = await serve(t, (_req, res) => { res.writeHead(302, { location: `${other}/api/state` }); res.end(); });
  const f = fixture(t);
  await f.manager.request(f.event, input({ url: `${first}/api/state` }));
  assert.equal(leaked, 0); assert.equal(f.events.at(-1).type, 'error');
  assert.doesNotMatch(JSON.stringify(f.events), /remote-session|127\.0\.0\.1/);
});

test('cancel stops an active stream, suppresses late chunks, and permits a new request with the old id', async t => {
  const started = deferred(); let signal, cancelled = 0, calls = 0;
  const f = fixture(t, { onEvent: event => { if (event.type === 'headers') started.resolve(); }, fetchImpl: async (_url, init) => {
    signal = init.signal; calls++;
    return calls === 1 ? new Response(new ReadableStream({ cancel() { cancelled++; } })) : new Response('retry');
  } });
  const pending = f.manager.request(f.event, input()); await started.promise;
  await f.manager.abort(f.event, 'request-1'); await pending;
  assert.equal(signal.aborted, true); assert.equal(cancelled, 1); assert.equal(f.events.at(-1).type, 'error');
  assert.equal(f.events.filter(event => event.type === 'chunk').length, 0);
  await f.manager.request(f.event, input()); assert.equal(f.events.at(-1).type, 'end');
});

test('navigation and destroyed renderer cancel owned streams; another renderer cannot cancel them', async t => {
  for (const action of ['navigate', 'modern-navigation', 'destroy']) {
    const started = deferred(); let signal;
    const f = fixture(t, { onEvent: event => { if (event.type === 'headers') started.resolve(); }, fetchImpl: async (_url, init) => { signal = init.signal; return new Response(new ReadableStream()); } });
    const pending = f.manager.request(f.event, input()); await started.promise;
    await assert.rejects(f.manager.abort({ ...f.event }, 'request-1'), /可信主窗口/);
    assert.equal(signal.aborted, false);
    if (action === 'navigate') f.owner.emit('did-start-navigation', {}, 'https://elsewhere.test', false, true);
    else if (action === 'modern-navigation') f.owner.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
    else f.destroy();
    await pending; assert.equal(signal.aborted, true); assert.equal(f.owner.listenerCount('did-start-navigation'), 0);
  }
});

test('duplicate ids and concurrency overflow never initiate extra fetches', async t => {
  const first = deferred(); let calls = 0;
  const f = fixture(t, { limits: { concurrency: 1 }, fetchImpl: async () => { calls++; first.resolve(); return new Response(new ReadableStream()); } });
  const pending = f.manager.request(f.event, input()); await first.promise;
  await assert.rejects(f.manager.request(f.event, input()), /重复/);
  await assert.rejects(f.manager.request(f.event, input({ id: 'another' })), /过多/);
  assert.equal(calls, 1); await f.manager.close(); await pending;
  await assert.rejects(f.manager.request(f.event, input()), /可信主窗口/);
});

test('response limits apply to decoded chunks even without Content-Length and split bounded IPC events', async t => {
  const f = fixture(t, { limits: { responseBytes: 5, chunkBytes: 2 }, fetchImpl: async () => new Response(Buffer.from('12345')) });
  await f.manager.request(f.event, input()); assert.deepEqual(f.events.filter(event => event.type === 'chunk').map(event => event.bytes.length), [2, 2, 1]);
  const excessive = fixture(t, { limits: { responseBytes: 5 }, fetchImpl: async () => new Response(Buffer.from('123456')) });
  await excessive.manager.request(excessive.event, input()); assert.match(excessive.events.at(-1).message, /大小限制/);
  const declared = fixture(t, { limits: { responseBytes: 5 }, fetchImpl: async () => new Response(null, { headers: { 'content-length': '6' } }) });
  await declared.manager.request(declared.event, input()); assert.equal(declared.events.some(event => event.type === 'headers'), false);
});

test('ACK flow control permits only one bounded chunk until the renderer consumes it', async t => {
  const first = deferred(); let upstreamReads = 0;
  const body = new ReadableStream({ pull(controller) { upstreamReads++; controller.enqueue(Buffer.from(upstreamReads === 1 ? '12345' : '67')); if (upstreamReads === 2) controller.close(); } }, { highWaterMark: 0 });
  const f = fixture(t, { limits: { chunkBytes: 2 }, fetchImpl: async () => new Response(body), onEvent: event => { if (event.type === 'chunk') first.resolve(); } });
  const pending = f.manager.request(f.event, input({ flowControl: 'ack-v1' }));
  await first.promise; await new Promise(setImmediate);
  const chunks = () => f.events.filter(event => event.type === 'chunk');
  assert.equal(chunks().length, 1); assert.equal(chunks()[0].sequence, 1); assert.equal(upstreamReads, 1);
  for (const sequence of [0, -1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1]) await assert.rejects(f.manager.acknowledge(f.event, 'request-1', sequence), /格式/);
  await assert.rejects(f.manager.acknowledge({ ...f.event }, 'request-1', 1), /可信主窗口/);
  await assert.rejects(f.manager.acknowledge(f.event, 'request-1', 2), /顺序/);
  assert.equal(chunks().length, 1);
  await f.manager.acknowledge(f.event, 'request-1', 1); await new Promise(setImmediate);
  assert.equal(chunks().length, 2); assert.equal(upstreamReads, 1);
  await assert.rejects(f.manager.acknowledge(f.event, 'request-1', 1), /顺序/);
  await f.manager.acknowledge(f.event, 'request-1', 2); await new Promise(setImmediate);
  assert.equal(chunks().length, 3); assert.equal(upstreamReads, 1);
  await f.manager.acknowledge(f.event, 'request-1', 3); await new Promise(setImmediate);
  assert.equal(chunks().length, 4); assert.equal(upstreamReads, 2);
  assert.equal(f.events.some(event => event.type === 'end'), false);
  await f.manager.acknowledge(f.event, 'request-1', 4); await pending;
  assert.equal(f.events.at(-1).type, 'end');
  assert.deepEqual(chunks().map(event => event.bytes.length), [2, 2, 1, 2]);
  assert.equal(Buffer.concat(chunks().map(event => Buffer.from(event.bytes))).toString(), '1234567');
  await f.manager.acknowledge(f.event, 'request-1', 4); // Harmless late ACK after cleanup.
});

test('abort, owner close, navigation, renderer destruction and shutdown release an ACK waiter', async t => {
  for (const action of ['abort', 'owner-close', 'navigate', 'destroy', 'shutdown']) {
    const first = deferred(); let cancelled = 0, signal;
    const f = fixture(t, { fetchImpl: async (_url, init) => {
      signal = init.signal;
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(Buffer.from('private')); }, cancel() { cancelled++; } }));
    }, onEvent: event => { if (event.type === 'chunk') first.resolve(); } });
    const pending = f.manager.request(f.event, input({ flowControl: 'ack-v1' })); await first.promise;
    if (action === 'abort') await f.manager.abort(f.event, 'request-1');
    else if (action === 'owner-close') f.manager.cancelOwner(f.owner);
    else if (action === 'navigate') f.owner.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
    else if (action === 'destroy') f.destroy();
    else await f.manager.close();
    await pending;
    assert.equal(signal.aborted, true, action); assert.equal(cancelled, 1, action);
    assert.equal(f.events.filter(event => event.type === 'chunk').length, 1, action);
    assert.equal(f.owner.listenerCount('destroyed'), 0, action);
    assert.equal(f.owner.listenerCount('did-start-navigation'), 0, action);
  }
});

test('a missing ACK times out and flow-controlled responses retain the total byte limit', async t => {
  const keepAlive = setTimeout(() => {}, 1000); t.after(() => clearTimeout(keepAlive));
  const stalled = fixture(t, { limits: { ackTimeoutMs: 5 }, fetchImpl: async () => new Response('audio') });
  await stalled.manager.request(stalled.event, input({ flowControl: 'ack-v1' }));
  assert.match(stalled.events.at(-1).message, /读取停滞/);
  const excessive = fixture(t, { limits: { responseBytes: 5 }, fetchImpl: async () => new Response('123456') });
  await excessive.manager.request(excessive.event, input({ flowControl: 'ack-v1' }));
  assert.equal(excessive.events.some(event => event.type === 'chunk'), false);
  assert.match(excessive.events.at(-1).message, /大小限制/);
});

test('header and idle timeout close stalled requests; upstream error strings remain private', async t => {
  // Keep a test-owned timer because production bridge deadlines deliberately do not keep the app alive.
  const keepAlive = setTimeout(() => {}, 1000); t.after(() => clearTimeout(keepAlive));
  const header = fixture(t, { limits: { headerTimeoutMs: 5 }, fetchImpl: () => new Promise(() => {}) });
  await header.manager.request(header.event, input()); assert.match(header.events.at(-1).message, /连接超时/);
  const idle = fixture(t, { limits: { idleTimeoutMs: 5 }, fetchImpl: async () => new Response(new ReadableStream()) });
  await idle.manager.request(idle.event, input()); assert.match(idle.events.at(-1).message, /等待超时/);
  const failed = fixture(t, { fetchImpl: async () => { throw new Error('secret remote-session https://password@example'); } });
  await failed.manager.request(failed.event, input()); assert.doesNotMatch(JSON.stringify(failed.events), /secret|remote-session|password/);
});

test('only POST voice synthesis gets the server-compatible longer header deadline', async t => {
  for (const [method, route, succeeds] of [['POST', '/api/voice/synthesize', true], ['POST', '/api/voice/synthesize/stream', true], ['GET', '/api/voice/synthesize/stream', false], ['GET', '/api/voice/synthesize', false], ['POST', '/api/voice/synthesize/other', false], ['POST', '/api/auth/login', false]]) {
    const f = fixture(t, { limits: { headerTimeoutMs: 5, synthesisTimeoutMs: 200 }, fetchImpl: async () => { await new Promise(resolve => setTimeout(resolve, 25)); return new Response('audio'); } });
    await f.manager.request(f.event, input({ method, url: `https://remote.example${route}` }));
    assert.equal(f.events.at(-1).type, succeeds ? 'end' : 'error', `${method} ${route}`);
  }
});

test('only release links under the fixed PetPal GitHub repository may open externally', () => {
  for (const suffix of ['download/v0.6.2/PetPal-0.6.2-Android-debug.apk', 'download/v0.6.1/PetPal-0.6.1-Windows-x64.exe', 'download/v0.6.3/PetPal-0.6.3-Ubuntu-arm64.tar.gz', 'tag/v0.6.3', 'latest']) assert.equal(isPetPalReleaseUrl(`https://github.com/lixinyu02/petpal/releases/${suffix}`), true);
  for (const url of ['http://github.com/lixinyu02/petpal/releases/latest', 'https://user:pw@github.com/lixinyu02/petpal/releases/latest', 'https://github.com/other/petpal/releases/latest', 'https://github.com/lixinyu02/petpal/issues', 'https://github.com/lixinyu02/petpal/releases/download/v1/file?next=https://evil', 'https://github.com/lixinyu02/petpal/releases/download/v1/%2E%2E', 'https://github.com.evil/lixinyu02/petpal/releases/latest']) assert.equal(isPetPalReleaseUrl(url), false, url);
});

test('actual preload routes events by id without exposing Electron objects and cleans cancelled document callbacks', async () => {
  const ipc = new EventEmitter(), pending = new Map(), lifecycle = new Map(), aborts = [];
  let api;
  ipc.invoke = async (channel, arg) => {
    if (channel === 'petpal:remote:abort') { aborts.push(arg); pending.get(arg)?.resolve(); return; }
    assert.equal(channel, 'petpal:remote:request'); const wait = deferred(); pending.set(arg.id, wait); return wait.promise;
  };
  vm.runInNewContext(await readFile(new URL('../desktop/preload.cjs', import.meta.url), 'utf8'), {
    require: name => { assert.equal(name, 'electron'); return { ipcRenderer: ipc, contextBridge: { exposeInMainWorld: (_name, value) => { api = value; } } }; },
    addEventListener: (name, callback) => lifecycle.set(name, callback),
  });
  const seen = [];
  const active = api.remoteRequest(input(), (...args) => seen.push(args));
  await assert.rejects(api.remoteRequest(input(), () => {}), /重复/);
  ipc.emit('petpal:remote:event', { sender: 'must not leak' }, 'unknown', { type: 'chunk', bytes: [1] });
  ipc.emit('petpal:remote:event', { sender: 'must not leak' }, 'request-1', { type: 'headers', status: 200, headers: {} });
  assert.equal(seen.length, 1); assert.equal(seen[0].length, 1); assert.equal(seen[0][0].type, 'headers');
  lifecycle.get('pagehide')(); await active;
  ipc.emit('petpal:remote:event', {}, 'request-1', { type: 'chunk', bytes: [1] });
  assert.equal(seen.length, 1); assert.deepEqual(aborts, ['request-1']);
});

test('preload keeps the stream callback when the invoke reply arrives before the terminal event', async () => {
  const ipc = new EventEmitter(); let api;
  ipc.invoke = async () => {};
  vm.runInNewContext(await readFile(new URL('../desktop/preload.cjs', import.meta.url), 'utf8'), {
    require: () => ({ ipcRenderer: ipc, contextBridge: { exposeInMainWorld: (_name, value) => { api = value; } } }),
  });
  const events = []; let settled = false;
  const pending = api.remoteRequest(input(), event => events.push(event)).then(() => { settled = true; });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(settled, false);
  ipc.emit('petpal:remote:event', {}, 'request-1', { type: 'headers', status: 200, headers: {} });
  ipc.emit('petpal:remote:event', {}, 'request-1', { type: 'chunk', bytes: [42] });
  ipc.emit('petpal:remote:event', {}, 'request-1', { type: 'end' });
  await pending; assert.deepEqual(events.map(event => event.type), ['headers', 'chunk', 'end']);
  ipc.emit('petpal:remote:event', {}, 'request-1', { type: 'chunk', bytes: [99] });
  assert.equal(events.length, 3);
});

test('preload exposes explicit ACK capability with only the request id and sequence', async () => {
  let api; const calls = [];
  const ipc = new EventEmitter(); ipc.invoke = async (...args) => { calls.push(args); };
  vm.runInNewContext(await readFile(new URL('../desktop/preload.cjs', import.meta.url), 'utf8'), {
    require: () => ({ ipcRenderer: ipc, contextBridge: { exposeInMainWorld: (_name, value) => { api = value; } } }),
  });
  await api.remoteAck('request-1', 3);
  assert.deepEqual(calls, [['petpal:remote:ack', 'request-1', 3]]);
});
