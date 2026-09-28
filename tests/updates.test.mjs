import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPetServer } from '../server/app.mjs';
import { createUpdateService, compareStableVersions, verifyUpdateEnvelope, validateGitHubAssetUrl, validateGitHubRedirect, UPDATE_MANIFEST_LIMIT, UPDATE_FILE_LIMIT } from '../server/updates.mjs';

const keys = generateKeyPairSync('ed25519');
const pem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const epoch = Date.parse('2026-09-28T12:00:00Z');
const repository = 'lixinyu02/petpal';
const asset = { id: 'windows-0.7.0', target: 'windows-x64', version: '0.7.0', url: `https://github.com/${repository}/releases/download/v0.7.0/PetPal.exe`, sha256: 'a'.repeat(64), bytes: 1024, notes: '更新说明', format: 'portable-exe' };
const query = { target: 'windows-x64', currentVersion: '0.6.0' };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const payload = overrides => ({ product: 'petpal', channel: 'stable', sequence: 1, issuedAt: '2026-09-28T11:00:00Z', expiresAt: '2026-10-28T12:00:00Z', releases: [{ ...asset }], ...overrides });
function signed(value = payload(), key = keys.privateKey) {
  const bytes = Buffer.from(JSON.stringify(value));
  return Buffer.from(JSON.stringify({ schemaVersion: 1, payload: bytes.toString('base64url'), signature: sign(null, bytes, key).toString('base64url') }));
}
function verify(bytes) { return verifyUpdateEnvelope(bytes, { repository, publicKey: pem, now: epoch }); }
async function service(t, options = {}) {
  const store = options.store ?? { state: {}, async save() {} };
  const updates = createUpdateService({ store, now: () => epoch, fetchImpl: async () => new Response(signed()), ...options });
  await updates.configure({ publicKey: pem });
  t.after(() => updates.close());
  return { updates, store };
}

test('stable versions compare numerically and reject ambiguous or nonstable values', () => {
  assert.equal(compareStableVersions('0.10.0', '0.9.99'), 1);
  assert.equal(compareStableVersions('1.0.0', '1.0.0'), 0);
  assert.equal(compareStableVersions('0.6.9', '1.0.0'), -1);
  for (const version of ['v1.2.3', '01.2.3', '1.2', '1.2.3-beta.1', '1.2.3+build', '9007199254740992.0.0', '', {}, ['1.2.3']]) assert.throws(() => compareStableVersions(version, '0.6.0'));
});

test('only repository-owned GitHub assets and official bounded redirect destinations validate', () => {
  assert.equal(validateGitHubAssetUrl(asset.url, repository), asset.url);
  const latest = `https://github.com/${repository}/releases/latest/download/petpal-update.json`;
  const cdn = 'https://release-assets.githubusercontent.com/github-production-release-asset/123/abc?sig=fixture';
  assert.equal(validateGitHubRedirect(latest, asset.url, repository), asset.url);
  assert.equal(validateGitHubRedirect(asset.url, cdn, repository), cdn);
  for (const invalid of ['http://github.com/lixinyu02/petpal/releases/download/v1/app.exe', asset.url.replace(repository, 'other/repo'), asset.url + '?key=x', asset.url + '#', asset.url.replace('github.com', 'user@github.com'), asset.url.replace('/PetPal.exe', '/%2Fescape'), asset.url.replace('github.com', 'github.com.evil.test'), asset.url.replace('github.com', 'github.com:444')]) assert.throws(() => validateGitHubAssetUrl(invalid, repository));
  for (const destination of ['https://evil.test/payload', 'http://release-assets.githubusercontent.com/github-production-release-asset/1/a', asset.url.replace(repository, 'other/repo'), 'https://release-assets.githubusercontent.com/unrelated', 'https://api.github.com/repos/lixinyu02/petpal']) assert.throws(() => validateGitHubRedirect(latest, destination, repository));
  assert.throws(() => validateGitHubRedirect(cdn, asset.url, repository));
});

test('Ed25519 verification authenticates exact payload bytes before schema parsing', () => {
  assert.equal(verify(signed()).releases[0].version, '0.7.0');
  const other = generateKeyPairSync('ed25519');
  assert.throws(() => verify(signed(payload(), other.privateKey)), /签名/);
  const envelope = JSON.parse(signed());
  envelope.payload = Buffer.from(JSON.stringify(payload({ sequence: 20 }))).toString('base64url');
  assert.throws(() => verify(Buffer.from(JSON.stringify(envelope))), /签名/);
  envelope.signature = 'a'.repeat(87);
  assert.throws(() => verify(Buffer.from(JSON.stringify(envelope))), /编码/);
  assert.throws(() => verify(Buffer.from('{')), /JSON/);
  assert.throws(() => verify(Buffer.alloc(UPDATE_MANIFEST_LIMIT + 1)), /128/);
});

