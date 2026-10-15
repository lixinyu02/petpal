import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import { Agent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { normalizeRemoteConfigUrl, downloadProxyConfiguration, PROXY_DOWNLOAD_ERRORS } from '../desktop/app-proxy-download.mjs';

const yaml = 'mode: rule\nproxies: []\nrules: [MATCH,DIRECT]\n';
const never = () => new Promise(() => {});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function safeError(kind, secret = 'fixture-private-token') {
  return error => {
    assert.equal(error.code, 'PETPAL_PROXY');
    assert.equal(error.message, PROXY_DOWNLOAD_ERRORS[kind]);
    assert.equal(error.cause, undefined);
    assert.ok(!String(error.stack).includes(secret));
    return true;
  };
}
async function serverFixture(t, handler) {
  const server = http.createServer(handler), sockets = new Set();
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); });
  return `http://127.0.0.1:${server.address().port}`;
}
function fakeResponse({ body = yaml, status = 200, headers = {} } = {}) {
  return new Response(body, { status, headers });
}

test('normalizes HTTP(S) origins and accepts LAN and IPv6 addresses', () => {
  assert.equal(normalizeRemoteConfigUrl('HTTPS://EXAMPLE.ORG:443/config.yaml?token=fixture-private-token'), 'https://example.org/config.yaml?token=fixture-private-token');
  assert.equal(normalizeRemoteConfigUrl('http://192.168.60.10:8080'), 'http://192.168.60.10:8080/');
  assert.equal(normalizeRemoteConfigUrl('http://[::1]:8080/a'), 'http://[::1]:8080/a');
  assert.equal(normalizeRemoteConfigUrl('http://intranet/config.yaml'), 'http://intranet/config.yaml');
  assert.equal(normalizeRemoteConfigUrl('http://例子.测试/配置'), 'http://xn--fsqu00a.xn--0zwm56d/%E9%85%8D%E7%BD%AE');
});

test('rejects non-requestable addresses, credentials, fragments and normalization ambiguities safely', () => {
  for (const value of [null, undefined, {}, '', ' ', 'example.org/config', '//example.org/a', 'http:example.org/a',
    'ftp://example.org/a', 'file:///a', 'data:yaml,secret', 'javascript:alert(1)', 'http://', 'http:///a',
    ' https://example.org/a', 'https://example.org/a ', 'https://example.org/a\n', 'https://exa\tmple.org/a',
    'https://example.org/\u0085', 'https://example.org\\a', 'https://user:fixture-private-token@example.org/a',
    'https://@example.org/a', 'https://user@example.org/a', 'https://example.org/a#', 'https://example.org/a#fragment',
    'http://example.org:99999/a', 'http://[not-ipv6]/', `https://example.org/${'a'.repeat(4096)}`]) {
    assert.throws(() => normalizeRemoteConfigUrl(value), safeError('ADDRESS'), String(value));
  }
});

test('makes real HTTP requests, follows bounded relative redirects and retains initial normalized source', async t => {
  const requests = [];
  const origin = await serverFixture(t, (request, response) => {
    requests.push({ path: request.url, headers: request.headers });
    if (request.url.startsWith('/first')) response.writeHead(302, { Location: './next', 'Set-Cookie': 'session=fixture-private-token' }).end('redirect body');
    else if (request.url === '/next') response.writeHead(307, { Location: '/config.yaml' }).end();
    else response.writeHead(200, { 'Content-Type': 'application/yaml' }).end(yaml);
  });
  const source = `${origin}/first?token=fixture-private-token`;
  assert.deepEqual(await downloadProxyConfiguration(source), { yaml, url: source });
  assert.deepEqual(requests.map(value => value.path), ['/first?token=fixture-private-token', '/next', '/config.yaml']);
  for (const { headers } of requests) {
    for (const name of ['authorization', 'proxy-authorization', 'cookie', 'referer']) assert.equal(headers[name], undefined);
  }
});

