import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import WebSocket, { WebSocketServer } from 'ws';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { APP_PROXY_NO_PROXY, APP_PROXY_WORKER_VARIABLE, setAppProxyRuntime, getAppProxyEnvironment, configureAppProxyWorker, createAppProxyWebSocketAgent } from '../server/app-proxy-context.mjs';
import { isolatedCodexEnvironment } from '../server/codex-config.mjs';
import { openCliEnvironment } from '../server/opencli.mjs';
import { isolatedMusicMcpEnvironment } from '../server/music-mcp.mjs';
import { isolatedComputerUseEnvironment } from '../server/computer-use-mcp.mjs';
import { ncmCliEnvironment, NcmCliManager } from '../server/ncmcli.mjs';
import { createAsrService } from '../server/asr.mjs';

const run = promisify(execFile), user = 'petpal-fixture', password = 'private_generated_proxy_password_123';
const proxyUrl = port => `http://${user}:${password}@127.0.0.1:${port}/`;
const hostEnvironment = { PATH: process.env.PATH || '', SystemRoot: process.env.SystemRoot || '',
  HTTP_PROXY: 'http://untrusted-host-secret@evil.invalid:8080', HTTPS_PROXY: 'https://host.invalid', ALL_PROXY: 'socks5://host.invalid',
  http_proxy: 'http://host.invalid', https_proxy: 'http://host.invalid', all_proxy: 'http://host.invalid',
  NO_PROXY: '*', no_proxy: '*', PETPAL_PRIVATE_APP_PROXY: 'http://host.invalid', OPENAI_API_KEY: 'host-model-secret', NODE_OPTIONS: '--import=host-hook' };
const envFactories = [
  () => isolatedCodexEnvironment({}, path.resolve('fixture-private-codex'), hostEnvironment),
  () => openCliEnvironment(path.resolve('fixture-private-opencli'), hostEnvironment),
  () => isolatedMusicMcpEnvironment(hostEnvironment, { profile: path.resolve('fixture-private-music'), dependenciesDirectory: '/fixture/deps', qqSourceDirectory: '/fixture/qq', config: {}, player: 'qqmusic' }),
  () => isolatedComputerUseEnvironment(hostEnvironment, { profile: 'full', auditLog: '/fixture/audit' }),
  () => ncmCliEnvironment(path.resolve('fixture-private-ncm'), hostEnvironment),
];
function runtime(t, url = proxyUrl(12345)) { setAppProxyRuntime(url); t.after(() => setAppProxyRuntime(null)); }
async function listen(t, server) {
  const sockets = new Set();
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); });
  return server.address().port;
}
async function connectProxy(t, targetPort) {
  const requests = [], tunnels = new Set(), server = http.createServer((_request, response) => response.writeHead(400).end());
  server.on('connect', (request, client, head) => {
    requests.push({ authority: request.url, auth: request.headers['proxy-authorization'] });
    if (request.headers['proxy-authorization'] !== `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`) {
      client.end('HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\n\r\n'); return;
    }
    const upstream = net.connect(targetPort, '127.0.0.1'); tunnels.add(upstream); upstream.on('close', () => tunnels.delete(upstream));
    upstream.on('error', () => client.destroy()); client.on('error', () => upstream.destroy()); client.on('close', () => upstream.destroy());
    upstream.once('connect', () => { client.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) upstream.write(head); client.pipe(upstream).pipe(client); });
  });
  const port = await listen(t, server); t.after(() => { for (const socket of tunnels) socket.destroy(); });
  return { port, requests };
}

test('disabled context excludes every host proxy, loader and model secret from isolated child environments', () => {
  setAppProxyRuntime(null); assert.deepEqual(getAppProxyEnvironment(), {});
  for (const create of envFactories) {
    const env = create();
    for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'NO_PROXY', 'no_proxy', APP_PROXY_WORKER_VARIABLE, 'NODE_OPTIONS', 'OPENAI_API_KEY']) assert.equal(env[key], undefined, key);
  }
});