test('manifest rejects expired/future dates, duplicate targets and malformed release metadata', () => {
  for (const change of [{ expiresAt: '2026-09-28T11:59:59Z' }, { issuedAt: '2026-09-29T12:00:00Z' }, { issuedAt: '2026-02-30T12:00:00Z' }, { sequence: 0 }, { sequence: 1.2 }, { product: 'other' }, { channel: 'beta' }, { releases: [asset, { ...asset, id: 'another' }] }, { unexpected: true }]) assert.throws(() => verify(signed(payload(change))));
  for (const change of [{ bytes: UPDATE_FILE_LIMIT + 1 }, { bytes: 0 }, { bytes: 1.5 }, { sha256: ['a'.repeat(64)] }, { target: ['windows-x64'] }, { version: '0.7.0-beta' }, { format: 'apk' }, { versionCode: 7 }, { url: asset.url.replace(repository, 'foreign/repo') }, { command: 'run' }]) assert.throws(() => verify(signed(payload({ releases: [{ ...asset, ...change }] }))));
  const android = { ...asset, id: 'android-0.7.0', target: 'android', format: 'apk' };
  assert.throws(() => verify(signed(payload({ releases: [android] }))));
  assert.equal(verify(signed(payload({ releases: [{ ...android, versionCode: 7 }] }))).releases[0].versionCode, 7);
});

test('an empty key is disabled without network access; key/config patches are bounded and immutable', async t => {
  const store = { state: {}, async save() {} }; let calls = 0;
  const updates = createUpdateService({ store, fetchImpl: async () => { calls++; throw new Error('should not fetch'); } });
  t.after(() => updates.close());
  const result = await updates.check(query);
  assert.equal(result.configured, false); assert.equal(result.available, false); assert.equal(result.release, null); assert.equal(calls, 0);
  const config = updates.statusConfig(); config.repository = 'mutated/repo';
  assert.equal(updates.statusConfig().repository, repository);
  for (const patch of [{ repository: 'https://github.com/owner/repo' }, { publicKey: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }) }, { publicKey: generateKeyPairSync('rsa', { modulusLength: 1024 }).publicKey.export({ type: 'spki', format: 'pem' }) }, { url: 'https://evil.test' }, { revision: 'stale', publicKey: pem }]) await assert.rejects(updates.configure(patch));
  assert.equal(updates.statusConfig().publicKey, '');
});

test('checks traverse only GitHub redirects and never transmit account credentials', async t => {
  const calls = [];
  const { updates } = await service(t, { fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) return new Response(null, { status: 302, headers: { location: asset.url } });
    if (calls.length === 2) return new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/github-production-release-asset/123/manifest?sig=fixture' } });
    return new Response(signed());
  } });
  const result = await updates.check(query);
  assert.equal(result.available, true); assert.equal(calls.length, 3);
  for (const { options } of calls) { assert.equal(options.redirect, 'manual'); assert.equal(options.credentials, 'omit'); assert.deepEqual(Object.keys(options.headers).sort(), ['Accept', 'User-Agent']); }
  assert.equal(result.release.revision, updates.statusConfig().revision);
  assert.equal(result.release.manifestHash, createHash('sha256').update(Buffer.from(JSON.parse(signed()).payload, 'base64url')).digest('hex'));
});

test('404, foreign redirects, redirect loops and silently redirected transports fail closed', async t => {
  for (const fetchImpl of [async () => new Response(null, { status: 404 }), async () => new Response(null, { status: 302, headers: { location: 'https://evil.test/manifest' } }), async url => new Response(null, { status: 302, headers: { location: url } }), async () => { const value = new Response(signed()); Object.defineProperty(value, 'redirected', { value: true }); return value; }]) {
    const { updates, store } = await service(t, { fetchImpl });
    await assert.rejects(updates.check(query), error => [404, 502].includes(error.status));
    assert.deepEqual(store.state.updateTrustState, {});
  }
});

test('actual streamed body, not only Content-Length, enforces the manifest byte limit', async t => {
  for (const makeResponse of [() => new Response(Buffer.alloc(UPDATE_MANIFEST_LIMIT + 1)), () => new Response(Buffer.alloc(UPDATE_MANIFEST_LIMIT + 1), { headers: { 'content-length': '10' } }), () => new Response('short', { headers: { 'content-length': String(UPDATE_MANIFEST_LIMIT + 1) } }), () => new Response(signed(), { headers: { 'content-length': '10' } })]) {
    const { updates } = await service(t, { fetchImpl: async () => makeResponse() });
    await assert.rejects(updates.check(query), error => error.status === 502);
  }
});

