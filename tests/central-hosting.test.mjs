import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { networkInterfaces, tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createPetServer } from '../server/app.mjs';
import { JsonStore } from '../server/store.mjs';
import { listenFixture } from './helpers/loopback.mjs';

const bootstrap = 'isolated-central-hosting-bootstrap';
const password = 'central-fixture-password';
const publicUrl = 'https://petpal-central.example:44318';
const packageName = 'PetPal-0.9.7-Windows-x64.zip';
const packageBytes = Buffer.from('isolated-central-download-package:0123456789');
const picture = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64');
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const portOf = server => server.address().port;
const urlOf = server => `http://127.0.0.1:${portOf(server)}`;

async function until(check, message = 'central-hosting state did not settle') {
  for (let index = 0; index < 150; index++) {
    if (await check()) return;
    await delay(10);
  }
  assert.fail(message);
}

async function closeListener(server) {
  if (!server.listening) return;
  const closed = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  server.closeIdleConnections(); server.closeAllConnections();
  await closed;
}

/** Exercise the actual HTTP listener, including Host values fetch cannot reliably set. */
async function rawRequest(server, route, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port: portOf(server), method, path: route,
      headers: { Connection: 'close', ...headers } }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, bytes: Buffer.concat(chunks) }));
      response.on('error', reject);
    });
    request.setTimeout(5000, () => request.destroy(new Error('isolated central request timed out')));
    request.on('error', reject); request.end(body);
  });
}