test('only controlled runtime can supply proxy environment, with explicit local/private bypass', t => {
  runtime(t); const expected = getAppProxyEnvironment();
  assert.equal(expected.HTTP_PROXY, proxyUrl(12345));
  assert.equal(expected.https_proxy, expected.HTTP_PROXY); assert.equal(expected.ALL_PROXY, expected.HTTP_PROXY);
  assert.equal(expected[APP_PROXY_WORKER_VARIABLE], expected.HTTP_PROXY);
  assert.equal(expected.NO_PROXY, expected.no_proxy); assert.equal(expected.NO_PROXY, APP_PROXY_NO_PROXY);
  for (const bypass of ['127.0.0.1', 'localhost', '::1', '.local', '10.0.0.0/8', '192.168.0.0/16']) assert.ok(expected.NO_PROXY.split(',').includes(bypass));
  for (const create of envFactories) {
    const env = create();
    for (const [key, value] of Object.entries(expected)) assert.equal(env[key], value, key);
    assert.equal(env.OPENAI_API_KEY, undefined); assert.equal(env.NODE_OPTIONS, undefined);
    assert.ok(!JSON.stringify(env).includes('evil.invalid'));
  }
  expected.HTTP_PROXY = 'mutated'; assert.equal(getAppProxyEnvironment().HTTP_PROXY, proxyUrl(12345));
});

test('invalid runtime addresses fail safely without changing the last controlled runtime', t => {
  runtime(t);
  for (const url of [undefined, {}, 'http://127.0.0.1:8080', `https://${user}:${password}@127.0.0.1:8080`,
    `http://${user}:${password}@192.168.60.10:8080`, `http://${user}:${password}@127.0.0.1:8080/file`, `http://${user}:${password}@localhost:8080`]) {
    assert.throws(() => setAppProxyRuntime(url), error => error.code === 'PETPAL_PROXY_CONTEXT_INVALID' && !error.message.includes(password));
    assert.equal(getAppProxyEnvironment().HTTP_PROXY, proxyUrl(12345));
  }
  setAppProxyRuntime(null); assert.deepEqual(getAppProxyEnvironment(), {});
});

test('child environment is a launch-time snapshot; disabling does not mutate or kill already running tools', t => {
  runtime(t); const prior = openCliEnvironment(path.resolve('private-opencli'), hostEnvironment);
  setAppProxyRuntime(null);
  assert.equal(prior.HTTP_PROXY, proxyUrl(12345));
  assert.equal(openCliEnvironment(path.resolve('private-opencli'), hostEnvironment).HTTP_PROXY, undefined);
});

test('worker never accepts generic host proxy variables or inherited dedicated properties', async () => {
  assert.equal(await configureAppProxyWorker({ HTTP_PROXY: proxyUrl(12345) }), null);
  assert.equal(await configureAppProxyWorker(Object.create({ [APP_PROXY_WORKER_VARIABLE]: proxyUrl(12345) })), null);
  await assert.rejects(configureAppProxyWorker({ [APP_PROXY_WORKER_VARIABLE]: 'http://host.invalid/secret' }), error => error.code === 'PETPAL_PROXY_CONTEXT_INVALID');
});

