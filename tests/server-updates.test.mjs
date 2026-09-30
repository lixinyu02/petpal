import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { listenFixture } from './helpers/loopback.mjs';
import { createPetServer } from '../server/app.mjs';
import { createUpdateService, verifyUpdateEnvelope, UPDATE_MANIFEST_LIMIT } from '../server/updates.mjs';

const keys = generateKeyPairSync('ed25519'), pem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const epoch = Date.parse('2026-09-30T12:00:00Z'), repository = 'lixinyu02/petpal';
const manifestUrl = 'https://updates.example.test:44318/updates/stable/petpal-update.json';
const asset = { id: 'windows-0.10.0', target: 'windows-x64', version: '0.10.0', url: 'https://updates.example.test:44318/updates/stable/v0.10.0/PetPal.exe', sha256: 'a'.repeat(64), bytes: 1024, notes: '服务器发布', format: 'portable-exe' };
const githubAsset = { ...asset, url: `https://github.com/${repository}/releases/download/v0.10.0/PetPal.exe` };
const query = { target: 'windows-x64', currentVersion: '0.9.1' };
const payload = (overrides = {}) => ({ product: 'petpal', channel: 'stable', sequence: 1, issuedAt: '2026-09-30T11:00:00Z', expiresAt: '2026-10-30T12:00:00Z', releases: [{ ...asset }], ...overrides });
function signed(value = payload(), key = keys.privateKey) {
  const bytes = Buffer.from(JSON.stringify(value));
  return Buffer.from(JSON.stringify({ schemaVersion: 1, payload: bytes.toString('base64url'), signature: sign(null, bytes, key).toString('base64url') }));
}
const verify = bytes => verifyUpdateEnvelope(bytes, { source: 'server', manifestUrl, repository, publicKey: pem, now: epoch });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function service(t, options = {}) {
  const store = options.store ?? { state: {}, async save() {} };
  const updates = createUpdateService({ store, now: () => epoch, fetchImpl: async () => new Response(signed()), ...options });
  t.after(() => updates.close());
  await updates.configure({ source: 'server', manifestUrl, publicKey: pem });
  return { updates, store };
}

test('server signed manifests authenticate all four platforms and Ubuntu architectures', () => {
  const releases = [['windows-x64', 'portable-exe', 'PetPal.exe'], ['ubuntu-x64', 'tar.gz', 'PetPal-x64.tar.gz'], ['ubuntu-arm64', 'tar.gz', 'PetPal-arm64.tar.gz'], ['android', 'apk', 'PetPal.apk'], ['web', 'web-zip', 'PetPal-web.zip']].map(([target, format, name]) => ({ ...asset, id: target, target, format, url: asset.url.replace('PetPal.exe', name), ...(target === 'android' ? { versionCode: 10 } : {}) }));
  assert.deepEqual(verify(signed(payload({ releases }))).releases, releases);
  for (const url of [asset.url.replace('/stable/', '/other/'), asset.url.replace('updates.example.test', 'foreign.example.test'), asset.url.replace('/v0.10.0/', '/x/../v0.10.0/'), asset.url + '?token=private']) assert.throws(() => verify(signed(payload({ releases: [{ ...asset, url }] }))), { status: 502 });
  const tampered = JSON.parse(signed()); tampered.payload = Buffer.from(JSON.stringify(payload({ sequence: 99 }))).toString('base64url');
  assert.throws(() => verify(Buffer.from(JSON.stringify(tampered))), /签名/);
  assert.throws(() => verify(signed(payload(), generateKeyPairSync('ed25519').privateKey)), /签名/);
  assert.throws(() => verify(signed(payload({ expiresAt: '2026-09-30T11:30:00Z' }))), /过期/);
  assert.throws(() => verifyUpdateEnvelope(signed(), { source: 'unknown', publicKey: pem, now: epoch }), { status: 400 });
});