/** Use only a temporary instance and fixture upstream; never load production data. */
async function fixture(t, { configurePassword = true, codex: suppliedCodex } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-central-hosting-'));
  let app, upstream;
  t.after(async () => {
    const outcomes = await Promise.allSettled([app?.close(), upstream ? closeListener(upstream) : Promise.resolve()]);
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('petpal-central-hosting-'));
    await rm(directory, { recursive: true, force: true });
    const failed = outcomes.find(result => result.status === 'rejected'); if (failed) throw failed.reason;
  });
  const staticDir = path.join(directory, 'public'), downloadsDir = path.join(staticDir, 'downloads');
  await mkdir(downloadsDir, { recursive: true });
  await writeFile(path.join(staticDir, 'index.html'), '<!doctype html><title>Isolated central shell</title>');
  const sha256 = createHash('sha256').update(packageBytes).digest('hex');
  await writeFile(path.join(downloadsDir, packageName), packageBytes);
  await writeFile(path.join(downloadsDir, 'release-manifest-0.9.7.json'), JSON.stringify({ version: '0.9.7', channel: 'stable',
    createdAt: '2026-10-04T00:00:00Z', files: [{ name: packageName, target: 'windows-x64', bytes: packageBytes.length, sha256 }] }));
  await writeFile(path.join(downloadsDir, 'SHA256SUMS-0.9.7.txt'), `${sha256}  ${packageName}\n`);
  upstream = http.createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks));
    response.setHeader('Content-Type', 'text/event-stream');
    response.write('data: ' + JSON.stringify({ choices: [{ delta: { content: `fixture:${body.model}` } }] }) + '\n\n');
    response.end('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n');
  });
  await listenFixture(upstream);
  const calls = [];
  const codex = suppliedCodex ?? { async status() { return { available: true, authenticated: true }; },
    async run(args) { calls.push(args); args.onEvent('delta', { text: 'isolated Agent result' }); return { text: 'isolated Agent result', threadId: 'isolated-thread' }; },
    async close() {} };
  app = await createPetServer({ dataDir: path.join(directory, 'data'), token: bootstrap, staticDir, codex,
    downloadsOptions: { fetchImpl: async () => new Response('[]', { headers: { 'Content-Type': 'application/json' } }) } });
  await listenFixture(app.server);
  const request = (server, route, { token = '', method = 'GET', body, raw, headers = {}, signal } = {}) => fetch(urlOf(server) + route, {
    method, signal: signal ?? AbortSignal.timeout(5000), headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(raw === undefined && body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const local = (route, options = {}) => request(app.server, route, { token: bootstrap, ...options });
  const responseJson = async response => { assert.ok(response.ok, `unexpected ${response.status}: ${await response.clone().text()}`); return response.json(); };
  const state = await responseJson(await local('/api/state'));
  if (configurePassword) assert.equal((await local(`/api/admin/users/${state.user.id}`, { method: 'PATCH', body: { password } })).status, 200);
  const login = async (server, username = 'owner', extra = {}) => responseJson(await request(server, '/api/auth/login', {
    method: 'POST', body: { username, password }, ...extra,
  }));
  const newListener = async options => { const listener = app.hosting.createListener(options); assert.equal(listener.listening, false); await listenFixture(listener); return listener; };
  const createMember = async (username, providerIds = [], agentAccess = 'none') => responseJson(await local('/api/admin/users', {
    method: 'POST', body: { username, password, providerIds, agentAccess },
  }));
  const provider = await responseJson(await local('/api/providers', { method: 'POST', body: { name: 'Assigned fixture', protocol: 'chat-completions',
    baseUrl: urlOf(upstream) + '/v1', model: 'central-chat-fixture', supportsImages: true, apiKey: 'isolated-never-roundtrip-key' } }));
  return { directory, app, request, local, login, responseJson, newListener, createMember, provider, state, calls };
}

test('central hosting requires a password-ready local owner and returns an unbound additional listener', async t => {
  const f = await fixture(t, { configurePassword: false });
  assert.deepEqual(f.app.hosting.status(), { instanceId: f.state.instanceId, ownerHasPassword: false });
  assert.throws(() => f.app.hosting.createListener(), { status: 409 });
  f.app.hosting.assertOwnerSession(bootstrap);
  assert.throws(() => f.app.hosting.assertOwnerSession('invalid-login'), { status: 401 });
  assert.equal((await f.local(`/api/admin/users/${f.state.user.id}`, { method: 'PATCH', body: { password } })).status, 200);
  assert.equal(f.app.hosting.status().ownerHasPassword, true);
  const owner = await f.login(f.app.server); f.app.hosting.assertOwnerSession(owner.token);
  await f.createMember('alice'); const member = await f.login(f.app.server, 'alice');
  assert.throws(() => f.app.hosting.assertOwnerSession(member.token), { status: 403 });
  const listener = f.app.hosting.createListener(); assert.equal(listener.listening, false);
  assert.equal(listener.headersTimeout, f.app.server.headersTimeout);
  assert.equal(listener.requestTimeout, f.app.server.requestTimeout);
});

test('malformed stored password records cannot make a central host appear password-ready', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-central-hosting-'));
  const store = await new JsonStore(directory).init();
  store.state.users[0].password = { algorithm: 'scrypt', salt: 'invalid-salt', hash: 'invalid-hash' }; await store.save();
  const app = await createPetServer({ dataDir: directory, token: bootstrap,
    codex: { async status() { return { available: false }; }, async close() {} } });
  t.after(async () => { await app.close();
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('petpal-central-hosting-'));
    await rm(directory, { recursive: true, force: true }); });
  assert.equal(app.hosting.status().ownerHasPassword, false);
  assert.throws(() => app.hosting.createListener(), { status: 409 });
});

