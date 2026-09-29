// Text boundary shapes plus optional PCM energy envelope; not phoneme recognition.
const PHASES = new Set(['idle', 'listening', 'thinking', 'speaking', 'error']);
const REACTIONS = new Set(['pet', 'greet', 'wake']);
const MAX_STEP = .1, MAX_BACKLOG_SECONDS = 4.8, MAX_BACKLOG_UNITS = 64, MAX_INCREMENT_CHARS = 192;
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const ease = (value, target, dt, rate = 12) => value + (target - value) * (1 - Math.exp(-dt * rate));
const FACE_CHANNELS = ['warmAmount', 'curiousAmount', 'surpriseAmount', 'concernAmount', 'smileAmount'];
// Facial targets are independent of articulation. Renderers must continue to
// composite mouth movement after expression layers, including a smiling face.
const expressions = {
  neutral: {},
  warm: { warmAmount: 1, smileAmount: .28, browRaise: .1, blush: .2 },
  curious: { curiousAmount: 1, browRaise: .38, browTilt: .08, gazeOffsetX: .12, gazeOffsetY: .06, headTilt: .22 },
  thoughtful: { curiousAmount: .45, browRaise: -.18, browTilt: .18, gazeOffsetX: -.16, gazeOffsetY: .12, headTilt: -.05 },
  surprised: { surpriseAmount: 1, browRaise: .82 },
  shy: { warmAmount: .55, smileAmount: .35, browRaise: -.1, browTilt: .1, blush: .78, gazeOffsetX: -.16, gazeOffsetY: -.16, headTilt: -.16 },
  happy: { warmAmount: .8, smileAmount: .9, browRaise: .22, blush: .3, headTilt: .04 },
  playful: { warmAmount: .6, curiousAmount: .12, smileAmount: .8, browRaise: .25, browTilt: -.12, blush: .2, gazeOffsetX: .12, headTilt: -.12 },
  concerned: { warmAmount: .18, curiousAmount: .18, concernAmount: 1, smileAmount: .05, browRaise: .14, browTilt: .42, gazeOffsetX: -.05, gazeOffsetY: -.1, headTilt: -.07 },
};
const reactions = { pet: { expression: 'happy', duration: 1.65, amount: .62 }, greet: { expression: 'playful', duration: 1.55, amount: .72 }, wake: { expression: 'warm', duration: 1.2, amount: .38 } };
const neutral = () => ({ expression: 'neutral', expressionAmount: 0, warmAmount: 0, curiousAmount: 0, surpriseAmount: 0, concernAmount: 0, smileAmount: 0, mouthOpen: 0, mouthShape: 'rest', blinkLeft: 0, blinkRight: 0, browRaise: 0, browTilt: 0, blush: 0, headTilt: 0, headNod: 0, gazeOffsetX: 0, gazeOffsetY: 0, speaking: false });

function cue(character) {
  if (!character) return { shape: 'rest', open: 0, duration: .06 };
  if (/[。！？.!?\n]/u.test(character)) return { shape: 'rest', open: 0, duration: .38 };
  if (/[，,；;：:、…]/u.test(character)) return { shape: 'rest', open: 0, duration: .21 };
  if (/\s/u.test(character)) return { shape: 'rest', open: 0, duration: .065 };
  if (/[bpm闭抿唔嗯]/iu.test(character)) return { shape: 'M', open: 0, duration: .09 };
  if (/[a]/iu.test(character)) return { shape: 'A', open: .78, duration: .075 };
  if (/[eiy]/iu.test(character)) return { shape: 'E', open: .46, duration: .065 };
  if (/[ouw]/iu.test(character)) return { shape: 'O', open: .65, duration: .075 };
  if (/\p{Script=Han}/u.test(character)) {
    // Unknown pronunciation intentionally uses a small generic articulation palette.
    const shape = ['A', 'E', 'O'][character.codePointAt(0) % 3];
    return { shape, open: shape === 'A' ? .66 : shape === 'O' ? .56 : .4, duration: .155 };
  }
  if (/[a-z0-9]/iu.test(character)) return { shape: 'E', open: .28, duration: .055 };
  return { shape: 'rest', open: 0, duration: .065 };
}