test('legacy GitHub configuration migrates without revision/trust changes and old envelopes retain GitHub validation', async t => {
  const revision = randomUUID(), trust = { ['b'.repeat(64) + ':stable']: { sequence: 8, payloadHash: 'c'.repeat(64) } };
  const store = { state: { updateConfig: { repository, publicKey: pem, revision }, updateTrustState: structuredClone(trust) }, async save() {} };
  let requested;
  const updates = createUpdateService({ store, now: () => epoch, fetchImpl: async url => { requested = url; return new Response(signed(payload({ releases: [githubAsset] }))); } });
  t.after(() => updates.close());
  assert.equal(updates.statusConfig().source, 'github'); assert.equal(updates.statusConfig().manifestUrl, ''); assert.equal(updates.statusConfig().revision, revision);
  assert.deepEqual(store.state.updateTrustState, trust);
  const checked = await updates.check(query);
  assert.equal(requested, `https://github.com/${repository}/releases/latest/download/petpal-update.json`);
  assert.equal(checked.source, 'github'); assert.equal(checked.release.source, 'github'); assert.equal(checked.release.repository, repository); assert.equal('manifestUrl' in checked.release, false);
  assert.equal(verifyUpdateEnvelope(signed(payload({ releases: [githubAsset] })), { repository, publicKey: pem, now: epoch }).releases[0].url, githubAsset.url);
  assert.throws(() => verifyUpdateEnvelope(signed(), { repository, publicKey: pem, now: epoch }), /发布项/);
});

test('server config validates before saving and binds checked release provenance to source, URL and revision', async t => {
  const calls = [];
  const { updates, store } = await service(t, { fetchImpl: async (url, options) => { calls.push({ url, options }); return new Response(signed()); } });
  const original = updates.statusConfig();
  for (const patch of [{ source: 'invalid' }, { manifestUrl: '' }, { manifestUrl: 'http://updates.example.test/updates/petpal-update.json' }, { manifestUrl: manifestUrl + '?' }, { manifestUrl: 42 }, { source: 'github', manifestUrl: 'bad-url' }, { endpoint: manifestUrl }]) await assert.rejects(updates.configure(patch), { status: 400 });
  assert.deepEqual(updates.statusConfig(), original);
  const result = await updates.check(query), release = await updates.resolveRelease(asset.id, query);
  assert.equal(result.source, 'server'); assert.equal(result.manifestUrl, manifestUrl); assert.equal(release.source, 'server'); assert.equal(release.manifestUrl, manifestUrl); assert.equal(release.repository, repository);
  for (const call of calls) { assert.equal(call.url, manifestUrl); assert.equal(call.options.redirect, 'manual'); assert.equal(call.options.credentials, 'omit'); assert.deepEqual(Object.keys(call.options.headers).sort(), ['Accept', 'Accept-Encoding', 'User-Agent']); assert.equal(call.options.headers['Accept-Encoding'], 'identity'); }
  const trust = structuredClone(store.state.updateTrustState), next = await updates.configure({ manifestUrl: manifestUrl.replace('/stable/', '/other/'), revision: original.revision });
  assert.notEqual(next.revision, original.revision); assert.deepEqual(store.state.updateTrustState, trust);
  const count = calls.length;
  await assert.rejects(updates.resolveRelease(asset.id, query), { status: 409 }); assert.equal(calls.length, count);
  await assert.rejects(updates.configure({ source: 'github', revision: original.revision }), { status: 409 });
  await updates.configure({ source: 'github', revision: next.revision }); assert.deepEqual(store.state.updateTrustState, trust);
});

test('server manifest requests accept safe child redirects and reject raw normalization, foreign and malformed destinations', async t => {
  const calls = [];
  const valid = await service(t, { fetchImpl: async (url, options) => { calls.push({ url, options }); return calls.length === 1 ? new Response(null, { status: 302, headers: { location: 'archive/petpal-update.json' } }) : new Response(signed()); } });
  assert.equal((await valid.updates.check(query)).available, true);
  assert.equal(calls[1].url, manifestUrl.replace('petpal-update.json', 'archive/petpal-update.json'));
  for (const location of ['https://foreign.example.test/updates/stable/petpal-update.json', manifestUrl.replace(':44318', ':44319'), '/updates/other/petpal-update.json', '/updates/stable/../stable/petpal-update.json', '%2e%2e/petpal-update.json', '%252e%252e/petpal-update.json', '//updates.example.test:44318/updates/stable/petpal-update.json', './petpal-update.json', 'other.json', 'petpal-update.json?', 'petpal-update.json#']) {
    let count = 0, canceled = false;
    const { updates, store } = await service(t, { fetchImpl: async () => { count++; return new Response(new ReadableStream({ cancel() { canceled = true; } }), { status: 302, headers: { location } }); } });
    await assert.rejects(updates.check(query), { status: 502 }); assert.equal(count, 1); assert.equal(canceled, true); assert.deepEqual(store.state.updateTrustState, {});
  }
});

