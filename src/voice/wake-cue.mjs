// Local acknowledgement only: it never makes a TTS request or drives lip sync.
export const WAKE_CUE_DURATION = .14;

export function wakeCueSamples(rate = 24000) {
  if (!Number.isFinite(rate) || rate < 8000 || rate > 192000) throw new RangeError('Invalid cue sample rate.');
  const samples = new Float32Array(Math.ceil(rate * WAKE_CUE_DURATION));
  for (const [offset, frequency] of [[0, 660], [.08, 880]]) {
    const start = Math.round(offset * rate), count = Math.round(.06 * rate);
    for (let i = 0; i < count && start + i < samples.length; i++) {
      const time = i / rate;
      const fade = Math.min(1, time / .006, (.06 - time) / .012);
      samples[start + i] = .065 * Math.sin(2 * Math.PI * frequency * time) * Math.sin(Math.PI * fade / 2) ** 2;
    }
  }
  return samples;
}

/** Warmed only by the explicit start gesture; play never waits for routing. */
export function createWakeCueController(options = {}) {
  const createContext = options.createContext ?? (() => new (globalThis.AudioContext ?? globalThis.webkitAudioContext)({latencyHint:'interactive'}));
  const schedule = options.schedule ?? ((callback, delay) => setTimeout(callback, delay));
  const unschedule = options.unschedule ?? (timer => clearTimeout(timer));
  let holder = null, source = null, disposed = false;
  function stop() {
    const previous = source; source = null;
    if (!previous) return;
    previous.signal?.removeEventListener('abort', previous.abort);
    previous.node.onended = null;
    try { previous.gain.gain.value = 0; previous.gain.disconnect(); } catch {}
    try { previous.node.stop(); } catch {}
    try { previous.node.disconnect(); } catch {}
  }
  function release() {
    stop(); const previous = holder; holder = null;
    if (!previous || previous.closed) return;
    previous.closed = true; previous.ready = false;
    if (previous.timer !== null) unschedule(previous.timer);
    previous.timer = null; previous.settle?.(false); previous.settle = null;
    try { Promise.resolve(previous.context.close()).catch(() => {}); } catch {}
  }
  function unlock() {
    if (disposed) return Promise.resolve(false);
    if (holder) return holder.promise;
    let context;
    try { context = createContext(); } catch { return Promise.resolve(false); }
    const active = {context,ready:false,closed:false,timer:null,settle:null,promise:null,speaker:''};
    active.promise = new Promise(resolve => { active.settle = resolve; }); holder = active;
    const current = () => !disposed && holder === active && !active.closed;
    const finish = ready => {
      if (!current()) return;
      if (!ready) { release(); return; }
      active.ready = true; unschedule(active.timer); active.timer = null;
      const settle = active.settle; active.settle = null; settle(true);
    };
    active.timer = schedule(() => finish(false), 5000);
    // resume() is invoked synchronously before any API/config await.
    try {
      const resumed = context.resume();
      Promise.resolve(resumed).then(async () => {
        if (!current() || context.state !== 'running') { finish(false); return; }
        const speaker = options.getSpeakerId?.() ?? '';
        if (speaker && speaker !== 'default') {
          if (typeof context.setSinkId !== 'function') { finish(false); return; }
          await context.setSinkId(speaker);
          if (!current()) return;
          if (typeof context.sinkId === 'string' && context.sinkId !== speaker) { finish(false); return; }
        }
        active.speaker = speaker && speaker !== 'default' ? speaker : '';
        finish(context.state === 'running');
      }).catch(() => finish(false));
    } catch { finish(false); }
    return active.promise;
  }
  function play(signal) {
    const active = holder;
    if (disposed || signal?.aborted || !active?.ready || active.closed || active.context.state !== 'running') return false;
    if (active.speaker && typeof active.context.sinkId === 'string' && active.context.sinkId !== active.speaker) return false;
    stop(); let node, gain;
    try {
      const context = active.context, samples = wakeCueSamples(context.sampleRate);
      const buffer = context.createBuffer(1, samples.length, context.sampleRate); buffer.getChannelData(0).set(samples);
      node = context.createBufferSource(); gain = context.createGain(); gain.gain.value = 1;
      node.buffer = buffer; node.connect(gain); gain.connect(context.destination);
      const playing = {node,gain,signal,abort:()=>{if(source === playing)stop();}};
      source = playing;
      signal?.addEventListener('abort', playing.abort, {once:true});
      node.onended = () => { if (source === playing) stop(); };
      if (signal?.aborted) { stop(); return false; }
      node.start(); return true;
    } catch {
      stop();
      try { node?.disconnect(); } catch {}
      try { if(gain){gain.gain.value=0;gain.disconnect();} } catch {}
      return false;
    }
  }
  return {unlock,play,stop,release,dispose(){release();disposed=true;}};
}
