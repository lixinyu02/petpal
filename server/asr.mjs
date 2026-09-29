import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { normalizeVoiceUrl } from './voice.mjs';

export const ASR_AUDIO = Object.freeze({ format: 'pcm_f32le', sampleRate: 24000, channels: 1, maxFrameBytes: 96000, maxSeconds: 60 });
const MAX_TEXT = 16000, MAX_MESSAGE = 65536, MAX_FRAMES = 2400;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
class AsrError extends Error { constructor(status, message, code) { super(message); this.status = status; this.code = code; } }
const failure = (status, message, code = 'asr_error') => new AsrError(status, message, code);
export const safeAsrError = error => error instanceof AsrError ? error : failure(502, '识别服务未能完成请求，请稍后重试。', 'upstream_error');
const unavailable = () => failure(401, '识别所属登录已失效，请重新登录。', 'auth_expired');
const timer = (callback, ms) => { const value = setTimeout(callback, ms); value.unref?.(); return value; };

export function validateAsrAudio(bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > ASR_AUDIO.maxFrameBytes || bytes.length % 4) throw failure(400, '音频块须为最多一秒的 24 kHz 单声道 float32 PCM。', 'invalid_audio');
  for (let offset = 0; offset < bytes.length; offset += 4) {
    const sample = bytes.readFloatLE(offset);
    if (!Number.isFinite(sample) || Math.abs(sample) > 1) throw failure(400, '音频包含无效采样值。', 'invalid_audio');
  }
  return bytes.length / 4;
}