test('uses current global fetch dispatcher and sends only request-local public headers', async t => {
  let dispatched = 0;
  const origin = await serverFixture(t, (_request, response) => response.end(yaml));
  const previous = getGlobalDispatcher(), delegate = new Agent();
  const dispatcher = { dispatch(options, handler) { dispatched++; return delegate.dispatch(options, handler); } };
  setGlobalDispatcher(dispatcher);
  t.after(async () => { setGlobalDispatcher(previous); await delegate.close(); });
  assert.equal((await downloadProxyConfiguration(origin)).yaml, yaml);
  assert.equal(dispatched, 1);
});

test('injected fetch sees credentials omitted and no application session or referrer headers', async () => {
  await downloadProxyConfiguration('http://example.org/config', { fetchImpl: async (_url, options) => {
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'manual');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.referrerPolicy, 'no-referrer');
    assert.equal(options.cache, 'no-store');
    assert.deepEqual(Object.keys(options.headers), ['Accept']);
    assert.ok(options.signal instanceof AbortSignal);
    return fakeResponse();
  } });
});

test('redirect limit cancels the final response without issuing another HTTP request', async t => {
  let requests = 0;
  const origin = await serverFixture(t, (_request, response) => { requests++; response.writeHead(302, { Location: '/again' }).end(); });
  await assert.rejects(downloadProxyConfiguration(origin, { maxRedirects: 2 }), safeError('REDIRECT'));
  assert.equal(requests, 3);
});

test('HTTP can upgrade to HTTPS while HTTPS cannot downgrade on any hop', async () => {
  const seen = [];
  const result = await downloadProxyConfiguration('http://example.org/start', { fetchImpl: async url => {
    seen.push(url);
    return seen.length === 1 ? fakeResponse({ status: 302, body: '', headers: { Location: 'https://example.org/config' } }) : fakeResponse();
  } });
  assert.equal(result.url, 'http://example.org/start');
  assert.deepEqual(seen, ['http://example.org/start', 'https://example.org/config']);
  let calls = 0;
  await assert.rejects(downloadProxyConfiguration('http://example.org/start', { fetchImpl: async () => {
    calls++;
    return fakeResponse({ status: 302, body: '', headers: { Location: calls === 1 ? 'https://example.org/config' : 'http://example.org/downgrade' } });
  } }), safeError('DOWNGRADE'));
  assert.equal(calls, 2);
});

test('redirects reject absent location, credentials, invalid protocols, fragments and controls', async () => {
  for (const location of [null, '', 'file:///private', 'ftp://example.org/a', 'https://user:fixture-private-token@example.org/a',
    'https://@example.org/a', '/a#', '/a#fragment', '/a\\b', ' /a', 'http://example.org:99999/a']) {
    let calls = 0;
    await assert.rejects(downloadProxyConfiguration('https://example.org/source', { fetchImpl: async () => {
      calls++;
      return { status: 302, headers: { get: () => location }, body: { cancel() {} } };
    } }), safeError('REDIRECT'), String(location));
    assert.equal(calls, 1);
  }
});

test('rejects error/unsupported statuses and never exposes server status text or bodies', async () => {
  for (const status of [300, 304, 400, 401, 403, 404, 429, 500]) {
    await assert.rejects(downloadProxyConfiguration('https://example.org/?token=fixture-private-token', {
      fetchImpl: async () => fakeResponse({ status, body: status === 304 ? null : 'fixture-private-token' }),
    }), safeError('RESPONSE'));
  }
});

test('rejects advertised lengths before reading the response body', async () => {
  for (const length of ['999999999999999999999999999999', '65', '-1', 'invalid']) {
    let reads = 0, cancelled = 0;
    const response = { status: 200, headers: new Headers({ 'Content-Length': length }), body: {
      getReader() { reads++; throw new Error('fixture-private-token'); }, cancel() { cancelled++; },
    } };
    await assert.rejects(downloadProxyConfiguration('https://example.org/config', { maxBytes: 64, fetchImpl: async () => response }), safeError('TOO_LARGE'));
    assert.equal(reads, 0);
    assert.equal(cancelled, 1);
  }
});

test('enforces streamed byte limit without content length and cancels an unfinished body', async () => {
  let cancelled = 0;
  const response = fakeResponse({ body: new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(33)); controller.enqueue(new Uint8Array(32)); },
    cancel() { cancelled++; },
  }) });
  await assert.rejects(downloadProxyConfiguration('https://example.org/config', { maxBytes: 64, fetchImpl: async () => response }), safeError('TOO_LARGE'));
  assert.equal(cancelled, 1);
});

