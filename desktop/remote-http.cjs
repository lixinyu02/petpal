'use strict';

const REMOTE_LIMITS = Object.freeze({ concurrency: 8, requestBytes: 16 * 1024 ** 2, responseBytes: 64 * 1024 ** 2, chunkBytes: 64 * 1024, headerBytes: 16 * 1024, headerTimeoutMs: 30000, synthesisTimeoutMs: 190000, idleTimeoutMs: 120000, ackTimeoutMs: 30000 });
const methods = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);
const requestHeaders = new Set(['authorization', 'content-type', 'accept', 'accept-language']);
const responseHeaders = new Set(['content-type', 'content-length', 'content-disposition', 'cache-control', 'etag', 'last-modified', 'retry-after']);
const requestId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);

function validateRemoteRequest(input, limits = REMOTE_LIMITS) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['id', 'url', 'method', 'headers', 'body', 'bodyEncoding', 'flowControl'].includes(key)) || !requestId(input.id)) throw new Error('远程请求标识或格式无效。');
  if (input.flowControl !== undefined && input.flowControl !== 'ack-v1') throw new Error('远程响应流控制格式无效。');
  if (typeof input.url !== 'string' || input.url.length > 4096 || /[\u0000-\u0020\\#]/.test(input.url)) throw new Error('远程服务地址无效。');
  let url;
  try { url = new URL(input.url); } catch { throw new Error('远程服务地址无效。'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || !url.pathname.startsWith('/api/') || /%(?:00|2f|5c)/i.test(url.pathname)) throw new Error('远程请求仅允许无内嵌凭据的 HTTP(S) API 地址。');
  if (typeof input.method !== 'string' || !methods.has(input.method.toUpperCase())) throw new Error('不支持此远程请求方法。');
  const method = input.method.toUpperCase(), headers = Object.create(null);
  if (!input.headers || typeof input.headers !== 'object' || Array.isArray(input.headers) || Object.keys(input.headers).length > requestHeaders.size) throw new Error('远程请求头无效。');
  let headerBytes = 0;
  for (const [name, value] of Object.entries(input.headers)) {
    const key = name.toLowerCase();
    if (!requestHeaders.has(key) || Object.hasOwn(headers, key) || typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value) || (headerBytes += Buffer.byteLength(name) + Buffer.byteLength(value)) > limits.headerBytes) throw new Error('远程请求头不受支持或过大。');
    headers[key] = value;
  }
  if (input.bodyEncoding !== undefined && !['utf8', 'base64'].includes(input.bodyEncoding)) throw new Error('远程请求体编码无效。');
  let body;
  if (input.body !== undefined) {
    if (method === 'GET' || method === 'HEAD' || typeof input.body !== 'string') throw new Error('远程请求体无效。');
    if (input.bodyEncoding === 'base64') {
      if (input.body.length > Math.ceil(limits.requestBytes / 3) * 4 || input.body.length % 4 || /[^A-Za-z0-9+/=]/.test(input.body)) throw new Error('远程二进制请求体无效或过大。');
      body = Buffer.from(input.body, 'base64');
      if (body.length > limits.requestBytes || body.toString('base64') !== input.body) throw new Error('远程二进制请求体无效或过大。');
    } else {
      if (input.body.length > limits.requestBytes || Buffer.byteLength(input.body) > limits.requestBytes) throw new Error('远程请求体过大。');
      body = input.body;
    }
  }
  return { id: input.id, url: url.href, method, headers, body, flowControl: input.flowControl };
}

function isPetPalReleaseUrl(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0020\\%?#]/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.origin === 'https://github.com' && !url.username && !url.password
      && /^\/lixinyu02\/petpal\/releases\/(?:download\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+|tag\/[A-Za-z0-9_.-]+|latest)\/?$/.test(url.pathname);
  } catch { return false; }
}

function abortable(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason); };
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) { reject(signal.reason); return; }
    signal.addEventListener('abort', abort, { once: true });
  });
}

