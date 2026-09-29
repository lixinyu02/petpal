import { readAsrEvents } from './asr-events.mjs';
import { pcmFloat32LE } from './audio.mjs';

/** Own one authenticated ASR turn. PCM uploads are acknowledged strictly in order. */
export async function openAsrTransport(options) {
  const abort = new AbortController();
  let id = '', sequence = 0, pendingBytes = 0, closed = false, ending = false, removed = false;
  let timer, pumping = false;
  const queued = [], pending = new Set();
  let readyResolve, readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  void ready.catch(() => {});
  const check = () => { options.signal?.throwIfAborted(); options.assertCurrent?.(); abort.signal.throwIfAborted(); };
  const clear = () => {
    clearTimeout(timer); timer = undefined;
    options.signal?.removeEventListener('abort', externalAbort);
    options.onClose?.();
  };
  const remove = () => {
    if (id && !removed) { removed = true; void Promise.resolve().then(() => options.remove(id)).catch(() => {}); }
  };
  const cancel = (error = new DOMException('语音识别已取消', 'AbortError')) => {
    if (!closed) {
      closed = true; abort.abort(error); readyReject(error); clear();
      for (const frame of pending) frame.reject(error);
      pending.clear(); queued.length = 0; pendingBytes = 0;
    }
    remove();
  };
  const externalAbort = () => cancel(options.signal.reason);
  const deadline = (milliseconds, message) => {
    clearTimeout(timer); timer = setTimeout(() => cancel(new Error(message)), milliseconds);
  };
  options.signal?.addEventListener('abort', externalAbort, { once: true });
  try {
    check(); deadline(15000, '语音识别连接超时，请稍后重试。');
    const created = await options.request('/voice/asr/sessions', { method: 'POST', body: '{}', signal: abort.signal });
    if (typeof created.id !== 'string' || !created.id) throw new Error('识别服务返回了不支持的音频格式。');
    id = created.id;
    if (created.sampleRate !== 24000) throw new Error('识别服务返回了不支持的音频格式。');
    check();
    const result = (async () => {
      const response = await options.openEvents(id, abort.signal); check();
      if (!response.ok) throw new Error(`识别字幕连接失败 (${response.status})。`);
      return readAsrEvents(response, {
        signal: abort.signal, assertCurrent: check,
        onReady() { clearTimeout(timer); timer = undefined; readyResolve(); },
        onTranscript: options.onTranscript,
      });
    })();
    void result.catch(cancel);
    await ready; check();
    async function upload() {
      if (pumping || closed) return;
      pumping = true;
      try {
        while (queued.length) {
          check();
          // Send the first frame immediately. During its RTT, collect later
          // worklet frames into at most one second of PCM for the next request.
          // A single capture frame may straddle batches; its promise resolves
          // only after the acknowledgement containing its final sample.
          const size = Math.min(96000, queued.reduce((bytes, frame) => bytes + frame.body.byteLength - frame.offset, 0));
          const body = new Uint8Array(size), completed = [];
          let offset = 0;
          while (offset < size) {
            const frame = queued[0], take = Math.min(size - offset, frame.body.byteLength - frame.offset);
            body.set(frame.body.subarray(frame.offset, frame.offset + take), offset);
            frame.offset += take; offset += take;
            if (frame.offset === frame.body.byteLength) { queued.shift(); completed.push(frame); }
          }
          const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]);
          const ack = await options.request(`/voice/asr/sessions/${encodeURIComponent(id)}/audio?sequence=${sequence}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body:body.buffer, signal });
          check(); if (ack.nextSequence !== sequence + 1) throw new Error('音频分块确认顺序不正确。'); sequence++;
          pendingBytes -= size;
          for (const frame of completed) { pending.delete(frame); frame.resolve(); }
        }
      } catch (error) { cancel(error); }
      finally { pumping = false; }
    }
    return {
      send(samples) {
        try {
          check(); if (closed || ending) throw new Error('识别语句已经结束。');
          const body = pcmFloat32LE(samples);
          if (!body.byteLength || body.byteLength > 96000) throw new Error('麦克风分块大小不正确。');
          if (pendingBytes + body.byteLength > 24000 * 4 * 3 || pending.size >= 64) throw new Error('音频上传跟不上录音速度，已停止以避免积压。');
          pendingBytes += body.byteLength;
          const frame = { body:new Uint8Array(body), offset:0, resolve:null, reject:null, promise:null };
          frame.promise = new Promise((resolve,reject) => { frame.resolve=resolve; frame.reject=reject; });
          void frame.promise.catch(()=>{});
          queued.push(frame); pending.add(frame); void upload(); return frame.promise;
        } catch (error) { cancel(error); return Promise.reject(error); }
      },
      async finish() {
        if (ending || closed) { check(); throw new Error('识别语句已经结束。'); }
        ending = true;
        try {
          await Promise.all([...pending].map(frame=>frame.promise)); check(); deadline(60000, '等待完整识别结果超时，请重试。');
          await options.request(`/voice/asr/sessions/${encodeURIComponent(id)}/end`, { method: 'POST', body: '{}', signal: abort.signal });
          const text = await result; check(); closed = true; clear(); return text.trim();
        } catch (error) { cancel(error); throw error; }
      },
      cancel,
    };
  } catch (error) { cancel(error); throw error; }
}