test('server manifest loops, hidden transport redirects, HTTP errors and oversized bodies never commit trust', async t => {
  for (const fetchImpl of [async url => new Response(null, { status: 302, headers: { location: url } }), async () => { const r = new Response(signed()); Object.defineProperty(r, 'redirected', { value: true }); return r; }, async () => { const r = new Response(signed()); Object.defineProperty(r, 'url', { value: 'https://foreign.example.test/petpal-update.json' }); return r; }, async () => new Response(null, { status: 404 }), async () => new Response(null, { status: 503 }), async () => new Response(Buffer.alloc(UPDATE_MANIFEST_LIMIT + 1)), async () => new Response(signed(), { headers: { 'content-length': '2' } })]) {
    const { updates, store } = await service(t, { fetchImpl });
    await assert.rejects(updates.check(query), error => [404, 502].includes(error.status)); assert.deepEqual(store.state.updateTrustState, {});
  }
});

test('one public-key/channel high-water mark persists across GitHub/server/URL changes and restart', async t => {
  let manifest = signed(payload({ sequence: 7, releases: [githubAsset] }));
  const store = { state: {}, async save() {} }, fetchImpl = async () => new Response(manifest);
  const updates = createUpdateService({ store, now: () => epoch, fetchImpl }); t.after(() => updates.close());
  await updates.configure({ publicKey: pem }); await updates.check(query);
  const trusted = Object.keys(store.state.updateTrustState)[0];
  await updates.configure({ source: 'server', manifestUrl });
  manifest = signed(payload({ sequence: 6 })); await assert.rejects(updates.check(query), /回退/);
  manifest = signed(payload({ sequence: 7 })); await assert.rejects(updates.check(query), /同序号/);
  manifest = signed(payload({ sequence: 8 })); await updates.check(query);
  assert.deepEqual(Object.keys(store.state.updateTrustState), [trusted]);
  const restarted = createUpdateService({ store: { state: structuredClone(store.state), async save() {} }, now: () => epoch, fetchImpl }); t.after(() => restarted.close());
  await restarted.configure({ publicKey: '', source: 'github' }); await restarted.configure({ publicKey: pem });
  manifest = signed(payload({ sequence: 7, releases: [githubAsset] })); await assert.rejects(restarted.check(query), /回退/);
  await restarted.configure({ source: 'server', manifestUrl: manifestUrl.replace('/stable/', '/other/') });
  manifest = signed(payload({ sequence: 7, releases: [{ ...asset, url: asset.url.replace('/stable/', '/other/') }] })); await assert.rejects(restarted.check(query), /回退/);
});

test('server check cancellation, timeout and late fetch abort cancel bodies and preserve trust', async t => {
  for (const timeout of [false, true]) {
    const entered = deferred(); let canceled = false;
    const { updates, store } = await service(t, { timeoutMs: timeout ? 20 : 15000, fetchImpl: async () => new Response(new ReadableStream({ start() { entered.resolve(); }, cancel() { canceled = true; } })) });
    const controller = new AbortController(), pending = updates.check({ ...query, signal: controller.signal });
    const rejected = assert.rejects(pending, error => timeout ? error.status === 504 : error.name === 'AbortError');
    await entered.promise; if (!timeout) controller.abort(); await rejected;
    assert.equal(canceled, true); assert.deepEqual(store.state.updateTrustState, {});
  }
  const entered = deferred(), release = deferred(); let canceled = false;
  const { updates, store } = await service(t, { fetchImpl: async () => { entered.resolve(); await release.promise; return new Response(new ReadableStream({ cancel() { canceled = true; } })); } });
  const pending = updates.check(query), rejected = assert.rejects(pending, { status: 409 });
  await entered.promise; await updates.configure({ source: 'github' }); release.resolve(); await rejected;
  assert.equal(canceled, true); assert.deepEqual(store.state.updateTrustState, {});
});

