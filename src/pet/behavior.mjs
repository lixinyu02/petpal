/** Pure, deterministic behavior for one pet; no timers, DOM, or renderer dependency. */
export const MAX_STEP_SECONDS = 0.05;
export const PET_ACTIONS = Object.freeze(['idle', 'walk', 'pet', 'eat', 'sleep', 'jump']);
const USER_ACTIONS = new Set(['pet', 'eat', 'sleep', 'jump', 'wake']);
const DURATIONS = Object.freeze({ pet: 2.1, eat: 3.2, jump: 0.85 });
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const normalized = value => typeof value === 'number' && Number.isFinite(value) ? clamp(value, -1, 1) : 0;

export function createSeededRandom(seed = 0x50455443) {
  if (!Number.isFinite(seed)) throw new TypeError('Pet seed must be a finite number.');
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ state >>> 15, state | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

export function createPetBehavior(options = {}) {
  const bounds = options.bounds ?? [-1.4, 1.4];
  if (!Array.isArray(bounds) || bounds.length !== 2 || !bounds.every(Number.isFinite) || bounds[0] >= bounds[1]) throw new TypeError('Pet bounds must be finite [minX, maxX] with minX < maxX.');
  const [minimum, maximum] = bounds;
  const walkSpeed = options.walkSpeed ?? 0.26;
  if (!Number.isFinite(walkSpeed) || walkSpeed <= 0) throw new TypeError('Pet walkSpeed must be a positive finite number.');
  if (options.random !== undefined && typeof options.random !== 'function') throw new TypeError('Pet random must be a function.');
  const random = options.random ?? createSeededRandom(options.seed);
  const sample = () => { const value = random(); return Number.isFinite(value) ? clamp(value, 0, 0.999999999) : 0.5; };
  let visible = options.visible !== false;
  let reducedMotion = options.reducedMotion === true;
  let action = 'idle';
  let autonomous = true;
  let actionTime = 0;
  let duration = 3 + sample() * 4;
  let x = clamp(Number.isFinite(options.initialX) ? options.initialX : 0, minimum, maximum);
  let facing = options.facing === -1 ? -1 : 1;
  let lookX = 0, lookY = 0, pointerX = 0, pointerY = 0;

  function enter(next, userInitiated = false) {
    action = next; actionTime = 0; autonomous = !userInitiated;
    if (next === 'idle') duration = 3 + sample() * 4;
    else if (next === 'walk') duration = 2.4 + sample() * 2;
    else duration = DURATIONS[next] ?? Infinity;
  }
  function snapshot() {
    const progress = action === 'sleep' ? clamp(actionTime / 0.6, 0, 1)
      : action === 'idle' ? 0 : clamp(actionTime / duration, 0, 1);
    return {
      action, x, facing, lookX, lookY, actionTime, actionProgress: progress,
      jumpHeight: action === 'jump' && !reducedMotion ? 4 * progress * (1 - progress) : 0,
      speed: action === 'walk' && visible && !reducedMotion ? 1 : 0,
      autonomous, paused: !visible, autonomyPaused: !visible || reducedMotion,
    };
  }
  function move(dt) {
    // Triangle-wave reflection also handles very narrow bounds without escaping or looping.
    const span = maximum - minimum;
    const period = 2 * span;
    const unbounded = x - minimum + facing * walkSpeed * dt;
    const phase = ((unbounded % period) + period) % period;
    x = phase <= span ? minimum + phase : maximum - (phase - span);
    if (phase > span) facing *= -1;
    const epsilon = Math.min(1e-10, span * 1e-6);
    if (x <= minimum + epsilon) { x = minimum; facing = 1; }
    else if (x >= maximum - epsilon) { x = maximum; facing = -1; }
    x = clamp(x, minimum, maximum);
  }
  function step(deltaSeconds) {
    const dt = typeof deltaSeconds === 'number' && Number.isFinite(deltaSeconds) ? clamp(deltaSeconds, 0, MAX_STEP_SECONDS) : 0;
    if (!visible || !dt) return snapshot();
    const lookBlend = reducedMotion ? 1 : 1 - Math.exp(-8 * dt);
    lookX += (pointerX - lookX) * lookBlend;
    lookY += (pointerY - lookY) * lookBlend;
    if (reducedMotion && autonomous) return snapshot();
    actionTime += dt;
    if (action === 'walk') move(dt);
    if (action !== 'sleep' && actionTime >= duration) {
      if (action === 'idle' && !reducedMotion) {
        if (sample() < 0.9) { facing = sample() < 0.5 ? -1 : 1; enter('walk'); }
        else enter('jump');
      } else enter('idle');
    }
    return snapshot();
  }
  function wake() {
    if (action === 'sleep') enter('idle');
    return snapshot();
  }
  function interact(next) {
    if (!USER_ACTIONS.has(next)) throw new TypeError(`Unknown pet interaction: ${String(next)}`);
    if (next === 'wake') return wake();
    // Rest is a persistent user choice. Only explicit wake can end it.
    if (action === 'sleep') return snapshot();
    enter(next, true);
    return snapshot();
  }
  return {
    step, interact, wake, snapshot,
    setPointer(nextX, nextY) { pointerX = normalized(nextX); pointerY = normalized(nextY); },
    clearPointer() { pointerX = 0; pointerY = 0; },
    setVisible(value) { visible = Boolean(value); },
    setReducedMotion(value) {
      reducedMotion = Boolean(value);
      if (reducedMotion && autonomous && action !== 'idle') enter('idle');
    },
  };
}