test('actual compressed HTTP response is limited after decompression', async t => {
  const compressed = zlib.gzipSync(`a: ${'x'.repeat(1024)}`);
  assert.ok(compressed.length < 64);
  const origin = await serverFixture(t, (_request, response) => response.writeHead(200, {
    'Content-Type': 'text/plain', 'Content-Encoding': 'gzip', 'Content-Length': compressed.length,
  }).end(compressed));
  await assert.rejects(downloadProxyConfiguration(origin, { maxBytes: 64 }), safeError('TOO_LARGE'));
});

test('allows exactly byte limit and preserves UTF-8 split across chunks', async () => {
  const body = Buffer.from('name: 小伴\n');
  const response = fakeResponse({ body: new ReadableStream({ start(controller) {
    for (const byte of body) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } }) });
  assert.deepEqual(await downloadProxyConfiguration('https://example.org/a', { maxBytes: body.length, fetchImpl: async () => response }), {
    yaml: body.toString('utf8'), url: 'https://example.org/a',
  });
});

test('strict UTF-8 rejects invalid sequences and unfinished multibyte suffix', async () => {
  for (const bytes of [[0xff], [0xc0, 0x80], [0xed, 0xa0, 0x80], [0x61, 0xe5, 0xb0]]) {
    await assert.rejects(downloadProxyConfiguration('https://example.org/a', { fetchImpl: async () => fakeResponse({ body: Uint8Array.from(bytes) }) }), safeError('TEXT'));
  }
});

test('rejects empty/whitespace bodies and declared/sniffed HTML login pages', async () => {
  for (const body of ['', ' \r\n\t', '\uFEFF \n']) {
    await assert.rejects(downloadProxyConfiguration('https://example.org/a', { fetchImpl: async () => fakeResponse({ body }) }), safeError('EMPTY'));
  }
  for (const body of ['<!DOCTYPE html><html>fixture-private-token</html>', '<HTML>login</HTML>', '<head>login</head>', '<body>login</body>', '<!-- auth page -->\n<html>login</html>']) {
    await assert.rejects(downloadProxyConfiguration('https://example.org/a', { fetchImpl: async () => fakeResponse({ body }) }), safeError('HTML'));
  }
  for (const type of ['text/html; charset=utf-8', 'application/xhtml+xml']) {
    await assert.rejects(downloadProxyConfiguration('https://example.org/a', { fetchImpl: async () => fakeResponse({ headers: { 'Content-Type': type } }) }), safeError('HTML'));
  }
});

test('non-HTML text is handed to the manager for full YAML/core validation', async () => {
  const body = 'not a valid configuration: [unterminated';
  assert.equal((await downloadProxyConfiguration('https://example.org/a', { fetchImpl: async () => fakeResponse({ body }) })).yaml, body);
});

test('timeout bounds fetch that ignores AbortSignal and closes its late response body', async () => {
  let resolveFetch, cancelled = 0, fetchSignal;
  await assert.rejects(downloadProxyConfiguration('https://example.org/?fixture-private-token', {
    timeoutMs: 20, fetchImpl: (_url, options) => { fetchSignal = options.signal; return new Promise(resolve => { resolveFetch = resolve; }); },
  }), safeError('TIMEOUT'));
  assert.equal(fetchSignal.aborted, true);
  resolveFetch({ body: { cancel() { cancelled++; } } });
  await delay(0);
  assert.equal(cancelled, 1);
});

test('timeout bounds hanging body reads and body.cancel implementations', async () => {
  let cancelled = 0, released = 0, fetchSignal;
  const response = { status: 200, headers: new Headers(), body: { getReader() { return {
    read: never, cancel() { cancelled++; return never(); }, releaseLock() { released++; },
  }; } } };
  const start = Date.now();
  await assert.rejects(downloadProxyConfiguration('https://example.org/a', {
    timeoutMs: 25, fetchImpl: async (_url, options) => { fetchSignal = options.signal; return response; },
  }), safeError('TIMEOUT'));
  assert.ok(Date.now() - start < 1000);
  assert.ok(cancelled >= 1);
  assert.equal(released, 1);
  assert.equal(fetchSignal.aborted, true);
});

