import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { Agent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { createAppProxyNetwork, isProxyBypassURL, electronProxyConfiguration, ELECTRON_PROXY_BYPASS_RULES } from '../desktop/app-proxy-network.mjs';

const username = 'petpal-fixture', password = 'private_fixture_random_password_123';
const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
const until = async predicate => {
  const deadline = Date.now() + 3000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error('Fixture deadline'); await new Promise(resolve => setTimeout(resolve, 5)); }
};
async function listen(t, server) {
  const sockets = new Set();
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); });
  return server.address().port;
}
async function fixture(t, { handle, expectedAuthorization = authorization, ...options } = {}) {
  const requests = [], connections = [], tunnels = new Set();
  const target = http.createServer((request, response) => {
    requests.push({ path: request.url, auth: request.headers.authorization, proxyAuth: request.headers['proxy-authorization'] });
    if (handle) handle(request, response);
    else response.end('OK');
  });
  const targetPort = await listen(t, target);
  const proxy = http.createServer((_request, response) => { response.writeHead(400).end(); });
  proxy.on('connect', (request, client, head) => {
    connections.push({ authority: request.url, authorization: request.headers['proxy-authorization'] });
    if (request.headers['proxy-authorization'] !== expectedAuthorization) { client.end('HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\n\r\n'); return; }
    const address = new URL(`http://${request.url}`);
    const upstream = net.connect(Number(address.port), address.hostname);
    tunnels.add(upstream); upstream.once('close', () => tunnels.delete(upstream));
    upstream.once('connect', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      client.pipe(upstream).pipe(client);
    });
    upstream.on('error', () => client.destroy()); client.on('error', () => upstream.destroy());
    client.on('close', () => upstream.destroy());
  });
  const proxyPort = await listen(t, proxy);
  t.after(() => { for (const socket of tunnels) socket.destroy(); });
  const changes = [];
  const network = createAppProxyNetwork({ applyProxy: async config => { changes.push(config); }, ...options });
  network.install(); t.after(() => network.close());
  return { network, changes, requests, connections, target,
    url: `http://127.0.0.1:${targetPort}`, proxyUrl: `http://${username}:${password}@127.0.0.1:${proxyPort}/` };
}

test('bypass recognizes normalized IPv4, private IPv6, mapped addresses, and local names', () => {
  for (const host of ['localhost', 'localhost.', 'service.localhost', 'printer.local', 'PRINTER.LOCAL.', 'intranet',
    '0.0.0.0', '10.12.4.3', '100.64.1.2', '100.127.255.255', '127.25.8.1', '169.254.2.3',
    '172.16.0.1', '172.31.255.255', '192.168.60.230', '198.18.1.2', '224.1.1.1', '255.255.255.255',
    '2130706433', '0x7f000001', '[::]', '[::1]', '[::2]', '[::127.0.0.1]', '[fc00::2]', '[fd80::2]', '[fe80::2]', '[febf::1]',
    '[fec0::1]', '[ff02::1]', '[::ffff:127.0.0.1]', '[::ffff:c0a8:3ce6]']) {
    assert.equal(isProxyBypassURL(`https://${host}/v1/responses`), true, host);
  }
  for (const host of ['api.openai.com', 'example.org', '100.128.0.1', '172.32.0.1', '192.169.0.1', '8.8.8.8',
    '[2001:4860:4860::8888]', '[fe7f::1]', '[::ffff:8.8.8.8]']) {
    assert.equal(isProxyBypassURL(`https://${host}/`), false, host);
  }
  assert.equal(isProxyBypassURL('wss://192.168.60.10/ws/asr'), true);
  assert.equal(isProxyBypassURL('wss://api.example.org/ws'), false);
  assert.equal(isProxyBypassURL('invalid'), true);
  assert.equal(isProxyBypassURL('file:///tmp/example'), true);
});

