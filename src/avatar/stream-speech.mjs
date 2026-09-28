// The authenticated transport validates NDJSON; this player owns bounded PCM playback.
export const STREAM_SPEECH_TEXT_LIMIT = 1000;
const RATE = 24000, FRAME = 2880, PREBUFFER = 5760, MAX_BUFFER = RATE * 3;
const AUDIO_LIMIT = 20 * 1024 * 1024, CHUNK_LIMIT = 24576, START_LEAD = 0.035;
const emptyState = () => ({ utteranceId: '', text: '', active: false, pending: false, charIndex: 0, ended: true, progressBasis: 'none', voiceName: '', error: '', audioLevel: 0, buffering: false, streaming: false });
const cancelled = () => Object.assign(new Error('语音播放已取消。'), { name: 'AbortError' });

export function createStreamingSpeechController(options = {}) {
  const schedule = options.schedule ?? ((callback, delay) => setTimeout(callback, delay));
  const unschedule = options.unschedule ?? (timer => clearTimeout(timer));
  const now = options.now ?? (() => globalThis.performance.now());
  const createContext = options.createContext ?? (() => {
    const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    return new Context({ latencyHint: 'interactive' });
  });
  const devices = options.mediaDevices ?? globalThis.navigator?.mediaDevices;
  let state = emptyState(), current = null, warm = null, generation = 0, disposed = false;
  const publish = patch => { state = { ...state, ...patch }; if (!disposed) options.onState?.({ ...state }); };
  const valid = job => !disposed && current === job && job.token === generation;
  const closeHolder = holder => {
    if (!holder) return;
    // Silence synchronously; a delayed resume/setSinkId cannot make released nodes audible.
    try { holder.gain.gain.value = 0; holder.gain.disconnect(); } catch { /* Already detached. */ }
    if (holder.timer !== null) unschedule(holder.timer);
    holder.timer = null;
    holder.settle?.(false); holder.settle = null;
    if (!holder.closed) {
      holder.closed = true;
      try { Promise.resolve(holder.context.close()).catch(() => {}); } catch { /* Continue cleanup. */ }
    }
  };
  const makeHolder = () => {
    const context = createContext();
    let gain;
    try { gain = context.createGain(); gain.gain.value = 0; gain.connect(context.destination); }
    catch (error) { try { Promise.resolve(context.close()).catch(() => {}); } catch { /* Nothing to release. */ } throw error; }
    const holder = { context, gain, timer: null, closed: false, settle: null, ready: null, error: '' };
    holder.ready = new Promise(resolve => { holder.settle = resolve; });
    const finish = (ok, error = '') => {
      if (!holder.settle) return;
      if (holder.timer !== null) unschedule(holder.timer);
      holder.timer = null; holder.error = error;
      const settle = holder.settle; holder.settle = null; settle(ok);
      if (!ok) closeHolder(holder);
    };
    holder.timer = schedule(() => finish(false, '语音播放未能解锁，请直接点击消息旁的播放按钮后重试。'), 15000);
    // Intentionally call resume before the first await to preserve the user's gesture.
    try {
      Promise.resolve(context.resume()).then(() => {
        if (holder.closed) { closeHolder(holder); return; }
        finish(context.state === 'running', context.state === 'running' ? '' : '语音播放未能解锁，请直接点击消息旁的播放按钮后重试。');
      }, () => finish(false, '浏览器阻止了语音播放，请直接点击消息旁的播放按钮后重试。'));
    } catch { finish(false, '当前环境无法播放流式语音，请检查音频设备后重试。'); }
    return holder;
  };
  const wake = job => { const notify = job.wake; job.wake = null; notify?.(); };
  const release = job => {
    if (!job || job.released) return;
    job.released = true;
    // Mute before abort can invoke any synchronous transport callbacks.
    closeHolder(job.holder);
    if (job.tick !== null) unschedule(job.tick);
    job.tick = null;
    for (const item of job.sources) { item.node.onended = null; try { item.node.stop(); item.node.disconnect(); } catch { /* A node may already have ended. */ } }
    job.sources.length = 0; job.queue.length = 0; job.queued = 0; job.carry = null;
    if (job.deviceListener) devices?.removeEventListener?.('devicechange', job.deviceListener);
    job.abort.abort(); wake(job);
  };
  function stop() {
    if (disposed) return;
    generation++;
    const job = current; current = null; release(job);
    const idle = warm; warm = null; closeHolder(idle);
    publish({ active: false, pending: false, ended: true, progressBasis: 'none', audioLevel: 0, buffering: false, streaming: false });
  }
  const fail = (job, message) => {
    if (!valid(job)) return;
    current = null; release(job);
    publish({ active: false, pending: false, ended: true, progressBasis: 'none', error: message, audioLevel: 0, buffering: false, streaming: false });
  };
  const finish = job => {
    if (!valid(job)) return;
    current = null; release(job);
    publish({ active: false, pending: false, ended: true, charIndex: job.text.length, progressBasis: 'estimated', audioLevel: 0, buffering: false, streaming: false });
  };
  const take = (job, count) => {
    const result = new Float32Array(count);
    let offset = 0;
    while (offset < count) {
      const first = job.queue[0], size = Math.min(first.length, count - offset);
      result.set(first.subarray(0, size), offset); offset += size;
      if (size === first.length) job.queue.shift(); else job.queue[0] = first.subarray(size);
    }
    job.queued -= count; return result;
  };
  const report = (job, at) => {
    const activeSource = job.sources.find(item => item.start <= at && at < item.end);
    const active = job.holder.context.state === 'running' && Boolean(activeSource);
    let rendered = job.rendered, audioLevel = 0;
    for (const item of job.sources) rendered += Math.min(item.samples.length, Math.max(0, Math.floor((at - item.start) * RATE)));
    if (activeSource && active) {
      const offset = Math.max(0, Math.floor((at - activeSource.start) * RATE));
      const end = Math.min(activeSource.samples.length, offset + 480);
      let power = 0;
      for (let i = offset; i < end; i++) power += activeSource.samples[i] ** 2;
      audioLevel = end > offset ? Math.min(1, Math.sqrt(power / (end - offset)) * 4) : 0;
    }
    // A streaming utterance has no final duration yet. Keep this explicitly estimated.
    const duration = job.inputEnded ? job.samples / RATE : Math.max(job.text.length / 5, job.samples / RATE);
    let index = Math.min(job.text.length - 1, Math.floor(rendered / RATE / Math.max(duration, 0.001) * job.text.length));
    if (/^[\uDC00-\uDFFF]$/.test(job.text[index] ?? '')) index--;
    publish({ active, pending: !active, charIndex: Math.max(state.charIndex, index, 0), progressBasis: 'estimated', audioLevel, buffering: !active && job.samples > 0, streaming: !job.inputEnded });
  };
  const pump = job => {
    if (!valid(job) || !job.ready) return;
    const context = job.holder.context, at = context.currentTime;
    if (job.speaker && typeof context.sinkId === 'string' && context.sinkId !== job.speaker) { fail(job, '所选扬声器已不可用，请重新选择输出设备后再朗读。'); return; }
    while (job.sources.length && job.sources[0].end <= at) {
      const item = job.sources.shift(); job.rendered += item.samples.length;
      item.node.onended = null; try { item.node.disconnect(); } catch { /* Already detached. */ }
    }
    if (!job.sources.length && job.nextStart <= at) job.playing = false;
    if (!job.playing && (job.queued >= PREBUFFER || (job.inputEnded && job.queued > 0))) {
      job.playing = true; job.nextStart = at + START_LEAD;
    }
    while (job.playing && job.queued > 0 && valid(job)) {
      const count = Math.min(FRAME, job.queued);
      if (count < FRAME && !job.inputEnded) break;
      const duration = count / RATE;
      if (job.nextStart + duration > at + 3) break;
      const samples = take(job, count), buffer = context.createBuffer(1, count, RATE);
      buffer.getChannelData(0).set(samples);
      const node = context.createBufferSource();
      node.buffer = buffer; node.connect(job.holder.gain);
      const item = { node, samples, start: job.nextStart, end: job.nextStart + duration };
      job.sources.push(item);
      node.onended = () => { if (valid(job)) { try { pump(job); } catch { fail(job, '生成的语音未能播放，请检查音频设备后重试。'); } } };
      node.start(item.start); job.nextStart = item.end;
    }
    if (job.inputEnded && job.queued === 0 && job.sources.length === 0) { finish(job); return; }
    wake(job); report(job, at);
  };
  const tick = job => {
    job.tick = null;
    if (!valid(job)) return;
    const elapsed = now(), context = job.holder?.context;
    if (elapsed - job.createdAt >= 600000) { fail(job, '语音播放没有正常结束，已停止此次朗读。'); return; }
    if (job.stage !== 'stream' && elapsed - job.stageAt >= 15000) { fail(job, job.stage === 'speaker' ? '切换扬声器超时，请重新选择输出设备后再朗读。' : '语音播放未能解锁，请直接点击消息旁的播放按钮后重试。'); return; }
    if (job.stage === 'stream' && !job.inputEnded && elapsed - job.lastDataAt >= (job.samples ? 30000 : 200000)) { fail(job, job.samples ? '流式语音长时间没有收到音频，已停止此次朗读。' : '远程语音生成超时，请稍后重试。'); return; }
    if (job.sources.length) {
      if (context.currentTime > job.lastClock) job.clockAt = elapsed;
      else if (elapsed - job.clockAt >= 15000) { fail(job, '语音播放未能继续，请检查音频设备后重试。'); return; }
    } else job.clockAt = elapsed;
    job.lastClock = context?.currentTime ?? 0;
    try { pump(job); } catch { fail(job, '生成的语音未能播放，请检查音频设备后重试。'); }
    if (valid(job)) job.tick = schedule(() => tick(job), 40);
  };
  const ingest = async (job, bytes) => {
    if (!valid(job)) throw cancelled();
    if (!job.format || job.inputEnded || job.receiving || !(bytes instanceof Uint8Array) || !bytes.length || bytes.length > CHUNK_LIMIT) throw new Error('流式音频数据格式不正确。');
    if ((job.bytes += bytes.length) > AUDIO_LIMIT) throw new Error('流式音频超出播放大小上限。');
    job.receiving = true; job.lastDataAt = now();
    try {
      let input = bytes;
      if (job.carry !== null) { input = new Uint8Array(bytes.length + 1); input[0] = job.carry; input.set(bytes, 1); job.carry = null; }
      if (input.length % 2) job.carry = input[input.length - 1];
      const view = new DataView(input.buffer, input.byteOffset, input.length);
      let offset = 0;
      const count = Math.floor(input.length / 2);
      while (offset < count) {
        if (!valid(job)) throw cancelled();
        pump(job);
        const ahead = Math.max(0, job.nextStart - job.holder.context.currentTime) * RATE;
        const room = Math.floor(MAX_BUFFER - ahead - job.queued);
        if (room <= 0) { await new Promise(resolve => { job.wake = resolve; }); continue; }
        const size = Math.min(room, count - offset), samples = new Float32Array(size);
        for (let i = 0; i < size; i++) samples[i] = view.getInt16((offset + i) * 2, true) / 32768;
        job.queue.push(samples); job.queued += size; job.samples += size; offset += size;
        pump(job);
      }
    } finally { job.receiving = false; }
  };
  async function start(job) {
    try {
      const ready = await job.holder.ready;
      if (!valid(job)) return;
      if (!ready) { fail(job, job.holder.error || '语音播放未能解锁，请直接点击消息旁的播放按钮后重试。'); return; }
      const context = job.holder.context, speaker = options.getSpeakerId?.() ?? '';
      if (speaker && speaker !== 'default') {
        job.stage = 'speaker'; job.stageAt = now();
        if (typeof context.setSinkId !== 'function') { fail(job, '当前环境不支持切换扬声器，请选择“系统默认”后再朗读。'); return; }
        await context.setSinkId(speaker);
        if (!valid(job)) return;
        job.speaker = speaker;
        if (typeof context.sinkId === 'string' && context.sinkId !== speaker) throw new Error('扬声器选择没有生效。');
        if (devices?.addEventListener && devices?.enumerateDevices) {
          job.deviceListener = () => {
            Promise.resolve().then(() => devices.enumerateDevices()).then(list => {
              if (valid(job) && !list.some(item => item.kind === 'audiooutput' && item.deviceId === speaker)) fail(job, '所选扬声器已断开，请重新选择输出设备后再朗读。');
            }, () => { if (valid(job)) fail(job, '无法确认所选扬声器，请重新选择输出设备后再朗读。'); });
          };
          devices.addEventListener('devicechange', job.deviceListener);
        }
      }
      job.stage = 'stream'; job.stageAt = job.lastDataAt = now(); job.ready = true;
      job.holder.gain.gain.value = 1;
      await options.requestStream(job.text, job.abort.signal, {
        onFormat(format) {
          if (!valid(job)) throw cancelled();
          if (job.format || format?.format !== 'pcm_s16le' || format.sampleRate !== RATE || format.channels !== 1) throw new Error('流式音频格式不受支持。');
          job.format = true;
        },
        onAudio: bytes => ingest(job, bytes),
      });
      if (!valid(job)) return;
      if (!job.format || !job.samples || job.carry !== null || job.receiving) throw new Error('流式音频为空或不完整，请重试。');
      job.inputEnded = true; pump(job);
    } catch (error) {
      if (!valid(job)) return;
      const message = job.stage === 'speaker' ? '无法使用所选扬声器，请重新选择输出设备后再朗读。'
        : typeof error?.message === 'string' && error.message ? `流式语音播放失败：${error.message.slice(0, 500)}` : '流式语音播放失败，请稍后重试。';
      fail(job, message);
    }
  }
  async function unlock() {
    if (disposed) return false;
    if (current) return current.holder.context.state === 'running';
    let holder;
    try { holder = warm ?? makeHolder(); warm = holder; }
    catch { publish({ error: '当前环境无法播放流式语音，请检查音频设备后重试。' }); return false; }
    const ready = await holder.ready;
    // speak() may take ownership while resume() is pending. That transfer is a
    // successful unlock, not cancellation of the user's auto-read gesture.
    const handedToCurrent = current?.holder === holder && valid(current);
    if (disposed || (warm !== holder && !handedToCurrent)) return false;
    if (!ready) { if (warm === holder) warm = null; publish({ error: holder.error || '语音播放未能解锁，请直接点击消息旁的播放按钮后重试。' }); }
    return ready;
  }
  function speak({ utteranceId, text }) {
    if (disposed) return false;
    const idle = warm; warm = null; stop();
    if (disposed) { closeHolder(idle); return false; }
    if (typeof text !== 'string' || !text.trim()) { closeHolder(idle); publish(emptyState()); return false; }
    if (text.length > STREAM_SPEECH_TEXT_LIMIT) { closeHolder(idle); publish({ ...emptyState(), error: `这条回复超过远程朗读的 ${STREAM_SPEECH_TEXT_LIMIT} 字符上限，请先让小伴概括后再朗读。` }); return false; }
    if (typeof options.requestStream !== 'function') { closeHolder(idle); publish({ ...emptyState(), error: '尚未配置远程语音服务。' }); return false; }
    let holder;
    try { holder = idle && !idle.closed && idle.context.state !== 'closed' ? idle : makeHolder(); }
    catch { closeHolder(idle); publish({ ...emptyState(), error: '当前环境无法播放流式语音，请检查音频设备后重试。' }); return false; }
    const time = now();
    const job = { token: ++generation, text, holder, abort: new AbortController(), tick: null, wake: null, released: false, createdAt: time, stage: 'unlock', stageAt: time, lastDataAt: time, lastClock: holder.context.currentTime, clockAt: time, ready: false, speaker: '', deviceListener: null, format: false, receiving: false, inputEnded: false, carry: null, bytes: 0, samples: 0, rendered: 0, queue: [], queued: 0, sources: [], nextStart: 0, playing: false };
    current = job;
    publish({ ...emptyState(), utteranceId, text, pending: true, ended: false, voiceName: 'CosyVoice', streaming: true });
    if (!valid(job)) { release(job); return false; }
    job.tick = schedule(() => tick(job), 40);
    void start(job);
    return valid(job);
  }
  return { speak, unlock, stop, snapshot: () => ({ ...state }), dispose() { if (!disposed) { stop(); disposed = true; } } };
}
