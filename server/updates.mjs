import { createHash, createPublicKey, randomUUID, verify } from 'node:crypto';

export const UPDATE_CHANNEL = 'stable';
export const UPDATE_MANIFEST_LIMIT = 128 * 1024;
export const UPDATE_FILE_LIMIT = 2 * 1024 * 1024 * 1024;
const FORMATS = Object.freeze({ 'windows-x64': 'portable-exe', 'ubuntu-x64': 'tar.gz', 'ubuntu-arm64': 'tar.gz', android: 'apk', web: 'web-zip' });
const failure = (status, message) => Object.assign(new Error(message), { status });
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const fields = (value, allowed) => object(value) && Object.keys(value).every(key => allowed.includes(key));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export function validateUpdateRepository(value) {
  if (typeof value !== 'string' || value.length > 140 || !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38})\/[a-zA-Z0-9_.-]{1,100}$/.test(value) || value.split('/')[1].startsWith('.') || value.split('/')[1].endsWith('.')) throw failure(400, '更新仓库必须是公开 GitHub owner/repo。');
  return value.toLowerCase();
}

export function parseStableVersion(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/.test(value)) throw failure(400, '更新版本必须是稳定版本号，例如 0.6.0。');
  return value.split('.').map(Number);
}

export function compareStableVersions(left, right) {
  const a = parseStableVersion(left), b = parseStableVersion(right);
  for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  return 0;
}

function publicKey(value) {
  if (typeof value !== 'string' || value.length > 2048) throw failure(400, '发布公钥必须是 Ed25519 SPKI PEM 公钥。');
  if (!value.trim()) return { pem: '', fingerprint: '' };
  if (!/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+\r?\n-----END PUBLIC KEY-----\s*$/.test(value.trim())) throw failure(400, '发布公钥必须是 Ed25519 SPKI PEM 公钥。');
  try {
    const key = createPublicKey(value);
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('Wrong key type');
    const der = key.export({ type: 'spki', format: 'der' });
    return { pem: key.export({ type: 'spki', format: 'pem' }).toString(), fingerprint: digest(der) };
  } catch { throw failure(400, '发布公钥必须是有效的 Ed25519 SPKI PEM 公钥。'); }
}

function httpsUrl(value, allowQuery = false) {
  if (typeof value !== 'string' || value.length > 8192 || /[\x00-\x20\x7f\\]/.test(value)) throw failure(400, '更新资产地址格式无效。');
  let url;
  try { url = new URL(value); } catch { throw failure(400, '更新资产地址格式无效。'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port || (!allowQuery && (url.search || value.includes('?'))) || value.includes('#')) throw failure(400, '更新资产必须使用无凭据的 GitHub HTTPS 地址。');
  return url;
}

function githubPath(url, repository, latest = false) {
  if (url.hostname !== 'github.com') return false;
  const prefix = `/${repository}/releases/`;
  if (latest && url.pathname.toLowerCase() === `${prefix}latest/download/petpal-update.json`) return true;
  const segments = url.pathname.split('/');
  if (segments.length !== 7 || segments.slice(1, 3).join('/').toLowerCase() !== repository || segments[3] !== 'releases' || segments[4] !== 'download') return false;
  try { return segments.slice(5).every(segment => { const decoded = decodeURIComponent(segment); return decoded && decoded !== '.' && decoded !== '..' && !/[\/\\\x00-\x20\x7f]/.test(decoded); }); } catch { return false; }
}

export function validateGitHubAssetUrl(value, repository) {
  const repo = validateUpdateRepository(repository), url = httpsUrl(value);
  if (!githubPath(url, repo)) throw failure(400, '更新资产必须属于所配置 GitHub 仓库的 Releases。');
  return url.href;
}

export function validateGitHubRedirect(from, to, repository) {
  const repo = validateUpdateRepository(repository), source = httpsUrl(from), target = httpsUrl(to, true);
  if (!githubPath(source, repo, true)) throw failure(502, '更新源返回不允许的重定向。');
  if (target.hostname === 'github.com' && !target.search && !to.includes('?') && githubPath(target, repo, true)) return target.href;
  if (target.hostname === 'release-assets.githubusercontent.com' && target.pathname.startsWith('/github-production-release-asset/') && target.pathname.length > '/github-production-release-asset/'.length) return target.href;
  throw failure(502, '更新源返回不允许的重定向。');
}

function decode64(value, maximum) {
  if (typeof value !== 'string' || !value.length || value.length > Math.ceil(maximum * 4 / 3) || !/^[A-Za-z0-9_-]+$/.test(value)) throw failure(502, '更新清单编码无效。');
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.length > maximum || bytes.toString('base64url') !== value) throw failure(502, '更新清单编码无效。');
  return bytes;
}