test('sequence/hash anti-rollback survives restart, clear key and source change with the same key', async t => {
  let manifest = signed(payload({ sequence: 5 }));
  const fetchImpl = async () => new Response(manifest);
  const { updates, store } = await service(t, { fetchImpl });
  await updates.check(query);
  const restarted = await service(t, { store: { state: structuredClone(store.state), async save() {} }, fetchImpl });
  manifest = signed(payload({ sequence: 4 }));
  await assert.rejects(restarted.updates.check(query), /回退/);
  manifest = signed(payload({ sequence: 5, releases: [{ ...asset, notes: 'different bytes' }] }));
  await assert.rejects(restarted.updates.check(query), /同序号/);
  await restarted.updates.configure({ publicKey: '' }); await restarted.updates.configure({ publicKey: pem, repository: 'different/repo' });
  manifest = signed(payload({ sequence: 4, releases: [{ ...asset, url: asset.url.replace(repository, 'different/repo') }] }));
  await assert.rejects(restarted.updates.check(query), /回退/);
});

test('native resolution rechecks signature, expiry, current version and configuration revision', async t => {
  let manifest = signed(), currentTime = epoch;
  const { updates } = await service(t, { fetchImpl: async () => new Response(manifest), now: () => currentTime });
  await assert.rejects(updates.resolveRelease(asset.id, query), /未检查/);
  const result = await updates.check(query);
  assert.equal((await updates.resolveRelease(asset.id, query)).manifestHash, result.release.manifestHash);
  // A second client with a different installed version cannot evict the native client's checked record.
  await updates.check({ ...query, currentVersion: '0.5.0' });
  assert.equal((await updates.resolveRelease(asset.id, query)).version, '0.7.0');
  currentTime = Date.parse('2026-11-01T12:00:00Z');
  await assert.rejects(updates.resolveRelease(asset.id, query), /过期/);
  currentTime = epoch;
  manifest = signed(payload({ sequence: 2, releases: [{ ...asset, notes: 'new notes' }] }));
  await assert.rejects(updates.resolveRelease(asset.id, query), /变化/);
  await assert.rejects(updates.resolveRelease(asset.id, query), /未检查/);
  await updates.check(query); await updates.configure({ publicKey: '' });
  await assert.rejects(updates.resolveRelease(asset.id, query), /未检查/);
});

test('concurrent checks cannot return an in-memory high-water mark before its durable save', async t => {
  const entered = deferred(), release = deferred(); let saves = 0, complete = false;
  const store = { state: {}, async save() {
    saves++;
    if (saves === 2) { entered.resolve(); await release.promise; throw new Error('disk failure'); }
  } };
  const { updates } = await service(t, { store });
  const first = updates.check(query), rejected = assert.rejects(first, /保存/);
  await entered.promise;
  const second = updates.check(query).then(value => { complete = true; return value; });
  await Promise.resolve(); await Promise.resolve(); assert.equal(complete, false);
  release.resolve(); await rejected;
  assert.equal((await second).available, true); assert.equal(saves, 3);
  assert.equal(Object.values(store.state.updateTrustState)[0].sequence, 1);
});

test('same or newer installed version and absent target never produce an installable release', async t => {
  const { updates } = await service(t);
  for (const requested of [{ ...query, currentVersion: '0.7.0' }, { ...query, currentVersion: '0.8.0' }, { ...query, target: 'ubuntu-arm64' }]) {
    const result = await updates.check(requested); assert.equal(result.available, false); assert.equal(result.release, null);
  }
  await assert.rejects(updates.check({ ...query, target: 'macos-arm64' }), /平台/);
});

test('changing configuration fences a late transport result before trust state is committed', async t => {
  const entered = deferred(), release = deferred();
  const { updates, store } = await service(t, { fetchImpl: async () => { entered.resolve(); await release.promise; return new Response(signed()); } });
  const request = updates.check(query); const rejected = assert.rejects(request, /变化/);
  await entered.promise; await updates.configure({ publicKey: '' }); release.resolve(); await rejected;
  assert.deepEqual(store.state.updateTrustState, {});
});

test('request cancellation and timeout cancel a pending response body without writing trust state', async t => {
  for (const timeout of [false, true]) {
    const entered = deferred(); let canceled = false;
    const { updates, store } = await service(t, { timeoutMs: timeout ? 20 : 15000, fetchImpl: async () => new Response(new ReadableStream({ start() { entered.resolve(); }, cancel() { canceled = true; } })) });
    const controller = new AbortController();
    const request = updates.check({ ...query, signal: controller.signal });
    const rejected = assert.rejects(request, error => timeout ? error.status === 504 : error.name === 'AbortError');
    await entered.promise; if (!timeout) controller.abort(); await rejected;
    assert.equal(canceled, true); assert.deepEqual(store.state.updateTrustState, {});
  }
});

