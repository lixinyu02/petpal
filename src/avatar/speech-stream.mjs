// Authenticated application framing around CosyVoice's raw PCM. A clean HTTP EOF
// alone is not an application completion marker.
import { normalizeSpeechEmotion } from './speech-emotion.mjs';
const FRAME_LIMIT = 36 * 1024, AUDIO_LIMIT = 20 * 1024 * 1024, CHUNK_LIMIT = 24576;
const invalid = () => new Error('语音流格式无效或连接提前结束，请重新播放。');
const fields = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

export async function readSpeechStream(response, { signal, assertCurrent = () => {}, onFormat, onAudio } = {}) {
  const check = () => { assertCurrent(); signal?.throwIfAborted(); };
  check();
  if (!/^application\/x-ndjson(?:\s*;|$)/i.test(response.headers.get('content-type') || '') || !response.body) {
    void response.body?.cancel().catch(() => {}); throw invalid();
  }
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '', formatted = false, terminal = false, received = 0, complete = false;
  const aborted = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal?.addEventListener('abort', aborted, { once: true });
  const dispatch = async line => {
    check();
    if (!line || line.length > FRAME_LIMIT || terminal) throw invalid();
    let frame; try { frame = JSON.parse(line); } catch { throw invalid(); }
    if (!frame || typeof frame !== 'object' || Array.isArray(frame)) throw invalid();
    if (frame.type === 'error') {
      if (!fields(frame, ['type', 'message']) || typeof frame.message !== 'string' || !frame.message || frame.message.length > 300) throw invalid();
      throw new Error(frame.message);
    }
    if (frame.type === 'format') {
      const keys = ['type', 'format', 'sampleRate', 'channels', ...(Object.hasOwn(frame, 'emotion') ? ['emotion'] : [])];
      if (formatted || !fields(frame, keys) || frame.format !== 'pcm_s16le' || frame.sampleRate !== 24000 || frame.channels !== 1) throw invalid();
      let emotion; try { emotion = normalizeSpeechEmotion(frame.emotion); } catch { throw invalid(); }
      formatted = true; await onFormat?.({ format: frame.format, sampleRate: frame.sampleRate, channels: frame.channels, ...(emotion ? { emotion } : {}) });
    } else if (frame.type === 'audio') {
      if (!formatted || !fields(frame, ['type', 'data']) || typeof frame.data !== 'string' || !frame.data.length || frame.data.length > CHUNK_LIMIT * 4 / 3 || !/^[A-Za-z0-9+/]+={0,2}$/.test(frame.data) || frame.data.length % 4) throw invalid();
      let raw; try { raw = atob(frame.data); } catch { throw invalid(); }
      if (btoa(raw) !== frame.data || raw.length > CHUNK_LIMIT) throw invalid();
      received += raw.length;
      if (received > AUDIO_LIMIT) throw new Error('语音流超过大小限制，请缩短朗读内容。');
      await onAudio?.(Uint8Array.from(raw, character => character.charCodeAt(0)));
    } else if (frame.type === 'end') {
      if (!formatted || !fields(frame, ['type', 'bytes']) || !Number.isSafeInteger(frame.bytes) || !received || received % 2 || frame.bytes !== received) throw invalid();
      terminal = true;
    } else throw invalid();
    check();
  };
  try {
    while (true) {
      check(); const { value, done } = await reader.read(); check();
      if (done) break;
      // Decode in bounded slices even if a transport coalesces the whole response.
      for (let offset = 0; offset < value.length; offset += FRAME_LIMIT) {
        buffer += decoder.decode(value.subarray(offset, offset + FRAME_LIMIT), { stream: true });
        let boundary;
        while ((boundary = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 1);
          await dispatch(line);
        }
        if (buffer.length > FRAME_LIMIT) throw invalid();
      }
    }
    buffer += decoder.decode();
    if (buffer.length || !terminal) throw invalid();
    check(); complete = true;
  } finally {
    signal?.removeEventListener('abort', aborted);
    if (!complete) void reader.cancel().catch(() => {});
    try { reader.releaseLock(); } catch {}
  }
}