test('independent GitHub and server signing keys keep separate durable high-water marks when switching sources', async t => {
  const serverKeys = generateKeyPairSync('ed25519'), serverPem = serverKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  let manifest = signed(payload({ sequence: 20, releases: [githubAsset] }));
  const store = { state: {}, async save() {} }, fetchImpl = async () => new Response(manifest);
  const updates = createUpdateService({ store, now: () => epoch, fetchImpl }); t.after(() => updates.close());
  await updates.configure({ publicKey: pem }); await updates.check(query);
  const githubTrust = structuredClone(store.state.updateTrustState);
  await updates.configure({ source: 'server', manifestUrl, publicKey: serverPem });
  manifest = signed(payload({ sequence: 1 }), serverKeys.privateKey); assert.equal((await updates.check(query)).available, true);
  assert.equal(Object.keys(store.state.updateTrustState).length, 2);
  for (const [key, value] of Object.entries(githubTrust)) assert.deepEqual(store.state.updateTrustState[key], value);
  await updates.configure({ source: 'github', publicKey: pem }); manifest = signed(payload({ sequence: 20, releases: [githubAsset] }));
  assert.equal((await updates.check(query)).available, true);
  manifest = signed(payload({ sequence: 19, releases: [githubAsset] })); await assert.rejects(updates.check(query), /回退/);
  await updates.configure({ source: 'server', publicKey: serverPem }); manifest = signed(payload({ sequence: 1 }), serverKeys.privateKey);
  assert.equal((await updates.check(query)).available, true);
  const restarted = createUpdateService({ store: { state: structuredClone(store.state), async save() {} }, now: () => epoch, fetchImpl }); t.after(() => restarted.close());
  manifest = signed(payload({ sequence: 1, releases: [{ ...asset, notes: 'different server payload' }] }), serverKeys.privateKey);
  await assert.rejects(restarted.check(query), /同序号/);
});

test('failed source save restores configuration without clearing trusted high-water marks', async t => {
  let fail = false;
  const store = { state: {}, async save() { if (fail) throw new Error('isolated disk failure'); } };
  const { updates } = await service(t, { store }); await updates.check(query);
  const before = updates.statusConfig(), trust = structuredClone(store.state.updateTrustState); fail = true;
  await assert.rejects(updates.configure({ source: 'github' }), /disk failure/);
  assert.deepEqual(updates.statusConfig(), before); assert.deepEqual(store.state.updateTrustState, trust);
  await assert.rejects(updates.resolveRelease(asset.id, query), { status: 409 });
});

test('server source API requires login for checks and owner for source settings; logout drains the check', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-server-updates-'));
  const entered = deferred(); let stalled = false, canceled = false;
  const app = await createPetServer({ dataDir: directory, token: 'server-update-fixture-owner', codex: { async status() { return { available: false }; }, async close() {} }, desktopTools: { async close() {} }, updatesOptions: { now: () => epoch, fetchImpl: async () => stalled ? new Response(new ReadableStream({ start() { entered.resolve(); }, cancel() { canceled = true; } })) : new Response(signed()) } });
  await listenFixture(app.server);
  const request = (route, { token = app.token, method = 'GET', body } = {}) => fetch(`http://127.0.0.1:${app.server.address().port}/api${route}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  t.after(async () => { await app.close(); assert.ok(directory.startsWith(path.join(tmpdir(), 'petpal-server-updates-'))); await rm(directory, { recursive: true, force: true }); });
  assert.equal((await request('/updates/check', { token: '', method: 'POST', body: query })).status, 401);
  await request('/admin/users', { method: 'POST', body: { username: 'update-member', password: 'isolated-update-password' } });
  const user = await (await request('/auth/login', { method: 'POST', body: { username: 'update-member', password: 'isolated-update-password' } })).json();
  assert.equal((await request('/updates/config', { token: user.token, method: 'PATCH', body: { source: 'server', manifestUrl } })).status, 403);
  const configured = await (await request('/updates/config', { method: 'PATCH', body: { source: 'server', manifestUrl, publicKey: pem } })).json();
  assert.equal(configured.source, 'server'); assert.equal(configured.manifestUrl, manifestUrl);
  const checked = await (await request('/updates/check', { token: user.token, method: 'POST', body: query })).json();
  assert.equal(checked.available, true); assert.equal(checked.release.source, 'server'); assert.equal(checked.release.manifestUrl, manifestUrl);
  assert.equal((await request('/updates/check', { method: 'POST', body: { ...query, url: 'https://foreign.example.test' } })).status, 400);
  const stored = JSON.parse(await readFile(path.join(directory, 'state.json'), 'utf8')).updateConfig; assert.equal(stored.source, 'server'); assert.equal(stored.manifestUrl, manifestUrl);
  stalled = true;
  const pending = request('/updates/check', { token: user.token, method: 'POST', body: query });
  await entered.promise; assert.equal((await request('/auth/logout', { token: user.token, method: 'POST' })).status, 200); assert.equal(canceled, true); assert.equal((await pending).status, 409);
});
