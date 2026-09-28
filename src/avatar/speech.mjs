// Browser/system TTS only. This module has no DOM or network dependency and accepts test doubles.
export const SPEECH_SEGMENT_LIMIT = 160;
const emptyState = () => ({ utteranceId: '', text: '', active: false, pending: false, charIndex: 0, ended: true, progressBasis: 'none', voiceName: '', error: '' });

export function speechLanguage(text, preferred = 'zh-CN') {
  if (/[\u3040-\u30ff]/u.test(text)) return 'ja';
  if (/[\uac00-\ud7af]/u.test(text)) return 'ko';
  if (/[\u3400-\u9fff]/u.test(text)) return 'zh';
  if (/[a-z]/i.test(text)) return 'en';
  return preferred.replace('_', '-').split('-')[0].toLowerCase();
}

export function selectSpeechVoice(voices, language) {
  const base = language.toLowerCase().replace('_', '-').split('-')[0];
  return [...voices].filter(voice => voice.localService === true && voice.lang?.toLowerCase().replace('_', '-').split('-')[0] === base)
    .sort((a, b) => Number(b.default) - Number(a.default))[0] ?? null;
}

export function splitSpeechText(text) {
  const parts = [];
  const expression = /[^。！？!?；;.\n]+[。！？!?；;.\n]*|[。！？!?；;.\n]+/gu;
  for (const match of text.matchAll(expression)) {
    let offset = 0;
    while (offset < match[0].length) {
      let end = Math.min(match[0].length, offset + SPEECH_SEGMENT_LIMIT);
      if (end < match[0].length) {
        const piece = match[0].slice(offset, end);
        const breakAt = Math.max(piece.lastIndexOf(' '), piece.lastIndexOf('，'), piece.lastIndexOf(','));
        if (breakAt > SPEECH_SEGMENT_LIMIT / 2) end = offset + breakAt + 1;
        if (/^[\uDC00-\uDFFF]$/.test(match[0][end] || '')) end--;
      }
      const raw = match[0].slice(offset, end);
      const leading = raw.length - raw.trimStart().length;
      const value = raw.trim();
      if (value) parts.push({ text: value, start: match.index + offset + leading, end: match.index + offset + leading + value.length });
      offset = end;
    }
  }
  return parts;
}

