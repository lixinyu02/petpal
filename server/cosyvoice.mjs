import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { normalizeVoiceUrl } from './voice.mjs';

export const REFERENCE_LIMIT = 5 * 1024 * 1024;
export const COSYVOICE_AUDIO_LIMIT = 20 * 1024 * 1024;
export const COSYVOICE_TEXT_LIMIT = 1000;
export const COSYVOICE_STREAM_CHUNK = 24576;
const RESPONSE_LIMIT = 128 * 1024, SSE_LIMIT = 1024 * 1024;
const SPEECH_EMOTIONS = ['neutral', 'happy', 'sad', 'angry', 'gentle'];
const SPEECH_SOURCES = ['manual', 'choice', 'rules'];
const SPEECH_INTENSITIES = ['natural', 'strong'];
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const fields = (value, allowed) => object(value) && Object.keys(value).every(key => allowed.includes(key));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const revision = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
const eventId = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
class VoiceError extends Error { constructor(status, message) { super(message); this.status = status; } }
const failure = (status, message) => new VoiceError(status, message);
export function safeCosyVoiceError(error) {
  return error instanceof VoiceError ? error : failure(502, '语音服务未能完成请求，请检查服务状态后重试。');
}
const checkText = (value, maximum, label, empty = true) => {
  if (typeof value !== 'string' || value.length > maximum || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value) || (!empty && !value.trim())) throw failure(400, `${label}内容无效或超过 ${maximum} 字符。`);
  return value.trim();
};

/** Validate actual PCM samples, not a filename or a caller-provided MIME type. */
export function validatePcmWav(bytes, { reference = false } = {}) {
  const maximum = reference ? REFERENCE_LIMIT : COSYVOICE_AUDIO_LIMIT;
  const invalid = () => failure(400, reference ? '参考音频须为 1 至 30 秒、至少 16 kHz 的有效非静音 PCM WAV。' : '语音服务没有返回有效的 PCM WAV 音频。');
  if (!Buffer.isBuffer(bytes) || bytes.length < 44 || bytes.length > maximum || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE' || bytes.readUInt32LE(4) + 8 !== bytes.length) throw invalid();
  let offset = 12, format, data;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) throw invalid();
    const name = bytes.toString('ascii', offset, offset + 4), size = bytes.readUInt32LE(offset + 4), start = offset + 8;
    if (start + size > bytes.length) throw invalid();
    if (name === 'fmt ') {
      if (format || size < 16) throw invalid();
      format = { encoding: bytes.readUInt16LE(start), channels: bytes.readUInt16LE(start + 2), sampleRate: bytes.readUInt32LE(start + 4), byteRate: bytes.readUInt32LE(start + 8), blockAlign: bytes.readUInt16LE(start + 12), bits: bytes.readUInt16LE(start + 14) };
    } else if (name === 'data') { if (data) throw invalid(); data = bytes.subarray(start, start + size); }
    offset = start + size + (size % 2);
  }
  if (offset !== bytes.length || !format || !data?.length || format.encoding !== 1 || ![1, 2].includes(format.channels) || ![8, 16, 24, 32].includes(format.bits) || format.sampleRate < 16000 || format.sampleRate > 192000 || format.blockAlign !== format.channels * format.bits / 8 || format.byteRate !== format.sampleRate * format.blockAlign || data.length % format.blockAlign) throw invalid();
  const seconds = data.length / format.byteRate, silent = format.bits === 8 ? 128 : 0;
  if (seconds < (reference ? 1 : 0.05) || seconds > (reference ? 30 : 180) || !data.some(value => value !== silent)) throw invalid();
  return { ...format, seconds, bytes: bytes.length };
}

