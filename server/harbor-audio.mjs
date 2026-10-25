import { validatePcmWav, safeCosyVoiceError, COSYVOICE_TEXT_LIMIT } from './cosyvoice.mjs';
import { normalizeVoiceUrl } from './voice.mjs';
import { createAppProxyWebSocketAgent } from './app-proxy-context.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value, low, high) => Number.isSafeInteger(value) && value >= low && value <= high;
const number = (value, low, high) => typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high;
class AudioError extends Error { constructor(status, message, code = 'harbor_audio_error') { super(message); this.status = status; this.code = code; } }
const failure = (status, message, code) => new AudioError(status, message, code);
export const safeHarborAudioError = error => error instanceof AudioError ? error : safeCosyVoiceError(error);
const changed = () => failure(409, 'API Harbor 连接或模型已变化，请重新开始。', 'source_changed');
const invalidResponse = () => failure(502, 'API Harbor 返回的音频或识别数据无效。', 'invalid_response');
const validText = (value, maximum) => typeof value === 'string' && value.length <= maximum && !/[\u0000-\u0008\u000b-\u001f\u007f]/u.test(value) && !/[\uD800-\uDFFF]/u.test(value);
const endpoint = (descriptor, suffix) => {
  try {
    const base = normalizeVoiceUrl(descriptor.baseUrl, 'Harbor');
    if (!base.endsWith('/v1') || base !== descriptor.baseUrl || typeof descriptor.apiKey !== 'string' || !/^sk-harbor-[A-Za-z0-9_-]{43}$/.test(descriptor.apiKey)
      || typeof descriptor.model !== 'string' || !descriptor.model || descriptor.model.length > 200 || !descriptor.linkRevision) return;
    return base + suffix;
  } catch { return; }
};
const liveDescriptor = (models, protocol, selected) => {
  const live = models.forProtocol(protocol, { model: selected.model });
  if (!live || live.linkRevision !== selected.linkRevision || live.apiKey !== selected.apiKey || live.baseUrl !== selected.baseUrl || live.receiverInstanceId !== selected.receiverInstanceId) throw changed();
};

/** Selection happens before a request. A sent request is never replayed to the fallback. */
function speechPlan(models, args = {}) {
  const selected = models.forProtocol('speech', args.model ? { model: args.model } : {}), profile = selected?.capabilities?.nativeProfile;
  if (!selected || !object(profile) || !endpoint(selected, '/audio/speech') || selected.capabilities.stream === true) return;
  const speed = args.speed ?? 1, emotion = args.emotion ?? 'auto', intensity = args.emotionIntensity ?? 'natural';
  // Auto is an unspecified style here; no inferred emotion metadata is invented.
  // Explicit expressive controls retain the original instruction-capable service.
  if (!['auto', 'original'].includes(emotion) || intensity !== 'natural' || !Array.isArray(profile.voices) || !profile.voices.length
    || profile.voices.some(voice => typeof voice !== 'string' || !voice || voice.length > 128) || !Array.isArray(profile.response_formats)
    || !profile.response_formats.some(format => ['wav', 'wav_pcm16_v1'].includes(format))
    || !number(profile.speed_min, .25, 1) || !number(profile.speed_max, 1, 4) || !number(speed, profile.speed_min, profile.speed_max)
    || !integer(profile.max_input_characters, 1, 4096) || !integer(profile.max_response_bytes, 1024, 8 * 1024 * 1024)) return;
  const voice = args.voice || profile.voices[0];
  if (!profile.voices.includes(voice) || args.text && [...args.text.trim()].length > profile.max_input_characters) return;
  const geometry = profile.response_validation;
  if (geometry !== undefined && (!object(geometry) || geometry.mode !== 'pcm16_wav_v1' || !integer(geometry.sample_rate_hz, 16000, 48000) || !integer(geometry.channels, 1, 2))) return;
  if (profile.adapter === 'cosyvoice_sft' && (!integer(profile.pcm_sample_rate, 16000, 48000) || profile.pcm_encoding !== 's16le')) return;
  if (profile.response_formats.includes('wav_pcm16_v1') && !geometry) return;
  return { selected, profile, voice, speed, url: endpoint(selected, '/audio/speech') };
}

