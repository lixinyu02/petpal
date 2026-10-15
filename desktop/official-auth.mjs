import path from 'node:path';
import http from 'node:http';
import { constants } from 'node:fs';
import { lstat, mkdir, open, rename, unlink, chmod } from 'node:fs/promises';
import { createHash, createPublicKey, randomBytes, randomUUID, timingSafeEqual, verify } from 'node:crypto';

const ISSUER = 'https://auth.openai.com';
const AUTHORIZE = `${ISSUER}/api/accounts/authorize`;
const TOKEN = `${ISSUER}/api/accounts/oauth/token`;
const REVOKE = `${ISSUER}/api/accounts/oauth/revoke`;
const JWKS = `${ISSUER}/.well-known/jwks.json`;
const RESOURCE = 'https://api.openai.com/v1';
const PLAN_SCOPE = 'chatgpt.tokens.use.direct';
const SCOPES = `openid profile email offline_access resource.invoke ${PLAN_SCOPE}`;
const MAX_FILE = 4 * 1024 * 1024;
const MAX_RESPONSE = 1024 * 1024;
const failure = (message, code = 'official_auth_failed') => Object.assign(new Error(message), { code });
const cancelled = () => failure('官方账号操作已取消，请重新操作。', 'official_auth_cancelled');
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const text = (value, max = 32768) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\x00-\x20\x7f]/.test(value);
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const userKey = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const constantEqual = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const planEnabled = profile => Boolean(profile?.scopes?.includes(PLAN_SCOPE));
const signedIn = (profile, now) => Boolean(profile && (profile.accessToken && profile.expiresAt > now || profile.refreshToken));
const clearTokens = profile => { for (const key of ['accessToken', 'refreshToken', 'idToken']) profile[key] = ''; profile.expiresAt = 0; profile.scopes = []; profile.revision = randomUUID(); };

async function safeDirectory(directory) {
  const absolute = path.resolve(directory), root = path.parse(absolute).root;
  let current = root;
  for (const part of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try { const info = await lstat(current); if (!info.isDirectory() || info.isSymbolicLink()) throw failure('官方账号存储目录不安全，请检查客户端私有目录。'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; await mkdir(current, { mode: 0o700 }); }
  }
  await chmod(absolute, 0o700);
}
async function regularFile(file) {
  try { const info = await lstat(file); if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > MAX_FILE) throw failure('官方账号存储文件不安全，请保留文件并检查。'); return info; }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function boundedBytes(response, max = MAX_RESPONSE) {
  if (Number(response.headers.get('content-length')) > max) { await response.body?.cancel(); throw failure('官方账号服务返回内容异常，请稍后重试。'); }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader(), chunks = []; let bytes = 0;
  try { for (;;) { const { value, done } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > max) throw failure('官方账号服务返回内容异常，请稍后重试。'); chunks.push(Buffer.from(value)); } }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return Buffer.concat(chunks, bytes);
}
function validateStored(data) {
  if (!object(data) || data.version !== 1 || !/^urn:uuid:[0-9a-f-]{36}$/.test(data.hostId) || !Array.isArray(data.users) || data.users.length > 256) throw new Error();
  const users = new Set();
  for (const user of data.users) {
    if (!object(user) || !userKey(user.userId) || users.has(user.userId) || !Array.isArray(user.profiles) || user.profiles.length > 64 || user.activeProfileId !== null && !uuid(user.activeProfileId)) throw new Error();
    users.add(user.userId); const ids = new Set(), registrations = new Set();
    for (const profile of user.profiles) {
      const registration = `${profile?.clientId}\n${profile?.subject}`;
      if (!object(profile) || !uuid(profile.id) || ids.has(profile.id) || registrations.has(registration) || !text(profile.clientId, 512) || profile.clientId === 'dynamic_agent_client' || !text(profile.subject, 512) || typeof profile.email !== 'string' || profile.email.length > 254 || /[\x00-\x1f\x7f]/.test(profile.email) || typeof profile.label !== 'string' || profile.label.length > 320 || !uuid(profile.revision) || !Number.isFinite(profile.expiresAt) || profile.expiresAt < 0 || !Array.isArray(profile.scopes) || profile.scopes.length > 64 || profile.scopes.some(scope => !text(scope, 128)) || ['accessToken', 'refreshToken', 'idToken'].some(key => profile[key] !== '' && !text(profile[key], key === 'idToken' ? 65536 : 32768))) throw new Error();
      ids.add(profile.id); registrations.add(registration);
    }
    if (user.activeProfileId !== null && !ids.has(user.activeProfileId)) throw new Error();
  }
  return data;
}
function jwtPart(part) {
  if (!text(part, 65536) || !/^[A-Za-z0-9_-]+$/.test(part)) throw failure('官方账号身份验证失败，请重新登录。');
  try { const result = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')); if (!object(result)) throw new Error(); return result; }
  catch { throw failure('官方账号身份验证失败，请重新登录。'); }
}
function awaitSignal(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(cancelled());
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(cancelled()); }, cleanup = () => signal.removeEventListener('abort', abort);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}

