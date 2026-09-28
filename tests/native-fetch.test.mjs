import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';

const source = await fs.readFile(new URL('../src/auth/native-fetch.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { connectionFetch } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const encoder = new TextEncoder();

test('renderer native fetch preserves destinations, credentials, streaming and cancellation', async t => {
  const originals = new Map(['window', 'location', 'fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const install = (key, value) => Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const harness = () => {
    const completed = deferred(), aborted = [], requests = []; let emit;
    const bridge = {
      connection() { throw new Error('Transport must not obtain native owner credentials'); },
      remoteRequest(request, callback) { requests.push(request); emit = callback; return completed.promise; },
      async remoteAbort(id) { aborted.push(id); },
    };
    install('window', { petpal: bridge });
    return { requests, aborted, completed, event: event => emit(event) };
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