async function readAudio(response, limit, signal, current) {
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) { void response.body?.cancel().catch(() => {}); throw invalidResponse(); }
  if (!response.body) throw invalidResponse();
  const reader = response.body.getReader(), chunks = []; let size = 0, complete = false;
  const abort = () => { void reader.cancel().catch(() => {}); }; signal.addEventListener('abort', abort, { once: true });
  try {
    current();
    while (true) {
      const item = await reader.read(); current();
      if (item.done) { complete = true; break; }
      size += item.value.byteLength; if (size > limit) throw invalidResponse(); chunks.push(Buffer.from(item.value));
    }
    if (length !== null && Number(length) !== size) throw invalidResponse();
    return Buffer.concat(chunks, size);
  } finally { signal.removeEventListener('abort', abort); if (!complete) void reader.cancel().catch(() => {}); reader.releaseLock(); }
}

const asrProfile = value => object(value) && value.server_contract === 'vibevoice_streaming_websocket_v1' && value.input_format === 'pcm_f32le_mono_24000'
  && value.checkpoint_sample_rate === 24000 && [48000, 70400].includes(value.checkpoint_chunk_samples)
  && integer(value.max_input_milliseconds, 1, 30000) && integer(value.max_context_characters, 0, 4096)
  && integer(value.max_tokens_per_chunk, 1, 256) && integer(value.max_response_bytes, 1024, 1024 * 1024);
const segmentsValid = (segments, seconds) => {
  if (!Array.isArray(segments) || segments.length > 256) return false;
  let previous = 0;
  return segments.every(segment => {
    if (!object(segment) || Object.keys(segment).sort().join(',') !== 'Content,End,Speaker,Start' || !number(segment.Start, previous, seconds + .01)
      || !number(segment.End, segment.Start, seconds + .01) || !validText(segment.Speaker, 64) || !segment.Speaker.length || !validText(segment.Content, 16000)) return false;
    previous = segment.End; return true;
  });
};