async function readBounded(response, limit, signal) {
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) { void response.body?.cancel().catch(() => {}); throw failure(502, '语音服务响应超过允许大小。'); }
  if (!response.body) throw failure(502, '语音服务响应为空。');
  const reader = response.body.getReader(), chunks = []; let size = 0, complete = false;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    while (true) { const { value, done } = await reader.read(); signal.throwIfAborted(); if (done) { complete = true; break; } size += value.length; if (size > limit) throw failure(502, '语音服务响应超过允许大小。'); chunks.push(Buffer.from(value)); }
    if (length !== null && Number(length) !== size) throw failure(502, '语音服务响应不完整。');
    return Buffer.concat(chunks, size);
  } finally { signal.removeEventListener('abort', abort); if (!complete) void reader.cancel().catch(() => {}); reader.releaseLock(); }
}
function parseJson(bytes) { try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw failure(502, '语音服务返回了无效数据。'); } }
function speechEmotion(value, requested, intensity) {
  if (!object(value) || !SPEECH_EMOTIONS.includes(value.emotion) || !SPEECH_SOURCES.includes(value.source) || !SPEECH_INTENSITIES.includes(value.intensity)
    || (requested !== 'auto' && value.emotion !== requested)
    || value.intensity !== (['neutral', 'gentle'].includes(value.emotion) ? 'natural' : intensity)) throw failure(502, '语音服务没有返回有效的朗读语气。');
  return Object.freeze({ emotion: value.emotion, intensity: value.intensity, source: value.source });
}
function pauseWithSignal(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const done = () => { cleanup(); resolve(); }, abort = () => { cleanup(); reject(signal.reason); };
    const timer = setTimeout(done, milliseconds), cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); };
    signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
  });
}