function parseJson(bytes) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw failure(502, '更新清单不是有效 UTF-8 JSON。'); }
}

function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) throw failure(502, '更新清单时间格式无效。');
  const result = Date.parse(value);
  if (!Number.isFinite(result) || new Date(result).toISOString().replace('.000Z', 'Z') !== value.replace('.000Z', 'Z')) throw failure(502, '更新清单时间格式无效。');
  return result;
}

export function verifyUpdateEnvelope(bytes, { repository, publicKey: pem, now = Date.now() }) {
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
  if (bytes.length > UPDATE_MANIFEST_LIMIT) throw failure(502, '更新清单超过 128 KiB 限制。');
  const envelope = parseJson(bytes);
  if (!fields(envelope, ['schemaVersion', 'payload', 'signature']) || envelope.schemaVersion !== 1) throw failure(502, '更新清单格式不受支持。');
  const payloadBytes = decode64(envelope.payload, UPDATE_MANIFEST_LIMIT), signature = decode64(envelope.signature, 64);
  const trustedKey = publicKey(pem);
  if (!trustedKey.pem || signature.length !== 64 || !verify(null, payloadBytes, trustedKey.pem, signature)) throw failure(502, '更新清单签名验证失败。');
  const payload = parseJson(payloadBytes);
  if (!fields(payload, ['product', 'channel', 'sequence', 'issuedAt', 'expiresAt', 'releases']) || payload.product !== 'petpal' || payload.channel !== UPDATE_CHANNEL || !Number.isSafeInteger(payload.sequence) || payload.sequence < 1 || !Array.isArray(payload.releases) || !payload.releases.length || payload.releases.length > 5) throw failure(502, '更新清单内容无效。');
  const issued = timestamp(payload.issuedAt), expires = timestamp(payload.expiresAt);
  if (issued > now + 5 * 60 * 1000 || expires <= now || expires <= issued) throw failure(502, '更新清单已过期或发布时间无效。');
  const ids = new Set(), targets = new Set();
  const releases = payload.releases.map(item => {
    try {
      if (!fields(item, ['id', 'target', 'version', 'versionCode', 'url', 'sha256', 'bytes', 'notes', 'format']) || typeof item.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(item.id) || ids.has(item.id) || typeof item.target !== 'string' || !Object.hasOwn(FORMATS, item.target) || targets.has(item.target) || item.format !== FORMATS[item.target]) throw new Error('target');
      parseStableVersion(item.version);
      const url = validateGitHubAssetUrl(item.url, repository);
      if (typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(item.sha256) || !Number.isSafeInteger(item.bytes) || item.bytes < 1 || item.bytes > UPDATE_FILE_LIMIT || typeof item.notes !== 'string' || item.notes.length > 16000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(item.notes)) throw new Error('metadata');
      if (item.target === 'android' ? (!Number.isInteger(item.versionCode) || item.versionCode < 1 || item.versionCode > 2100000000) : item.versionCode !== undefined) throw new Error('versionCode');
      ids.add(item.id); targets.add(item.target);
      return { ...item, url };
    } catch { throw failure(502, '更新发布项的版本、平台、地址、大小或校验值无效。'); }
  });
  return { ...payload, releases, payloadHash: digest(payloadBytes), keyFingerprint: trustedKey.fingerprint };
}

async function limitedBody(response, signal) {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > UPDATE_MANIFEST_LIMIT)) { void response.body?.cancel().catch(() => {}); throw failure(502, '更新清单超过 128 KiB 限制。'); }
  if (!response.body) throw failure(502, '更新清单内容为空。');
  const reader = response.body.getReader(), chunks = [];
  let total = 0, complete = false, rejectAbort;
  const aborted = new Promise((resolve, reject) => { rejectAbort = reject; });
  const abort = () => { rejectAbort(signal.reason); void reader.cancel(signal.reason).catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    while (true) {
      const { value, done } = await Promise.race([reader.read(), aborted]);
      signal.throwIfAborted();
      if (done) { complete = true; break; }
      total += value.byteLength;
      if (total > UPDATE_MANIFEST_LIMIT) throw failure(502, '更新清单超过 128 KiB 限制。');
      chunks.push(Buffer.from(value));
    }
    if (declared !== null && Number(declared) !== total) throw failure(502, '更新清单传输长度不匹配。');
    return Buffer.concat(chunks, total);
  } finally { signal.removeEventListener('abort', abort); if (!complete) void reader.cancel().catch(() => {}); }
}