function nativeTranscript(profile) {
  let next = 0, text = '', done = false, lastSegments = [];
  const timestamp = seconds => {
    const value = seconds * 1000, floor = Math.floor(value);
    // Match the native Python contract's round-to-even at exact half ticks.
    let milliseconds = value - floor === .5 ? floor + floor % 2 : Math.round(value);
    const hours = Math.floor(milliseconds / 3600000); milliseconds %= 3600000;
    const minutes = Math.floor(milliseconds / 60000); milliseconds %= 60000;
    const whole = Math.floor(milliseconds / 1000); milliseconds %= 1000;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(whole).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`;
  };
  const srt = segments => segments.map((segment, index) => `${index + 1}\n${timestamp(segment.Start)} --> ${timestamp(segment.End)}\nSpeaker ${segment.Speaker}: ${segment.Content}\n`).join('\n');
  return (value, { ended, samples, probe = false }) => {
    if (done || !object(value) || !validText(value.text, 16000) || !segmentsValid(value.segments, (value.done === true ? next : next + 1) * profile.checkpoint_chunk_samples / 24000)) throw invalidResponse();
    if (value.done === true) {
      if (!ended || (!samples && !probe) || Object.keys(value).sort().join(',') !== 'done,segments,srt,text,total_chunks'
        || value.total_chunks !== next || Boolean(samples) !== Boolean(next) || typeof value.srt !== 'string' || Buffer.byteLength(value.srt) > 65536 || value.text !== text
        || value.segments.length !== lastSegments.length || value.segments.some((segment, index) => ['Start', 'End', 'Speaker', 'Content'].some(field => segment[field] !== lastSegments[index][field]))
        || value.srt !== srt(value.segments)) throw invalidResponse();
      done = true; return { text, chunks: next, done: true };
    }
    if (!samples || Object.keys(value).sort().join(',') !== 'chunk,segments,text' || value.chunk !== next
      || next >= Math.ceil(profile.max_input_milliseconds * 24 / profile.checkpoint_chunk_samples)) throw invalidResponse();
    text += value.text; if (!validText(text, 16000)) throw invalidResponse(); lastSegments = structuredClone(value.segments); next++;
    return { text, chunks: next };
  };
}

async function probeNative(transport, { signal, authorize, webSocketFactory, timeoutMs = 5000, closeTimeoutMs = 1000 }) {
  signal.throwIfAborted(); authorize(); transport.assertCurrent();
  const parser = nativeTranscript(transport.profile), proxy = createAppProxyWebSocketAgent(transport.url);
  let socket;
  try {
    return await new Promise((resolve, reject) => {
      let settled = false, messages = 0, closeTimer;
      const current = () => { signal.throwIfAborted(); authorize(); transport.assertCurrent(); };
      const cleanup = () => { clearTimeout(deadline); clearTimeout(closeTimer); signal.removeEventListener('abort', cancelled); };
      const finish = error => {
        if (settled) return; settled = true;
        cleanup();
        try { socket?.terminate?.(); } catch { /* bounded fixture/client cleanup */ }
        error ? reject(error) : resolve({ ok: true, source: 'api-harbor', revision: transport.revision, audio: transport.audio, configVerified: true, protocolVerified: true, protocolVersion: 1 });
      };
      const cancelled = () => finish(failure(409, '识别检测已取消。', 'cancelled'));
      const deadline = setTimeout(() => finish(failure(504, 'API Harbor 识别检测超时。', 'probe_timeout')), timeoutMs);
      signal.addEventListener('abort', cancelled, { once: true });
      try {
        socket = webSocketFactory(transport.url, { headers: transport.headers, perMessageDeflate: false, followRedirects: false, maxPayload: 65536, handshakeTimeout: timeoutMs, ...(proxy ? { agent: proxy } : {}) });
        socket.addEventListener('open', () => { try { current(); socket.send(JSON.stringify(transport.config)); socket.send('end'); } catch (error) { finish(error); } });
        socket.addEventListener('message', event => {
          try {
            current(); if (typeof event.data !== 'string' || Buffer.byteLength(event.data) > 65536 || ++messages > 2) throw invalidResponse();
            const value = parser(JSON.parse(event.data), { ended: true, samples: 0, probe: true });
            if (!value.done) throw invalidResponse();
            socket.close(1000, 'probe finished');
            if (!settled) closeTimer = setTimeout(() => finish(), closeTimeoutMs);
          } catch (error) { finish(error); }
        });
        socket.addEventListener('close', () => { if (settled) return; try { current(); if (messages !== 1) throw invalidResponse(); finish(); } catch (error) { finish(error); } });
        socket.addEventListener('error', () => finish(failure(502, 'API Harbor 识别检测失败。', 'upstream_error')));
        if (signal.aborted) cancelled();
      } catch (error) { finish(error); }
    });
  } finally { proxy?.destroy(); }
}

/** Credential-bearing descriptors and transports never leave the server. */
export function createHarborAudioService({ serviceModels, cosyvoice, fetchImpl = globalThis.fetch, now = Date.now, maxConcurrent = 2, rateLimit = 30, timeoutMs = 120000, authPollMs = 1000 } = {}) {
  const running = new Map(), rates = new Map(); let closed = false;
  const admitted = async (args, consume) => {
    if (closed) throw failure(503, '语音服务正在退出。', 'closed');
    args.signal?.throwIfAborted(); args.authorize?.();
    if (!validText(args.text, COSYVOICE_TEXT_LIMIT) || !args.text.trim()) throw failure(400, '合成文本无效或超过 1000 字符。', 'invalid_text');
    if (!number(args.speed ?? 1, .5, 2) || !['auto', 'original', 'neutral', 'happy', 'sad', 'angry', 'gentle'].includes(args.emotion ?? 'auto')
      || !['natural', 'strong'].includes(args.emotionIntensity ?? 'natural')) throw failure(400, '朗读语速或语气无效。', 'invalid_voice');
    if (running.has(args.userId) || running.size >= maxConcurrent) throw failure(429, '语音服务忙，请稍后再试。', 'busy');
    const time = now(); for (const [id, entries] of rates) if (!entries.some(value => value > time - 60000)) rates.delete(id);
    const recent = (rates.get(args.userId) ?? []).filter(value => value > time - 60000);
    if (recent.length >= rateLimit) throw failure(429, '朗读请求过于频繁，请一分钟后重试。', 'rate_limited');
    recent.push(time); rates.set(args.userId, recent);
    const controller = new AbortController(), signal = args.signal ? AbortSignal.any([args.signal, controller.signal]) : controller.signal;
    let resolve; const done = new Promise(value => { resolve = value; }); running.set(args.userId, { controller, done });
    const deadline = setTimeout(() => controller.abort(failure(504, '语音生成超时，请稍后重试。', 'timeout')), timeoutMs);
    try { return await consume({ ...args, text: args.text.trim(), signal }); }
    catch (error) { if (controller.signal.aborted) throw controller.signal.reason; throw error; }
    finally { clearTimeout(deadline); running.delete(args.userId); resolve(); }
  };
  const synthesize = args => admitted(args, async input => {
    const plan = speechPlan(serviceModels, input);
    if (!plan) { const audio = await cosyvoice.synthesize(input); audio.audioSource = 'cosyvoice'; return audio; }
    const controller = new AbortController(), signal = AbortSignal.any([input.signal, controller.signal]);
    const current = () => { signal.throwIfAborted(); input.authorize?.(); liveDescriptor(serviceModels, 'speech', plan.selected); };
    const poll = setInterval(() => { try { current(); } catch (error) { controller.abort(error); } }, authPollMs); poll.unref?.();
    let response;
    try {
      current();
      response = await fetchImpl(plan.url, { method: 'POST', headers: { Authorization: `Bearer ${plan.selected.apiKey}`, 'Content-Type': 'application/json', Accept: 'audio/wav', 'Accept-Encoding': 'identity' },
        body: JSON.stringify({ model: plan.selected.model, input: input.text, voice: plan.voice, response_format: 'wav', speed: plan.speed }), signal, redirect: 'error', credentials: 'omit' });
      current();
      if (response.status !== 200 || response.redirected || response.url && response.url !== plan.url || !/^audio\/(?:wav|wave|x-wav)(?:\s*;|$)/i.test(response.headers.get('content-type') || '')
        || !['', 'identity'].includes((response.headers.get('content-encoding') || '').trim().toLowerCase())) throw invalidResponse();
      const audio = await readAudio(response, plan.profile.max_response_bytes, signal, current);
      let actual; try { actual = validatePcmWav(audio); } catch { throw invalidResponse(); }
      const geometry = plan.profile.response_validation;
      if (geometry && (actual.bits !== 16 || actual.sampleRate !== geometry.sample_rate_hz || actual.channels !== geometry.channels)
        || plan.profile.adapter === 'cosyvoice_sft' && (actual.bits !== 16 || actual.sampleRate !== plan.profile.pcm_sample_rate || actual.channels !== 1)) throw invalidResponse();
      current(); audio.audioSource = 'api-harbor'; return audio;
    } catch (error) {
      void response?.body?.cancel().catch(() => {});
      if (signal.aborted) throw signal.reason instanceof AudioError ? signal.reason : failure(409, '语音请求已停止。', 'cancelled');
      throw error instanceof AudioError ? error : failure(502, 'API Harbor 语音合成失败，请稍后重试。', 'upstream_error');
    } finally { clearInterval(poll); }
  });
  const resolveAsrTransport = ({ model } = {}) => {
    const selected = serviceModels.forProtocol('asr_stream', model ? { model } : {}), profile = selected?.capabilities?.nativeProfile;
    const endpointUrl = selected && endpoint(selected, '/stream');
    if (!endpointUrl || !asrProfile(profile)) return;
    const url = new URL(endpointUrl); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const transport = { source: 'api-harbor', revision: selected.linkRevision, url: url.toString(), headers: { Authorization: `Bearer ${selected.apiKey}` }, config: { model: selected.model }, profile: structuredClone(profile),
      audio: { format: 'pcm_f32le', sampleRate: 24000, channels: 1, maxFrameBytes: 96000, maxSeconds: profile.max_input_milliseconds / 1000 }, maxFrameBytes: 64000,
      assertCurrent: () => liveDescriptor(serviceModels, 'asr_stream', selected), parse: nativeTranscript(profile) };
    transport.probe = options => probeNative(transport, options); return transport;
  };
  return {
    synthesize, resolveAsrTransport,
    synthesizeStream: args => admitted(args, input => cosyvoice.synthesizeStream(input)),
    publicConfig(editable = false, preferences = {}) {
      const original = cosyvoice.publicConfig(editable), plan = speechPlan(serviceModels, preferences);
      return { ...original, configured: original.configured || Boolean(plan), source: plan ? 'api-harbor' : 'cosyvoice', streamingAvailable: original.configured, streamingSource: original.configured ? 'cosyvoice' : null };
    },
    async close() { closed = true; const pending = [...running.values()]; for (const item of pending) item.controller.abort(failure(503, '语音服务正在退出。', 'closed')); await Promise.all(pending.map(item => item.done)); },
  };
}