/** Only Gradio cache WAV paths returned by this request can be downloaded. */
function cacheWav(value) {
  if (typeof value !== 'string' || value.length > 2048 || !/^\/[^\\%?#\x00-\x20]*\/gradio\/[a-f0-9]{16,128}\/[A-Za-z0-9][A-Za-z0-9._-]{0,100}\.wav$/i.test(value) || value.includes('//') || value.split('/').some(part => part === '.' || part === '..')) throw failure(502, '语音服务返回了不受支持的音频文件。');
  return value;
}
export function cosyVoiceAudioUrl(item, baseUrl, sessionHash) {
  if (!object(item)) throw failure(502, '语音服务返回了不受支持的音频文件。');
  let expected;
  if (item.is_stream === true) {
    // Gradio's simple call API uses its returned event ID as the session hash.
    // playlist-file joins the completed stream on the upstream; we still inspect
    // actual WAV bytes because orig_name may say mp3 even for a WAV stream.
    const match = typeof item.path === 'string' && /^([a-f0-9]{32})\/([0-9]{1,20})\/([0-9]{1,10})\/playlist\.m3u8$/.exec(item.path);
    if (!match || !eventId(sessionHash) || match[1] !== sessionHash || typeof item.url !== 'string') throw failure(502, '语音服务返回了不属于当前请求的音频流。');
    expected = `${baseUrl}/gradio_api/stream/${item.path}`;
  } else expected = `${baseUrl}/gradio_api/file=${cacheWav(item.path)}`;
  if (item.url != null) {
    // Exact equality also rejects credentials, query, fragment, encoded path
    // separators and traversal that URL normalization would otherwise conceal.
    // Gradio 5.4 trims /queue/join from the longer /call/generate_audio URL,
    // leaving /gradio_a in output metadata. Accept only that exact known alias;
    // downloads always use our canonical URL, never the supplied URL.
    const alias = `${baseUrl}/gradio_a${expected.slice(baseUrl.length)}`;
    if (![expected, new URL(expected).pathname, alias, new URL(alias).pathname].includes(item.url)) throw failure(502, '语音服务返回了不受支持的音频地址。');
  }
  return item.is_stream === true ? expected.replace(/playlist\.m3u8$/, 'playlist-file') : expected;
}

async function readAudioEvent(response, signal) {
  if (!/^text\/event-stream(?:\s*;|$)/i.test(response.headers.get('content-type') || '') || !response.body) throw failure(502, '语音队列没有返回事件流。');
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '', received = 0;
  const abort = () => { void reader.cancel().catch(() => {}); }; signal.addEventListener('abort', abort, { once: true });
  const dispatch = block => {
    let event = '', data = [];
    for (const line of block.split('\n')) { if (line.startsWith('event:')) event = line.slice(6).trim(); else if (line.startsWith('data:')) data.push(line.slice(5).trimStart()); }
    if (event === 'error') throw failure(502, '语音生成失败，请检查参考音频和语音服务。');
    if (event !== 'complete') return null;
    const result = parseJson(Buffer.from(data.join('\n')));
    if (!Array.isArray(result) || result.length !== 1 || !object(result[0])) throw failure(502, '语音队列完成但没有返回音频。');
    return result[0];
  };
  try {
    signal.throwIfAborted();
    while (true) {
      const { value, done } = await reader.read(); signal.throwIfAborted();
      if (done) break;
      received += value.length; if (received > SSE_LIMIT) throw failure(502, '语音队列响应超过允许大小。');
      buffer += decoder.decode(value, { stream: true }); buffer = buffer.replace(/\r\n/g, '\n');
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) { const item = dispatch(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 2); if (item) return item; }
    }
    buffer += decoder.decode(); if (buffer.trim()) { const item = dispatch(buffer); if (item) return item; }
    throw failure(502, '语音队列连接提前结束，请重试。');
  } finally { signal.removeEventListener('abort', abort); void reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export async function createCosyVoiceService({ store, dataDir, fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 180000, maxConcurrent = 1, rateLimit = 30,
  capabilityTtlMs = 60000, capabilityTimeoutMs = 5000, completionTimeoutMs = 3000, completionPollMs = 100 } = {}) {
  const state = store.state;
  state.cosyvoiceConfig ??= { baseUrl: '', apiKey: '', referenceText: '', reference: null, revision: randomUUID() };
  const initial = state.cosyvoiceConfig;
  try {
    if (!fields(initial, ['baseUrl', 'apiKey', 'referenceText', 'reference', 'revision']) || !revision(initial.revision) || normalizeVoiceUrl(initial.baseUrl) !== initial.baseUrl || typeof initial.apiKey !== 'string' || initial.apiKey.length > 8192 || /\s|[\x00-\x1f\x7f]/.test(initial.apiKey) || checkText(initial.referenceText, 2000, '参考文本') !== initial.referenceText) throw new Error();
    if (initial.reference !== null && (!fields(initial.reference, ['name', 'sha256', 'bytes']) || !/^reference-[a-f0-9-]{36}\.wav$/.test(initial.reference.name) || !/^[a-f0-9]{64}$/.test(initial.reference.sha256) || !Number.isSafeInteger(initial.reference.bytes) || initial.reference.bytes < 44 || initial.reference.bytes > REFERENCE_LIMIT)) throw new Error();
  } catch { throw new Error('本地 CosyVoice 配置无效，请保留数据并检查备份。'); }
  const directory = path.resolve(dataDir ?? store.directory, 'cosyvoice');
  const running = new Map(), rates = new Map(); let changing = false, closed = false, mutation = null, capabilityCache = null;
  const assertLive = () => { if (closed) throw failure(503, '语音服务正在退出。'); if (changing) throw failure(409, '语音配置正在保存，请稍后重试。'); };
  const publicConfig = (editable = false) => { const config = state.cosyvoiceConfig; return { configured: Boolean(config.baseUrl && config.referenceText && config.reference), hasReference: Boolean(config.reference), referenceName: config.reference ? 'reference.wav' : '', referenceText: editable ? config.referenceText : '', baseUrl: editable ? config.baseUrl : '', hasApiKey: Boolean(config.apiKey), editable, revision: config.revision }; };
  const cancelRunning = () => { for (const value of running.values()) value.abort(failure(409, '语音配置已变化，请重新开始朗读。')); };
  const protectDirectory = async () => { await mkdir(directory, { recursive: true, mode: 0o700 }); const info = await lstat(directory); if (!info.isDirectory() || info.isSymbolicLink()) throw failure(500, '无法安全访问参考音频目录。'); };
  const readReference = async reference => {
    await protectDirectory(); const filename = path.join(directory, reference.name), before = await lstat(filename);
    if (!before.isFile() || before.isSymbolicLink() || before.size !== reference.bytes || before.size > REFERENCE_LIMIT) throw failure(409, '参考音频不可用，请重新上传。');
    const handle = await open(filename, 'r');
    try {
      const info = await handle.stat(); if (!info.isFile() || info.ino !== before.ino || info.dev !== before.dev || info.size !== before.size) throw failure(409, '参考音频已变化，请重新上传。');
      const bytes = Buffer.alloc(info.size); let offset = 0;
      while (offset < bytes.length) { const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset); if (!bytesRead) break; offset += bytesRead; }
      if (offset !== bytes.length || digest(bytes) !== reference.sha256) throw failure(409, '参考音频已变化，请重新上传。');
      validatePcmWav(bytes, { reference: true }); return bytes;
    } finally { await handle.close(); }
  };
  const save = async (next, authorize) => {
    if (closed) throw failure(503, '语音服务正在退出。');
    authorize(); const previous = state.cosyvoiceConfig;
    state.cosyvoiceConfig = next;
    try { await store.save(); } catch { state.cosyvoiceConfig = previous; throw failure(500, '语音配置保存失败，请检查数据目录。'); }
    return publicConfig(true);
  };
  const configure = async (body, { authorize = () => {} } = {}) => {
    assertLive(); authorize();
    if (!fields(body, ['baseUrl', 'apiKey', 'clearApiKey', 'referenceText', 'revision'])) throw failure(400, '语音配置包含不支持的字段。');
    const previous = state.cosyvoiceConfig;
    if (body.revision !== undefined && body.revision !== previous.revision) throw failure(409, '语音配置已变化，请重新读取。');
    const next = { ...previous };
    if (body.baseUrl !== undefined) { try { next.baseUrl = normalizeVoiceUrl(body.baseUrl, 'CosyVoice'); } catch { throw failure(400, 'CosyVoice 地址须为无凭据的 HTTPS 或私网 HTTP 地址。'); } }
    if (body.referenceText !== undefined) next.referenceText = checkText(body.referenceText, 2000, '参考文本');
    if (body.clearApiKey !== undefined && typeof body.clearApiKey !== 'boolean') throw failure(400, '清除密钥选项无效。');
    const key = body.apiKey === undefined ? '' : checkText(body.apiKey, 8192, 'API Key');
    if (/\s/.test(key) || (body.clearApiKey && key)) throw failure(400, '密钥格式或清除选项无效。');
    if (previous.apiKey && previous.baseUrl !== next.baseUrl && !key && !body.clearApiKey) throw failure(400, '服务地址已改变，请重新填写或明确清除密钥。');
    if (key) next.apiKey = key; else if (body.clearApiKey) next.apiKey = '';
    if (['baseUrl', 'apiKey', 'referenceText'].every(key => next[key] === previous[key])) return publicConfig(true);
    next.revision = randomUUID(); changing = true; cancelRunning();
    mutation = save(next, authorize);
    try { return await mutation; } finally { changing = false; }
  };
  const setReference = async (bytes, { authorize = () => {} } = {}) => {
    assertLive(); authorize(); validatePcmWav(bytes, { reference: true });
    changing = true; cancelRunning();
    const previous = state.cosyvoiceConfig, name = `reference-${randomUUID()}.wav`, filename = path.join(directory, name);
    mutation = (async () => {
      let created = false, saved = false;
      try {
        await protectDirectory(); authorize();
        const handle = await open(filename, 'wx', 0o600); created = true;
        try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
        authorize(); const result = await save({ ...previous, reference: { name, bytes: bytes.length, sha256: digest(bytes) }, revision: randomUUID() }, authorize); saved = true;
        if (previous.reference) await unlink(path.join(directory, previous.reference.name)).catch(() => {});
        return result;
      } finally { if (created && !saved) await unlink(filename).catch(() => {}); }
    })();
    try { return await mutation; } finally { changing = false; }
  };
  // Both transports reserve the same user/global slot and rate allowance.
  const capabilities = async ({ config, request, signal, checkCurrent }) => {
    if (capabilityCache?.revision === config.revision && capabilityCache.expires > now()) return capabilityCache.value;
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(capabilityTimeoutMs)]);
    const response = await request(`${config.baseUrl}/api/tts/capabilities`, {}, [404], bounded);
    let value;
    if (response.status === 404) { void response.body?.cancel().catch(() => {}); value = { modern: false, instruct2: false }; }
    else {
      const data = parseJson(await readBounded(response, RESPONSE_LIMIT, bounded));
      if (!object(data) || !Array.isArray(data.modes) || data.modes.length > 16 || !data.modes.every(mode => typeof mode === 'string' && mode.length <= 32) || typeof data.instruct2 !== 'boolean') throw failure(502, '语音服务能力说明无效。');
      value = { modern: true, instruct2: data.instruct2 && data.modes.includes('instruct2') };
    }
    checkCurrent(); capabilityCache = { revision: config.revision, expires: now() + capabilityTtlMs, value }; return value;
  };
  const freezeSpeechEmotion = async ({ input, emotion, emotionIntensity, config, request, signal }) => {
    const response = await request(`${config.baseUrl}/api/tts/emotion`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tts_text: input, emotion, emotion_intensity: emotionIntensity }) });
    const selection = parseJson(await readBounded(response, RESPONSE_LIMIT, signal));
    const metadata = speechEmotion(selection, emotion, emotionIntensity);
    let instruction;
    try { instruction = checkText(selection.instruct_text, 2000, '朗读指令', false); }
    catch { throw failure(502, '语音服务没有返回有效的朗读指令。'); }
    return { metadata, instruction };
  };
  const verifyStreamCompletion = async ({ requestId, config, request, signal, checkCurrent }) => {
    if (!eventId(requestId)) throw failure(502, '语音服务没有返回有效的任务回执。');
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(completionTimeoutMs)]);
    for (let attempt = 0; attempt <= Math.ceil(completionTimeoutMs / completionPollMs); attempt++) {
      checkCurrent();
      const response = await request(`${config.baseUrl}/api/tts/status`, {}, [], bounded);
      const value = parseJson(await readBounded(response, RESPONSE_LIMIT, bounded));
      if (!object(value) || !Array.isArray(value.recent) || value.recent.length > 30 || !value.recent.every(object)) throw failure(502, '语音服务任务回执无效。');
      const matches = value.recent.filter(item => item.request_id === requestId);
      if (matches.length > 1) throw failure(502, '语音服务任务回执无效。');
      if (matches.length) {
        const receipt = matches[0];
        if (receipt.state !== 'succeeded' || receipt.error_type !== null || !object(receipt.runtime) || receipt.runtime.cancelled !== false || receipt.runtime.timed_out !== false
          || (receipt.runtime.request_id !== undefined && receipt.runtime.request_id !== requestId)) throw failure(502, '语音服务没有确认本次合成完成。');
        checkCurrent(); return;
      }
      await pauseWithSignal(completionPollMs, bounded);
    }
    throw failure(502, '语音服务没有确认本次合成完成。');
  };
  const withSynthesis = async ({ userId, text, speed = 1, emotion = 'auto', emotionIntensity = 'natural', signal, streaming = false } = {}, consume) => {
    assertLive(); signal?.throwIfAborted();
    const input = checkText(text, COSYVOICE_TEXT_LIMIT, '合成文本', false);
    if (!['auto', 'original', ...SPEECH_EMOTIONS].includes(emotion) || !SPEECH_INTENSITIES.includes(emotionIntensity)) throw failure(400, '朗读语气或程度无效。');
    if (typeof speed !== 'number' || !Number.isFinite(speed) || speed < 0.5 || speed > 2) throw failure(400, 'CosyVoice 语速必须为 0.5 到 2。');
    if (streaming && speed !== 1) throw failure(409, '实时语音仅支持 1.0 倍语速，请使用完整音频朗读。');
    const config = state.cosyvoiceConfig;
    if (!config.baseUrl || !config.reference || !config.referenceText) throw failure(409, '管理员尚未配置完整的 CosyVoice 服务与参考声音。');
    if (running.has(userId) || running.size >= maxConcurrent) throw failure(429, '语音服务忙，请稍后再试。');
    const time = now(); for (const [id, entries] of rates) if (!entries.some(value => value > time - 60000)) rates.delete(id);
    const recent = (rates.get(userId) ?? []).filter(value => value > time - 60000);
    if (recent.length >= rateLimit) throw failure(429, '朗读请求过于频繁，请一分钟后重试。');
    recent.push(time); rates.set(userId, recent);
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(failure(504, '语音生成超时，请稍后重试。')), timeoutMs);
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal; running.set(userId, controller);
    const checkCurrent = () => {
      combined.throwIfAborted();
      if (state.cosyvoiceConfig.revision !== config.revision) throw failure(409, '语音配置已变化，请重新开始朗读。');
    };
    const request = async (url, init = {}, allowedStatuses = [], operationSignal) => {
      combined.throwIfAborted();
      const requestSignal = operationSignal ? AbortSignal.any([combined, operationSignal]) : combined;
      requestSignal.throwIfAborted();
      const headers = new Headers(init.headers); if (config.apiKey) headers.set('Authorization', `Bearer ${config.apiKey}`);
      const response = await fetchImpl(url, { ...init, headers, signal: requestSignal, redirect: 'error', credentials: 'omit' });
      if (requestSignal.aborted) { void response.body?.cancel().catch(() => {}); requestSignal.throwIfAborted(); }
      if (response.status === 503 && !response.redirected && (!response.url || response.url === url)) { void response.body?.cancel().catch(() => {}); throw failure(503, '语音服务繁忙或尚未就绪，请稍后重试。'); }
      if (response.redirected || (response.url && response.url !== url) || (response.status !== 200 && !allowedStatuses.includes(response.status))) { void response.body?.cancel().catch(() => {}); throw failure(502, '语音服务请求失败，请检查地址及服务状态。'); }
      return response;
    };
    try {
      const reference = await readReference(config.reference); checkCurrent();
      const capability = await capabilities({ config, request, signal: combined, checkCurrent });
      if (!capability.instruct2 && SPEECH_EMOTIONS.includes(emotion)) throw failure(409, '当前语音服务不支持所选朗读语气，请选择自动或保留原声。');
      const result = await consume({ input, speed, config, reference, request, signal: combined, checkCurrent, capability,
        emotion: emotion !== 'original' && capability.instruct2 ? emotion : null, emotionIntensity });
      checkCurrent(); return result;
    } catch (error) {
      if (combined.aborted) throw controller.signal.aborted ? safeCosyVoiceError(controller.signal.reason) : failure(409, '语音请求已停止。');
      throw safeCosyVoiceError(error);
    } finally { clearTimeout(timer); running.delete(userId); }
  };
  const synthesize = args => withSynthesis(args, async ({ input, speed, config, reference, request, signal, emotion, emotionIntensity }) => {
    const selection = emotion ? await freezeSpeechEmotion({ input, emotion, emotionIntensity, config, request, signal }) : null;
    const form = new FormData(); form.append('files', new Blob([reference], { type: 'audio/wav' }), 'reference.wav');
    const upload = parseJson(await readBounded(await request(`${config.baseUrl}/gradio_api/upload`, { method: 'POST', body: form }), RESPONSE_LIMIT, signal));
    if (!Array.isArray(upload) || upload.length !== 1) throw failure(502, '语音服务未接收参考音频。');
    const uploadedPath = cacheWav(upload[0]);
    const data = [input, selection ? '自然语言控制' : '3s极速复刻', '', selection ? '' : config.referenceText, { path: uploadedPath, meta: { _type: 'gradio.FileData' } }, null, selection?.instruction || '', 0, false, speed];
    // Supplying a different session_hash breaks Gradio's simple GET endpoint:
    // it looks up the message queue by event_id rather than that custom hash.
    const job = parseJson(await readBounded(await request(`${config.baseUrl}/gradio_api/call/generate_audio`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data }) }), RESPONSE_LIMIT, signal));
    if (!fields(job, ['event_id']) || !eventId(job.event_id)) throw failure(502, '语音队列未返回有效任务。');
    const item = await readAudioEvent(await request(`${config.baseUrl}/gradio_api/call/generate_audio/${job.event_id}`), signal);
    const audioUrl = cosyVoiceAudioUrl(item, config.baseUrl, job.event_id), response = await request(audioUrl);
    if (!/^(?:audio\/(?:wav|x-wav|wave)|application\/octet-stream)(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) { void response.body?.cancel().catch(() => {}); throw failure(502, '语音服务没有返回 WAV 音频。'); }
    const audio = await readBounded(response, COSYVOICE_AUDIO_LIMIT, signal);
    try { validatePcmWav(audio); } catch { throw failure(502, '语音服务没有返回有效的 PCM WAV 音频。'); }
    if (selection) Object.defineProperty(audio, 'speechEmotion', { value: selection.metadata });
    return audio;
  });
  const synthesizeStream = async ({ onFrame, ...args } = {}) => {
    if (typeof onFrame !== 'function') throw failure(400, '语音流接收器不可用。');
    return withSynthesis({ ...args, streaming: true }, async ({ input, config, reference, request, signal, checkCurrent, capability, emotion, emotionIntensity }) => {
      const form = new FormData();
      form.set('tts_text', input); form.set('mode', emotion ? 'instruct2' : 'zero_shot'); form.set('seed', '0');
      if (emotion) { form.set('emotion', emotion); form.set('emotion_intensity', emotionIntensity); form.set('text_normalization', 'auto'); }
      else form.set('prompt_text', config.referenceText);
      form.set('prompt_wav', new Blob([reference], { type: 'audio/wav' }), 'reference.wav');
      const response = await request(`${config.baseUrl}/api/tts/stream`, { method: 'POST', body: form });
      let metadata;
      try {
        if (emotion) metadata = speechEmotion({ emotion: response.headers.get('x-tts-emotion'), source: response.headers.get('x-tts-emotion-source'), intensity: response.headers.get('x-tts-emotion-intensity') }, emotion, emotionIntensity);
        if (capability.modern && !eventId(response.headers.get('x-request-id'))) throw failure(502, '语音服务没有返回有效的任务回执。');
      } catch (error) { void response.body?.cancel().catch(() => {}); throw error; }
      const length = response.headers.get('content-length');
      if (response.headers.get('content-type') !== 'application/octet-stream' || response.headers.get('x-audio-format') !== 'pcm_s16le' || response.headers.get('x-audio-sample-rate') !== '24000' || response.headers.get('x-audio-channels') !== '1' || !response.body || (length !== null && (!/^\d+$/.test(length) || Number(length) > COSYVOICE_AUDIO_LIMIT))) {
        void response.body?.cancel().catch(() => {});
        throw failure(502, '语音服务没有返回受支持的 24 kHz 单声道 PCM 音频流。');
      }
      const reader = response.body.getReader(); let total = 0, complete = false;
      const abort = () => { void reader.cancel().catch(() => {}); };
      signal.addEventListener('abort', abort, { once: true });
      // Waiting for a slow consumer remains part of the synthesis deadline.
      const emit = async frame => {
        checkCurrent();
        await new Promise((resolve, reject) => {
          const cancelled = () => { cleanup(); reject(signal.reason); };
          const cleanup = () => signal.removeEventListener('abort', cancelled);
          signal.addEventListener('abort', cancelled, { once: true });
          if (signal.aborted) { cancelled(); return; }
          Promise.resolve().then(() => { checkCurrent(); return onFrame(frame, signal); }).then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
        });
        checkCurrent();
      };
      try {
        await emit({ type: 'format', format: 'pcm_s16le', sampleRate: 24000, channels: 1, ...(metadata ? { emotion: metadata } : {}) });
        while (true) {
          checkCurrent(); const { done, value } = await reader.read(); checkCurrent();
          if (done) break;
          total += value.byteLength;
          if (total > COSYVOICE_AUDIO_LIMIT) throw failure(502, '语音服务响应超过允许大小。');
          // Network chunks need not align to a PCM sample. Preserve every byte;
          // the client carries an unmatched byte into the next audio frame.
          for (let offset = 0; offset < value.byteLength; offset += COSYVOICE_STREAM_CHUNK) {
            const chunk = Buffer.from(value.buffer, value.byteOffset + offset, Math.min(COSYVOICE_STREAM_CHUNK, value.byteLength - offset));
            await emit({ type: 'audio', data: chunk.toString('base64') });
          }
        }
        if (!total || total % 2 || (length !== null && Number(length) !== total)) throw failure(502, '语音服务返回了空白或不完整的 PCM 音频流。');
        const requestId = response.headers.get('x-request-id');
        if (capability.modern || requestId !== null) await verifyStreamCompletion({ requestId, config, request, signal, checkCurrent });
        complete = true;
        await emit({ type: 'end', bytes: total });
        return { bytes: total };
      } finally {
        signal.removeEventListener('abort', abort);
        if (!complete) void reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    });
  };
  const close = async () => { closed = true; for (const controller of running.values()) controller.abort(failure(503, '语音服务正在退出。')); if (mutation) await mutation.catch(() => {}); };
  return { publicConfig, configure, setReference, synthesize, synthesizeStream, close };
}