async function fetchManifest(repository, fetchImpl, signal) {
  let url = `https://github.com/${repository}/releases/latest/download/petpal-update.json`;
  const visited = new Set();
  for (let redirects = 0; redirects <= 3; redirects++) {
    signal.throwIfAborted();
    if (visited.has(url)) throw failure(502, '更新源重定向形成循环。');
    visited.add(url);
    const response = await fetchImpl(url, { method: 'GET', headers: { Accept: 'application/json', 'User-Agent': 'PetPal-Updater/0.6' }, redirect: 'manual', credentials: 'omit', signal });
    signal.throwIfAborted();
    // A custom transport must not silently follow redirects on our behalf.
    if (response.redirected || (response.url && response.url !== url)) { void response.body?.cancel().catch(() => {}); throw failure(502, '更新传输绕过了重定向校验。'); }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      void response.body?.cancel().catch(() => {});
      const location = response.headers.get('location');
      if (!location || redirects === 3) throw failure(502, '更新源重定向次数过多或缺少地址。');
      if (location.length > 8192 || /[\x00-\x20\x7f\\]/.test(location)) throw failure(502, '更新源重定向地址无效。');
      let next;
      try { next = new URL(location, url).href; } catch { throw failure(502, '更新源重定向地址无效。'); }
      url = validateGitHubRedirect(url, next, repository); continue;
    }
    if (response.status === 404) { void response.body?.cancel().catch(() => {}); throw failure(404, 'GitHub 仓库尚未发布签名更新清单。'); }
    if (response.status !== 200) { void response.body?.cancel().catch(() => {}); throw failure(502, 'GitHub 更新源暂时不可用。'); }
    return limitedBody(response, signal);
  }
  throw failure(502, '更新源重定向次数过多。');
}