/** The caller supplies credentials. This module never reads local owner tokens or browser cookies. */
function createDesktopRemoteHttp({ isAllowed, fetchImpl = globalThis.fetch, limits: overrides = {} }) {
  const limits = { ...REMOTE_LIMITS, ...overrides }, owners = new Map();
  let closed = false;
  const allowed = event => { try { return !closed && !event.sender.isDestroyed() && isAllowed(event); } catch { return false; } };
  const assertAllowed = event => { if (!allowed(event)) throw new Error('远程请求仅允许可信主窗口。'); };
  const cancelOwner = owner => { for (const entry of owners.get(owner)?.requests.values() || []) entry.controller.abort(new Error('远程请求已取消。')); };
  function ownerState(owner) {
    let state = owners.get(owner);
    if (state) return state;
    const cancel = () => cancelOwner(owner);
    const navigate = (details, _url, inPlace, mainFrame) => { if ((details?.isMainFrame ?? mainFrame) && !(details?.isSameDocument ?? inPlace)) cancel(); };
    state = { requests: new Map(), cancel, navigate };
    owner.on('destroyed', cancel); owner.on('render-process-gone', cancel); owner.on('did-start-navigation', navigate);
    owners.set(owner, state); return state;
  }
  function cleanupOwner(owner, state) {
    if (state.requests.size) return;
    owner.removeListener('destroyed', state.cancel); owner.removeListener('render-process-gone', state.cancel); owner.removeListener('did-start-navigation', state.navigate);
    owners.delete(owner);
  }
  async function request(event, raw) {
    assertAllowed(event);
    const input = validateRemoteRequest(raw, limits), owner = event.sender;
    const existing = owners.get(owner);
    if (existing?.requests.has(input.id)) throw new Error('远程请求标识重复。');
    if ((existing?.requests.size || 0) >= limits.concurrency) throw new Error('同时进行的远程请求过多。');
    const state = ownerState(owner), controller = new AbortController();
    const entry = { controller, done: null, acknowledgement: null }; state.requests.set(input.id, entry);
    const emit = payload => {
      if (!allowed(event)) { controller.abort(new Error('远程窗口已关闭或离开。')); return; }
      try { event.senderFrame.send('petpal:remote:event', input.id, payload); }
      catch { controller.abort(new Error('远程窗口已关闭或离开。')); }
    };
    entry.done = (async () => {
      let timer, reader, finished = false, sequence = 0;
      const deadline = (ms, message) => { clearTimeout(timer); timer = setTimeout(() => controller.abort(new Error(message)), ms); timer.unref?.(); };
      try {
        // Both voice routes may need the bounded synthesis budget for cold starts.
        const synthesizing = input.method === 'POST' && ['/api/voice/synthesize', '/api/voice/synthesize/stream'].includes(new URL(input.url).pathname);
        deadline(synthesizing ? limits.synthesisTimeoutMs : limits.headerTimeoutMs, '远程服务连接超时。');
        const response = await abortable(fetchImpl(input.url, { method: input.method, headers: input.headers, body: input.body, signal: controller.signal, redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' }), controller.signal);
        controller.signal.throwIfAborted(); clearTimeout(timer);
        if (response.status < 200 || response.status > 599 || response.status >= 300 && response.status < 400 && response.status !== 304) throw new Error('远程服务返回了不支持的重定向。');
        const headers = Object.create(null);
        for (const [key, value] of response.headers) if (responseHeaders.has(key) && !(key === 'content-length' && response.headers.has('content-encoding'))) headers[key] = value;
        const length = Number(response.headers.get('content-length'));
        if (Number.isFinite(length) && length > limits.responseBytes) throw new Error('远程响应超过大小限制。');
        emit({ type: 'headers', status: response.status, headers });
        if (response.body) {
          reader = response.body.getReader(); let received = 0;
          while (true) {
            deadline(limits.idleTimeoutMs, '远程响应等待超时。');
            const { done, value } = await abortable(reader.read(), controller.signal);
            controller.signal.throwIfAborted();
            if (done) break;
            received += value.byteLength;
            if (received > limits.responseBytes) throw new Error('远程响应超过大小限制。');
            for (let offset = 0; offset < value.byteLength; offset += limits.chunkBytes) {
              controller.signal.throwIfAborted();
              const chunk = { type: 'chunk', bytes: Array.from(value.subarray(offset, offset + limits.chunkBytes)) };
              if (input.flowControl === 'ack-v1') {
                // Exactly one IPC chunk may be in flight. Install the waiter before
                // sending so an immediate consumer acknowledgement cannot be lost.
                chunk.sequence = ++sequence;
                const consumed = new Promise(resolve => { entry.acknowledgement = { sequence, resolve }; });
                deadline(limits.ackTimeoutMs, '远程响应读取停滞，已停止请求。');
                emit(chunk);
                try { await abortable(consumed, controller.signal); }
                finally { entry.acknowledgement = null; }
              } else emit(chunk);
            }
          }
        }
        controller.signal.throwIfAborted(); emit({ type: 'end' }); finished = true;
      } catch (error) {
        // Never forward upstream exception strings: they can contain URLs or supplied credentials.
        const message = controller.signal.aborted ? (controller.signal.reason?.message || '远程请求已取消。')
          : /^(远程响应超过大小限制|远程服务返回了不支持的重定向)/.test(error?.message || '') ? error.message : '远程请求失败，请检查服务地址、网络或证书。';
        emit({ type: 'error', message });
      } finally {
        clearTimeout(timer);
        entry.acknowledgement = null;
        if (!finished) controller.abort(new Error('远程请求已结束。'));
        if (reader) { if (!finished) void reader.cancel().catch(() => {}); try { reader.releaseLock(); } catch {} }
        state.requests.delete(input.id); cleanupOwner(owner, state);
      }
    })();
    await entry.done;
  }
  return {
    request,
    async abort(event, id) { assertAllowed(event); if (!requestId(id)) throw new Error('远程请求标识无效。'); owners.get(event.sender)?.requests.get(id)?.controller.abort(new Error('远程请求已取消。')); },
    async acknowledge(event, id, sequence) {
      assertAllowed(event);
      if (!requestId(id) || !Number.isSafeInteger(sequence) || sequence < 1) throw new Error('远程响应确认格式无效。');
      const entry = owners.get(event.sender)?.requests.get(id);
      // A legitimate ACK can arrive after an abort has already removed its request.
      if (!entry || entry.controller.signal.aborted) return;
      const pending = entry.acknowledgement;
      if (!pending || pending.sequence !== sequence) throw new Error('远程响应确认顺序无效。');
      entry.acknowledgement = null;
      pending.resolve();
    },
    cancelOwner,
    async close() {
      closed = true;
      const pending = [];
      for (const [owner, state] of owners) { for (const entry of state.requests.values()) pending.push(entry.done); cancelOwner(owner); }
      await Promise.allSettled(pending);
    },
  };
}

module.exports = { REMOTE_LIMITS, validateRemoteRequest, createDesktopRemoteHttp, isPetPalReleaseUrl };