export function createSpeechController(options = {}) {
  const synthesis = options.synthesis;
  const createUtterance = options.createUtterance;
  const now = options.now ?? (() => globalThis.performance?.now() ?? Date.now());
  const schedule = options.schedule ?? ((callback, delay) => setTimeout(callback, delay));
  const unschedule = options.unschedule ?? (timer => clearTimeout(timer));
  let state = emptyState(), generation = 0, disposed = false, current = null;
  let tickTimer = null, startTimer = null, finishTimer = null;
  const publish = patch => { state = { ...state, ...patch }; if (!disposed) options.onState?.({ ...state }); };
  const clearTimers = () => {
    for (const timer of [tickTimer, startTimer, finishTimer]) if (timer !== null) unschedule(timer);
    tickTimer = startTimer = finishTimer = null;
  };
  const detach = () => {
    clearTimers();
    if (current) current.onstart = current.onboundary = current.onend = current.onerror = null;
    current = null;
  };
  function stop() {
    const owned = current !== null || state.active || state.pending;
    generation++; detach();
    if (owned) { try { synthesis?.cancel(); } catch { /* Some WebViews expose an unavailable synthesis service. */ } }
    publish({ active: false, pending: false, ended: true, progressBasis: 'none' });
  }
  function fail(message) { stop(); publish({ error: message }); }

  function speak({ utteranceId, text, language: preferred = 'zh-CN' }) {
    if (disposed) return false;
    stop();
    if (!synthesis || !createUtterance) { publish({ error: '此浏览器或 WebView 不支持系统语音朗读，仍可正常聊天。' }); return false; }
    if (typeof text !== 'string' || !text.trim()) return false;
    if (text.length > 20000) { publish({ error: '这条回复超过朗读长度上限，请先让小伴概括后再朗读。' }); return false; }
    const language = speechLanguage(text, preferred);
    let voice;
    try { voice = selectSpeechVoice(synthesis.getVoices(), language); }
    catch { publish({ error: '当前环境无法获取系统音色，暂不能朗读。' }); return false; }
    if (!voice) {
      publish({ error: language === 'zh' ? '此设备暂无可用的本地中文音色。请安装系统中文语音包，或换用支持它的浏览器。' : `此设备没有匹配 ${language} 的本地音色，暂不能朗读这条回复。` });
      return false;
    }
    const pieces = splitSpeechText(text), token = ++generation;
    publish({ ...emptyState(), utteranceId, text, pending: true, ended: false, voiceName: voice.name });
    let pieceIndex = 0;
    function next() {
      if (disposed || token !== generation) return;
      const piece = pieces[pieceIndex++];
      if (!piece) { detach(); publish({ active: false, pending: false, ended: true, charIndex: text.length }); return; }
      detach();
      let utterance;
      try { utterance = createUtterance(piece.text); }
      catch { fail('当前环境无法创建系统语音，仍可正常聊天。'); return; }
      current = utterance; utterance.voice = voice; utterance.lang = voice.lang; utterance.rate = 1; utterance.pitch = 1;
      let anchorTime = 0, anchorIndex = piece.start, lastBoundary = 0, silenceStarted = 0;
      const valid = () => !disposed && generation === token && current === utterance;
      const unitsPerSecond = language === 'zh' || language === 'ja' || language === 'ko' ? 4.5 : 13;
      const tick = () => {
        if (!valid()) return;
        const time = now();
        if (synthesis.paused || synthesis.speaking === false) {
          anchorTime = time; anchorIndex = state.charIndex;
          publish({ active: false });
          if (!silenceStarted) silenceStarted = time;
          if (time - silenceStarted > 3000) { fail('系统朗读已停止，未返回完成状态。可以再次点击“朗读上一条”。'); return; }
        } else {
          silenceStarted = 0;
          // No phoneme claim: estimate only after the engine actually started, and prefer real boundaries.
          if (time - lastBoundary > 650) {
            const estimate = Math.min(piece.end - 1, anchorIndex + Math.floor((time - anchorTime) / 1000 * unitsPerSecond));
            publish({ active: true, charIndex: Math.max(state.charIndex, estimate), progressBasis: 'estimated' });
          } else if (!state.active) publish({ active: true });
        }
        tickTimer = schedule(tick, 100);
      };
      utterance.onstart = () => {
        if (!valid()) return;
        if (startTimer !== null) unschedule(startTimer); startTimer = null;
        anchorTime = lastBoundary = now(); anchorIndex = piece.start;
        publish({ active: true, pending: false, charIndex: piece.start, progressBasis: 'none' });
        tickTimer = schedule(tick, 100);
        finishTimer = schedule(() => { if (valid()) fail('系统朗读没有正常结束，已停止此次朗读。'); }, Math.min(120000, 30000 + piece.text.length / unitsPerSecond * 1800));
      };
      utterance.onboundary = event => {
        if (!valid() || !state.active || !Number.isFinite(event.charIndex)) return;
        const index = Math.max(piece.start, Math.min(piece.end - 1, piece.start + Math.floor(event.charIndex)));
        anchorIndex = index; anchorTime = lastBoundary = now();
        publish({ charIndex: Math.max(state.charIndex, index), progressBasis: 'boundary' });
      };
      utterance.onend = () => {
        if (!valid()) return;
        detach(); publish({ active: false, pending: pieceIndex < pieces.length, charIndex: piece.end });
        next();
      };
      utterance.onerror = event => {
        if (!valid()) return;
        const reason = event.error === 'not-allowed' ? '当前浏览器阻止了朗读，请直接点击“朗读上一条”。' : '系统音色未能播放，可能受设备或 WebView 限制；仍可正常阅读回复。';
        fail(reason);
      };
      publish({ active: false, pending: true, charIndex: piece.start });
      startTimer = schedule(() => { if (valid()) fail('系统音色未能启动。请检查设备语音服务，或换用支持朗读的浏览器。'); }, 10000);
      try { synthesis.speak(utterance); }
      catch { fail('当前环境无法开始语音朗读，仍可正常聊天。'); }
    }
    next();
    return !state.error;
  }
  return { speak, stop, snapshot: () => ({ ...state }), dispose() { stop(); disposed = true; } };
}
