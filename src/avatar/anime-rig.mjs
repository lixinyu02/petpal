const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const smooth = (low, high, value) => { const t = clamp((value - low) / (high - low)); return t * t * (3 - 2 * t); };
const zero = () => ({ leftX: 0, leftY: 0, rightX: 0, rightY: 0 });

/** Weights for the existing Akari portrait; x/y are image coordinates, origin top left. */
export function sampleAnimeHairWeights(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return { left: 0, right: 0 };
  // The crown/ribbon and the shoulders stay attached. Fade before the cardigan,
  // since the flattened source has no clean clothing plate behind the hair.
  const tips = smooth(.195, .285, y) * (1 - smooth(.390, .445, y));
  const outside = (cx, cy, rx, ry) => smooth(1, 1.14, Math.hypot((x - cx) / rx, (y - cy) / ry));
  const protectedAreas = outside(.497, .273, .178, .117) * outside(.515, .398, .112, .083);
  const down = smooth(.245, .410, y);
  const strand = (center, radius) => 1 - smooth(.48, 1, Math.abs(x - center) / radius);
  const left = strand(.275 + down * .057, .080 - down * .010);
  const right = strand(.738 - down * .061, .082 - down * .010);
  return { left: left * tips * protectedAreas, right: right * tips * protectedAreas };
}

/** Continuous, bounded local offsets for a 2 by 3 portrait plane. */
export function createAnimeHairMotion() {
  const maxX = .022, maxY = .0045, tau = Math.PI * 2;
  const axes = Array.from({ length: 4 }, () => ({ position: 0, velocity: 0 }));
  let phase = 0, secondary = 0, drift = 0, gain = 0, gaze = 0, tilt = 0;
  const clearOffsets = () => { gain = 0; for (const axis of axes) axis.position = axis.velocity = 0; };
  const snapshot = () => ({ leftX: axes[0].position, leftY: axes[1].position, rightX: axes[2].position, rightY: axes[3].position });
  // Exact critically damped spring for each short interval. This stays stable
  // after long frames and lets hair lag behind a glance rather than snap to it.
  const spring = (axis, target, dt, limit) => {
    const frequency = 7, offset = axis.position - target;
    const momentum = axis.velocity + frequency * offset, decay = Math.exp(-frequency * dt);
    const position = target + (offset + momentum * dt) * decay;
    axis.velocity = (axis.velocity - frequency * momentum * dt) * decay;
    axis.position = clamp(position, -limit, limit);
    if (position !== axis.position) axis.velocity = 0;
  };
  function step(deltaSeconds, options = {}) {
    const input = options && typeof options === 'object' ? options : {};
    const resting = input.resting === true ? 1 : clamp(finite(input.resting));
    if (input.reducedMotion || resting >= 1) { clearOffsets(); gaze = tilt = 0; return zero(); }
    const dt = clamp(finite(deltaSeconds), 0, .1);
    if (!dt) return snapshot();
    const targetGaze = clamp(finite(input.gazeX), -1, 1), targetTilt = clamp(finite(input.headTilt), -1, 1);
    const targetGain = 1 - smooth(0, 1, resting);
    const steps = Math.ceil(dt * 120), interval = dt / steps;
    for (let index = 0; index < steps; index++) {
      phase = (phase + interval * .92) % tau;
      secondary = (secondary + interval * 1.61) % tau;
      drift = (drift + interval * .23) % tau;
      gain += (targetGain - gain) * (1 - Math.exp(-interval * 4));
      gaze += (targetGaze - gaze) * (1 - Math.exp(-interval * 6));
      tilt += (targetTilt - tilt) * (1 - Math.exp(-interval * 5));
      const inertia = -(targetGaze - gaze) * .003 - (targetTilt - tilt) * .006;
      const breeze = .90 + Math.sin(drift) * .10;
      const targets = [
        (Math.sin(phase) * .0115 + Math.sin(secondary + .35) * .003) * breeze + inertia,
        Math.sin(phase + 1.1) * .0025 + Math.sin(secondary) * .0007,
        (Math.sin(phase + .72) * .011 + Math.sin(secondary + 1.3) * .003) * breeze + inertia * .84,
        Math.sin(phase + 1.85) * .0023 + Math.sin(secondary + .9) * .0007,
      ];
      for (let axis = 0; axis < axes.length; axis++) {
        const limit = axis % 2 ? maxY : maxX;
        spring(axes[axis], clamp(targets[axis], -limit, limit) * gain, interval, limit);
      }
    }
    return snapshot();
  }
  function reset() { clearOffsets(); phase = secondary = drift = gaze = tilt = 0; }
  return { step, reset };
}
