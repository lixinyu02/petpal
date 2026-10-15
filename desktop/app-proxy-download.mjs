const MAX_URL_LENGTH = 4096;
const MAX_CONFIG_BYTES = 4 * 1024 * 1024;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const unsafeAddressCharacters = /[\p{Cc}\\#]/u;
const ownedErrors = new WeakSet();

export const PROXY_DOWNLOAD_ERRORS = Object.freeze({
  ADDRESS: '请输入有效的 HTTP 或 HTTPS 配置地址，地址不能包含账号密码或片段。',
  FAILED: '远程配置下载失败，请检查地址、网络或服务器。',
  RESPONSE: '远程服务器未返回可用配置，请检查地址或访问权限。',
  REDIRECT: '远程配置重定向无效或次数过多。',
  DOWNGRADE: '远程配置不允许从 HTTPS 降级到 HTTP。',
  TOO_LARGE: '远程配置文件过大，未覆盖原配置。',
  TIMEOUT: '远程配置下载超时，请稍后重试。',
  CANCELLED: '远程配置下载已取消。',
  TEXT: '远程配置必须是有效的 UTF-8 文本。',
  EMPTY: '远程服务器返回了空配置。',
  HTML: '远程服务器返回了网页，请使用直接下载 Clash YAML 的地址。',
});

function fail(kind) {
  const error = Object.assign(new Error(PROXY_DOWNLOAD_ERRORS[kind]), { code: 'PETPAL_PROXY' });
  ownedErrors.add(error);
  return error;
}

function validAddressText(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_URL_LENGTH
    && value.trim() === value && !unsafeAddressCharacters.test(value);
}

export function normalizeRemoteConfigUrl(value) {
  if (!validAddressText(value) || !/^https?:\/\//i.test(value)) throw fail('ADDRESS');
  try {
    const address = new URL(value);
    // Empty userinfo and an empty fragment also count as credentials/fragments;
    // WHATWG URL.username and URL.hash alone cannot detect those spellings.
    const authority = value.match(/^https?:\/\/([^/?#]*)/i)?.[1] || '';
    if (!['http:', 'https:'].includes(address.protocol) || !address.hostname || !authority
      || authority.includes('@') || address.username || address.password || address.hash
      || address.href.length > MAX_URL_LENGTH) throw fail('ADDRESS');
    return address.href;
  } catch {
    throw fail('ADDRESS');
  }
}

function redirectAddress(value, current) {
  if (!validAddressText(value)) throw fail('REDIRECT');
  let result;
  try {
    // Preserve raw absolute/network-path spelling until validation: URL.href
    // discards an empty userinfo segment (https://@host) while resolving it.
    if (/^[a-z][a-z\d+.-]*:/i.test(value)) result = normalizeRemoteConfigUrl(value);
    else if (value.startsWith('//')) result = normalizeRemoteConfigUrl(`${new URL(current).protocol}${value}`);
    else result = normalizeRemoteConfigUrl(new URL(value, current).href);
  }
  catch { throw fail('REDIRECT'); }
  if (new URL(current).protocol === 'https:' && new URL(result).protocol !== 'https:') throw fail('DOWNGRADE');
  return result;
}

function cancelBody(response, reader) {
  // Some injected fetch implementations do not honor AbortSignal. Cancellation
  // is invoked without awaiting it so a stalled stream cannot defeat the bound.
  try { Promise.resolve(reader ? reader.cancel() : response?.body?.cancel()).catch(() => {}); }
  catch { /* A detached/closed body needs no further cancellation. */ }
}

export async function downloadProxyConfiguration(value, options = {}) {
  const source = normalizeRemoteConfigUrl(value);
  let fetchImpl, signal, timeoutMs, maxBytes, maxRedirects;
  try {
    if (!options || typeof options !== 'object' || Array.isArray(options)) throw fail('FAILED');
    ({ fetchImpl = fetch, signal, timeoutMs = 20000, maxBytes = MAX_CONFIG_BYTES, maxRedirects = 3 } = options);
    if (typeof fetchImpl !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000
      || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_CONFIG_BYTES
      || !Number.isSafeInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > 10
      || (signal !== undefined && !(signal instanceof AbortSignal))) throw fail('FAILED');
  } catch { throw fail('FAILED'); }
  const controller = new AbortController();
  let response, reader, stoppedError, completed = false;
  let rejectStopped;
  const stopped = new Promise((_, reject) => { rejectStopped = reject; });
  // Attach a rejection consumer before a pre-aborted caller can stop the scope.
  stopped.catch(() => {});
  const stop = kind => {
    if (stoppedError) return;
    stoppedError = fail(kind);
    controller.abort();
    cancelBody(response, reader);
    rejectStopped(stoppedError);
  };
  const externalAbort = () => stop('CANCELLED');
  signal?.addEventListener('abort', externalAbort, { once: true });
  const timer = setTimeout(() => stop('TIMEOUT'), timeoutMs);
  if (signal?.aborted) externalAbort();
  const bounded = promise => Promise.race([promise, stopped]);
  try {
    let current = source, redirects = 0;
    while (true) {
      if (stoppedError) throw stoppedError;
      const pending = Promise.resolve().then(() => {
        if (stoppedError) throw stoppedError;
        return fetchImpl(current, {
          method: 'GET', redirect: 'manual', credentials: 'omit', cache: 'no-store',
          referrerPolicy: 'no-referrer', signal: controller.signal,
          headers: { Accept: 'application/yaml, text/yaml, text/plain, application/octet-stream;q=0.8' },
        });
      }).then(result => {
        // A late fetch resolution still owns a response body that must be closed.
        if (controller.signal.aborted) cancelBody(result);
        return result;
      });
      response = await bounded(pending);
      if (stoppedError) throw stoppedError;
      if (REDIRECT_STATUSES.has(response.status)) {
        if (redirects++ >= maxRedirects) throw fail('REDIRECT');
        current = redirectAddress(response.headers.get('location'), current);
        cancelBody(response);
        response = undefined;
        continue;
      }
      if (!Number.isInteger(response.status) || response.status < 200 || response.status >= 300) throw fail('RESPONSE');
      const length = response.headers.get('content-length');
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) throw fail('TOO_LARGE');
      const contentType = response.headers.get('content-type') || '';
      if (/^\s*(?:text\/html|application\/xhtml\+xml)(?:\s*;|$)/i.test(contentType)) throw fail('HTML');
      if (!response.body) throw fail('EMPTY');
      reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8', { fatal: true });
      let bytes = 0, chunks = 0, yaml = '';
      while (true) {
        // Yield occasionally even for synchronously supplied/zero-byte chunks;
        // a stream cannot keep the event loop in microtasks past its deadline.
        if (++chunks % 128 === 0) await bounded(new Promise(resolve => setTimeout(resolve, 0)));
        const chunk = await bounded(reader.read());
        if (stoppedError) throw stoppedError;
        if (chunk.done) break;
        if (!(chunk.value instanceof Uint8Array)) throw fail('TEXT');
        bytes += chunk.value.byteLength;
        if (bytes > maxBytes) throw fail('TOO_LARGE');
        try { yaml += decoder.decode(chunk.value, { stream: true }); }
        catch { throw fail('TEXT'); }
      }
      try { yaml += decoder.decode(); }
      catch { throw fail('TEXT'); }
      if (!yaml.trim()) throw fail('EMPTY');
      if (/^(?:\s*<!--[\s\S]*?-->)*\s*<(?:!doctype\s+html\b|html\b|head\b|body\b)/i.test(yaml)) throw fail('HTML');
      completed = true;
      return { yaml, url: source };
    }
  } catch (error) {
    if (stoppedError) throw stoppedError;
    throw ownedErrors.has(error) ? error : fail('FAILED');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', externalAbort);
    if (!completed) {
      controller.abort();
      cancelBody(response, reader);
    }
    try { reader?.releaseLock(); } catch { /* Pending injected reads may hold the lock. */ }
  }
}