test('central entry serves only the public shell and health before password login, and rejects local bootstrap tokens', async t => {
  const f = await fixture(t), listener = await f.newListener();
  for (const route of ['/', '/api/health']) assert.equal((await f.request(listener, route)).status, 200);
  for (const [route, method, body] of [['/api/state', 'GET'], ['/api/agent/hosts', 'GET'], ['/api/voice', 'GET'],
    ['/api/voice/asr/sessions', 'POST', {}], ['/api/voice/synthesize', 'POST', { text: 'no login' }], ['/api/downloads', 'GET'],
    ['/api/attachments/missing', 'GET']]) assert.equal((await f.request(listener, route, { method, body })).status, 401, route);
  for (const route of ['/api/auth/me', '/api/state', '/api/health']) assert.equal((await f.request(listener, route, { token: bootstrap })).status, 403, route);
  assert.equal((await f.request(listener, '/api/auth/login', { method: 'POST', body: { username: 'owner', password: 'wrong-password' } })).status, 401);
  const owner = await f.login(listener), me = await f.responseJson(await f.request(listener, '/api/auth/me', { token: owner.token }));
  assert.equal(me.instanceId, f.state.instanceId); assert.equal(me.user.id, f.state.user.id);
  assert.equal((await f.local('/api/auth/me')).status, 200, 'loopback retains the existing local administrator connection');
});

test('dual listeners share user models, Chat history and voice preferences while maintaining account isolation', async t => {
  const f = await fixture(t), listener = await f.newListener();
  await f.createMember('alice', [f.provider.id]); await f.createMember('bob');
  const alice = await f.login(listener, 'alice'), bob = await f.login(listener, 'bob');
  const sameAccount = await f.login(f.app.server, 'alice');
  const conversation = await f.responseJson(await f.request(listener, '/api/conversations', { token: alice.token, method: 'POST',
    body: { mode: 'chat', providerId: f.provider.id } }));
  const reply = await f.request(listener, `/api/conversations/${conversation.id}/messages`, { token: alice.token, method: 'POST', body: { content: 'LAN Chat fixture' } });
  assert.equal(reply.status, 200); assert.match(await reply.text(), /fixture:central-chat-fixture/);
  const fromLocal = await f.responseJson(await f.request(f.app.server, `/api/conversations/${conversation.id}`, { token: sameAccount.token }));
  assert.equal(fromLocal.messages.length, 2); assert.equal(fromLocal.messages[1].content, 'fixture:central-chat-fixture');
  const aliceState = await f.responseJson(await f.request(listener, '/api/state', { token: alice.token }));
  assert.deepEqual(aliceState.providers.map(value => value.id), [f.provider.id]);
  assert.ok(!JSON.stringify(aliceState).includes('isolated-never-roundtrip-key'));
  const voice = await f.responseJson(await f.request(listener, '/api/voice', { token: alice.token }));
  const localVoice = await f.responseJson(await f.request(f.app.server, '/api/voice', { token: sameAccount.token }));
  assert.deepEqual(localVoice, voice);
  assert.equal((await f.request(listener, `/api/conversations/${conversation.id}`, { token: bob.token })).status, 404);
  assert.equal((await f.local(`/api/conversations/${conversation.id}`)).status, 404);
  assert.equal((await f.request(listener, '/api/admin/users', { token: alice.token })).status, 403);
  assert.equal((await f.request(listener, '/api/agent/hosts', { token: alice.token })).status, 403);
});

test('LAN listener enforces exact Host and Origin and does not implicitly trust Android or forwarded origins', async t => {
  const f = await fixture(t), listener = await f.newListener(), owner = await f.login(listener);
  const headers = { Authorization: `Bearer ${owner.token}` };
  for (const Origin of ['https://evil.example', 'null', 'https://localhost', `http://127.0.0.1:${portOf(listener) + 1}`]) {
    assert.equal((await rawRequest(listener, '/api/auth/me', { headers: { ...headers, Origin } })).status, 403, Origin);
  }
  assert.equal((await rawRequest(listener, '/api/auth/me', { headers: { ...headers, Origin: urlOf(listener) } })).status, 200);
  assert.equal((await rawRequest(listener, '/api/health', { headers: { Host: 'evil.example', 'X-Forwarded-Host': '127.0.0.1', 'X-Forwarded-Proto': 'https' } })).status, 403);
  const address = Object.values(networkInterfaces()).flat().find(value => value?.family === 'IPv4' && !value.internal)?.address;
  if (address) {
    const Host = `${address}:${portOf(listener)}`, Origin = `http://${Host}`;
    assert.equal((await rawRequest(listener, '/api/auth/me', { headers: { ...headers, Host, Origin } })).status, 200,
      'current LAN interface Host and same-origin requests are accepted without rewriting sockets');
  }
});

