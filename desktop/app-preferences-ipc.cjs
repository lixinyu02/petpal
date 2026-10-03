'use strict';

const { timingSafeEqual } = require('node:crypto');

const messages = Object.freeze({
  untrusted: '应用设置仅允许可信主窗口管理。',
  login: '请先登录后再修改应用设置。',
  changed: '登录账号已变化，请重新打开设置后再试。',
  verification: '无法验证当前登录，请检查服务连接或重新登录。',
  status: '无法读取应用设置，请重新打开小伴后再试。',
  update: '应用设置未能保存，请检查系统权限后再试。',
  apply: '设置已保存，但窗口状态未能更新，请重新打开小伴。',
});

const preferenceError = key => Object.assign(new Error(messages[key]), { code: `PETPAL_PREFERENCES_${key.toUpperCase()}` });
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value);

function validatePreferencesConnection(value) {
  try {
    if (!object(value) || Object.keys(value).length !== 2 || !Object.hasOwn(value, 'url') || !Object.hasOwn(value, 'token') ||
        typeof value.url !== 'string' || !value.url || value.url.length > 2048 || /[\x00-\x20\x7f\\?#]/.test(value.url) ||
        typeof value.token !== 'string' || !value.token || value.token.length > 4096 || /[\x00-\x20\x7f]/.test(value.token)) throw preferenceError('login');
    const url = new URL(value.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash ||
        /%(?:00|2f|5c)/i.test(url.pathname)) throw preferenceError('login');
    // Only this exact snapshot is authorized. Neither owner bootstrap tokens nor
    // executor credentials are substituted for the account selected in the UI.
    return { url: url.href.replace(/\/+$/, ''), token: value.token };
  } catch { throw preferenceError('login'); }
}

function sameConnection(left, right) {
  if (left.url !== right.url) return false;
  const a = Buffer.from(left.token), b = Buffer.from(right.token);
  return a.length === b.length && timingSafeEqual(a, b);
}

function abortable(promise, signal) {
  return new Promise((resolve, reject) => {
    const aborted = () => { signal.removeEventListener('abort', aborted); reject(preferenceError('verification')); };
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
    if (signal.aborted) { aborted(); return; }
    signal.addEventListener('abort', aborted, { once: true });
  });
}

/** Verify any currently selected PetPal login; Chat-only accounts are eligible. */
async function verifyPreferencesSessionConnection(connection, {
  fetchImpl = globalThis.fetch, timeoutMs = 10000, maxBytes = 32768,
} = {}) {
  const current = validatePreferencesConnection(connection);
  if (typeof fetchImpl !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000 ||
      !Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 65536) throw preferenceError('verification');
  const target = `${current.url}/api/auth/me`, controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let reader, body, completed = false;
  try {
    const response = await abortable(fetchImpl(target, {
      method: 'GET', headers: { Authorization: `Bearer ${current.token}`, Accept: 'application/json' },
      redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', signal: controller.signal,
    }), controller.signal);
    body = response.body;
    if (response.status !== 200 || response.redirected || response.url && response.url !== target || !body) throw preferenceError('verification');
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) throw preferenceError('verification');
    reader = body.getReader();
    const chunks = []; let bytes = 0;
    for (;;) {
      const chunk = await abortable(reader.read(), controller.signal);
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) throw preferenceError('verification');
      chunks.push(Buffer.from(chunk.value));
    }
    controller.signal.throwIfAborted();
    const identity = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    if (!object(identity) || !identifier(identity.instanceId) || !object(identity.user) || !identifier(identity.user.id)) throw preferenceError('verification');
    completed = true;
    // Do not return upstream arbitrary fields, account permissions or credentials.
    return { instanceId: identity.instanceId, userId: identity.user.id };
  } catch { throw preferenceError('verification'); }
  finally {
    clearTimeout(timer);
    if (!completed) controller.abort();
    if (reader) { if (!completed) void reader.cancel().catch(() => {}); try { reader.releaseLock(); } catch {} }
    else if (!completed && body) void body.cancel().catch(() => {});
  }
}

function createAppPreferencesHandlers(preferences, { isAllowed, readConnection, verifyConnection = verifyPreferencesSessionConnection, onUpdated = () => {} }) {
  const assertAllowed = event => {
    let allowed = false;
    try { allowed = isAllowed(event); } catch {}
    if (!allowed) throw preferenceError('untrusted');
  };
  const snapshot = async event => {
    try { return validatePreferencesConnection(await readConnection(event)); }
    catch { throw preferenceError('login'); }
  };
  return {
    'petpal:app-preferences:status': async event => {
      assertAllowed(event);
      let value;
      try { value = await preferences.status(); } catch { throw preferenceError('status'); }
      assertAllowed(event);
      return value;
    },
    'petpal:app-preferences:update': async (event, connection, patch) => {
      assertAllowed(event);
      const expected = validatePreferencesConnection(connection);
      const compare = async () => {
        assertAllowed(event);
        if (!sameConnection(expected, await snapshot(event))) throw preferenceError('changed');
        assertAllowed(event);
      };
      let authorizationError;
      const authorize = async () => {
        try {
          await compare();
          try { await verifyConnection(expected); } catch { throw preferenceError('verification'); }
          await compare();
        } catch (error) { authorizationError = error; throw error; }
      };
      await authorize();
      let next;
      try { next = await preferences.update(patch, { authorize }); }
      catch (error) {
        if (authorizationError) throw authorizationError;
        if (Object.values(messages).includes(error?.message) && /^PETPAL_PREFERENCES_[A-Z]+$/.test(error?.code || '')) throw error;
        throw preferenceError('update');
      }
      await compare();
      try { await onUpdated(next); } catch { throw preferenceError('apply'); }
      await compare();
      return next;
    },
  };
}

module.exports = { createAppPreferencesHandlers, verifyPreferencesSessionConnection };