test('Chromium config excludes credentials and retains loopback/private bypass', () => {
  const config = electronProxyConfiguration(`http://${username}:${password}@127.0.0.1:12345/`);
  assert.equal(config.mode, 'fixed_servers');
  assert.equal(config.proxyRules, 'http=127.0.0.1:12345;https=127.0.0.1:12345');
  assert.equal(config.proxyBypassRules, ELECTRON_PROXY_BYPASS_RULES);
  assert.ok(config.proxyBypassRules.includes('192.168.0.0/16'));
  assert.ok(config.proxyBypassRules.includes('[::1]'));
  assert.ok(!config.proxyBypassRules.includes('<-loopback>'));
  assert.ok(!JSON.stringify(config).includes(password));
  assert.deepEqual(electronProxyConfiguration(), { mode: 'direct' });
});

test('proxy URI policy accepts only authenticated exact HTTP loopback', async t => {
  const f = await fixture(t);
  for (const address of ['http://127.0.0.1:12345', 'http://user:short@127.0.0.1:12345',
    `https://${username}:${password}@127.0.0.1:12345`, `http://${username}:${password}@localhost:12345`,
    `http://${username}:${password}@192.168.1.2:12345`, `http://${username}:${password}@[::1]:12345`,
    `http://${username}:${password}@127.0.0.1:12345/path`, `http://${username}:${password}@127.0.0.1:12345/?secret=yes`,
    `http://${username}:${password}@127.0.0.1:12345/#fragment`]) {
    await assert.rejects(f.network.enable({ url: address }), error => error.code === 'PETPAL_PROXY_ADDRESS' && !error.message.includes(password));
  }
  assert.equal(f.network.status().enabled, false);
});

test('stable installed router preserves original dispatcher while disabled and restores ownership safely', async t => {
  const original = getGlobalDispatcher(), f = await fixture(t), router = getGlobalDispatcher();
  assert.notEqual(router, original);
  assert.equal(await (await fetch(f.url)).text(), 'OK');
  assert.equal(f.connections.length, 0);
  assert.deepEqual(f.network.install(), { installed: true, enabled: false, closed: false });
  await f.network.close();
  assert.equal(getGlobalDispatcher(), original);
  assert.equal(await (await fetch(f.url)).text(), 'OK');
  assert.throws(() => f.network.install(), /小伴代理已停用/);
});

test('enabled private requests bypass proxy; disable preserves same router identity', async t => {
  const f = await fixture(t), router = getGlobalDispatcher();
  await f.network.enable({ url: f.proxyUrl });
  assert.equal(getGlobalDispatcher(), router);
  assert.equal(await (await fetch(f.url)).text(), 'OK');
  assert.equal(f.connections.length, 0);
  assert.equal(f.changes.at(-1).mode, 'fixed_servers');
  await f.network.disable();
  assert.equal(getGlobalDispatcher(), router);
  assert.equal(f.changes.at(-1).mode, 'direct');
  assert.equal(await (await fetch(f.url)).text(), 'OK');
});

test('CONNECT proxy receives random authentication without leaking it to target or status', async t => {
  const f = await fixture(t, { forceProxy: () => true });
  await f.network.enable({ url: f.proxyUrl });
  assert.equal(await (await fetch(`${f.url}/responses`, { headers: { Authorization: 'Bearer fixture-model-secret' } })).text(), 'OK');
  assert.equal(f.connections.length, 1);
  assert.equal(f.connections[0].authorization, authorization);
  assert.equal(f.requests[0].auth, 'Bearer fixture-model-secret');
  assert.equal(f.requests[0].proxyAuth, undefined);
  assert.ok(!JSON.stringify(f.network.status()).includes(password));
});

test('SSE bytes arrive before completion, and caller abort ends one stream without replay', async t => {
  let response, ended = false;
  const f = await fixture(t, { forceProxy: () => true, handle: (_request, result) => {
    response = result; result.on('close', () => { ended = true; });
    result.writeHead(200, { 'Content-Type': 'text/event-stream' }); result.write('data: first\n\n');
  } });
  await f.network.enable({ url: f.proxyUrl });
  const controller = new AbortController(), streamed = await fetch(f.url, { signal: controller.signal });
  const reader = streamed.body.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'data: first\n\n');
  assert.equal(response.writableEnded, false);
  const pending = reader.read(); controller.abort();
  await assert.rejects(pending, error => error.name === 'AbortError');
  await until(() => ended);
  assert.equal(f.requests.length, 1);
});