function emotion(text) {
  if (/难过|担心|别着急|没关系|辛苦了|抱歉|\bsorry\b|\bworr(?:y|ied)\b|\bsad\b/iu.test(text)) return 'concerned';
  if (/开个玩笑|逗你|调皮|眨眨眼|\bwink\b|\bplayful\b|[😉😋]/iu.test(text)) return 'playful';
  if (/不好意思|害羞|脸红|嘿嘿|embarrass|blush|\bshy\b/iu.test(text)) return 'shy';
  if (/太好了|真棒|好耶|哈哈|开心极了|\bhappy\b|\bhooray\b|[😄🥰]/iu.test(text)) return 'happy';
  if (/[!！]{2}|哇|天哪|惊喜|没想到|\bwow\b/iu.test(text)) return 'surprised';
  if (/谢谢|感谢|喜欢|开心|陪你|抱抱|爱你|\bthanks?\b|\blove\b|[❤♥😊]/iu.test(text)) return 'warm';
  if (/让我想|思考|也许|或许|想一想|\bhmm\b|\bperhaps\b/iu.test(text)) return 'thoughtful';
  if (/[?？]|为什么|怎么|好奇|\bwonder\b/iu.test(text)) return 'curious';
  return null;
}

function emotionAtBoundary(text, index) {
  // Use the sentence actually being read, not a later sentence in the completed reply.
  let start = Math.max(0, index - 80), end = Math.min(text.length, index + 80);
  for (let position = index - 1; position >= start; position--) {
    if (/[。！？.!?\n]/u.test(text[position])) { start = position + 1; break; }
  }
  for (let position = index; position < end; position++) {
    if (/[。！？.!?\n]/u.test(text[position])) { end = position + 1; break; }
  }
  return emotion(text.slice(start, end));
}