/** Official public-client SIWC credentials. Only sanitized status may cross IPC. */
export class OfficialAuth {
  constructor({ directory, openExternal, fetchImpl = fetch, clock = Date.now, attemptMs = 180000, onChange, encrypt, decrypt } = {}) {
    if (typeof directory !== 'string' || !path.isAbsolute(directory) || path.resolve(directory) === path.parse(directory).root || typeof openExternal !== 'function' || typeof fetchImpl !== 'function' || typeof clock !== 'function' || !Number.isInteger(attemptMs) || attemptMs < 100 || attemptMs > 600000 || Boolean(encrypt) !== Boolean(decrypt) || encrypt && (typeof encrypt !== 'function' || typeof decrypt !== 'function')) throw new Error('官方账号初始化参数无效。');
    this.directory = path.resolve(directory); this.file = path.join(this.directory, 'credentials.json'); this.openExternal = openExternal; this.fetch = fetchImpl; this.clock = clock; this.attemptMs = attemptMs; this.onChange = onChange; this.encrypt = encrypt; this.decrypt = decrypt;
    this.data = null; this.initializing = null; this.tail = Promise.resolve(); this.runtime = new Map(); this.closed = false; this.jwks = null;
  }
  async init() {
    if (this.closed) throw cancelled();
    if (this.data) return;
    this.initializing ??= (async () => {
      try {
        await safeDirectory(this.directory);
        const info = await regularFile(this.file);
        if (!info) { const data = { version: 1, hostId: `urn:uuid:${randomUUID()}`, users: [] }; await this._write(data); this.data = data; return; }
        const handle = await open(this.file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
        let bytes;
        try { const current = await handle.stat(); if (!current.isFile() || current.nlink !== 1 || current.size > MAX_FILE || current.ino !== info.ino || current.dev !== info.dev) throw new Error(); bytes = await handle.readFile(); if (bytes.length > MAX_FILE) throw new Error(); }
        finally { await handle.close(); }
        let stored = JSON.parse(bytes.toString('utf8'));
        if (stored.encrypted === true) {
          if (!this.decrypt || stored.version !== 1 || !text(stored.ciphertext, MAX_FILE) || !/^[A-Za-z0-9+/]+={0,2}$/.test(stored.ciphertext)) throw new Error();
          stored = JSON.parse(await this.decrypt(Buffer.from(stored.ciphertext, 'base64')));
        }
        this.data = validateStored(stored);
        await chmod(this.file, 0o600);
      } catch { this.data = null; throw failure('无法读取官方账号私有配置，请保留文件并检查权限或系统加密设置。', 'official_storage_failed'); }
    })();
    try { await this.initializing; } catch (error) { this.initializing = null; throw error; }
  }
  _state(userId) {
    if (!userKey(userId)) throw failure('小伴账号标识无效。');
    let state = this.runtime.get(userId);
    if (!state) { state = { epoch: 0, loginEpoch: 0, attempt: null, retryClientId: null, refresh: null, controller: new AbortController(), error: '' }; this.runtime.set(userId, state); }
    return state;
  }
  _user(userId, data = this.data) { return data.users.find(user => user.userId === userId) ?? { userId, profiles: [], activeProfileId: null }; }
  _profile(userId) { const user = this._user(userId); return user.profiles.find(profile => profile.id === user.activeProfileId); }
  _snapshot(userId) {
    const state = this._state(userId), user = this._user(userId), profile = this._profile(userId);
    return { supported: true, state: state.attempt ? 'signing-in' : signedIn(profile, this.clock()) ? 'signed-in' : 'signed-out', profiles: user.profiles.map(item => ({ id: item.id, email: item.email, label: item.label, signedIn: signedIn(item, this.clock()), planUsageEnabled: signedIn(item, this.clock()) && planEnabled(item) })), activeProfileId: user.activeProfileId, revision: profile?.revision ?? null, planUsageEnabled: signedIn(profile, this.clock()) && planEnabled(profile), ...(state.error ? { error: state.error } : {}) };
  }
  async status(userId) { await this.init(); return this._snapshot(userId); }
  _notify(userId) { try { this.onChange?.(userId, this._snapshot(userId)); } catch { /* observers cannot change authorization */ } }
  async _write(data) {
    await safeDirectory(this.directory); await regularFile(this.file);
    let value = JSON.stringify(data);
    if (this.encrypt) { const encrypted = await this.encrypt(value); const bytes = Buffer.isBuffer(encrypted) ? encrypted : Buffer.from(encrypted); value = JSON.stringify({ version: 1, encrypted: true, ciphertext: bytes.toString('base64') }); }
    if (Buffer.byteLength(value) > MAX_FILE) throw failure('官方账号配置过大，请减少保存的账号。', 'official_storage_failed');
    const temporary = path.join(this.directory, `.credentials-${randomUUID()}.tmp`);
    let handle;
    try { handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600); await handle.writeFile(value + '\n'); await handle.sync(); await handle.close(); handle = null; await safeDirectory(this.directory); await regularFile(this.file); await rename(temporary, this.file); await chmod(this.file, 0o600); }
    catch { throw failure('保存官方账号失败，请检查客户端私有目录。', 'official_storage_failed'); }
    finally { await handle?.close().catch(() => {}); await unlink(temporary).catch(() => {}); }
  }
  _store(change, assert = () => {}) {
    const work = this.tail.catch(() => {}).then(async () => {
      await assert(); const draft = structuredClone(this.data), result = change(draft);
      await this._write(draft);
      try { await assert(); } catch (error) { await this._write(this.data); throw error; }
      this.data = draft; return result;
    }).catch(error => { if (error.code?.startsWith('official_')) throw error; throw failure('保存官方账号失败，请检查客户端私有目录。', 'official_storage_failed'); }); this.tail = work; return work;
  }
  _invalidate(userId) {
    const state = this._state(userId); state.epoch++; state.loginEpoch++; state.retryClientId = null; state.controller.abort(); state.controller = new AbortController();
    if (state.attempt) { const attempt = state.attempt; state.attempt = null; clearTimeout(attempt.timer); attempt.controller.abort(); attempt.server.close(); attempt.server.closeAllConnections?.(); }
    state.refresh = null; return state;
  }
  _assert(userId, epoch) { if (this.closed || this._state(userId).epoch !== epoch) throw cancelled(); }
  _guard(userId, epoch, authorize) {
    if (authorize !== undefined && typeof authorize !== 'function') throw failure('官方账号授权参数无效。');
    return async () => { this._assert(userId, epoch); if (authorize) { try { if (await authorize() === false) throw new Error(); } catch { throw cancelled(); } } this._assert(userId, epoch); };
  }
  async start(userId, body = {}, { authorize } = {}) {
    await this.init(); this._state(userId);
    if (!object(body) || Object.keys(body).some(key => key !== 'profileId') || body.profileId !== undefined && !uuid(body.profileId) || authorize !== undefined && typeof authorize !== 'function') throw failure('官方账号登录参数无效。');
    const selected = body.profileId ? this._user(userId).profiles.find(profile => profile.id === body.profileId) : null;
    if (body.profileId && !selected) throw failure('保存的官方账号不存在。');
    const state = this._state(userId), epoch = state.epoch, loginEpoch = ++state.loginEpoch; state.error = '';
    if (state.attempt) { const prior = state.attempt; state.attempt = null; clearTimeout(prior.timer); prior.controller.abort(); prior.server.close(); prior.server.closeAllConnections?.(); }
    const guard = this._guard(userId, epoch, authorize); let attempt;
    const assert = async () => { await guard(); if (state.loginEpoch !== loginEpoch || attempt && state.attempt !== attempt) throw cancelled(); };
    await assert();
    attempt = { userId, epoch, selected: selected ? { ...selected } : null, clientId: selected?.clientId ?? state.retryClientId, assert, state: randomBytes(32).toString('base64url'), nonce: randomBytes(32).toString('base64url'), verifier: randomBytes(48).toString('base64url'), controller: new AbortController(), used: false, server: null, timer: null };
    const server = http.createServer((req, res) => this._callback(attempt, req, res)); attempt.server = server;
    state.attempt = attempt;
    server.headersTimeout = 10000; server.requestTimeout = 10000; server.maxHeadersCount = 32; server.maxConnections = 8;
    server.on('error', () => { if (state.attempt === attempt) this._finish(attempt, '无法建立官方登录回调，请重新登录。'); });
    try {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); }); });
      await assert(); attempt.redirectUri = `http://127.0.0.1:${server.address().port}/auth/callback`; state.attempt = attempt;
      attempt.timer = setTimeout(() => this._finish(attempt, '官方账号登录已超时，请重新登录。'), this.attemptMs); attempt.timer.unref?.();
      const url = new URL(AUTHORIZE); const parameters = { client_id: attempt.clientId ?? 'dynamic_agent_client', ext_agent_host_id: this.data.hostId, response_type: 'code', redirect_uri: attempt.redirectUri, scope: SCOPES, resource: RESOURCE, state: attempt.state, nonce: attempt.nonce, code_challenge_method: 'S256', code_challenge: createHash('sha256').update(attempt.verifier).digest('base64url'), ...(!attempt.clientId ? { agent_name_hint: '小伴 PetPal' } : {}), ...(selected?.idToken ? { id_token_hint: selected.idToken } : {}), ...(selected?.email ? { login_hint: selected.email } : {}) };
      for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
      this._notify(userId); await this.openExternal(url.href); await assert(); return this._snapshot(userId);
    } catch { server.close(); server.closeAllConnections?.(); if (state.attempt === attempt) this._finish(attempt, '无法打开官方登录，请重试或检查默认浏览器。'); this._assert(userId, epoch); throw failure('无法开始官方账号登录，请重试或检查默认浏览器。'); }
  }
  _callback(attempt, req, res) {
    const respond = (status, message) => { res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" }); res.end(message); };
    const state = this._state(attempt.userId);
    if (this.closed || state.attempt !== attempt || attempt.epoch !== state.epoch || attempt.used) { respond(410, '此登录已结束，请回到小伴重新登录。'); return; }
    let url;
    try { if (req.method !== 'GET' || typeof req.url !== 'string' || req.url.length > 16384 || req.headers.host !== new URL(attempt.redirectUri).host) throw new Error(); url = new URL(req.url, attempt.redirectUri); if (url.pathname !== '/auth/callback' || url.searchParams.getAll('state').length !== 1 || !constantEqual(url.searchParams.get('state'), attempt.state)) throw new Error(); }
    catch { respond(400, '登录回调无效，请继续原来的官方登录。'); return; }
    attempt.used = true;
    if (url.searchParams.has('error')) { respond(400, '官方授权未完成，请回到小伴重试。'); this._finish(attempt, '官方授权未完成，请在官方页面允许后重试。'); return; }
    const code = url.searchParams.get('code'), returnedClient = url.searchParams.get('client_id');
    const clientId = attempt.clientId ?? returnedClient;
    if (url.searchParams.getAll('code').length !== 1 || url.searchParams.getAll('client_id').length > 1 || !text(code, 8192) || !text(clientId, 512) || clientId === 'dynamic_agent_client' || returnedClient !== null && returnedClient !== clientId) { respond(400, '官方注册未完成，请重新登录。'); this._finish(attempt, '官方注册信息不匹配，请重新登录。'); return; }
    respond(200, '正在完成官方登录，可以返回小伴。');
    void this._complete(attempt, code, clientId).catch(error => { this._finish(attempt, error.code === 'official_auth_cancelled' ? '' : error.code === 'official_storage_failed' ? '保存官方账号失败，请检查客户端私有目录。' : '官方账号验证失败，请重新登录。'); });
  }
  _finish(attempt, error = '') {
    clearTimeout(attempt.timer); attempt.controller.abort(); attempt.server.close(); attempt.server.closeAllConnections?.();
    const state = this._state(attempt.userId);
    if (state.attempt !== attempt || state.epoch !== attempt.epoch || this.closed) return;
    state.attempt = null; state.error = error; this._notify(attempt.userId);
  }
  async _request(url, { form, signal, empty = false } = {}) {
    if (![TOKEN, REVOKE, JWKS].includes(url)) throw failure('官方账号服务地址无效。');
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12000), abort = () => controller.abort(); timer.unref?.();
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) controller.abort();
    try {
      const response = await this.fetch(url, { method: form ? 'POST' : 'GET', headers: form ? { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' } : { Accept: 'application/json' }, ...(form ? { body: new URLSearchParams(form).toString() } : {}), signal: controller.signal, redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer' });
      const bytes = await boundedBytes(response); let data;
      if (!empty || !response.ok) { try { data = JSON.parse(bytes.toString('utf8')); } catch { data = null; } }
      if (!response.ok) { const error = failure(response.status === 400 || response.status === 401 ? '官方登录已失效，请重新登录。' : '官方账号服务暂时不可用，请稍后重试。', response.status === 400 || response.status === 401 ? 'official_session_invalid' : 'official_network_failed'); if (data?.error === 'invalid_grant') error.invalidGrant = true; throw error; }
      if (empty) return;
      if (!object(data)) throw failure('官方账号服务返回内容异常，请稍后重试。'); return data;
    } catch (error) { if (signal?.aborted) throw cancelled(); if (error.code?.startsWith('official_')) throw error; throw failure('连接官方账号服务失败，请检查网络后重试。', 'official_network_failed'); }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  async _verifyId(token, clientId, { nonce, subject, signal } = {}) {
    if (!text(token, 65536) || token.split('.').length !== 3) throw failure('官方账号身份验证失败，请重新登录。');
    const [head, payload, signature] = token.split('.'), header = jwtPart(head), claims = jwtPart(payload);
    if (header.alg !== 'RS256' || !text(header.kid, 200) || !/^[A-Za-z0-9_-]+$/.test(signature)) throw failure('官方账号身份验证失败，请重新登录。');
    let key;
    for (let pass = 0; pass < 2; pass++) {
      if (!this.jwks || this.jwks.expiresAt <= this.clock() || pass) {
        const data = await this._request(JWKS, { signal });
        if (!Array.isArray(data.keys) || data.keys.length > 64) throw failure('无法验证官方账号签名，请稍后重试。');
        this.jwks = { keys: data.keys, expiresAt: this.clock() + 300000 };
      }
      const matches = this.jwks.keys.filter(item => object(item) && item.kid === header.kid && item.kty === 'RSA' && (!item.alg || item.alg === 'RS256') && (!item.use || item.use === 'sig'));
      if (matches.length === 1) { key = matches[0]; break; }
    }
    try { if (!key || !verify('RSA-SHA256', Buffer.from(`${head}.${payload}`), createPublicKey({ key, format: 'jwk' }), Buffer.from(signature, 'base64url'))) throw new Error(); }
    catch { throw failure('官方账号身份验证失败，请重新登录。'); }
    const audience = typeof claims.aud === 'string' ? [claims.aud] : Array.isArray(claims.aud) ? claims.aud : [];
    if (claims.iss !== ISSUER || !audience.length || audience.length > 16 || audience.some(item => !text(item, 512)) || !audience.includes(clientId) || audience.length > 1 && claims.azp !== clientId || !Number.isFinite(claims.exp) || claims.exp * 1000 <= this.clock() || claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf * 1000 > this.clock() + 60000) || !text(claims.sub, 512) || subject && claims.sub !== subject || nonce !== undefined && !constantEqual(claims.nonce, nonce)) throw failure('官方账号身份验证失败，请重新登录。');
    return claims;
  }
  _tokens(response, previous) {
    if (!text(response.access_token) || typeof response.token_type !== 'string' || response.token_type.toLowerCase() !== 'bearer' || !Number.isFinite(response.expires_in) || response.expires_in <= 0 || response.expires_in > 31 * 86400 || response.refresh_token !== undefined && !text(response.refresh_token) || response.id_token !== undefined && !text(response.id_token, 65536) || response.scope !== undefined && (typeof response.scope !== 'string' || response.scope.length > 8192 || /[\x00-\x1f\x7f]/.test(response.scope))) throw failure('官方账号凭据格式异常，请重新登录。');
    const scopes = response.scope === undefined && previous ? [...previous.scopes] : typeof response.scope === 'string' ? response.scope.split(' ').filter(Boolean) : [];
    if (scopes.length > 64 || scopes.some(scope => !text(scope, 128))) throw failure('官方账号授权范围异常，请重新登录。');
    return { accessToken: response.access_token, refreshToken: response.refresh_token ?? previous?.refreshToken ?? '', idToken: response.id_token ?? previous?.idToken ?? '', scopes: [...new Set(scopes)], expiresAt: this.clock() + response.expires_in * 1000 };
  }
  async _complete(attempt, code, clientId) {
    await attempt.assert();
    let response;
    try { response = await this._request(TOKEN, { form: { grant_type: 'authorization_code', client_id: clientId, code, code_verifier: attempt.verifier, redirect_uri: attempt.redirectUri, resource: RESOURCE }, signal: attempt.controller.signal }); }
    catch (error) {
      // An issued registration is not yet an authenticated profile. Keep only
      // its ID in memory so a fresh authorization does not register it again.
      if (!attempt.selected && error.code === 'official_session_invalid' && error.invalidGrant) { await attempt.assert(); this._state(attempt.userId).retryClientId = clientId; }
      throw error;
    }
    const credentials = this._tokens(response), claims = await this._verifyId(response.id_token, clientId, { nonce: attempt.nonce, subject: attempt.selected?.subject, signal: attempt.controller.signal });
    await attempt.assert();
    const email = typeof claims.email === 'string' && claims.email.length <= 254 && !/[\x00-\x1f\x7f]/.test(claims.email) ? claims.email : '';
    await this._store(data => {
      let user = data.users.find(item => item.userId === attempt.userId); if (!user) { if (data.users.length >= 256) throw failure('保存的账号已达上限。'); user = { userId: attempt.userId, profiles: [], activeProfileId: null }; data.users.push(user); }
      let profile = attempt.selected ? user.profiles.find(item => item.id === attempt.selected.id) : user.profiles.find(item => item.clientId === clientId && item.subject === claims.sub);
      if (user.profiles.some(item => item.clientId === clientId && item.subject !== claims.sub) || attempt.selected && (!profile || profile.clientId !== clientId || profile.subject !== claims.sub)) throw failure('官方账号与保存的注册不匹配，请重新选择账号。');
      if (!profile) { if (user.profiles.length >= 64) throw failure('保存的官方账号已达上限。'); const id = randomUUID(); profile = { id, clientId, subject: claims.sub, email, label: `${email || 'ChatGPT 账号'} · ${id.slice(0, 6)}` }; user.profiles.push(profile); }
      Object.assign(profile, credentials, { email, revision: randomUUID() }); user.activeProfileId = profile.id;
    }, attempt.assert);
    this._state(attempt.userId).retryClientId = null;
    this._finish(attempt, planEnabled(credentials) ? '' : '官方账号已登录，但尚未允许使用 ChatGPT 套餐，请重新授权。');
  }
  async cancel(userId, { authorize } = {}) { await this.init(); const prior = this._state(userId); await this._guard(userId, prior.epoch, authorize)(); const state = this._invalidate(userId); state.error = ''; await this.tail.catch(() => {}); await this._guard(userId, state.epoch, authorize)(); this._notify(userId); return this._snapshot(userId); }
  async select(userId, profileId, { authorize } = {}) {
    await this.init(); if (!uuid(profileId) || !this._user(userId).profiles.some(profile => profile.id === profileId)) throw failure('保存的官方账号不存在。');
    await this._guard(userId, this._state(userId).epoch, authorize)();
    const state = this._invalidate(userId), epoch = state.epoch; state.error = '';
    await this._store(data => { const user = this._user(userId, data); user.activeProfileId = profileId; const profile = user.profiles.find(item => item.id === profileId); profile.revision = randomUUID(); }, this._guard(userId, epoch, authorize));
    this._notify(userId); return this._snapshot(userId);
  }
  async logout(userId, { authorize } = {}) {
    await this.init(); await this._guard(userId, this._state(userId).epoch, authorize)();
    const profile = this._profile(userId), revoke = profile?.refreshToken ? { token: profile.refreshToken, token_type_hint: 'refresh_token', client_id: profile.clientId } : null;
    const state = this._invalidate(userId), epoch = state.epoch; state.error = '';
    await this._store(data => { const user = this._user(userId, data), selected = user.profiles.find(item => item.id === user.activeProfileId); if (selected) clearTokens(selected); }, this._guard(userId, epoch, authorize));
    this._notify(userId);
    if (revoke) {
      let success = false;
      for (let attempt = 0; attempt < 2 && !success; attempt++) {
        if (attempt) { try { await awaitSignal(new Promise(resolve => setTimeout(resolve, 100)), state.controller.signal); } catch { break; } }
        try { await this._request(REVOKE, { form: revoke, signal: state.controller.signal, empty: true }); success = true; } catch (error) { if (error.code === 'official_auth_cancelled' || error.code === 'official_session_invalid') break; }
      }
      if (!success && !this.closed && state.epoch === epoch) { state.error = '已退出本机官方账号，远程会话撤销未确认；可在 ChatGPT 设置中断开此应用。'; this._notify(userId); }
    }
    return this._snapshot(userId);
  }
  async access(userId, { signal, forceRefresh = false } = {}) {
    await this.init(); if (signal?.aborted) throw cancelled(); const state = this._state(userId), epoch = state.epoch, profile = this._profile(userId);
    if (!profile || !signedIn(profile, this.clock())) throw failure('请先登录官方 ChatGPT 账号。', 'official_signin_required');
    if (!planEnabled(profile)) throw failure('请在官方授权中允许使用 ChatGPT 套餐。', 'official_plan_required');
    if (!forceRefresh && profile.accessToken && profile.expiresAt > this.clock() + 30000) return { accessToken: profile.accessToken, profileId: profile.id, revision: profile.revision };
    if (!state.refresh) {
      const refreshing = this._refresh(userId, profile, epoch, state.controller.signal);
      state.refresh = refreshing; void refreshing.finally(() => { if (state.refresh === refreshing) state.refresh = null; }).catch(() => {});
    }
    await awaitSignal(state.refresh, signal); this._assert(userId, epoch); if (signal?.aborted) throw cancelled();
    const current = this._profile(userId);
    if (!current || current.id !== profile.id || !current.accessToken || current.expiresAt <= this.clock() || !planEnabled(current)) throw failure('官方授权暂时不可用，请重新登录。', 'official_signin_required');
    return { accessToken: current.accessToken, profileId: current.id, revision: current.revision };
  }
  async _refresh(userId, profile, epoch, signal) {
    const assert = () => { this._assert(userId, epoch); const current = this._profile(userId); if (current?.id !== profile.id || current.revision !== profile.revision) throw cancelled(); };
    try {
      if (!profile.refreshToken) throw failure('官方登录已失效，请重新登录。', 'official_session_invalid');
      const response = await this._request(TOKEN, { form: { grant_type: 'refresh_token', client_id: profile.clientId, refresh_token: profile.refreshToken, resource: RESOURCE }, signal });
      const credentials = this._tokens(response, profile);
      if (response.id_token) await this._verifyId(response.id_token, profile.clientId, { subject: profile.subject, signal });
      assert(); await this._store(data => Object.assign(this._user(userId, data).profiles.find(item => item.id === profile.id), credentials), assert);
      if (planEnabled(credentials) !== planEnabled(profile)) this._notify(userId);
    } catch (error) {
      if (this.closed || this._state(userId).epoch !== epoch) throw cancelled();
      if (!['official_network_failed', 'official_auth_cancelled', 'official_storage_failed'].includes(error.code)) {
        await this._store(data => { const item = this._user(userId, data).profiles.find(entry => entry.id === profile.id); if (item) clearTokens(item); }, assert);
        this._state(userId).error = '官方登录已失效，请重新登录。'; this._notify(userId);
      }
      throw error.code?.startsWith('official_') ? error : failure('刷新官方登录失败，请重新登录。');
    }
  }
  async close() {
    if (this.closed) return; this.closed = true;
    for (const userId of this.runtime.keys()) this._invalidate(userId);
    await this.tail.catch(() => {});
  }
}