async function apiSetup(t, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-updates-'));
  const app = await createPetServer({ dataDir: directory, token: 'updates-owner-token', codex: { async status() { return { available: false }; }, async close() {} }, desktopTools: { async close() {} }, updatesOptions: { now: () => epoch, fetchImpl: async () => new Response(signed()), ...options } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const request = (route, { method = 'GET', body, token = app.token } = {}) => fetch(`http://127.0.0.1:${app.server.address().port}/api${route}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const member = async () => {
    assert.equal((await request('/admin/users', { method: 'POST', body: { username: 'tester', displayName: 'Tester', password: 'test-passphrase-123' } })).status, 201);
    return (await request('/auth/login', { method: 'POST', body: { username: 'tester', password: 'test-passphrase-123' } })).json();
  };
  return { app, request, member, directory };
}

test('API permits authenticated checks/public config, limits writes to owner and rejects arbitrary URL inputs', async t => {
  const { app, request, member, directory } = await apiSetup(t);
  const user = await member();
  assert.equal((await request('/updates/config', { token: 'invalid' })).status, 401);
  assert.equal((await request('/updates/config', { token: user.token })).status, 200);
  assert.equal((await request('/updates/config', { token: user.token, method: 'PATCH', body: { publicKey: pem } })).status, 403);
  const config = await (await request('/updates/config', { method: 'PATCH', body: { publicKey: pem } })).json();
  assert.equal(config.configured, true); assert.equal(typeof config.revision, 'string');
  const result = await (await request('/updates/check', { token: user.token, method: 'POST', body: query })).json();
  assert.equal(result.available, true);
  assert.equal((await request('/updates/check', { method: 'POST', body: { ...query, url: 'https://evil.test' } })).status, 400);
  assert.equal((await request('/updates/config', { method: 'PATCH', body: { revision: 'stale', publicKey: '' } })).status, 409);
  assert.equal((await request('/updates/download', { method: 'POST', body: { id: asset.id } })).status, 404);
  assert.equal(JSON.parse(await readFile(path.join(directory, 'state.json'), 'utf8')).updateConfig.publicKey, pem);
  assert.equal(app.updates.assertOwnerSession(app.token).bootstrap, true);
  assert.throws(() => app.updates.assertOwnerSession(user.token), error => error.status === 403);
  assert.throws(() => app.updates.assertOwnerSession('invalid'), error => error.status === 401);
});

test('logout cancels a member update check and waits for cleanup before responding', async t => {
  const entered = deferred(); let canceled = false;
  const { request, member } = await apiSetup(t, { fetchImpl: async () => new Response(new ReadableStream({ start() { entered.resolve(); }, cancel() { canceled = true; } })) });
  const user = await member();
  await request('/updates/config', { method: 'PATCH', body: { publicKey: pem } });
  const pending = request('/updates/check', { token: user.token, method: 'POST', body: query });
  await entered.promise;
  assert.equal((await request('/auth/logout', { token: user.token, method: 'POST' })).status, 200);
  assert.equal(canceled, true);
  assert.equal((await pending).status, 409);
  assert.equal((await request('/updates/config', { token: user.token })).status, 401);
});

test('native owner authorization is reevaluated after logout, and server close cancels internal checks', async t => {
  const entered = deferred(); let canceled = false;
  const { app, request } = await apiSetup(t, { fetchImpl: async () => new Response(new ReadableStream({ start() { entered.resolve(); }, cancel() { canceled = true; } })) });
  const identity = await (await request('/auth/me')).json();
  await request(`/admin/users/${identity.user.id}`, { method: 'PATCH', body: { password: 'owner-passphrase-123' } });
  const logged = await (await request('/auth/login', { method: 'POST', body: { username: 'owner', password: 'owner-passphrase-123' } })).json();
  assert.equal(app.updates.assertOwnerSession(logged.token).bootstrap, false);
  await request('/auth/logout', { token: logged.token, method: 'POST' });
  assert.throws(() => app.updates.assertOwnerSession(logged.token), error => error.status === 401);
  await app.updates.configure({ publicKey: pem });
  const pending = app.updates.check(query), rejected = assert.rejects(pending, error => error.status === 503);
  await entered.promise; await app.close(); await rejected; assert.equal(canceled, true);
  assert.throws(() => app.updates.assertOwnerSession(app.token), error => error.status === 503);
  assert.equal(app.updates.assertOwnerSession(app.token, { allowClosing: true }).bootstrap, true);
  assert.throws(() => app.updates.assertOwnerSession(logged.token, { allowClosing: true }), error => error.status === 401);
  assert.throws(() => app.updates.assertOwnerSession('invalid', { allowClosing: true }), error => error.status === 401);
});