export function createAvatarPerformance() {
  let output = neutral(), input = { utteranceId: '', text: '', phase: 'idle' };
  let queue = [], current = null, hidden = false, external = false, externalActive = false, externalIndex = -1, externalAudio = null;
  let emotionKind = null, emotionRemaining = 0, motionTime = 0, blinkAt = 3.1, blinkRemaining = 0, blinkNumber = 0;
  let reaction = null, winkAge = null, winkCooldown = 0, motionReduced = false;
  // Remember consumed lengths, not old message bodies. Reset/cancel must not replay a visited reply.
  const consumed = new Map();
  const reacted = new Set();
  const clearMouth = () => { queue = []; current = null; output.mouthOpen = 0; output.mouthShape = 'rest'; output.speaking = false; };
  const resetPose = () => { clearMouth(); output = neutral(); emotionKind = null; emotionRemaining = 0; reaction = null; winkAge = null; winkCooldown = 0; motionTime = 0; blinkAt = 3.1; blinkRemaining = 0; blinkNumber = 0; };
  const rememberLength = (id, length) => {
    const previous = consumed.get(id) ?? 0;
    consumed.delete(id); consumed.set(id, Math.max(length, previous));
    while (consumed.size > 64) consumed.delete(consumed.keys().next().value);
  };
  const enqueue = text => {
    for (const character of text.slice(-MAX_INCREMENT_CHARS)) {
      queue.push(cue(character));
      let seconds = queue.reduce((sum, event) => sum + event.duration, 0);
      while (queue.length > MAX_BACKLOG_UNITS || seconds > MAX_BACKLOG_SECONDS) seconds -= queue.shift().duration;
    }
  };

  function setInput(next) {
    if (!next || typeof next.utteranceId !== 'string' || typeof next.text !== 'string' || !PHASES.has(next.phase)) throw new TypeError('Invalid avatar performance input.');
    if (next.speech !== undefined && (!next.speech || typeof next.speech.active !== 'boolean' || typeof next.speech.charIndex !== 'number')) throw new TypeError('Invalid speech boundary input.');
    const changed = next.utteranceId !== input.utteranceId;
    const rewritten = !changed && !next.text.startsWith(input.text);
    const previousLength = Math.max(changed ? 0 : input.text.length, consumed.get(next.utteranceId) ?? 0);
    const priorExternal = external, priorActive = externalActive, priorIndex = externalIndex;
    // New replies invalidate only their speech queue. Facial channels and the
    // blink clock continue smoothly instead of flashing through a neutral pose.
    if (changed || rewritten) { clearMouth(); emotionKind = null; emotionRemaining = 0; }
    const appended = rewritten ? '' : next.text.slice(Math.min(previousLength, next.text.length));
    const wasSpeaking = input.phase === 'speaking';
    input = { utteranceId: next.utteranceId, text: next.text, phase: next.phase };
    rememberLength(next.utteranceId, next.text.length);
    external = next.speech !== undefined;
    externalActive = external && next.speech.active && !next.speech.ended;
    externalAudio = external && Number.isFinite(next.speech.audioLevel) ? (externalActive ? clamp(next.speech.audioLevel) : 0) : null;
    externalIndex = external && Number.isFinite(next.speech.charIndex) ? clamp(Math.floor(next.speech.charIndex), 0, next.text.length) : -1;
    let boundaryAdvanced = false;
    if (next.phase !== 'speaking' || hidden) { clearMouth(); emotionKind = null; emotionRemaining = 0; }
    else if (external) {
      queue = [];
      if (!externalActive || next.speech.ended || externalIndex < 0 || externalIndex >= next.text.length) {
        clearMouth(); emotionKind = null; emotionRemaining = 0;
      }
      else if (changed || !priorExternal || !priorActive || !wasSpeaking || externalIndex > priorIndex) {
        clearMouth();
        const value = cue(String.fromCodePoint(next.text.codePointAt(externalIndex)));
        current = { ...value, remaining: Math.min(.22, value.duration + .07) };
        boundaryAdvanced = true;
      } else if (externalIndex < priorIndex) clearMouth();
    } else {
      if (priorExternal) clearMouth();
      if (appended) enqueue(appended);
    }
    if (!hidden && next.phase === 'speaking' && (external ? boundaryAdvanced : appended)) {
      const value = external ? emotionAtBoundary(next.text, externalIndex) : emotion(next.text.slice(-160));
      if (value) { emotionKind = value; emotionRemaining = 2.1; }
      else if (external) { emotionKind = null; emotionRemaining = 0; }
    }
  }

  function react(event) {
    if (!event || typeof event.id !== 'string' || !event.id || event.id.length > 200 || !REACTIONS.has(event.kind)) throw new TypeError('Invalid avatar reaction.');
    if (reacted.has(event.id)) return false;
    reacted.add(event.id);
    while (reacted.size > 64) reacted.delete(reacted.values().next().value);
    // Hidden reactions are consumed, not deferred until the page is visible.
    if (hidden) return false;
    reaction = { ...reactions[event.kind], age: 0 };
    if (event.kind === 'greet' && winkCooldown <= 0) {
      winkCooldown = 2.4;
      if (!motionReduced) winkAge = 0;
    }
    return true;
  }

  function step(deltaSeconds, { reducedMotion = false, hidden: nowHidden = false } = {}) {
    const dt = Number.isFinite(deltaSeconds) && deltaSeconds > 0 ? Math.min(deltaSeconds, MAX_STEP) : 0;
    hidden = Boolean(nowHidden);
    motionReduced = Boolean(reducedMotion);
    if (hidden) {
      externalAudio = null;
      clearMouth(); emotionKind = null; emotionRemaining = 0; blinkRemaining = 0; reaction = null; winkAge = null;
      output = neutral();
      return { ...output };
    }
    if (motionReduced) {
      blinkRemaining = 0; winkAge = null;
      output.blinkLeft = output.blinkRight = output.headTilt = output.headNod = output.gazeOffsetX = output.gazeOffsetY = 0;
    }
    if (dt > 0) {
      if (input.phase === 'speaking') {
        let remainingDt = dt;
        while (remainingDt > 0) {
          if (!current && !external && queue.length) { const next = queue.shift(); current = { ...next, remaining: next.duration }; }
          if (!current) break;
          const elapsed = Math.min(remainingDt, current.remaining); current.remaining -= elapsed; remainingDt -= elapsed;
          if (current.remaining <= .000001) current = null;
        }
      }
      const audible = input.phase === 'speaking' && externalActive && externalAudio !== null;
      const targetOpen = audible ? (externalAudio > .025 ? clamp(externalAudio * .85, .06, .85) : 0) : current?.open ?? 0;
      output.mouthOpen = targetOpen === 0 ? 0 : ease(output.mouthOpen, targetOpen, dt, 28);
      output.mouthShape = audible ? (targetOpen > 0 ? (current?.shape && current.shape !== 'rest' && current.shape !== 'M' ? current.shape : 'A') : 'rest') : current?.shape ?? 'rest';
      output.speaking = input.phase === 'speaking' && (audible ? targetOpen > 0 : Boolean(current || queue.length));
      emotionRemaining = Math.max(0, emotionRemaining - dt);
      winkCooldown = Math.max(0, winkCooldown - dt);
      if (reaction) { reaction.age += dt; if (reaction.age >= reaction.duration) reaction = null; }
      const base = input.phase === 'thinking' ? 'thoughtful' : input.phase === 'listening' ? 'curious' : input.phase === 'error' ? 'concerned' : output.speaking ? 'warm' : 'neutral';
      const selected = emotionRemaining > 0 ? emotionKind : base;
      const amount = selected === 'neutral' ? 0 : emotionRemaining > 0 ? .85 : .4;
      const reactionAmount = reaction ? reaction.amount * clamp((reaction.duration - reaction.age) / .55) : 0;
      const face = expressions[selected], response = expressions[reaction?.expression ?? 'neutral'];
      output.expression = reaction && (selected === 'neutral' || selected === 'warm') ? reaction.expression : selected;
      const strength = Math.max(amount, reactionAmount);
      output.expressionAmount = ease(output.expressionAmount, strength, dt, strength > output.expressionAmount ? 9 : 4.5);
      for (const channel of FACE_CHANNELS) {
        const target = Math.max((face[channel] ?? 0) * amount, (response[channel] ?? 0) * reactionAmount);
        output[channel] = ease(output[channel], target, dt, target > output[channel] ? 9 : 4.5);
      }
      const poseTarget = channel => (face[channel] ?? 0) * amount * (1 - reactionAmount * .3) + (response[channel] ?? 0) * reactionAmount * .7;
      output.browRaise = ease(output.browRaise, poseTarget('browRaise'), dt, 7);
      output.browTilt = ease(output.browTilt, poseTarget('browTilt'), dt, 7);
      output.blush = ease(output.blush, Math.max((face.blush ?? 0) * amount, (response.blush ?? 0) * reactionAmount), dt, 5);
      if (!motionReduced) {
        motionTime += dt; blinkRemaining = Math.max(0, blinkRemaining - dt);
        if (winkAge !== null) { winkAge += dt; if (winkAge >= .38) winkAge = null; else blinkAt = Math.max(blinkAt, motionTime + .7); }
        if (motionTime >= blinkAt) { blinkRemaining = .18; blinkAt = motionTime + [3.4, 4.3, 2.9][blinkNumber++ % 3]; }
        const blink = blinkRemaining > 0 ? Math.sin((1 - blinkRemaining / .18) * Math.PI) : 0;
        const wink = winkAge !== null && winkAge > .07 ? Math.sin(clamp((winkAge - .07) / .31) * Math.PI) : 0;
        output.blinkLeft = clamp(blink); output.blinkRight = clamp(Math.max(wink, blink * (selected === 'shy' ? .92 : 1)));
        output.headTilt = ease(output.headTilt, Math.sin(motionTime * .75) * .08 + poseTarget('headTilt'), dt, 8);
        output.headNod = ease(output.headNod, Math.sin(motionTime * (output.speaking ? 4 : 1.4)) * (output.speaking ? .07 : .025), dt, 12);
        output.gazeOffsetX = ease(output.gazeOffsetX, poseTarget('gazeOffsetX'), dt, 5);
        output.gazeOffsetY = ease(output.gazeOffsetY, poseTarget('gazeOffsetY'), dt, 5);
      }
    }
    return { ...output };
  }
  function reset() { resetPose(); input = { utteranceId: '', text: '', phase: 'idle' }; external = externalActive = false; externalIndex = -1; externalAudio = null; hidden = false; }
  return { setInput, react, step, reset };
}