export function createUpdateService({ store, fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 15000 } = {}) {
  const state = store.state;
  state.updateConfig ??= { repository: 'lixinyu02/petpal', publicKey: '', revision: randomUUID() };
  state.updateTrustState ??= {};
  const stored = state.updateConfig;
  if (!fields(stored, ['repository', 'publicKey', 'revision']) || validateUpdateRepository(stored.repository) !== stored.repository || publicKey(stored.publicKey).pem !== stored.publicKey || !/^[a-f0-9-]{36}$/.test(stored.revision) || !object(state.updateTrustState) || Object.entries(state.updateTrustState).some(([key, value]) => !/^[a-f0-9]{64}:stable$/.test(key) || !fields(value, ['sequence', 'payloadHash']) || !Number.isSafeInteger(value.sequence) || value.sequence < 1 || !/^[a-f0-9]{64}$/.test(value.payloadHash))) throw new Error('本地更新设置无效，请保留数据并检查备份。');
  const running = new Set(), checked = new Map();
  let closed = false, changing = false, closing, configTask, trustQueue = Promise.resolve();
  const statusConfig = () => ({ ...state.updateConfig, configured: Boolean(state.updateConfig.publicKey), channel: UPDATE_CHANNEL });
  const assertLive = () => { if (closed) throw failure(503, '更新服务正在退出。'); if (changing) throw failure(409, '更新设置正在保存，请稍后重试。'); };
  const sameConfig = config => { assertLive(); if (state.updateConfig.revision !== config.revision) throw failure(409, '更新源已变化，请重新检查更新。'); };

  const configure = async body => {
    assertLive();
    if (!fields(body, ['repository', 'publicKey', 'revision'])) throw failure(400, '更新配置包含不支持的字段。');
    const previous = state.updateConfig;
    if (body.revision !== undefined && body.revision !== previous.revision) throw failure(409, '更新设置已变化，请刷新后重试。');
    const next = { ...previous, ...(body.repository !== undefined ? { repository: validateUpdateRepository(body.repository) } : {}), ...(body.publicKey !== undefined ? { publicKey: publicKey(body.publicKey).pem } : {}) };
    if (next.repository === previous.repository && next.publicKey === previous.publicKey) return statusConfig();
    if (!Object.hasOwn(state.updateTrustState, `${publicKey(next.publicKey).fingerprint}:stable`) && Object.keys(state.updateTrustState).length >= 64 && next.publicKey) throw failure(400, '已保存过多发布公钥，请先整理可信更新历史。');
    next.revision = randomUUID(); changing = true;
    configTask = (async () => {
      for (const task of running) task.controller.abort(failure(409, '更新源已变化，请重新检查更新。'));
      checked.clear(); state.updateConfig = next;
      try { await store.save(); } catch (error) { state.updateConfig = previous; throw error; }
      finally { changing = false; }
      return statusConfig();
    })();
    return configTask;
  };

  const check = async ({ target, currentVersion, signal } = {}, remember = true) => {
    assertLive();
    if (typeof target !== 'string' || !Object.hasOwn(FORMATS, target)) throw failure(400, '更新目标平台无效。');
    parseStableVersion(currentVersion);
    signal?.throwIfAborted();
    const config = statusConfig();
    const result = { configured: config.configured, currentVersion, target, available: false, release: null, repository: config.repository, revision: config.revision, message: '尚未配置发布公钥，更新源未启用。', checkedAt: new Date(now()).toISOString() };
    if (!config.configured) return result;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(failure(504, '检查更新超时，请稍后重试。')), timeoutMs);
    const combined = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
    let finish;
    const done = new Promise(resolve => { finish = resolve; }), task = { controller, done }; running.add(task);
    try {
      const bytes = await fetchManifest(config.repository, fetchImpl, combined);
      combined.throwIfAborted(); sameConfig(config);
      const payload = verifyUpdateEnvelope(bytes, { ...config, now: now() });
      const trustId = `${payload.keyFingerprint}:${UPDATE_CHANNEL}`;
      const commit = trustQueue.catch(() => {}).then(async () => {
        combined.throwIfAborted(); sameConfig(config);
        const previous = state.updateTrustState[trustId];
        if (previous && (payload.sequence < previous.sequence || (payload.sequence === previous.sequence && payload.payloadHash !== previous.payloadHash))) throw failure(409, '更新清单回退或同序号内容变化，已拒绝。');
        if (!previous && Object.keys(state.updateTrustState).length >= 64) throw failure(400, '已保存过多发布公钥，请先整理可信更新历史。');
        state.updateTrustState[trustId] = { sequence: payload.sequence, payloadHash: payload.payloadHash };
        // Every successful check awaits a durable save. Keep the high-water mark
        // conservative after a disk failure; a retry saves it before returning.
        try { await store.save(); } catch { throw failure(503, '无法保存更新验证记录，已停止更新。'); }
      });
      trustQueue = commit; await commit;
      combined.throwIfAborted(); sameConfig(config);
      if (timestamp(payload.expiresAt) <= now()) throw failure(502, '更新清单已过期，请重新检查更新。');
      const highest = state.updateTrustState[trustId];
      if (highest.sequence !== payload.sequence || highest.payloadHash !== payload.payloadHash) throw failure(409, '更新清单已被较新检查替代，请重试。');
      const release = payload.releases.find(item => item.target === target);
      if (!release) return { ...result, message: '当前签名发布中没有此平台的安装包。' };
      if (compareStableVersions(release.version, currentVersion) <= 0) return { ...result, message: '当前客户端已是此更新源提供的最新版本。' };
      const validated = { ...release, repository: config.repository, revision: config.revision, manifestHash: payload.payloadHash, sequence: payload.sequence };
      if (remember) checked.set(`${target}:${currentVersion}:${release.id}`, { revision: config.revision, manifestHash: payload.payloadHash, target, currentVersion });
      if (checked.size > 100) checked.delete(checked.keys().next().value);
      return { ...result, available: true, release: validated, message: '发现已验证的新版本。' };
    } catch (error) {
      if (combined.aborted) throw combined.reason;
      if (error.status) throw error;
      throw failure(502, '无法连接 GitHub 更新源，请稍后重试。');
    } finally { clearTimeout(timer); running.delete(task); finish(); }
  };

  const resolveRelease = async (id, { target, currentVersion, signal } = {}) => {
    assertLive();
    const key = `${target}:${currentVersion}:${id}`, prior = checked.get(key);
    if (!prior || prior.revision !== state.updateConfig.revision || prior.target !== target || prior.currentVersion !== currentVersion) throw failure(409, '发布项未检查或已失效，请重新检查更新。');
    const result = await check({ target, currentVersion, signal }, false);
    if (!result.available || result.release.id !== id || result.revision !== prior.revision || result.release.manifestHash !== prior.manifestHash) { checked.delete(key); throw failure(409, '发布项或更新清单已变化，请重新检查更新。'); }
    return result.release;
  };
  const close = () => closing ??= (async () => { closed = true; for (const task of running) task.controller.abort(failure(503, '更新服务正在退出。')); checked.clear(); await Promise.allSettled([...running].map(task => task.done)); if (configTask) await configTask.catch(() => {}); })();
  return { statusConfig, configure, check, resolveRelease, close };
}
