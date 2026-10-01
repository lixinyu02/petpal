const TAU = Math.PI * 2;
const REST_FREQUENCY = TAU / 5.2;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const finite = value => Number.isFinite(value) ? value : 0;
const signed = value => clamp(finite(value), -1, 1);
const unit = value => clamp(finite(value), 0, 1);
const axis = () => ({ position: 0, velocity: 0 });
const neutral = () => ({
  gazeX: 0, gazeY: 0, headX: 0, headY: 0, headTilt: 0,
  bodyXPercent: 0, bodyYPercent: 0, bodyRotationDegrees: 0,
  breath: 0, breathScale: 1,
});

/** Exact critically damped response to a constant intent during this frame.
 * Each layer follows that same intent at its own speed; using the preceding
 * layer's end-of-frame position as a target would introduce frame-rate drift.
 */
function spring(state, target, frequency, seconds, limit) {
  const offset = state.position - target;
  const momentum = state.velocity + frequency * offset;
  const decay = Math.exp(-frequency * seconds);
  const position = target + (offset + momentum * seconds) * decay;
  state.velocity = (state.velocity - frequency * momentum * seconds) * decay;
  state.position = clamp(position, -limit, limit);
  if (state.position !== position) state.velocity = 0;
}

/** Renderer-independent, low-amplitude follow-through. Semantic gestures,
 * expressions and mouth cues remain the performance controller's concern.
 */
export function createAvatarPresence() {
  const eyes = [axis(), axis()];
  const head = [axis(), axis(), axis()];
  const body = [axis(), axis(), axis()];
  let breathPhase = 0, breathFrequency = REST_FREQUENCY, speechEnergy = 0;
  let output = neutral();

  function reset() {
    for (const state of [...eyes, ...head, ...body]) state.position = state.velocity = 0;
    breathPhase = speechEnergy = 0;
    breathFrequency = REST_FREQUENCY;
    output = neutral();
  }

  function step(deltaSeconds, options = {}) {
    const input = options && typeof options === 'object' ? options : {};
    if (input.reducedMotion || input.sleeping || input.hidden) {
      reset();
      return { ...output };
    }
    const dt = clamp(finite(deltaSeconds), 0, .1);
    if (!dt) return { ...output };

    const gazeX = signed(input.gazeX), gazeY = signed(input.gazeY);
    const tilt = signed(input.headTilt), nod = signed(input.headNod);
    const energy = input.phase === 'speaking' ? unit(input.voiceEnergy) : 0;
    spring(eyes[0], gazeX, 18, dt, 1);
    spring(eyes[1], gazeY, 18, dt, 1);
    spring(head[0], gazeX, 6, dt, 1);
    spring(head[1], gazeY, 6, dt, 1);
    spring(head[2], tilt, 6, dt, 1);
    spring(body[0], gazeX * .65, 3, dt, .65);
    // View y and head tilt use world axes; portrait offsets use CSS axes.
    spring(body[1], -gazeY * .35 + nod * .05, 3, dt, .4);
    spring(body[2], -tilt * .35 - gazeX * .15, 3, dt, .5);

    // Integrate the changing frequency itself, never recompute a sine phase
    // from elapsed time and current audio energy. Wrap to avoid unbounded clocks.
    const targetFrequency = TAU / (5.2 - energy * .35);
    const decay = Math.exp(-1.2 * dt);
    breathPhase = (breathPhase + targetFrequency * dt
      + (breathFrequency - targetFrequency) * (1 - decay) / 1.2) % TAU;
    breathFrequency = targetFrequency + (breathFrequency - targetFrequency) * decay;
    speechEnergy = energy + (speechEnergy - energy) * Math.exp(-4 * dt);

    output = {
      gazeX: eyes[0].position, gazeY: eyes[1].position,
      headX: head[0].position, headY: head[1].position, headTilt: head[2].position,
      bodyXPercent: body[0].position, bodyYPercent: body[1].position,
      bodyRotationDegrees: body[2].position,
      breath: Math.sin(breathPhase), breathScale: 1 + .12 * speechEnergy,
    };
    return { ...output };
  }

  return { step, reset };
}
