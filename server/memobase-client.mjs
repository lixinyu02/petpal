import { createHash } from 'node:crypto';

const MAX_RESPONSE = 2 * 1024 * 1024;
export const memoryFailure = (status, code) => Object.assign(new Error(code), { status, code });
export function normalizeMemobaseUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw 0;
    url.pathname = url.pathname.replace(/\/api\/v1\/?$/, '').replace(/\/+$/, '');
    return url.toString().replace(/\/$/, '');
  } catch { throw memoryFailure(400, 'MEMORY_INVALID_URL'); }
}
export const memoryPayloadHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** The official API returns application errors in HTTP 200 responses. Never echo its bodies. */
export async function memoryJson(fetchImpl, url, { token, signal, timeoutMs = 10000, method = 'GET', body } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs); timeout.unref?.();
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  try {
    if (combined.aborted) throw memoryFailure(499, 'MEMORY_CANCELLED');
    const response = await fetchImpl(url, {
      method, signal: combined, redirect: 'error',
      headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const size = Number(response.headers?.get?.('content-length'));
    if (size > MAX_RESPONSE) throw memoryFailure(502, 'MEMORY_INVALID_RESPONSE');
    let raw = '';
    if (response.body?.getReader) {
      const reader = response.body.getReader(); let bytes = 0; const decoder = new TextDecoder();
      try {
        for (;;) { const item = await reader.read(); if (item.done) break; bytes += item.value.byteLength; if (bytes > MAX_RESPONSE) { await reader.cancel(); throw memoryFailure(502, 'MEMORY_INVALID_RESPONSE'); } raw += decoder.decode(item.value, { stream: true }); }
        raw += decoder.decode();
      } finally { reader.releaseLock(); }
    } else { raw = await response.text(); if (Buffer.byteLength(raw) > MAX_RESPONSE) throw memoryFailure(502, 'MEMORY_INVALID_RESPONSE'); }
    let result; try { result = JSON.parse(raw); } catch { throw memoryFailure(502, 'MEMORY_INVALID_RESPONSE'); }
    if (!response.ok) throw memoryFailure(response.status >= 400 && response.status < 600 ? response.status : 502, 'MEMORY_UPSTREAM_ERROR');
    return result;
  } catch (error) {
    if (signal?.aborted) throw memoryFailure(499, 'MEMORY_CANCELLED');
    if (controller.signal.aborted) throw memoryFailure(504, 'MEMORY_TIMEOUT');
    if (error?.code?.startsWith('MEMORY_')) throw error;
    throw memoryFailure(502, 'MEMORY_UNAVAILABLE');
  } finally { clearTimeout(timeout); }
}

export function createMemobaseClient({ baseUrl, apiKey, fetchImpl = globalThis.fetch, timeoutMs = 10000 }) {
  const base = normalizeMemobaseUrl(baseUrl);
  if (typeof apiKey !== 'string' || !apiKey.trim() || apiKey.length > 8192 || /[\r\n]/.test(apiKey)) throw memoryFailure(400, 'MEMORY_MISSING_KEY');
  const request = async (suffix, options = {}) => {
    const result = await memoryJson(fetchImpl, `${base}/api/v1${suffix}`, { token: apiKey, timeoutMs, ...options });
    if (!result || typeof result !== 'object' || result.errno !== 0) {
      const errno = Number(result?.errno);
      throw memoryFailure(Number.isInteger(errno) && errno >= 400 && errno < 600 ? errno : 502, 'MEMORY_API_ERROR');
    }
    return result.data;
  };
  const segment = value => { if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[45][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw memoryFailure(400, 'MEMORY_INVALID_ID'); return value; };
  return {
    async health(options) { return request('/healthcheck', options); },
    async ensureUser(userId, options) {
      const uid = segment(userId);
      try { await request(`/users/${uid}`, options); return; } catch (error) { if (error.status !== 404) throw error; }
      try { await request('/users', { ...options, method: 'POST', body: { id: uid, data: { source: 'petpal' } } }); }
      catch (error) { // An ambiguous create can be resolved by its deterministic user ID.
        try { await request(`/users/${uid}`, options); } catch { throw error; }
      }
    },
    async insert(userId, event, options) {
      const messages = [{ role: 'user', content: event.userText }, ...(event.assistantText ? [{ role: 'assistant', content: event.assistantText }] : [])];
      const data = await request(`/blobs/insert/${segment(userId)}?wait_process=false`, {
        ...options, method: 'POST', body: { blob_type: 'chat', blob_data: { messages }, fields: { source: 'petpal', eventId: event.id, epoch: event.epoch, payloadHash: event.fingerprint } },
      });
      if (!data || typeof data.id !== 'string') throw memoryFailure(502, 'MEMORY_INVALID_RESPONSE');
      return data.id;
    },
    async flush(userId, options) { return request(`/users/buffer/${segment(userId)}/chat?wait_process=true`, { ...options, timeoutMs: 120000, method: 'POST' }); },
    async context(userId, options = {}) {
      const data = await request(`/users/context/${segment(userId)}?max_token_size=1000`, { timeoutMs: 750, ...options });
      if (!data || typeof data.context !== 'string') throw memoryFailure(502, 'MEMORY_INVALID_RESPONSE');
      return data.context.slice(0, 6000);
    },
    async deleteUser(userId, options) { try { await request(`/users/${segment(userId)}`, { ...options, method: 'DELETE' }); } catch (error) { if (error.status !== 404) throw error; } },
    async findEvent(userId, event, { signal, maxPages = 100 } = {}) {
      const uid = segment(userId);
      for (let page = 0; page < maxPages; page++) {
        const data = await request(`/users/blobs/${uid}/chat?page=${page}&page_size=50`, { signal });
        if (!data || !Array.isArray(data.ids) || data.ids.length > 50) throw memoryFailure(502, 'MEMORY_INVALID_RESPONSE');
        for (const id of data.ids) {
          let blob; try { blob = await request(`/blobs/${uid}/${segment(id)}`, { signal }); } catch (error) { if (error.status === 404) continue; throw error; }
          if (blob?.fields?.source === 'petpal' && blob.fields.eventId === event.id && blob.fields.epoch === event.epoch) {
            if (blob.fields.payloadHash !== event.fingerprint) throw memoryFailure(409, 'MEMORY_EVENT_CONFLICT');
            return { found: true, id };
          }
        }
        if (data.ids.length < 50) return { found: false, complete: true };
      }
      return { found: false, complete: false };
    },
  };
}
