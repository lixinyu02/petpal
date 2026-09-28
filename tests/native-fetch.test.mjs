import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
import { EventEmitter } from 'node:events';
import remoteHttp from '../desktop/remote-http.cjs';

const source = await fs.readFile(new URL('../src/auth/native-fetch.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { connectionFetch } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const encoder = new TextEncoder();

test('renderer native fetch preserves destinations, credentials, streaming and cancellation', async t => {
  const originals = new Map(['window', 'location', 'fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const install = (key, value) => Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const harness = (flowControlled = false) => {
    const completed = deferred(), aborted = [], requests = [], acknowledgements = []; let emit;
    const bridge = {
      connection() { throw new Error('Transport must not obtain native owner credentials'); },
      remoteRequest(request, callback) { requests.push(request); emit = callback; return completed.promise; },
      async remoteAbort(id) { aborted.push(id); },
      ...(flowControlled ? { async remoteAck(id, sequence) { acknowledgements.push({ id, sequence }); } } : {}),
    };
    install('window', { petpal: bridge });
    return { requests, aborted, completed, acknowledgements, bridge, event: event => emit(event) };
  };
  install('location', { origin: 'http://127.0.0.1:4318' });
  install('fetch', () => { throw new Error('Unexpected browser fetch'); });
  try {
    await t.test('same-origin and browser-only requests use browser fetch unchanged', async () => {
      const h = harness(), sent = [], options = { method: 'GET', headers: { Authorization: 'Bearer local-session' } };
      install('fetch', async (...args) => { sent.push(args); return new Response('local'); });
      assert.equal(await (await connectionFetch('/api/state', options)).text(), 'local');
      assert.deepEqual(sent[0], ['/api/state', options]); assert.equal(h.requests.length, 0);
      install('window', {});
      await connectionFetch('https://service.example/api/state', options);
      assert.equal(sent[1][0], 'https://service.example/api/state');
      install('fetch', () => { throw new Error('Unexpected browser fetch'); });
    });

    await t.test('remote SSE receives only supplied credentials and preserves split UTF-8 bytes', async () => {
      const h = harness();
      const response = connectionFetch('https://service.example/api/conversations/id/messages', {
        method: 'POST', headers: { Authorization: 'Bearer remote-member', 'Content-Type': 'application/json' }, body: '{"content":"你好"}',
      });
      assert.equal(h.requests.length, 1); const request = h.requests[0];
      assert.equal(request.url, 'https://service.example/api/conversations/id/messages');
      assert.deepEqual(request.headers, { authorization: 'Bearer remote-member', 'content-type': 'application/json' });
      assert.equal(request.body, '{"content":"你好"}'); assert.equal(request.method, 'POST');
      assert.equal(Object.hasOwn(request, 'flowControl'), false); // Legacy bridges must not receive a new request field.
      h.event({ type: 'headers', status: 200, headers: { 'content-type': 'text/event-stream' } });
      const data = encoder.encode('event: delta\ndata: {"text":"你好"}\n\n');
      const pending = (await response).text();
      h.event({ type: 'chunk', bytes: Array.from(data.subarray(0, data.length - 8)) });
      h.event({ type: 'chunk', bytes: Array.from(data.subarray(data.length - 8)) });
      h.event({ type: 'end' }); h.completed.resolve();
      assert.equal(await pending, 'event: delta\ndata: {"text":"你好"}\n\n'); assert.deepEqual(h.aborted, []);
    });

    await t.test('binary uploads retain selected bytes and non-2xx JSON remains inspectable', async () => {
      const h = harness(), buffer = Uint8Array.from([99, 0, 128, 255, 88]);
      const response = connectionFetch('https://service.example/api/uploads', { method: 'POST', body: buffer.subarray(1, 4), headers: { 'Content-Type': 'image/png' } });
      assert.equal(h.requests[0].bodyEncoding, 'base64'); assert.equal(h.requests[0].body, Buffer.from([0, 128, 255]).toString('base64'));
      h.event({ type: 'headers', status: 401, headers: { 'content-type': 'application/json' } });
      h.event({ type: 'chunk', bytes: Array.from(encoder.encode('{"error":"login required"}')) });
      h.event({ type: 'end' }); h.completed.resolve();
      const value = await response; assert.equal(value.status, 401); assert.equal(value.ok, false); assert.deepEqual(await value.json(), { error: 'login required' });
    });

    await t.test('pre-aborted requests never enter IPC', async () => {
      const h = harness(), controller = new AbortController(); controller.abort();
      await assert.rejects(connectionFetch('https://service.example/api/state', { signal: controller.signal }), error => error.name === 'AbortError');
      assert.equal(h.requests.length, 0); h.completed.resolve();
    });

    await t.test('abort before headers rejects immediately and ignores late native events', async () => {
      const h = harness(), controller = new AbortController();
      const pending = connectionFetch('https://service.example/api/state', { signal: controller.signal });
      const rejected = assert.rejects(pending, error => error.name === 'AbortError'); controller.abort(); await rejected;
      assert.deepEqual(h.aborted, [h.requests[0].id]);
      h.event({ type: 'headers', status: 200, headers: {} }); h.event({ type: 'chunk', bytes: [1] }); h.event({ type: 'end' }); h.completed.resolve();
    });

    await t.test('abort after headers errors the body and suppresses late private data', async () => {
      const h = harness(), controller = new AbortController();
      const pending = connectionFetch('https://service.example/api/voice/synthesize', { signal: controller.signal });
      h.event({ type: 'headers', status: 200, headers: { 'content-type': 'audio/wav' } });
      const body = (await pending).arrayBuffer(), rejected = assert.rejects(body, error => error.name === 'AbortError');
      controller.abort(); await rejected; assert.deepEqual(h.aborted, [h.requests[0].id]);
      h.event({ type: 'chunk', bytes: [1, 2, 3] }); h.event({ type: 'end' }); h.completed.resolve();
    });

    await t.test('reader cancellation cancels its exact native request', async () => {
      const h = harness(), pending = connectionFetch('https://service.example/api/voice/synthesize');
      h.event({ type: 'headers', status: 200, headers: {} });
      const reader = (await pending).body.getReader(); await reader.cancel(); reader.releaseLock();
      assert.deepEqual(h.aborted, [h.requests[0].id]); h.event({ type: 'end' }); h.completed.resolve();
    });

    await t.test('ACK capability disables prefetch and confirms a chunk only on the next consumer read', async () => {
      const h = harness(true), pending = connectionFetch('https://service.example/api/voice/synthesize/stream');
      assert.equal(h.requests[0].flowControl, 'ack-v1');
      h.event({ type: 'headers', status: 200, headers: { 'content-type': 'application/x-ndjson' } });
      h.event({ type: 'chunk', sequence: 1, bytes: [1, 2] });
      const reader = (await pending).body.getReader(); await new Promise(setImmediate);
      assert.deepEqual(h.acknowledgements, []);
      assert.deepEqual((await reader.read()).value, Uint8Array.from([1, 2]));
      await new Promise(setImmediate); assert.deepEqual(h.acknowledgements, []);
      const second = reader.read(); await new Promise(setImmediate);
      assert.deepEqual(h.acknowledgements, [{ id: h.requests[0].id, sequence: 1 }]);
      h.event({ type: 'chunk', sequence: 2, bytes: [3] });
      assert.deepEqual((await second).value, Uint8Array.from([3]));
      await new Promise(setImmediate); assert.equal(h.acknowledgements.length, 1);
      const eof = reader.read(); await new Promise(setImmediate);
      assert.equal(h.acknowledgements[1].sequence, 2);
      h.event({ type: 'end' }); h.completed.resolve();
      assert.equal((await eof).done, true); reader.releaseLock();
      assert.deepEqual(h.aborted, []);
    });

    await t.test('cancel and abort discard unacknowledged buffered data without requesting more', async () => {
      for (const action of ['cancel', 'abort']) {
        const h = harness(true), controller = new AbortController();
        const pending = connectionFetch('https://service.example/api/voice/synthesize/stream', { signal: controller.signal });
        h.event({ type: 'headers', status: 200, headers: {} });
        h.event({ type: 'chunk', sequence: 1, bytes: [42] });
        const reader = (await pending).body.getReader();
        if (action === 'cancel') await reader.cancel();
        else { controller.abort(); await assert.rejects(reader.read(), error => error.name === 'AbortError'); }
        h.event({ type: 'chunk', sequence: 2, bytes: [99] }); h.event({ type: 'end' }); h.completed.resolve();
        assert.deepEqual(h.acknowledgements, []); assert.deepEqual(h.aborted, [h.requests[0].id]); reader.releaseLock();
      }
    });

    await t.test('invalid ACK sequences, oversized chunks and extra in-flight chunks fail closed', async () => {
      for (const chunks of [
        [{ bytes: [1] }], [{ sequence: 2, bytes: [1] }], [{ sequence: 1, bytes: [] }],
        [{ sequence: 1, bytes: new Array(65537).fill(1) }],
        [{ sequence: 1, bytes: [1] }, { sequence: 2, bytes: [2] }],
      ]) {
        const h = harness(true), pending = connectionFetch('https://service.example/api/voice/synthesize/stream');
        h.event({ type: 'headers', status: 200, headers: {} });
        const response = await pending;
        for (const chunk of chunks) h.event({ type: 'chunk', ...chunk });
        await assert.rejects(response.text(), /顺序或大小无效/);
        assert.deepEqual(h.aborted, [h.requests[0].id]); h.completed.resolve();
      }
    });

    await t.test('ACK IPC failure errors the body and cancels the native request', async () => {
      const h = harness(true), pending = connectionFetch('https://service.example/api/voice/synthesize/stream');
      h.bridge.remoteAck = async () => { throw new Error('ACK unavailable'); };
      h.event({ type: 'headers', status: 200, headers: {} }); h.event({ type: 'chunk', sequence: 1, bytes: [1] });
      const reader = (await pending).body.getReader(); await reader.read();
      await assert.rejects(reader.read(), /ACK unavailable/);
      assert.deepEqual(h.aborted, [h.requests[0].id]); h.completed.resolve(); reader.releaseLock();
    });

    await t.test('actual main transport and renderer stream keep a bounded window through EOF', async () => {
      const owner = new EventEmitter(); owner.isDestroyed = () => false;
      const events = [], acknowledgements = []; let receive, run;
      const event = { sender: owner, senderFrame: { send(_channel, _id, payload) { events.push(payload); receive(payload); } } };
      const manager = remoteHttp.createDesktopRemoteHttp({ isAllowed: input => input === event, limits: { chunkBytes: 2 }, fetchImpl: async () => new Response('123456') });
      install('window', { petpal: {
        remoteRequest(request, callback) { receive = callback; run = manager.request(event, request); return run; },
        remoteAbort: id => manager.abort(event, id),
        remoteAck(id, sequence) { acknowledgements.push(sequence); return manager.acknowledge(event, id, sequence); },
      } });
      try {
        const response = await connectionFetch('https://service.example/api/voice/synthesize/stream');
        await new Promise(setImmediate); assert.equal(events.filter(value => value.type === 'chunk').length, 1);
        const reader = response.body.getReader(), chunks = [];
        while (true) {
          const result = await reader.read(); if (result.done) break; chunks.push(result.value);
          await new Promise(setImmediate);
          assert.equal(events.filter(value => value.type === 'chunk').length, chunks.length);
          assert.equal(acknowledgements.length, chunks.length - 1);
        }
        reader.releaseLock(); await run;
        assert.equal(Buffer.concat(chunks).toString(), '123456'); assert.deepEqual(acknowledgements, [1, 2, 3]);
        assert.equal(events.at(-1).type, 'end'); assert.equal(owner.listenerCount('destroyed'), 0);
      } finally { await manager.close(); }
    });

    await t.test('native rejection and premature completion reject headers or body', async () => {
      for (const withHeaders of [false, true]) {
        const h = harness(), pending = connectionFetch('https://service.example/api/state');
        if (withHeaders) h.event({ type: 'headers', status: 200, headers: {} });
        const observed = withHeaders ? (await pending).text() : pending;
        const rejected = assert.rejects(observed, /提前结束/); h.completed.resolve(); await rejected;
      }
      const h = harness(), pending = connectionFetch('https://service.example/api/state');
      const rejected = assert.rejects(pending, /native rejected/); h.completed.reject(new Error('native rejected')); await rejected;
    });

    await t.test('malformed header status fails the fetch promise rather than leaving it pending', async () => {
      const h = harness(), pending = connectionFetch('https://service.example/api/state');
      let outcome = 'pending'; const observed = pending.then(() => { outcome = 'resolved'; }, () => { outcome = 'rejected'; });
      h.event({ type: 'headers', status: 100, headers: {} });
      // Drain promise adoption by the async wrapper as well as the inner reject.
      await new Promise(setImmediate);
      assert.equal(outcome, 'rejected'); await observed; assert.deepEqual(h.aborted, [h.requests[0].id]); h.completed.resolve();
    });

    await t.test('invalid event order and duplicate headers fail closed', async () => {
      const early = harness(), first = connectionFetch('https://service.example/api/state');
      const rejected = assert.rejects(first, /顺序无效/); early.event({ type: 'chunk', bytes: [1] }); await rejected; early.completed.resolve();
      const duplicate = harness(), second = connectionFetch('https://service.example/api/state');
      duplicate.event({ type: 'headers', status: 200, headers: {} }); const body = (await second).text();
      const bodyRejected = assert.rejects(body, /重复/); duplicate.event({ type: 'headers', status: 200, headers: {} }); await bodyRejected; duplicate.completed.resolve();
      assert.equal(duplicate.aborted.length, 1);
    });

    await t.test('204 and HEAD responses have null bodies', async () => {
      for (const [status, method] of [[204, 'POST'], [200, 'HEAD']]) {
        const h = harness(), pending = connectionFetch('https://service.example/api/state', { method });
        h.event({ type: 'headers', status, headers: {} }); h.event({ type: 'end' }); h.completed.resolve();
        assert.equal((await pending).body, null);
      }
    });
  } finally {
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  }
});
