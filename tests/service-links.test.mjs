import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, unlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServiceLinks, normalizeServiceUrl } from '../server/service-links.mjs';

const DP = 'docker-platform', HARBOR = 'api-harbor';
const code = kind => kind === DP ? 'dp-pair-' + 'A'.repeat(32) : 'harbor-connect-' + 'B'.repeat(43);
const connectionId = 'hc-' + 'a'.repeat(64);
const catalog = { schema: 'api-harbor-model-catalog.v1', service: 'api-harbor', models: [{ id: 'luna', protocols: ['responses'], capabilities: { responses: { tools: true, inputModalities: ['text', 'image'], reasoningEfforts: ['max'] } } }], sharedRequestLimit: 3 };
function fixture() {
  const calls = []; const clientId = randomUUID(); let exchange; let broken = null;
  const fetchImpl = async (url, options) => {
    const body = options.body ? JSON.parse(options.body) : null;
    const call = { url, method: options.method, headers: options.headers, body }; calls.push(call);
    if (broken) { const result = broken(call); if (result !== undefined) return result; }
    const suffix = new URL(url).pathname;
    const reply = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
    if (suffix === '/v1/pair') return reply({ schema: 'docker-platform-link.v1', clientId, state: 'pending' });
    if (suffix === '/v1/confirm') return reply({ clientId, state: 'active' });
    if (suffix === '/v1/link') return reply({ state: 'revoked' });
    if (options.method === 'DELETE') return reply({ state: 'revoked', connectionId });
    if (suffix === '/v1/hosts') return reply({ hosts: [] });
    if (suffix.endsWith('/exchange')) exchange = body;
    if (suffix.startsWith('/integrations/')) return reply({ schema: 'service-link-receipt.v1', issuerType: 'api-harbor', issuerInstanceId: 'issuer-1', connectionId, receiverType: 'petpal', receiverInstanceId: exchange.receiverInstanceId, redemptionId: exchange.redemptionId, state: suffix.endsWith('/confirm') ? 'ready' : 'pairing', catalog });
    throw new Error('unexpected request');
  };
  return { calls, fetchImpl, setBroken(value) { broken = value; } };
}
async function setup(t) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'petpal-links-')); const f = fixture();
  let service = await createServiceLinks({ dataDir, fetchImpl: f.fetchImpl });
  t.after(async () => { await service.close(); await rm(dataDir, { recursive: true, force: true }); });
  return { dataDir, f, get service() { return service; }, async reopen() { await service.close(); service = await createServiceLinks({ dataDir, fetchImpl: f.fetchImpl }); return service; } };
}
test('URL policy accepts HTTPS and explicit private HTTP, rejects credentials and external HTTP', () => {
  assert.equal(normalizeServiceUrl('https://example.com/v1/', HARBOR), 'https://example.com');
  assert.equal(normalizeServiceUrl('http://127.0.0.1:9780/', DP), 'http://127.0.0.1:9780');
  assert.equal(normalizeServiceUrl('http://platform:9780/', DP), 'http://platform:9780');
  for (const value of ['http://example.com', 'https://u:p@example.com', 'https://example.com/?token=x', 'http://169.254.169.254', 'https://example.com/#x', 'https://example.com/a%2f..%2fb', 'https://example.com/a\\b']) assert.throws(() => normalizeServiceUrl(value, DP), /SERVICE_LINK_INVALID_URL/);
});
test('DP pairing is backend authenticated, confirmed, encrypted and restart stable', async t => {
  const h = await setup(t);
  const result = await h.service.pair(DP, { baseUrl: 'http://localhost:9780', code: code(DP) });
  assert.equal(result.state, 'ready');
  const { credential, instanceId, clientId } = await h.service.credential(DP);
  assert.match(credential, /^dp-client-[A-Za-z0-9_-]{43}$/);
  assert.equal(h.f.calls[0].body.instanceId, instanceId);
  assert.equal(h.f.calls[0].body.credential, credential);
  assert.equal(h.f.calls[1].headers.Authorization, 'Bearer ' + credential);
  assert.equal(h.f.calls[0].headers.Origin, undefined);
  const serialized = JSON.stringify(await h.service.status());
  assert.ok(!serialized.includes(credential) && !serialized.includes(code(DP)));
  const disk = await readFile(path.join(h.dataDir, 'service-links', 'links.json'), 'utf8');
  assert.ok(!disk.includes(credential) && !disk.includes(code(DP)));
  await h.reopen();
  assert.equal((await h.service.credential(DP)).clientId, clientId);
  assert.equal((await h.service.credential(DP)).credential, credential);
});
test('unknown exchange delivery persists identical operation through restart', async t => {
  const h = await setup(t); h.f.setBroken(call => { if (call.url.endsWith('/v1/pair')) throw new Error('secret-upstream-address'); });
  await assert.rejects(h.service.pair(DP, { baseUrl: 'http://localhost:9780', code: code(DP) }), /SERVICE_LINK_UNAVAILABLE/);
  const original = h.f.calls[0].body;
  await h.reopen(); h.f.setBroken(null); await h.service.refresh(DP);
  assert.deepEqual(h.f.calls[1].body, original);
  assert.equal((await h.service.status()).links[DP].state, 'ready');
});
test('unknown confirmation does not exchange again and never replaces pending identity', async t => {
  const h = await setup(t); h.f.setBroken(call => { if (call.url.endsWith('/v1/confirm')) throw new Error('lost'); });
  await assert.rejects(h.service.pair(DP, { baseUrl: 'http://localhost:9780', code: code(DP) }));
  await assert.rejects(h.service.pair(DP, { baseUrl: 'http://different:9780', code: code(DP) }), /RECOVERY_PENDING/);
  await assert.rejects(h.service.disconnect(DP), /RECOVERY_PENDING/);
  await h.reopen(); h.f.setBroken(null); await h.service.refresh(DP);
  assert.equal(h.f.calls.filter(c => c.url.endsWith('/v1/pair')).length, 1);
});
test('Harbor uses explicit petpal identity, imports filtered capability catalog and confirms', async t => {
  const h = await setup(t);
  const result = await h.service.pair(HARBOR, { baseUrl: 'https://harbor.example/v1', code: code(HARBOR) });
  const exchange = h.f.calls[0].body;
  assert.equal(exchange.receiverType, 'petpal'); assert.match(exchange.credentialHash, /^[0-9a-f]{64}$/);
  assert.equal(exchange.credential, undefined);
  assert.equal(result.state, 'ready'); assert.equal(result.connectionId, connectionId);
  assert.deepEqual(result.catalog.models[0].capabilities.responses.inputModalities, ['text', 'image']);
  assert.equal(result.catalog.models[0].verified, false);
  assert.equal(h.f.calls[1].headers['X-Service-Link-Receiver-Instance'], exchange.receiverInstanceId);
  await h.service.refresh(HARBOR);
  assert.equal(h.f.calls.filter(c => c.url.endsWith('/exchange')).length, 1);
  assert.ok(h.f.calls.some(c => c.url.includes('/receipts/' + exchange.redemptionId)));
});
test('Harbor rejects wrong receiver receipt before confirmation and retains original recovery tuple', async t => {
  const h = await setup(t); h.f.setBroken(call => call.url.endsWith('/exchange') ? new Response(JSON.stringify({ schema: 'service-link-receipt.v1', receiverType: 'codex-remote' })) : undefined);
  await assert.rejects(h.service.pair(HARBOR, { baseUrl: 'https://harbor.example', code: code(HARBOR) }), /INVALID_RECEIPT/);
  assert.equal(h.f.calls.length, 1); assert.equal((await h.service.status()).links[HARBOR].state, 'pending');
});
test('revocation is persisted before delivery and retries DELETE after restart', async t => {
  const h = await setup(t); await h.service.pair(DP, { baseUrl: 'http://localhost:9780', code: code(DP) });
  h.f.setBroken(call => { if (call.method === 'DELETE') throw new Error('offline'); });
  await assert.rejects(h.service.disconnect(DP));
  assert.equal((await h.service.status()).links[DP].state, 'revoking');
  await assert.rejects(h.service.request(DP, '/v1/hosts'), /NOT_READY/);
  await h.reopen(); h.f.setBroken(null); assert.equal((await h.service.refresh(DP)).state, 'revoked');
});
test('only a confirmed revocation permits a fresh platform registration identity', async t => {
  const h = await setup(t); await h.service.pair(DP, { baseUrl: 'http://localhost:9780', code: code(DP) });
  const original = h.f.calls[0].body;
  h.f.setBroken(call => call.method === 'DELETE' ? new Response('{}') : undefined);
  await assert.rejects(h.service.disconnect(DP), /INVALID_RECEIPT/);
  assert.equal((await h.service.status()).links[DP].state, 'revoking');
  h.f.setBroken(null); await h.service.refresh(DP);
  await h.service.pair(DP, { baseUrl: 'http://localhost:9780', code: code(DP) });
  const newPair = h.f.calls.filter(call => call.url.endsWith('/v1/pair')).at(-1).body;
  assert.notEqual(newPair.instanceId, original.instanceId); assert.notEqual(newPair.credential, original.credential);
});
test('Harbor permanent revocation proof must bind issuer, receiver, original operation and connection', async t => {
  const h = await setup(t); await h.service.pair(HARBOR, { baseUrl: 'https://harbor.example', code: code(HARBOR) });
  const exchange = h.f.calls[0].body;
  const proof = { schema: 'service-link-revocation.v1', issuerType: 'api-harbor', issuerInstanceId: 'issuer-1', connectionId, receiverType: 'petpal', receiverInstanceId: exchange.receiverInstanceId, redemptionId: exchange.redemptionId, state: 'revoked' };
  h.f.setBroken(() => new Response(JSON.stringify({ error: { code: 'service_link_connection_revoked', details: { ...proof, redemptionId: 'wrong' } } }), { status: 401 }));
  await assert.rejects(h.service.refresh(HARBOR)); assert.equal((await h.service.status()).links[HARBOR].state, 'offline');
  h.f.setBroken(() => new Response(JSON.stringify({ error: { code: 'service_link_connection_revoked', details: proof } }), { status: 401 }));
  await assert.rejects(h.service.refresh(HARBOR)); assert.equal((await h.service.status()).links[HARBOR].state, 'revoked');
});
test('missing master key fails closed without creating replacement identity', async t => {
  const h = await setup(t); await h.service.close();
  await unlink(path.join(h.dataDir, 'service-links', 'master.key'));
  await assert.rejects(createServiceLinks({ dataDir: h.dataDir }), /STORAGE_RECOVERY_REQUIRED/);
  await assert.rejects(readFile(path.join(h.dataDir, 'service-links', 'master.key')), { code: 'ENOENT' });
});
test('authenticated ciphertext tampering cannot reset or reveal the saved connection', async t => {
  const h = await setup(t); await h.service.close();
  const filename = path.join(h.dataDir, 'service-links', 'links.json');
  const envelope = JSON.parse(await readFile(filename, 'utf8'));
  const encrypted = Buffer.from(envelope.ciphertext, 'base64'); encrypted[0] ^= 1;
  envelope.ciphertext = encrypted.toString('base64'); await writeFile(filename, JSON.stringify(envelope));
  await assert.rejects(createServiceLinks({ dataDir: h.dataDir }), /STORAGE_RECOVERY_REQUIRED/);
});
test('retained key without encrypted state requires recovery rather than a new instance', async t => {
  const h = await setup(t); await h.service.close(); await unlink(path.join(h.dataDir, 'service-links', 'links.json'));
  await assert.rejects(createServiceLinks({ dataDir: h.dataDir }), /STORAGE_RECOVERY_REQUIRED/);
});
test('platform request validates the expected client before sending and after awaiting response', async t => {
  const h = await setup(t); await h.service.pair(DP, { baseUrl: 'http://localhost:9780', code: code(DP) });
  const { clientId } = await h.service.credential(DP); const count = h.f.calls.length;
  await assert.rejects(h.service.request(DP, '/v1/hosts', { expectedClientId: randomUUID() }), /cloud_docker_identity_changed/);
  assert.equal(h.f.calls.length, count);
  let finish;
  h.f.setBroken(call => call.url.endsWith('/v1/hosts') ? new Promise(resolve => { finish = () => resolve(new Response('{"hosts":[]}')); }) : undefined);
  const pending = h.service.request(DP, '/v1/hosts', { expectedClientId: clientId });
  while (!finish) await new Promise(resolve => setTimeout(resolve, 1));
  await h.service.disconnect(DP); finish();
  await assert.rejects(pending, /cloud_docker_identity_changed/);
});
test('oversize and malformed responses are sanitized without public upstream diagnostics', async t => {
  const h = await setup(t); h.f.setBroken(() => new Response('secret-not-json'));
  await assert.rejects(h.service.pair(DP, { baseUrl: 'http://localhost:9780', code: code(DP) }), /INVALID_RESPONSE/);
  assert.ok(!JSON.stringify(await h.service.status()).includes('secret-not-json'));
  h.f.setBroken(() => new Response('{}', { headers: { 'content-length': String(5 * 1024 * 1024) } }));
  await assert.rejects(h.service.refresh(DP), /INVALID_RESPONSE/);
});
test('private request cannot send credential to another origin or traversal endpoint', async t => {
  const h = await setup(t); await h.service.pair(DP, { baseUrl: 'http://localhost:9780', code: code(DP) });
  for (const suffix of ['https://evil.example', '//evil.example', '/v1/../bad', '/v1/%2e%2e/bad']) await assert.rejects(h.service.request(DP, suffix), /INVALID_PATH/);
  assert.deepEqual(await h.service.request(DP, '/v1/hosts'), { hosts: [] });
});
test('fixed Docker protocol error codes remain usable without reflecting diagnostic bodies', async t => {
  const h = await setup(t); await h.service.pair(DP, { baseUrl: 'http://localhost:9780', code: code(DP) });
  h.f.setBroken(() => new Response(JSON.stringify({ errorCode: 'file_exists', message: 'secret native path' }), { status: 409 }));
  await assert.rejects(h.service.request(DP, '/v1/projects'), error => error.code === 'file_exists' && error.message === 'file_exists');
});
test('close aborts an in-flight request and never saves a late result', async t => {
  const h = await setup(t); let observed;
  h.f.setBroken(call => { if (call.url.endsWith('/v1/pair')) return new Promise(() => {}); });
  const fetchImpl = (url, options) => new Promise((resolve, reject) => { observed = options.signal; options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }); });
  const otherDir = await mkdtemp(path.join(os.tmpdir(), 'petpal-links-close-'));
  const other = await createServiceLinks({ dataDir: otherDir, fetchImpl });
  const pending = other.pair(DP, { baseUrl: 'http://localhost:9780', code: code(DP) });
  while (!observed) await new Promise(resolve => setTimeout(resolve, 1));
  const handled = assert.rejects(pending, /SERVICE_LINK_CLOSED/);
  await other.close(); await handled; assert.equal(observed.aborted, true);
  await rm(otherDir, { recursive: true, force: true });
});