test('configured HTTPS public and Android origins are exact and restricted to their additional listener', async t => {
  const f = await fixture(t), listener = await f.newListener({ publicUrl }), plainListener = await f.newListener();
  const owner = await f.login(listener), headers = { Authorization: `Bearer ${owner.token}` };
  for (const Origin of [publicUrl, 'https://localhost']) {
    const result = await rawRequest(listener, '/api/auth/me', { headers: { ...headers, Host: new URL(publicUrl).host, Origin } });
    assert.equal(result.status, 200); assert.equal(result.headers['access-control-allow-origin'], Origin);
    assert.equal((await rawRequest(f.app.server, '/api/auth/me', { headers: { ...headers, Origin } })).status, 403);
    assert.equal((await rawRequest(plainListener, '/api/auth/me', { headers: { ...headers, Origin } })).status, 403);
  }
  const preflight = await rawRequest(listener, '/api/auth/login', { method: 'OPTIONS', headers: { Host: new URL(publicUrl).host,
    Origin: 'https://localhost', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } });
  assert.equal(preflight.status, 204); assert.equal(preflight.headers['access-control-allow-origin'], 'https://localhost');
  for (const Origin of ['http://petpal-central.example:44318', 'https://petpal-central.example:44319', 'https://localhost:44318',
    'http://localhost', 'capacitor://localhost', 'https://petpal-central.example.evil:44318', 'null']) {
    assert.equal((await rawRequest(listener, '/api/auth/me', { headers: { ...headers, Host: new URL(publicUrl).host, Origin } })).status, 403, Origin);
  }
  for (const Host of ['petpal-central.example.evil:44318', 'evil.example', 'other.example:44318',
    'petpal-central.example:44319', 'petpal-central.example']) {
    assert.equal((await rawRequest(listener, '/api/health', { headers: { Host, Origin: publicUrl } })).status, 403, Host);
  }
  assert.equal((await rawRequest(f.app.server, '/api/health', { headers: { Host: new URL(publicUrl).host } })).status, 403);
});

test('central public URL rejects credentials, paths, query, fragments, non-HTTPS and unknown configuration fields', async t => {
  const f = await fixture(t);
  for (const value of ['http://petpal.example', 'ftp://petpal.example', 'https://user:password@petpal.example',
    'https://petpal.example/path', 'https://petpal.example?token=secret', 'https://petpal.example/#token=secret',
    'https://petpal.example\nprivate', 123, {}, null]) assert.throws(() => f.app.hosting.createListener({ publicUrl: value }), { status: 400 }, String(value));
  for (const value of [null, [], { host: '0.0.0.0' }, { publicUrl, token: bootstrap }]) assert.throws(() => f.app.hosting.createListener(value), { status: 400 });
});