test('disable cancels active proxy response and never resubmits it; next request is direct', async t => {
  const f = await fixture(t, { forceProxy: () => true, handle: (request, response) => {
    if (request.url === '/stream') { response.writeHead(200, { 'Content-Type': 'text/event-stream' }); response.write('data: first\n\n'); }
    else response.end('direct');
  } });
  await f.network.enable({ url: f.proxyUrl });
  const reader = (await fetch(`${f.url}/stream`)).body.getReader(); await reader.read();
  const pending = reader.read(); const rejected = assert.rejects(pending);
  await f.network.disable({ cancelActive: true }); await rejected;
  assert.equal(await (await fetch(f.url)).text(), 'direct');
  assert.deepEqual(f.requests.map(request => request.path), ['/stream', '/']);
  assert.equal(f.connections.length, 1);
});

test('graceful disable waits for existing stream without retrying and routes new requests direct', async t => {
  let stream;
  const f = await fixture(t, { forceProxy: () => true, handle: (request, response) => {
    if (request.url === '/stream') { stream = response; response.writeHead(200, { 'Content-Type': 'text/event-stream' }); response.write('data: first\n\n'); }
    else response.end('direct');
  } });
  await f.network.enable({ url: f.proxyUrl });
  const reader = (await fetch(`${f.url}/stream`)).body.getReader(); await reader.read();
  const draining = f.network.disable({ cancelActive: false });
  await until(() => !f.network.status().enabled);
  assert.equal(await (await fetch(f.url)).text(), 'direct');
  stream.end('data: last\n\n');
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'data: last\n\n');
  assert.equal((await reader.read()).done, true); await draining;
  assert.equal(f.connections.length, 1);
  assert.deepEqual(f.requests.map(request => request.path), ['/stream', '/']);
});

test('rejected proxy authentication has safe errors and no silent direct fallback', async t => {
  const f = await fixture(t, { forceProxy: () => true, expectedAuthorization: 'Basic deliberately-wrong' });
  await f.network.enable({ url: f.proxyUrl });
  await assert.rejects(fetch(f.url), error => !JSON.stringify(error, Object.getOwnPropertyNames(error)).includes(password));
  assert.equal(f.requests.length, 0);
  assert.equal(f.connections.length, 1);
});

test('close can cancel an unfinished graceful drain without waiting for a stalled response', async t => {
  const f = await fixture(t, { forceProxy: () => true, handle: (_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/event-stream' }); response.write('data: first\n\n');
  } });
  await f.network.enable({ url: f.proxyUrl });
  const reader = (await fetch(f.url)).body.getReader(); await reader.read();
  const pending = reader.read(), rejected = assert.rejects(pending);
  const draining = f.network.disable({ cancelActive: false });
  await until(() => !f.network.status().enabled);
  await f.network.close(); await draining; await rejected;
  assert.equal(f.network.status().closed, true);
  assert.equal(f.requests.length, 1);
});

test('failed Chromium apply retains old route and reports only a fixed safe error', async t => {
  let rejectApply = false;
  const f = await fixture(t, { forceProxy: () => true, applyProxy: async () => { if (rejectApply) throw new Error(password); } });
  await f.network.enable({ url: f.proxyUrl }); rejectApply = true;
  await assert.rejects(f.network.disable(), error => error.code === 'PETPAL_PROXY_APPLY_FAILED' && !error.message.includes(password));
  assert.equal(f.network.status().enabled, true);
  assert.equal(await (await fetch(f.url)).text(), 'OK');
  await assert.rejects(f.network.enable({ url: f.proxyUrl }), error => !error.message.includes(password));
  assert.equal(await (await fetch(f.url)).text(), 'OK');
});

test('close never destroys original dispatcher or overwrites a later unrelated owner', async t => {
  const original = getGlobalDispatcher(), f = await fixture(t), later = new Agent();
  t.after(async () => { setGlobalDispatcher(original); await later.close(); });
  setGlobalDispatcher(later); await f.network.close();
  assert.equal(getGlobalDispatcher(), later);
  assert.equal(await (await fetch(f.url, { dispatcher: original })).text(), 'OK');
});