test('independent Node worker uses authenticated CONNECT for public targets and directly reaches local gateways', async t => {
  const received = [], target = http.createServer((request, response) => {
    received.push({ path: request.url, proxyAuth: request.headers['proxy-authorization'] }); response.end(request.url === '/public' ? 'proxied' : 'direct');
  });
  const port = await listen(t, target), proxy = await connectProxy(t, port); runtime(t, proxyUrl(proxy.port));
  const moduleUrl = new URL('../server/app-proxy-context.mjs', import.meta.url).href;
  const code = `import {configureAppProxyWorker} from ${JSON.stringify(moduleUrl)};
const network=await configureAppProxyWorker();
try{const proxied=await(await fetch('http://public.example.invalid/public')).text();
const direct=await(await fetch(${JSON.stringify(`http://127.0.0.1:${port}/local`)})).text();
process.stdout.write(JSON.stringify({proxied,direct,enabled:network.status().enabled}));}finally{await network.close();}`;
  const env = openCliEnvironment(path.resolve('fixture-worker'), process.env);
  const result = await run(process.execPath, ['--input-type=module', '-e', code], { env, windowsHide: true, timeout: 10000, maxBuffer: 4096 });
  assert.deepEqual(JSON.parse(result.stdout), { proxied: 'proxied', direct: 'direct', enabled: true });
  assert.equal(result.stderr, ''); assert.equal(proxy.requests.length, 1);
  assert.equal(proxy.requests[0].authority, 'public.example.invalid:80');
  assert.deepEqual(received.map(request => request.path), ['/public', '/local']);
  assert.ok(received.every(request => request.proxyAuth === undefined));
});

test('ASR WebSocket proxy selection always bypasses LAN, local names and IPv6 loopback', t => {
  setAppProxyRuntime(null); assert.equal(createAppProxyWebSocketAgent('wss://public.example.invalid/ws'), undefined);
  runtime(t);
  for (const target of ['ws://127.0.0.1:40000/ws/asr', 'wss://192.168.60.10/ws', 'wss://[::1]/ws', 'wss://host.local/ws', 'wss://[fd00::1]/ws']) assert.equal(createAppProxyWebSocketAgent(target), undefined, target);
  const agent = createAppProxyWebSocketAgent('wss://public.example.invalid/ws');
  assert.ok(agent instanceof HttpsProxyAgent); assert.equal(agent.proxy.hostname, '127.0.0.1'); agent.destroy();
});

test('public WebSocket CONNECT uses local authentication without forwarding it to ASR', async t => {
  let leaked;
  const upstream = http.createServer(), wss = new WebSocketServer({ server: upstream });
  wss.on('connection', (socket, request) => { leaked = request.headers['proxy-authorization']; socket.on('message', value => socket.send(value)); });
  const port = await listen(t, upstream), proxy = await connectProxy(t, port); runtime(t, proxyUrl(proxy.port));
  const agent = createAppProxyWebSocketAgent('ws://asr.example.invalid/ws/asr');
  const socket = new WebSocket('ws://asr.example.invalid/ws/asr', { agent, handshakeTimeout: 2000 });
  t.after(() => { socket.terminate(); agent.destroy(); wss.close(); });
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  const echoed = new Promise((resolve, reject) => { socket.once('message', value => resolve(value.toString())); socket.once('error', reject); });
  socket.send('audio-fixture'); assert.equal(await echoed, 'audio-fixture');
  assert.equal(proxy.requests.length, 1); assert.equal(proxy.requests[0].authority, 'asr.example.invalid:80'); assert.equal(leaked, undefined);
});

class AsrSocket extends EventTarget {
  readyState = 0;
  send() {}
  close() { this.terminate(); }
  terminate() { if (this.readyState === 3) return; this.readyState = 3; const event = new Event('close'); event.code = 1000; this.dispatchEvent(event); }
}
test('ASR service supplies public WSS agent and releases it on cancellation or constructor failure', async t => {
  runtime(t); let destroyed = 0, supplied;
  const auth = { userId: 'fixture-user', sessionHash: 'fixture-session', bootstrap: false };
  const store = { state: {}, async save() {} };
  const service = createAsrService({ store, authorizeSession: () => ({ userId: auth.userId }), webSocketFactory(url, options) {
    assert.equal(url, 'wss://public-asr.example.invalid/ws/asr'); supplied = options;
    const destroy = options.agent.destroy.bind(options.agent); options.agent.destroy = () => { destroyed++; return destroy(); };
    return new AsrSocket();
  } }); t.after(() => service.close());
  await service.configure({ baseUrl: 'https://public-asr.example.invalid' });
  const created = service.create(auth);
  assert.ok(supplied.agent instanceof HttpsProxyAgent); assert.equal(supplied.perMessageDeflate, false); assert.equal(supplied.handshakeTimeout, 8000);
  service.cancel(created.id, auth); assert.equal(destroyed, 1); await service.close(); assert.equal(destroyed, 1);
  const failing = createAsrService({ store: { state: {}, async save() {} }, authorizeSession: () => ({}), webSocketFactory(_url, options) {
    const destroy = options.agent.destroy.bind(options.agent); options.agent.destroy = () => { destroyed++; return destroy(); }; throw new Error(password);
  } }); t.after(() => failing.close());
  await failing.configure({ baseUrl: 'https://public-asr.example.invalid' }); failing.create(auth); assert.equal(destroyed, 2);
});

test('manual ncm-cli launchers never persist temporary proxy credentials or stale runtime', async t => {
  runtime(t); const directory = await mkdtemp(path.join(os.tmpdir(), 'petpal-proxy-ncm-'));
  const manager = new NcmCliManager({ dataDir: directory, env: { PATH: '' }, resolve: async () => null });
  t.after(async () => {
    await manager.close(); assert.equal(path.dirname(directory), os.tmpdir()); assert.match(path.basename(directory), /^petpal-proxy-ncm-/); await rm(directory, { recursive: true, force: true });
  });
  const prepared = await manager.prepare();
  const launcher = await readFile(path.join(path.dirname(prepared.launchers.configure), 'launch.mjs'), 'utf8');
  assert.ok(!launcher.includes(password)); assert.ok(!launcher.includes(APP_PROXY_WORKER_VARIABLE)); assert.ok(!launcher.includes('HTTP_PROXY'));
  assert.equal(ncmCliEnvironment(directory, hostEnvironment).HTTP_PROXY, proxyUrl(12345));
});