test('endless synchronously fulfilled empty chunks cannot starve timeout', async () => {
  let cancelled = 0;
  const response = { status: 200, headers: new Headers(), body: { getReader() { return {
    read: async () => ({ done: false, value: new Uint8Array() }),
    cancel() { cancelled++; }, releaseLock() {},
  }; } } };
  await assert.rejects(downloadProxyConfiguration('https://example.org/a', {
    timeoutMs: 25, fetchImpl: async () => response,
  }), safeError('TIMEOUT'));
  assert.ok(cancelled >= 1);
});

test('timeout is shared across redirect hops rather than reset per request', async () => {
  let calls = 0;
  await assert.rejects(downloadProxyConfiguration('https://example.org/a', {
    timeoutMs: 35, fetchImpl: async () => {
      calls++; await delay(20);
      return fakeResponse({ status: 302, body: '', headers: { Location: '/again' } });
    },
  }), safeError('TIMEOUT'));
  assert.ok(calls >= 1 && calls <= 2);
});

test('pre-aborted external signal never starts a request', async () => {
  const controller = new AbortController(); controller.abort(new Error('fixture-private-token'));
  let calls = 0;
  await assert.rejects(downloadProxyConfiguration('https://example.org/a', { signal: controller.signal, fetchImpl: () => { calls++; return never(); } }), safeError('CANCELLED'));
  assert.equal(calls, 0);
});

test('external abort cancels body, terminates hanging fetch and never exposes custom abort reason', async () => {
  const controller = new AbortController();
  let cancelled = 0;
  const pending = downloadProxyConfiguration('https://example.org/a', {
    signal: controller.signal, fetchImpl: async () => fakeResponse({ body: new ReadableStream({ cancel() { cancelled++; } }) }),
  });
  await delay(0); controller.abort(new Error('fixture-private-token'));
  await assert.rejects(pending, safeError('CANCELLED'));
  assert.equal(cancelled, 1);
  const second = new AbortController();
  const hung = downloadProxyConfiguration('https://example.org/a', { signal: second.signal, fetchImpl: never });
  second.abort(new Error('fixture-private-token'));
  await assert.rejects(hung, safeError('CANCELLED'));
});

test('actual HTTP stream is closed after timeout and does not retry', async t => {
  let requests = 0, closed;
  const disconnected = new Promise(resolve => { closed = resolve; });
  const origin = await serverFixture(t, (_request, response) => {
    requests++; response.on('close', closed); response.writeHead(200, { 'Content-Type': 'text/yaml' }); response.write('mode: ');
  });
  await assert.rejects(downloadProxyConfiguration(origin, { timeoutMs: 120 }), safeError('TIMEOUT'));
  await Promise.race([disconnected, delay(1000).then(() => { throw new Error('Body was not closed'); })]);
  assert.equal(requests, 1);
});

test('fetch and body failures are sanitized and arbitrary PETPAL_PROXY errors are not trusted', async () => {
  for (const fetchImpl of [
    () => { throw Object.assign(new Error('fixture-private-token'), { code: 'PETPAL_PROXY' }); },
    async () => fakeResponse({ body: new ReadableStream({ pull() { throw new Error('fixture-private-token'); } }) }),
    async () => ({ status: 200, headers: { get() { throw new Error('fixture-private-token'); } }, body: null }),
  ]) await assert.rejects(downloadProxyConfiguration('https://example.org/?token=fixture-private-token', { fetchImpl }), safeError('FAILED'));
});

test('invalid bounds and dependencies fail with fixed safe error before network use', async () => {
  for (const options of [{ maxBytes: 0 }, { maxBytes: 4 * 1024 * 1024 + 1 }, { maxRedirects: -1 }, { maxRedirects: 11 },
    { timeoutMs: 0 }, { timeoutMs: 120001 }, { timeoutMs: Infinity }, { fetchImpl: null }, { signal: {} }, null, [], false,
    { get fetchImpl() { throw new Error('fixture-private-token'); } }]) {
    await assert.rejects(downloadProxyConfiguration('https://example.org/a', options), safeError('FAILED'));
  }
});
