// Remote synthesis is injected by the authenticated API layer; this module owns only playback.
export const REMOTE_SPEECH_TEXT_LIMIT = 1000;
const emptyState = () => ({ utteranceId: '', text: '', active: false, pending: false, charIndex: 0, ended: true, progressBasis: 'none', voiceName: '', error: '' });
const audioEvents = ['onplaying', 'onpause', 'onwaiting', 'onstalled', 'onended', 'onerror', 'ontimeupdate', 'onloadedmetadata'];

export function createRemoteSpeechController(options = {}) {
  const schedule = options.schedule ?? ((callback, delay) => setTimeout(callback, delay));
  const unschedule = options.unschedule ?? (timer => clearTimeout(timer));
  const createAudio = options.createAudio ?? (() => new globalThis.Audio());
  const createObjectURL = options.createObjectURL ?? (blob => globalThis.URL.createObjectURL(blob));
  const revokeObjectURL = options.revokeObjectURL ?? (url => globalThis.URL.revokeObjectURL(url));
  let state = emptyState(), current = null, generation = 0, disposed = false;
  const publish = patch => {
    state = { ...state, ...patch };
    if (!disposed) options.onState?.({ ...state });
  };
  const valid = job => !disposed && current === job && job.token === generation;
  const silence = audio => {
    if (!audio) return;
    // Keep cancelled elements muted even if an outstanding play() starts them later.
    try { audio.muted = true; } catch { /* The element may already have been torn down. */ }
    try { audio.pause(); } catch { /* Continue releasing the source. */ }
    try { if (audio.removeAttribute) audio.removeAttribute('src'); else audio.src = ''; } catch { /* Best effort teardown. */ }
    try { audio.load?.(); } catch { /* Some embedded media elements cannot reload after teardown. */ }
  };
  const release = job => {
    if (!job || job.released) return;
    job.released = true;
    for (const timer of [job.tick, job.timeout]) if (timer !== null) unschedule(timer);
    job.tick = job.timeout = null;
    if (job.audio) for (const event of audioEvents) job.audio[event] = null;
    job.abort.abort();
    silence(job.audio);
    if (job.url) { try { revokeObjectURL(job.url); } catch { /* Do not retain playback on a URL cleanup failure. */ } }
    job.url = '';
  };
  function stop() {
    if (disposed) return;
    generation++;
    const job = current; current = null;
    release(job);
    publish({ active: false, pending: false, ended: true, progressBasis: 'none' });
  }
  const fail = (job, message) => {
    if (!valid(job)) return;
    current = null; release(job);
    publish({ active: false, pending: false, ended: true, progressBasis: 'none', error: message });
  };
  const deadline = (job, delay, message) => {
    if (job.timeout !== null) unschedule(job.timeout);
    job.timeout = schedule(() => { job.timeout = null; fail(job, message); }, delay);
  };
  const progress = job => {
    if (!valid(job) || !job.accepted) return;
    const audio = job.audio;
    const active = audio.paused === false && !job.buffering;
    let index = state.charIndex;
    if (active && Number.isFinite(audio.duration) && audio.duration > 0 && Number.isFinite(audio.currentTime)) {
      index = Math.max(index, Math.min(job.text.length - 1, Math.floor(Math.max(0, audio.currentTime) / audio.duration * job.text.length)));
      if (/^[\uDC00-\uDFFF]$/.test(job.text[index] ?? '')) index--;
    }
    publish({ active, pending: job.buffering, charIndex: Math.max(state.charIndex, index), progressBasis: 'estimated' });
  };
  const tick = job => {
    job.tick = null;
    if (!valid(job)) return;
    progress(job);
    if (valid(job)) job.tick = schedule(() => tick(job), 100);
  };

  async function start(job) {
    let stage = 'create';
    try {
      const audio = createAudio(); job.audio = audio;
      if (!valid(job)) { silence(audio); return; }
      audio.muted = true; audio.preload = 'auto';
      const speakerId = options.getSpeakerId?.() ?? '';
      if (speakerId && speakerId !== 'default') {
        stage = 'speaker';
        if (typeof audio.setSinkId !== 'function') { fail(job, '当前环境不支持切换扬声器，请选择“系统默认”后再朗读。'); return; }
        await audio.setSinkId(speakerId);
        if (!valid(job)) { silence(audio); return; }
      }
      stage = 'synthesis';
      const blob = await options.requestAudio(job.text, job.abort.signal);
      if (!valid(job)) return;
      if (!blob || !Number.isFinite(blob.size) || blob.size <= 0) { fail(job, '远程语音服务返回了空音频，请重试。'); return; }
      job.url = createObjectURL(blob);
      audio.onplaying = () => { if (valid(job)) { job.buffering = false; progress(job); } };
      audio.onpause = () => { if (valid(job)) { job.buffering = false; progress(job); } };
      audio.onwaiting = () => {
        if (!valid(job)) return;
        job.buffering = true;
        if (job.accepted) progress(job);
      };
      // A stalled download can still have buffered audio; only waiting means playback stopped.
      audio.ontimeupdate = audio.onloadedmetadata = audio.onstalled = () => progress(job);
      audio.onended = () => {
        if (!valid(job)) return;
        current = null; release(job);
        publish({ active: false, pending: false, ended: true, charIndex: job.text.length, progressBasis: 'estimated' });
      };
      audio.onerror = () => fail(job, '生成的语音未能播放，请检查音频设备后重试。');
      audio.src = job.url;
      if (!valid(job)) return;
      stage = 'play';
      deadline(job, 15000, '语音播放未能启动，请检查音频设备后重试。');
      if (!valid(job)) { silence(audio); return; }
      // Request audible playback so the browser applies its normal autoplay policy.
      // Cancellation synchronously mutes this element, including any late play() start.
      audio.muted = false;
      await audio.play();
      if (!valid(job)) { silence(audio); return; }
      job.accepted = true;
      const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration * 1000 + 15000 : 300000;
      deadline(job, Math.min(600000, Math.max(30000, duration)), '语音播放没有正常结束，已停止此次朗读。');
      progress(job);
      if (valid(job)) job.tick = schedule(() => tick(job), 100);
    } catch (error) {
      if (!valid(job)) { silence(job.audio); return; }
      const message = stage === 'speaker' ? '无法使用所选扬声器，请重新选择输出设备后再朗读。'
        : stage === 'play' && error?.name === 'NotAllowedError' ? '浏览器阻止了语音播放，请直接点击“朗读上一条”后重试。'
          : stage === 'play' || stage === 'create' ? '当前环境无法播放语音，请检查音频设备后重试。'
            : typeof error?.message === 'string' && error.message ? `远程语音生成失败：${error.message.slice(0, 500)}` : '远程语音生成失败，请稍后重试。';
      fail(job, message);
    }
  }

  function speak({ utteranceId, text }) {
    if (disposed) return false;
    stop();
    if (disposed) return false;
    if (typeof text !== 'string' || !text.trim()) { publish({ ...emptyState() }); return false; }
    if (text.length > REMOTE_SPEECH_TEXT_LIMIT) {
      publish({ ...emptyState(), error: `这条回复超过远程朗读的 ${REMOTE_SPEECH_TEXT_LIMIT} 字符上限，请先让小伴概括后再朗读。` }); return false;
    }
    if (typeof options.requestAudio !== 'function') { publish({ ...emptyState(), error: '尚未配置远程语音服务。' }); return false; }
    const job = { token: ++generation, text, abort: new AbortController(), audio: null, url: '', tick: null, timeout: null, accepted: false, buffering: false, released: false };
    current = job;
    publish({ ...emptyState(), utteranceId, text, pending: true, ended: false, voiceName: '远程语音' });
    if (!valid(job)) return false;
    // Allow the backend's 180-second synthesis budget plus transport overhead for cold starts.
    deadline(job, 200000, '远程语音生成超时，请稍后重试。');
    void start(job);
    return valid(job);
  }
  return { speak, stop, snapshot: () => ({ ...state }), dispose() { if (!disposed) { stop(); disposed = true; } } };
}