/** One shared upstream slot; all capabilities remain bound to the creating login. */
export function createAsrService({ store, authorizeSession, webSocketFactory = url => new WebSocket(url, { perMessageDeflate: false, maxPayload: MAX_MESSAGE, handshakeTimeout: connectTimeoutMs }), fetchImpl = globalThis.fetch, now = Date.now,
  connectTimeoutMs = 8000, attachTimeoutMs = 8000, idleTimeoutMs = 8000, endTimeoutMs = 30000, timeoutMs = 120000,
  authPollMs = 1000, drainTimeoutMs = 5000, closeTimeoutMs = 5000, terminalCacheMs = 5000, testTimeoutMs = 5000, rateLimit = 30 } = {}) {
  const state = store.state;
  state.asrConfig ??= { baseUrl: '', apiKey: '', revision: randomUUID() };
  try {
    const initial = state.asrConfig;
    if (!object(initial) || Object.keys(initial).some(key => !['baseUrl', 'apiKey', 'revision'].includes(key)) || typeof initial.apiKey !== 'string' || initial.apiKey !== '' || !/^[a-f0-9-]{36}$/.test(initial.revision) || normalizeVoiceUrl(initial.baseUrl, 'ASR') !== initial.baseUrl) throw new Error();
  } catch { throw new Error('本地 ASR 配置无效，请保留数据并检查备份。'); }
  const sessions = new Map(), rates = new Map(), probes = new Set();
  let slot = null, closed = false, changing = false, mutation;
  const authorize = auth => { try { return authorizeSession(auth); } catch { throw unavailable(); } };
  const live = () => { if (closed) throw failure(503, '识别服务正在退出。', 'closed'); if (changing) throw failure(409, '识别配置正在保存。', 'config_changing'); };
  const publicConfig = (editable = false) => ({ editable, configured: Boolean(state.asrConfig.baseUrl), baseUrl: editable ? state.asrConfig.baseUrl : '', hasApiKey: false, revision: state.asrConfig.revision, busy: Boolean(slot), audio: { ...ASR_AUDIO } });
  const clear = (session, key) => { clearTimeout(session[key]); session[key] = null; };
  const current = session => {
    authorize(session.auth);
    if (session.revision !== state.asrConfig.revision) throw failure(409, '识别配置已变化，请重新开始。', 'config_changed');
  };
  const releaseSocket = session => {
    clear(session, 'closeTimer');
    if (slot === session) slot = null;
    session.socketClosed = true;
    session.resolveSocketDone();
  };
  const closeSocket = session => {
    if (!session.ws || session.ws.readyState === 3) { releaseSocket(session); return; }
    // Keep the shared slot until the upstream actually closes. A second user
    // cannot seize it while cancellation is still propagating.
    if (!session.closeTimer) session.closeTimer = timer(() => {
      try { session.ws.terminate?.(); } catch { /* close/error event releases the slot */ }
    }, closeTimeoutMs);
    try {
      if (session.ws.readyState === WebSocket.CONNECTING && session.ws.terminate) session.ws.terminate();
      else session.ws.close(1000, 'session finished');
    } catch { try { session.ws.terminate?.(); } catch { /* close/error event releases the slot */ } }
  };
  const forget = session => {
    clear(session, 'cacheTimer');
    if (sessions.get(session.id) === session) sessions.delete(session.id);
  };
  const detach = session => {
    const subscriber = session.subscriber;
    if (!subscriber) return;
    clearTimeout(subscriber.drainTimer); clearInterval(subscriber.heartbeat);
    subscriber.res.off('drain', subscriber.drain); subscriber.res.off('close', subscriber.closed); subscriber.res.off('error', subscriber.closed);
    session.subscriber = null;
  };
  const failSubscriber = session => {
    const res = session.subscriber?.res;
    detach(session);
    finish(session, failure(409, '识别连接已关闭，请重新开始。', 'client_closed'));
    res?.destroy();
  };
  const pump = session => {
    const sub = session.subscriber;
    if (!sub || sub.blocked) return;
    try { current(session); } catch { failSubscriber(session); return; }
    if (sub.res.destroyed || sub.res.writableEnded) { failSubscriber(session); return; }
    const frames = [];
    if (session.ready && !sub.readySent) frames.push({ type: 'ready', id: session.id, ...ASR_AUDIO });
    if (!session.terminal && session.version > sub.version) frames.push({ type: 'transcript', text: session.text, chunks: session.chunks });
    if (session.terminal) frames.push(session.terminal);
    for (const frame of frames) {
      try { current(session); } catch { failSubscriber(session); return; }
      if (frame.type === 'ready') sub.readySent = true;
      if (frame.type === 'transcript') sub.version = session.version;
      let writable;
      try { writable = sub.res.write(`event: ${frame.type}\ndata: ${JSON.stringify(frame)}\n\n`); }
      catch { failSubscriber(session); return; }
      if (frame.type === 'done' || frame.type === 'error') {
        detach(session);
        try { sub.res.end(); } catch { sub.res.destroy(); }
        return;
      }
      if (!writable) {
        sub.blocked = true;
        sub.drainTimer = timer(() => failSubscriber(session), drainTimeoutMs);
        return;
      }
    }
  };
  const finish = (session, error = null) => {
    if (session.terminal) return;
    session.terminal = error ? { type: 'error', error: safeAsrError(error).message, code: safeAsrError(error).code } : { type: 'done', text: session.text, chunks: session.chunks, done: true };
    for (const key of ['connectTimer', 'attachTimer', 'idleTimer', 'endTimer', 'totalTimer', 'expiryTimer']) clear(session, key);
    clearInterval(session.authTimer);
    session.upload = null;
    closeSocket(session);
    pump(session);
    session.cacheTimer = timer(() => forget(session), terminalCacheMs);
    const completed = [...sessions.values()].filter(value => value.terminal && value !== session);
    for (const value of completed.slice(0, Math.max(0, completed.length - 31))) forget(value);
  };
  const check = (id, auth, { terminal = false } = {}) => {
    live(); authorize(auth);
    const session = sessions.get(id);
    if (!session || session.auth.userId !== auth.userId || session.auth.sessionHash !== auth.sessionHash || session.auth.bootstrap !== auth.bootstrap) throw failure(404, '识别会话不存在或不属于当前登录。', 'not_found');
    try { current(session); } catch (error) { finish(session, error); throw error; }
    if (!terminal && session.terminal) throw failure(409, '识别会话已结束，请重新开始。', 'session_ended');
    return session;
  };
  const renewIdle = session => { clear(session, 'idleTimer'); session.idleTimer = timer(() => finish(session, failure(408, '没有及时收到音频，请重新开始。', 'audio_timeout')), idleTimeoutMs); };
  const create = auth => {
    live(); const identity = authorize(auth);
    if (!state.asrConfig.baseUrl) throw failure(409, '管理员尚未配置共享识别服务。', 'not_configured');
    if (slot) throw failure(429, '识别服务忙，请稍后再试。', 'busy');
    const time = now();
    for (const [user, entries] of rates) if (!entries.some(value => value > time - 60000)) rates.delete(user);
    const recent = (rates.get(auth.userId) ?? []).filter(value => value > time - 60000);
    if (recent.length >= rateLimit) throw failure(429, '识别请求过于频繁，请稍后再试。', 'rate_limited');
    recent.push(time); rates.set(auth.userId, recent);
    const session = { id: randomUUID(), auth: { ...auth }, revision: state.asrConfig.revision, text: '', chunks: 0, version: 0, messages: 0, sequence: 0, samples: 0, ready: false, ended: false, terminal: null };
    session.socketDone = new Promise(resolve => { session.resolveSocketDone = resolve; });
    slot = session; sessions.set(session.id, session);
    const expire = () => { try { current(session); } catch (error) { finish(session, error); } };
    session.authTimer = setInterval(expire, authPollMs); session.authTimer.unref?.();
    if (Number.isFinite(identity?.expiresAt) && identity.expiresAt - now() <= timeoutMs) session.expiryTimer = timer(() => finish(session, unavailable()), Math.max(0, identity.expiresAt - now()));
    session.connectTimer = timer(() => finish(session, failure(504, '识别服务连接超时。', 'connect_timeout')), connectTimeoutMs);
    session.attachTimer = timer(() => finish(session, failure(408, '识别事件流没有及时连接。', 'attach_timeout')), attachTimeoutMs);
    session.totalTimer = timer(() => finish(session, failure(504, '识别请求超时，请重新开始。', 'session_timeout')), timeoutMs);
    const url = new URL(`${state.asrConfig.baseUrl}/ws/asr`); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    try {
      session.ws = webSocketFactory(url.toString());
      session.ws.addEventListener('open', () => {
        if (session.terminal) { closeSocket(session); return; }
        try { current(session); session.ws.send('{}'); session.ready = true; clear(session, 'connectTimer'); renewIdle(session); pump(session); }
        catch (error) { finish(session, safeAsrError(error)); }
      });
      session.ws.addEventListener('message', event => {
        if (session.terminal) return;
        try {
          current(session);
          if (typeof event.data !== 'string' || Buffer.byteLength(event.data) > MAX_MESSAGE || ++session.messages > 512) throw failure(502, '识别服务返回的数据无效。', 'invalid_response');
          let value; try { value = JSON.parse(event.data); } catch { throw failure(502, '识别服务返回的数据无效。', 'invalid_response'); }
          if (!object(value) || value.error) throw failure(502, '识别服务未能完成音频处理。', 'upstream_error');
          if (typeof value.text !== 'string' || value.text.length > MAX_TEXT || /[\u0000-\u0008\u000b-\u001f\u007f]/u.test(value.text) || !Number.isSafeInteger(value.chunks) || value.chunks < session.chunks || value.chunks > MAX_FRAMES || (value.done !== undefined && typeof value.done !== 'boolean')) throw failure(502, '识别服务返回的数据无效。', 'invalid_response');
          session.text = value.text; session.chunks = value.chunks; session.version++;
          if (value.done === true) {
            if (!session.ended || !session.samples) throw failure(502, '识别服务过早结束了请求。', 'invalid_response');
            finish(session);
          } else pump(session);
        } catch (error) { finish(session, safeAsrError(error)); }
      });
      session.ws.addEventListener('error', () => { if (!session.terminal) finish(session, failure(502, '识别服务连接失败，请稍后重试。', 'upstream_error')); });
      session.ws.addEventListener('close', event => {
        releaseSocket(session);
        if (!session.terminal) finish(session, event.code === 1013 ? failure(429, '识别服务忙，请稍后再试。', 'busy') : failure(502, '识别连接提前结束，未收到完整结果。', 'incomplete'));
      });
    } catch { releaseSocket(session); finish(session, failure(502, '无法连接识别服务。', 'upstream_error')); }
    return { id: session.id, ...ASR_AUDIO };
  };
  const attach = (id, auth, res) => {
    const session = check(id, auth, { terminal: true });
    if (session.subscriber) throw failure(409, '识别事件流已连接。', 'already_attached');
    clear(session, 'attachTimer');
    res.status(200).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' }); res.flushHeaders();
    const sub = { res, blocked: false, readySent: false, version: 0 };
    session.subscriber = sub;
    sub.drain = () => { clearTimeout(sub.drainTimer); sub.blocked = false; pump(session); };
    sub.closed = () => { if (session.subscriber !== sub) return; detach(session); if (!session.terminal) finish(session, failure(409, '识别连接已关闭。', 'client_closed')); };
    res.on('drain', sub.drain); res.once('close', sub.closed); res.once('error', sub.closed);
    sub.heartbeat = setInterval(() => {
      if (sub.blocked) return;
      try { current(session); } catch { failSubscriber(session); return; }
      try {
        if (!res.write(': keepalive\n\n')) { sub.blocked = true; sub.drainTimer = timer(() => failSubscriber(session), drainTimeoutMs); }
      } catch { failSubscriber(session); }
    }, 10000); sub.heartbeat.unref?.();
    pump(session);
  };
  const claimAudio = (id, auth, sequence) => {
    const session = check(id, auth);
    if (!session.ready || !session.subscriber || session.ended) throw failure(409, '请等待识别事件流就绪后再发送音频。', 'not_ready');
    if (session.upload) throw failure(409, '前一音频块尚未接收完成。', 'frame_in_flight');
    if (typeof sequence !== 'string' || !/^(?:0|[1-9]\d{0,5})$/.test(sequence) || Number(sequence) !== session.sequence) {
      const error = failure(409, '音频块顺序无效，请重新开始识别。', 'invalid_sequence'); finish(session, error); throw error;
    }
    const lease = {}; session.upload = lease;
    const abort = () => { if (session.upload === lease) { session.upload = null; finish(session, failure(400, '音频上传未完成，请重新开始。', 'upload_incomplete')); } };
    return { abort, commit(bytes) {
      try {
        check(id, auth);
        if (session.upload !== lease || session.ws.readyState !== 1 || session.ended) throw failure(409, '识别音频连接已结束。', 'session_ended');
        const samples = validateAsrAudio(bytes);
        if (session.samples + samples > ASR_AUDIO.sampleRate * ASR_AUDIO.maxSeconds || session.sequence >= MAX_FRAMES) throw failure(413, '单轮识别最多接收 60 秒音频。', 'audio_limit');
        if (session.ws.bufferedAmount + bytes.length > ASR_AUDIO.maxFrameBytes * 4) throw failure(429, '识别音频发送过快，请重新开始。', 'upstream_backpressure');
        session.ws.send(bytes); session.samples += samples; session.sequence++; session.upload = null; renewIdle(session);
        return { ok: true, nextSequence: session.sequence, receivedSamples: session.samples };
      } catch (error) { finish(session, safeAsrError(error)); throw safeAsrError(error); }
    } };
  };
  const end = (id, auth) => {
    const session = check(id, auth, { terminal: true });
    if (session.terminal?.type === 'error') throw failure(409, '识别会话已结束。', 'session_ended');
    if (session.ended) return { ok: true };
    if (session.upload || !session.ready || !session.samples) throw failure(409, '请先发送完整音频块。', 'not_ready');
    try { session.ended = true; clear(session, 'idleTimer'); session.endTimer = timer(() => finish(session, failure(504, '识别服务未及时返回完整结果。', 'end_timeout')), endTimeoutMs); session.ws.send('end'); }
    catch { finish(session, failure(502, '识别服务连接已关闭。', 'upstream_error')); throw failure(502, '识别服务连接已关闭。', 'upstream_error'); }
    return { ok: true };
  };
  const cancel = (id, auth) => { const session = check(id, auth, { terminal: true }); finish(session, failure(409, '识别已停止。', 'cancelled')); return { ok: true }; };
  const revoke = predicate => {
    for (const session of sessions.values()) if (predicate({ mode: 'voice', ...session.auth })) { finish(session, unavailable()); forget(session); }
    for (const probe of probes) if (predicate({ mode: 'voice', ...probe.auth })) probe.controller.abort();
  };
  const configure = async (body, { authorize: allowed = () => {} } = {}) => {
    live(); allowed();
    if (!object(body) || Object.keys(body).some(key => !['baseUrl', 'apiKey', 'clearApiKey', 'revision'].includes(key))) throw failure(400, '识别配置包含不支持的字段。', 'invalid_config');
    if (body.apiKey !== undefined && body.apiKey !== '' || body.clearApiKey !== undefined && typeof body.clearApiKey !== 'boolean') throw failure(400, '当前识别服务不支持 API Key，请留空。', 'unsupported_api_key');
    const previous = state.asrConfig;
    if (body.revision !== undefined && body.revision !== previous.revision) throw failure(409, '识别配置已变化，请重新读取。', 'stale_revision');
    let baseUrl = previous.baseUrl;
    if (body.baseUrl !== undefined) { try { baseUrl = normalizeVoiceUrl(body.baseUrl, 'ASR'); } catch { throw failure(400, '识别地址须为无凭据的 HTTPS 或私网 HTTP 地址。', 'invalid_config'); } }
    if (baseUrl === previous.baseUrl) return publicConfig(true);
    changing = true; revoke(() => true);
    mutation = (async () => {
      allowed(); state.asrConfig = { baseUrl, apiKey: '', revision: randomUUID() };
      try { await store.save(); } catch { state.asrConfig = previous; throw failure(500, '识别配置保存失败。', 'save_failed'); }
      return publicConfig(true);
    })();
    try { return await mutation; } finally { changing = false; }
  };
  const test = async (auth, signal) => {
    live(); authorize(auth);
    const config = state.asrConfig;
    if (!config.baseUrl) throw failure(409, '管理员尚未配置共享识别服务。', 'not_configured');
    if (probes.size) throw failure(429, '识别服务正在检测，请稍后再试。', 'busy');
    const controller = new AbortController(), probe = { auth, controller }; probes.add(probe);
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const deadline = timer(() => controller.abort(), testTimeoutMs);
    try {
      const url = `${config.baseUrl}/healthz`;
      const response = await fetchImpl(url, { signal: combined, redirect: 'error', credentials: 'omit' });
      authorize(auth); combined.throwIfAborted();
      if (!response.ok || response.redirected || response.url && response.url !== url || !response.body) { void response.body?.cancel().catch(() => {}); throw new Error(); }
      const reader = response.body.getReader(), chunks = []; let size = 0;
      const abort = () => { void reader.cancel().catch(() => {}); }; combined.addEventListener('abort', abort, { once: true });
      try {
        while (true) { const item = await reader.read(); authorize(auth); combined.throwIfAborted(); if (item.done) break; size += item.value.length; if (size > 16384) throw new Error(); chunks.push(Buffer.from(item.value)); }
        const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!object(result) || result.ok === false || result.status === 'error' || state.asrConfig.revision !== config.revision) throw new Error();
      } finally { combined.removeEventListener('abort', abort); void reader.cancel().catch(() => {}); reader.releaseLock(); }
      return { ok: true, revision: config.revision, busy: Boolean(slot), audio: { ...ASR_AUDIO } };
    } catch (error) { throw safeAsrError(error); }
    finally { clearTimeout(deadline); probes.delete(probe); }
  };
  const close = async () => {
    if (closed) return;
    closed = true;
    const sockets = [...new Set([...sessions.values(), ...(slot ? [slot] : [])])];
    revoke(() => true);
    for (const session of sockets) {
      if (!session.socketClosed) { try { session.ws?.terminate?.(); } catch { /* closing deadline remains active */ } }
    }
    await Promise.all(sockets.map(session => session.socketDone));
    if (mutation) await mutation.catch(() => {});
  };
  return { publicConfig, configure, create, attach, claimAudio, end, cancel, revoke, test, close };
}