test('updating a central HTTPS origin preserves the listener while replacing only its own public trust', async t => {
  const f = await fixture(t), listener = await f.newListener({ publicUrl }), other = await f.newListener({ publicUrl });
  const owner = await f.login(listener), port = portOf(listener), nextUrl = 'https://new-central.example:44418';
  const headers = { Authorization: `Bearer ${owner.token}` };
  f.app.hosting.updateListener(listener, { publicUrl: nextUrl });
  assert.equal(listener.listening, true); assert.equal(portOf(listener), port, 'origin configuration must not restart the existing listener');
  assert.equal((await rawRequest(listener, '/api/auth/me', { headers: { ...headers, Host: new URL(publicUrl).host, Origin: publicUrl } })).status, 403);
  const current = await rawRequest(listener, '/api/auth/me', { headers: { ...headers, Host: new URL(nextUrl).host, Origin: nextUrl } });
  assert.equal(current.status, 200); assert.equal(current.headers['access-control-allow-origin'], nextUrl);
  assert.equal((await rawRequest(listener, '/api/auth/me', { headers: { ...headers, Origin: publicUrl } })).status, 403);
  assert.equal((await rawRequest(other, '/api/auth/me', { headers: { ...headers, Host: new URL(publicUrl).host, Origin: publicUrl } })).status, 200);
  assert.equal((await rawRequest(other, '/api/auth/me', { headers: { ...headers, Host: new URL(nextUrl).host, Origin: nextUrl } })).status, 403);
  assert.equal((await rawRequest(f.app.server, '/api/auth/me', { headers: { ...headers, Host: new URL(nextUrl).host, Origin: nextUrl } })).status, 403);
  assert.throws(() => f.app.hosting.updateListener(listener, { publicUrl: 'http://new-central.example' }), { status: 400 });
  assert.equal((await rawRequest(listener, '/api/auth/me', { headers: { ...headers, Host: new URL(nextUrl).host, Origin: nextUrl } })).status, 200,
    'invalid public-origin updates must not replace the working policy');
  f.app.hosting.updateListener(listener, { publicUrl: '' });
  assert.equal((await rawRequest(listener, '/api/auth/me', { headers: { ...headers, Origin: 'https://localhost' } })).status, 403);
  assert.equal((await f.request(listener, '/api/auth/me', { token: owner.token })).status, 200);
});

test('central HTTP preserves verified download HEAD and Range and binary image ownership across listeners', async t => {
  const f = await fixture(t), listener = await f.newListener();
  await f.createMember('alice'); await f.createMember('bob');
  const alice = await f.login(listener, 'alice'), bob = await f.login(listener, 'bob');
  const upload = await f.responseJson(await f.request(listener, '/api/attachments', { token: alice.token, method: 'POST', raw: picture,
    headers: { 'Content-Type': 'image/webp' } }));
  const image = await f.request(f.app.server, `/api/attachments/${upload.id}`, { token: alice.token });
  assert.equal(image.status, 200); assert.equal(image.headers.get('content-type'), 'image/webp');
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), picture);
  assert.equal((await f.request(listener, `/api/attachments/${upload.id}`, { token: bob.token })).status, 404);
  const catalog = await f.responseJson(await f.request(listener, '/api/downloads', { token: alice.token }));
  assert.equal(catalog.source, 'server'); assert.equal(catalog.packages[0].url, `/downloads/${packageName}`);
  const head = await f.request(listener, `/downloads/${packageName}`, { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(Number(head.headers.get('content-length')), packageBytes.length); assert.equal((await head.arrayBuffer()).byteLength, 0);
  const range = await f.request(listener, `/downloads/${packageName}`, { headers: { Range: 'bytes=4-13' } });
  assert.equal(range.status, 206); assert.equal(range.headers.get('content-range'), `bytes 4-13/${packageBytes.length}`);
  assert.deepEqual(Buffer.from(await range.arrayBuffer()), packageBytes.subarray(4, 14));
  assert.equal((await f.request(listener, '/downloads/PetPal-0.9.6-Windows-x64.zip')).status, 404);
});

test('Agent stream arrives before completion and cancelling LAN stream leaves the loopback backend available', async t => {
  const entered = deferred(), aborted = deferred(); let bridgeClosed = 0;
  const codex = { async status() { return { available: true, authenticated: true }; },
    run({ onEvent, signal }) { onEvent('delta', { text: 'visible before completion' }); entered.resolve();
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => { aborted.resolve(); reject(signal.reason); }, { once: true })); },
    async close() { bridgeClosed++; } };
  const f = await fixture(t, { codex }), listener = await f.newListener(), owner = await f.login(listener);
  const conversation = await f.responseJson(await f.request(listener, '/api/conversations', { token: owner.token, method: 'POST', body: { mode: 'codex' } }));
  const controller = new AbortController(); t.after(() => controller.abort());
  const response = await f.request(listener, `/api/conversations/${conversation.id}/messages`, { token: owner.token, method: 'POST', body: { content: 'isolated stream' }, signal: controller.signal });
  assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /^text\/event-stream/);
  const reader = response.body.getReader(); let output = '';
  await entered.promise;
  while (!output.includes('visible before completion')) output += new TextDecoder().decode((await reader.read()).value);
  assert.ok(!output.includes('event: done')); controller.abort(); await aborted.promise;
  await until(async () => {
    const current = await f.responseJson(await f.local(`/api/conversations/${conversation.id}`));
    return current.messages.at(-1).status === 'cancelled';
  });
  assert.equal((await f.local('/api/health')).status, 200); assert.equal(bridgeClosed, 0);
});

