import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, readFile, rm, writeFile, symlink, stat } from 'node:fs/promises';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { OfficialAuth } from '../desktop/official-auth.mjs';

const keypair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const alternate = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicKey = { ...keypair.publicKey.export({ format: 'jwk' }), kid: 'fixture-key', alg: 'RS256', use: 'sig' };
const issuer = 'https://auth.openai.com', scope = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const jwt = (claims, key = keypair.privateKey, header = {}) => {
  const head = Buffer.from(JSON.stringify({ alg: 'RS256', kid: publicKey.kid, ...header })).toString('base64url'), payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${head}.${payload}.${sign('RSA-SHA256', Buffer.from(`${head}.${payload}`), key).toString('base64url')}`;
};
async function until(predicate) { for (let attempt = 0; attempt < 300; attempt++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); } throw new Error('Fixture operation did not settle'); }
async function fixture(t, overrides = {}) {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'petpal-official-auth-')), directory = path.join(parent, 'auth');
  const f = { now: 1900000000000, urls: [], requests: [], notifications: [], tokenCalls: 0, refreshCalls: 0, revocations: 0, options: {}, parent, directory };
  f.fetch = async (url, init) => {
    assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit'); assert.equal(init.referrerPolicy, 'no-referrer');
    const body = new URLSearchParams(init.body); f.requests.push({ url, body, init });
    if (url === `${issuer}/.well-known/jwks.json`) return Response.json({ keys: [publicKey] });
    if (url === `${issuer}/api/accounts/oauth/revoke`) { f.revocations++; if (f.options.revokeFailure) throw new Error('fixture PRIVATE-REFRESH-SECRET'); return new Response('', { status: 200 }); }
    assert.equal(url, `${issuer}/api/accounts/oauth/token`); assert.equal(body.get('resource'), 'https://api.openai.com/v1'); assert.equal(init.headers['Content-Type'], 'application/x-www-form-urlencoded');
    const refresh = body.get('grant_type') === 'refresh_token';
    if (refresh) { f.refreshCalls++; assert.equal(body.has('scope'), false); if (f.options.refreshGate) await f.options.refreshGate.promise; if (f.options.refreshInvalid) return Response.json({ error: 'invalid_grant', error_description: 'PRIVATE-SECRET' }, { status: 400 }); if (f.options.refreshNetwork) throw new Error('PRIVATE-SECRET'); }
    else { f.tokenCalls++; assert.equal(body.get('grant_type'), 'authorization_code'); const request = f.urls.at(-1); assert.equal(body.get('redirect_uri'), request.searchParams.get('redirect_uri')); assert.equal(createHash('sha256').update(body.get('code_verifier')).digest('base64url'), request.searchParams.get('code_challenge')); if (f.options.tokenGate) await f.options.tokenGate.promise; if (f.options.tokenInvalidGrant) return Response.json({ error: 'invalid_grant', error_description: 'PRIVATE-SECRET' }, { status: 400 }); }
    const claims = { iss: issuer, aud: body.get('client_id'), sub: f.options.subject ?? 'private-fixture-subject', email: 'fixture@example.com', exp: Math.floor(f.now / 1000) + 3600, ...(!refresh ? { nonce: f.urls.at(-1).searchParams.get('nonce') } : {}), ...(f.options.claims ?? {}), ...(refresh ? f.options.refreshClaims ?? {} : {}) };
    return Response.json({ access_token: refresh ? 'PRIVATE-ACCESS-ROTATED' : 'PRIVATE-ACCESS-SECRET', refresh_token: refresh ? 'PRIVATE-REFRESH-ROTATED' : 'PRIVATE-REFRESH-SECRET', id_token: jwt(claims, f.options.badSignature ? alternate.privateKey : keypair.privateKey, f.options.header), token_type: 'Bearer', expires_in: f.options.expiresIn ?? 3600, scope: f.options.scope ?? scope });
  };
  f.create = extra => new OfficialAuth({ directory, openExternal: async value => { f.urls.push(new URL(value)); }, fetchImpl: f.fetch, clock: () => f.now, onChange: (userId, status) => f.notifications.push({ userId, status }), ...overrides, ...extra });
  f.auth = f.create(); await f.auth.init();
  t.after(async () => { await f.auth.close(); await rm(parent, { recursive: true, force: true }); });
  return f;
}
async function callback(f, { state, clientId = 'oaiapp_fixture-one', omitClient = false, code = 'fixture-one-time-code', ...params } = {}) {
  const request = f.urls.at(-1), url = new URL(request.searchParams.get('redirect_uri'));
  url.searchParams.set('state', state ?? request.searchParams.get('state')); url.searchParams.set('code', code);
  if (!omitClient) url.searchParams.set('client_id', clientId);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return fetch(url);
}
async function login(f, userId = 'alice', body = {}, callbackOptions = {}) {
  await f.auth.start(userId, body); await callback(f, callbackOptions); await until(async () => (await f.auth.status(userId)).state !== 'signing-in'); return f.auth.status(userId);
}
function assertPublic(status) {
  const value = JSON.stringify(status); assert.doesNotMatch(value, /PRIVATE-|private-fixture-subject|client_id|clientId|subject|authUrl|auth_url|nonce|refreshToken|accessToken|idToken|eyJ/);
  assert.deepEqual(Object.keys(status).filter(key => !['supported', 'state', 'profiles', 'activeProfileId', 'revision', 'planUsageEnabled', 'error'].includes(key)), []);
}

test('SIWC starts loopback, creates PKCE and stable host identity, verifies JWT and keeps public status token-free', async t => {
  const f = await fixture(t), pending = await f.auth.start('alice'); assert.equal(pending.state, 'signing-in'); assertPublic(pending);
  const url = f.urls[0]; assert.equal(url.origin + url.pathname, `${issuer}/api/accounts/authorize`); assert.equal(url.searchParams.get('client_id'), 'dynamic_agent_client'); assert.equal(url.searchParams.get('agent_name_hint'), '小伴 PetPal'); assert.equal(url.searchParams.get('scope'), scope); assert.equal(url.searchParams.get('resource'), 'https://api.openai.com/v1'); assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  const redirect = new URL(url.searchParams.get('redirect_uri')); assert.equal(redirect.hostname, '127.0.0.1'); assert.equal(redirect.pathname, '/auth/callback'); assert.ok(Number(redirect.port) > 0);
  await callback(f); await until(async () => (await f.auth.status('alice')).state === 'signed-in');
  const status = await f.auth.status('alice'); assert.equal(status.planUsageEnabled, true); assert.equal(status.profiles[0].email, 'fixture@example.com'); assertPublic(status); assertPublic(f.notifications.at(-1).status);
  const access = await f.auth.access('alice'); assert.equal(access.accessToken, 'PRIVATE-ACCESS-SECRET'); assert.equal(access.profileId, status.activeProfileId); assert.equal(access.revision, status.revision);
  const bytes = await readFile(path.join(f.directory, 'credentials.json'), 'utf8'); assert.match(bytes, /PRIVATE-REFRESH-SECRET/); assert.equal((await stat(path.join(f.directory, 'credentials.json'))).isFile(), true);
  if (process.platform !== 'win32') { assert.equal((await stat(f.directory)).mode & 0o777, 0o700); assert.equal((await stat(path.join(f.directory, 'credentials.json'))).mode & 0o777, 0o600); }
});

test('an incorrect callback state or path cannot terminate the valid attempt or exchange any code', async t => {
  const f = await fixture(t); await f.auth.start('alice'); const valid = new URL(f.urls[0].searchParams.get('redirect_uri'));
  assert.equal((await callback(f, { state: 'attacker-state' })).status, 400);
  const wrong = new URL(valid); wrong.pathname = '/callback'; wrong.searchParams.set('state', f.urls[0].searchParams.get('state')); assert.equal((await fetch(wrong)).status, 400);
  assert.equal((await f.auth.status('alice')).state, 'signing-in'); assert.equal(f.tokenCalls, 0);
  await callback(f); await until(async () => (await f.auth.status('alice')).state === 'signed-in'); assert.equal(f.tokenCalls, 1);
});

for (const [name, options] of [['nonce', { claims: { nonce: 'wrong' } }], ['audience', { claims: { aud: 'different-client' } }], ['issuer', { claims: { iss: 'https://attacker.example' } }], ['expired JWT', { claims: { exp: 1 } }], ['signature', { badSignature: true }], ['algorithm', { header: { alg: 'none' } }]]) {
  test(`SIWC refuses invalid ${name} and never saves its tokens`, async t => {
    const f = await fixture(t); f.options = options; const status = await login(f); assert.equal(status.state, 'signed-out'); assert.equal(status.profiles.length, 0); assertPublic(status);
    assert.doesNotMatch(await readFile(path.join(f.directory, 'credentials.json'), 'utf8'), /PRIVATE-|private-fixture-subject/);
  });
}

test('new registrations require an issued client ID and reauthorization cannot replace it or the verified subject', async t => {
  const f = await fixture(t); let status = await login(f, 'alice', {}, { omitClient: true }); assert.equal(status.state, 'signed-out'); assert.equal(f.tokenCalls, 0);
  status = await login(f, 'alice', {}, { clientId: 'dynamic_agent_client' }); assert.equal(status.state, 'signed-out'); assert.equal(f.tokenCalls, 0);
  status = await login(f); const original = await f.auth.access('alice');
  await f.auth.start('alice', { profileId: status.activeProfileId }); const request = f.urls.at(-1); assert.equal(request.searchParams.get('client_id'), 'oaiapp_fixture-one'); assert.equal(request.searchParams.has('agent_name_hint'), false); assert.ok(request.searchParams.get('id_token_hint')); assert.equal(request.searchParams.get('login_hint'), 'fixture@example.com');
  await callback(f, { clientId: 'oaiapp_wrong-registration' }); await until(async () => (await f.auth.status('alice')).state !== 'signing-in'); assert.equal((await f.auth.access('alice')).revision, original.revision);
  f.options.subject = 'different-private-subject'; await login(f, 'alice', { profileId: status.activeProfileId }, { omitClient: true }); assert.equal((await f.auth.access('alice')).revision, original.revision);
});

test('a new registration invalid_grant retries its issued ID with fresh PKCE and never creates an unverified profile', async t => {
  const f = await fixture(t); f.options.tokenInvalidGrant = true;
  const failed = await login(f); assert.equal(failed.state, 'signed-out'); assert.equal(failed.profiles.length, 0); assertPublic(failed);
  assert.doesNotMatch(await readFile(path.join(f.directory, 'credentials.json'), 'utf8'), /oaiapp_fixture-one|PRIVATE-|private-fixture-subject/);
  const prior = f.urls.at(-1); f.options.tokenInvalidGrant = false; await f.auth.start('alice'); const retry = f.urls.at(-1);
  assert.equal(retry.searchParams.get('client_id'), 'oaiapp_fixture-one'); assert.equal(retry.searchParams.has('agent_name_hint'), false); assert.equal(retry.searchParams.has('id_token_hint'), false);
  for (const key of ['state', 'nonce', 'code_challenge']) assert.notEqual(retry.searchParams.get(key), prior.searchParams.get(key));
  await callback(f, { omitClient: true }); await until(async () => (await f.auth.status('alice')).state === 'signed-in');
  assert.equal((await f.auth.status('alice')).profiles.length, 1); assert.equal(f.tokenCalls, 2);
  await f.auth.start('alice'); assert.equal(f.urls.at(-1).searchParams.get('client_id'), 'dynamic_agent_client');
});

test('cancel clears unverified registration retries and a selected saved profile takes precedence', async t => {
  const f = await fixture(t), saved = await login(f); const original = await f.auth.access('alice'); f.options.tokenInvalidGrant = true;
  await login(f, 'alice', {}, { clientId: 'oaiapp_unverified-retry' }); assert.deepEqual(await f.auth.access('alice'), original);
  await f.auth.start('alice', { profileId: saved.activeProfileId }); assert.equal(f.urls.at(-1).searchParams.get('client_id'), 'oaiapp_fixture-one');
  await f.auth.cancel('alice'); await f.auth.start('alice'); assert.equal(f.urls.at(-1).searchParams.get('client_id'), 'dynamic_agent_client');
});

test('registrations with identical email stay separate and cannot be accessed or selected by another PetPal user', async t => {
  const f = await fixture(t), first = await login(f); const firstId = first.activeProfileId;
  const second = await login(f, 'alice', {}, { clientId: 'oaiapp_fixture-two' }); assert.equal(second.profiles.length, 2); assert.notEqual(second.activeProfileId, firstId); assert.notEqual(second.profiles[0].label, second.profiles[1].label);
  assert.equal((await f.auth.status('bob')).profiles.length, 0); await assert.rejects(f.auth.access('bob'), { code: 'official_signin_required' }); await assert.rejects(f.auth.select('bob', firstId));
  await f.auth.select('alice', firstId); assert.equal((await f.auth.access('alice')).profileId, firstId);
});

test('plan usage depends on granted token scopes, never on the valid ID token or callback scope', async t => {
  const f = await fixture(t); f.options.scope = 'openid profile email offline_access resource.invoke';
  const status = await login(f, 'alice', {}, { scope }); assert.equal(status.state, 'signed-in'); assert.equal(status.planUsageEnabled, false); await assert.rejects(f.auth.access('alice'), { code: 'official_plan_required' }); assertPublic(status);
});

test('cancelling and closing invalidate code exchanges even when a late fetch ignores abort', async t => {
  for (const action of ['cancel', 'close']) {
    const f = await fixture(t), gate = deferred(); f.options.tokenGate = gate; await f.auth.start('alice'); await callback(f); await until(() => f.tokenCalls === 1);
    await f.auth[action]('alice'); gate.resolve(); await new Promise(resolve => setTimeout(resolve, 30));
    assert.doesNotMatch(await readFile(path.join(f.directory, 'credentials.json'), 'utf8'), /PRIVATE-|private-fixture-subject/);
    if (action === 'cancel') assert.equal((await f.auth.status('alice')).profiles.length, 0);
  }
});

test('the login callback repeats the current PetPal authorization before accepting credentials', async t => {
  const f = await fixture(t), gate = deferred(); f.options.tokenGate = gate; let authorized = true;
  await f.auth.start('alice', {}, { authorize: () => authorized }); await callback(f); await until(() => f.tokenCalls === 1); authorized = false; gate.resolve();
  await until(async () => (await f.auth.status('alice')).state !== 'signing-in'); assert.equal((await f.auth.status('alice')).profiles.length, 0);
});

test('mutation authorization prevents cancelling, selecting or logging out another current session', async t => {
  const f = await fixture(t), status = await login(f), original = await f.auth.access('alice');
  for (const action of [() => f.auth.cancel('alice', { authorize: () => false }), () => f.auth.select('alice', status.activeProfileId, { authorize: () => false }), () => f.auth.logout('alice', { authorize: () => false })]) await assert.rejects(action(), { code: 'official_auth_cancelled' });
  assert.deepEqual(await f.auth.access('alice'), original); assert.equal(f.revocations, 0);
});

test('refresh is singleflight, rotates credentials atomically and preserves the provider revision without notifications', async t => {
  const f = await fixture(t); await login(f); const original = await f.auth.access('alice'), before = f.notifications.length;
  const gate = deferred(); f.options.refreshGate = gate; f.now += 3590000;
  const requests = Array.from({ length: 8 }, () => f.auth.access('alice')); await until(() => f.refreshCalls === 1); gate.resolve(); const results = await Promise.all(requests);
  for (const result of results) { assert.equal(result.accessToken, 'PRIVATE-ACCESS-ROTATED'); assert.equal(result.revision, original.revision); }
  assert.equal(f.refreshCalls, 1); assert.equal(f.notifications.length, before); const stored = await readFile(path.join(f.directory, 'credentials.json'), 'utf8'); assert.match(stored, /PRIVATE-REFRESH-ROTATED/); assert.doesNotMatch(stored, /PRIVATE-REFRESH-SECRET/);
});

test('adding a pending account keeps the active registration and its in-flight refresh usable', async t => {
  const f = await fixture(t); await login(f); const original = await f.auth.access('alice'), gate = deferred(); f.options.refreshGate = gate;
  const refreshing = f.auth.access('alice', { forceRefresh: true }); await until(() => f.refreshCalls === 1);
  const pending = await f.auth.start('alice'); assert.equal(pending.state, 'signing-in'); assert.equal(pending.activeProfileId, original.profileId); assert.equal(pending.revision, original.revision); assert.equal(pending.planUsageEnabled, true);
  gate.resolve(); const refreshed = await refreshing; assert.equal(refreshed.revision, original.revision); assert.equal(refreshed.accessToken, 'PRIVATE-ACCESS-ROTATED'); await f.auth.cancel('alice');
});

test('a valid callback code is consumed at most once while its token exchange is pending', async t => {
  const f = await fixture(t), gate = deferred(); f.options.tokenGate = gate; await f.auth.start('alice'); await callback(f); await until(() => f.tokenCalls === 1);
  assert.equal((await callback(f)).status, 410); assert.equal(f.tokenCalls, 1); gate.resolve(); await until(async () => (await f.auth.status('alice')).state === 'signed-in');
});

test('cancel during atomic credential persistence restores the pre-login private state', async t => {
  let hold = false; const gate = deferred(), entered = deferred();
  const f = await fixture(t, { encrypt: async value => { if (hold) { entered.resolve(); await gate.promise; } return Buffer.from(value); }, decrypt: bytes => bytes.toString('utf8') });
  hold = true; await f.auth.start('alice'); await callback(f); await entered.promise;
  const cancelling = f.auth.cancel('alice'); gate.resolve(); await cancelling;
  assert.equal((await f.auth.status('alice')).profiles.length, 0);
  const stored = JSON.parse(await readFile(path.join(f.directory, 'credentials.json'), 'utf8')); assert.doesNotMatch(Buffer.from(stored.ciphertext, 'base64').toString('utf8'), /PRIVATE-|private-fixture-subject/);
});

test('timeout rejects late token responses and rolls back a credential write already in progress', async t => {
  for (const stage of ['token', 'persistence']) {
    let hold = false; const gate = deferred(), entered = deferred();
    const f = await fixture(t, { attemptMs: 100, encrypt: async value => { if (hold && stage === 'persistence') { entered.resolve(); await gate.promise; } return Buffer.from(value); }, decrypt: bytes => bytes.toString('utf8') });
    if (stage === 'token') f.options.tokenGate = gate;
    hold = true; await f.auth.start('alice'); await callback(f);
    if (stage === 'token') await until(() => f.tokenCalls === 1); else await entered.promise;
    await until(async () => (await f.auth.status('alice')).state === 'signed-out');
    gate.resolve(); await f.auth.tail.catch(() => {}); await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal((await f.auth.status('alice')).profiles.length, 0);
    const stored = JSON.parse(await readFile(path.join(f.directory, 'credentials.json'), 'utf8')); assert.doesNotMatch(Buffer.from(stored.ciphertext, 'base64').toString('utf8'), /PRIVATE-|private-fixture-subject/);
  }
});

test('force refresh retries a rejected access token and refresh failures never return expired credentials', async t => {
  const f = await fixture(t); await login(f); await f.auth.access('alice', { forceRefresh: true }); assert.equal(f.refreshCalls, 1);
  f.now += 4000000; f.options.refreshNetwork = true; await assert.rejects(f.auth.access('alice'), { code: 'official_network_failed' }); assert.equal((await f.auth.status('alice')).profiles[0].signedIn, true);
  f.options.refreshNetwork = false; f.options.refreshInvalid = true; await assert.rejects(f.auth.access('alice'), { code: 'official_session_invalid' }); const status = await f.auth.status('alice'); assert.equal(status.state, 'signed-out'); assert.equal(status.profiles.length, 1); assertPublic(status); assert.doesNotMatch(await readFile(path.join(f.directory, 'credentials.json'), 'utf8'), /PRIVATE-/);
});

test('a refresh identity mismatch clears credentials and a stale refresh cannot overwrite profile selection', async t => {
  const f = await fixture(t), first = await login(f), firstId = first.activeProfileId;
  f.options.refreshClaims = { sub: 'wrong-subject' }; await assert.rejects(f.auth.access('alice', { forceRefresh: true })); assert.equal((await f.auth.status('alice')).state, 'signed-out');
  f.options = {}; await login(f, 'alice', { profileId: firstId }, { omitClient: true }); await login(f, 'alice', {}, { clientId: 'oaiapp_fixture-two' });
  const gate = deferred(); f.options.refreshGate = gate; const refreshing = f.auth.access('alice', { forceRefresh: true }); const rejected = assert.rejects(refreshing, { code: 'official_auth_cancelled' }); await until(() => f.refreshCalls === 2); await f.auth.select('alice', firstId); gate.resolve(); await rejected; assert.equal((await f.auth.access('alice')).profileId, firstId);
});

test('logout revokes the selected renewable session, clears local tokens and retains registration and host for reauthorization', async t => {
  const f = await fixture(t), signed = await login(f), host = f.urls[0].searchParams.get('ext_agent_host_id'); const status = await f.auth.logout('alice');
  assert.equal(status.state, 'signed-out'); assert.equal(status.profiles.length, 1); assert.equal(status.activeProfileId, signed.activeProfileId); assert.equal(f.revocations, 1); assertPublic(status);
  const revoke = f.requests.find(item => item.url.endsWith('/revoke')); assert.equal(revoke.body.get('token_type_hint'), 'refresh_token'); assert.equal(revoke.body.get('client_id'), 'oaiapp_fixture-one');
  assert.doesNotMatch(await readFile(path.join(f.directory, 'credentials.json'), 'utf8'), /PRIVATE-|eyJ/);
  await f.auth.start('alice', { profileId: signed.activeProfileId }); assert.equal(f.urls.at(-1).searchParams.get('ext_agent_host_id'), host); assert.equal(f.urls.at(-1).searchParams.has('id_token_hint'), false);
});

test('network failure during remote revocation still clears tokens and reports only sanitized recovery text', async t => {
  const f = await fixture(t); await login(f); f.options.revokeFailure = true; const status = await f.auth.logout('alice'); assert.equal(status.state, 'signed-out'); assert.equal(f.revocations, 2); assert.match(status.error, /远程会话撤销未确认/); assertPublic(status); assert.doesNotMatch(await readFile(path.join(f.directory, 'credentials.json'), 'utf8'), /PRIVATE-/);
});

test('restart restores independent profiles and protected encryption round-trips without credentials in the file', async t => {
  const f = await fixture(t, { encrypt: value => Buffer.from(value).map(byte => byte ^ 0xa5), decrypt: bytes => Buffer.from(bytes).map(byte => byte ^ 0xa5).toString('utf8') });
  const status = await login(f), original = await f.auth.access('alice'), host = f.urls[0].searchParams.get('ext_agent_host_id'); assert.doesNotMatch(await readFile(path.join(f.directory, 'credentials.json'), 'utf8'), /PRIVATE-|fixture@example/);
  await f.auth.close(); f.auth = f.create(); await f.auth.init(); assert.equal((await f.auth.status('alice')).activeProfileId, status.activeProfileId); assert.deepEqual(await f.auth.access('alice'), original);
  await f.auth.start('alice', { profileId: status.activeProfileId }); assert.equal(f.urls.at(-1).searchParams.get('ext_agent_host_id'), host);
});

test('malformed private storage is rejected without echoing secrets', async t => {
  const f = await fixture(t); await f.auth.close(); await writeFile(path.join(f.directory, 'credentials.json'), '{PRIVATE-SENSITIVE-STORAGE'); f.auth = f.create();
  await assert.rejects(f.auth.init(), error => error.code === 'official_storage_failed' && !error.message.includes('PRIVATE-'));
});

test('credential symlinks are refused and the linked file is not read or overwritten', async t => {
  const f = await fixture(t); await f.auth.close(); const outside = path.join(f.parent, 'outside.json'); await writeFile(outside, 'PRIVATE-OUTSIDE'); await rm(path.join(f.directory, 'credentials.json'));
  try { await symlink(outside, path.join(f.directory, 'credentials.json'), 'file'); } catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.skip('This Windows account cannot create file symlinks'); return; } throw error; }
  f.auth = f.create(); await assert.rejects(f.auth.init(), { code: 'official_storage_failed' }); assert.equal(await readFile(outside, 'utf8'), 'PRIVATE-OUTSIDE');
});