test('password-session logout is shared across listeners and does not revoke another login or the native pairing connection', async t => {
  const f = await fixture(t), listener = await f.newListener(), first = await f.login(listener), second = await f.login(f.app.server);
  assert.equal((await f.request(listener, '/api/auth/logout', { token: first.token, method: 'POST' })).status, 200);
  assert.equal((await f.request(listener, '/api/auth/me', { token: first.token })).status, 401);
  assert.equal((await f.request(f.app.server, '/api/auth/me', { token: first.token })).status, 401);
  assert.equal((await f.request(listener, '/api/auth/me', { token: second.token })).status, 200);
  assert.equal((await f.local('/api/auth/me')).status, 200);
});

test('closing one central listener keeps the other listener and local backend working', async t => {
  const f = await fixture(t), listener = await f.newListener(), other = await f.newListener(), owner = await f.login(listener);
  const stoppedUrl = urlOf(listener); await closeListener(listener);
  await assert.rejects(fetch(stoppedUrl + '/api/health', { signal: AbortSignal.timeout(1500) }));
  assert.equal((await f.local('/api/state')).status, 200);
  assert.equal((await f.request(other, '/api/auth/me', { token: owner.token })).status, 200);
});

test('application shutdown closes all active central listeners and refuses creation after close', async t => {
  const f = await fixture(t), first = await f.newListener(), second = await f.newListener({ publicUrl });
  const prepared = f.app.hosting.createListener();
  const urls = [urlOf(f.app.server), urlOf(first), urlOf(second)];
  await f.app.close(); await f.app.close();
  assert.equal(f.app.server.listening, false); assert.equal(first.listening, false); assert.equal(second.listening, false);
  assert.throws(() => f.app.hosting.createListener(), { status: 503 });
  for (const url of urls) await assert.rejects(fetch(url + '/api/health', { signal: AbortSignal.timeout(1500) }));
  const lateClosed = new Promise((resolve, reject) => {
    prepared.once('error', reject); prepared.once('close', resolve); prepared.listen(0, '127.0.0.1');
  });
  await lateClosed; assert.equal(prepared.listening, false, 'a pre-created listener cannot resurrect a closed backend');
});

test('central listener rejects proxy-form, CONNECT and unimplemented websocket upgrades', async t => {
  const f = await fixture(t), listener = await f.newListener();
  for (const route of ['http://evil.example/api/health', '//evil.example/api/health']) {
    assert.equal((await rawRequest(listener, route)).status, 400);
  }
  for (const line of ['CONNECT evil.example:443 HTTP/1.1\r\nHost: evil.example\r\n\r\n',
    `GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:${portOf(listener)}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`]) {
    const bytes = await new Promise((resolve, reject) => {
      const socket = net.connect({ host: '127.0.0.1', port: portOf(listener) }); const chunks = [];
      socket.setTimeout(1500, () => socket.destroy(new Error('unsupported upgrade remained open')));
      socket.on('connect', () => socket.write(line)); socket.on('data', chunk => chunks.push(chunk));
      socket.on('end', () => resolve(Buffer.concat(chunks))); socket.on('error', reject);
    });
    assert.ok(!bytes.includes('200 Connection Established') && !bytes.includes('101 Switching Protocols'));
  }
});
