import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnimeHairMotion, sampleAnimeHairWeights } from '../src/avatar/anime-rig.mjs';

const still = { leftX: 0, leftY: 0, rightX: 0, rightY: 0 };
const advance = (motion, seconds, options, hz = 60) => {
  let pose = motion.step(0);
  for (let frame = 0; frame < Math.round(seconds * hz); frame++) pose = motion.step(1 / hz, options);
  return pose;
};
const bounded = pose => {
  for (const [name, value] of Object.entries(pose)) {
    assert.ok(Number.isFinite(value), name);
    assert.ok(Math.abs(value) <= (name.endsWith('X') ? .022 : .0045), `${name}: ${value}`);
  }
};

test('hair weights protect the crown, facial features, neck and entire chest', () => {
  for (let column = 0; column <= 100; column++) {
    const x = column / 100;
    for (const y of [0, .05, .10, .195, .445, .46, .6, .9, 1]) assert.deepEqual(sampleAnimeHairWeights(x, y), { left: 0, right: 0 });
  }
  for (const [cx, cy, rx, ry] of [[.497, .273, .178, .117], [.515, .398, .112, .083]]) {
    for (let angle = 0; angle < Math.PI * 2; angle += .1) {
      for (const radius of [0, .4, .8, .999]) assert.deepEqual(sampleAnimeHairWeights(cx + Math.cos(angle) * rx * radius, cy + Math.sin(angle) * ry * radius), { left: 0, right: 0 });
    }
  }
});

test('only the two side locks receive smooth bounded weights', () => {
  const left = sampleAnimeHairWeights(.28, .33), right = sampleAnimeHairWeights(.72, .33);
  assert.ok(left.left > .5); assert.equal(left.right, 0);
  assert.ok(right.right > .5); assert.equal(right.left, 0);
  for (let row = 0; row <= 200; row++) for (let column = 0; column <= 200; column++) {
    const x = column / 200, y = row / 200, weights = sampleAnimeHairWeights(x, y);
    for (const value of Object.values(weights)) assert.ok(Number.isFinite(value) && value >= 0 && value <= 1);
    assert.ok(weights.left * weights.right === 0, 'side channels must not move the same part of the portrait');
    for (const next of [sampleAnimeHairWeights(x + .0001, y), sampleAnimeHairWeights(x, y + .0001)]) {
      assert.ok(Math.abs(next.left - weights.left) < .02 && Math.abs(next.right - weights.right) < .02, 'mask edges must fade rather than tear');
    }
  }
});

test('invalid coordinates never deform the portrait', () => {
  for (const invalid of [NaN, Infinity, -Infinity, undefined, null, '0.3', -.01, 1.01]) {
    assert.deepEqual(sampleAnimeHairWeights(invalid, .3), { left: 0, right: 0 });
    assert.deepEqual(sampleAnimeHairWeights(.3, invalid), { left: 0, right: 0 });
  }
});

test('hair drifts continuously with distinct side phases and bounded motion', () => {
  const motion = createAnimeHairMotion(); let previous = motion.step(0), distinct = 0, moved = 0;
  assert.deepEqual(previous, still);
  for (let frame = 0; frame < 60 * 180; frame++) {
    const pose = motion.step(1 / 60, { gazeX: Math.sin(frame / 63), headTilt: Math.sin(frame / 117) });
    bounded(pose);
    if (Math.abs(pose.leftX - pose.rightX) > .001) distinct++;
    if (Math.abs(pose.leftX) > .003) moved++;
    for (const key of Object.keys(pose)) assert.ok(Math.abs(pose[key] - previous[key]) < .001, 'a frame must not visibly snap');
    previous = pose;
  }
  assert.ok(distinct > 1000 && moved > 1000);
});

test('input reversals are damped and settle after the head stops', () => {
  const moved = createAnimeHairMotion(), stationary = createAnimeHairMotion();
  advance(moved, 2); advance(stationary, 2);
  const before = moved.step(0), first = moved.step(1 / 60, { gazeX: 1, headTilt: 1 });
  stationary.step(1 / 60);
  assert.ok(Math.abs(first.leftX - before.leftX) < .001);
  const transient = advance(moved, .25, { gazeX: 1, headTilt: 1 });
  const steady = advance(stationary, .25);
  assert.ok(Math.abs(transient.leftX - steady.leftX) > .0003, 'hair should briefly trail the head');
  const settled = advance(moved, 4, { gazeX: 1, headTilt: 1 });
  const baseline = advance(stationary, 4);
  assert.ok(Math.abs(settled.leftX - baseline.leftX) < .00001, 'holding a gaze must not leave a permanent sideways hair offset');
});

test('reduced motion and sleep stop immediately, then restore with a gentle entrance', () => {
  for (const stop of [{ reducedMotion: true }, { resting: true }, { resting: 1 }]) {
    const motion = createAnimeHairMotion(); advance(motion, 2);
    assert.deepEqual(motion.step(0, stop), still);
    assert.deepEqual(motion.step(10, stop), still);
    const resumed = motion.step(1 / 60);
    for (const value of Object.values(resumed)) assert.ok(Math.abs(value) < .0001);
    assert.notDeepEqual(advance(motion, 2), still);
  }
  const awake = createAnimeHairMotion(), resting = createAnimeHairMotion();
  const awakePose = advance(awake, 5), quietPose = advance(resting, 5, { resting: .9 });
  assert.ok(Math.abs(quietPose.leftX) < Math.abs(awakePose.leftX) * .04);
});

test('invalid steps hold state and large steps cannot fast-forward or poison the spring', () => {
  const motion = createAnimeHairMotion(); const prior = advance(motion, 1);
  for (const dt of [NaN, Infinity, -Infinity, undefined, null, '0.1', -1, 0]) assert.deepEqual(motion.step(dt), prior);
  const regular = createAnimeHairMotion(), stalled = createAnimeHairMotion();
  advance(regular, 1); advance(stalled, 1);
  assert.deepEqual(stalled.step(1e10), regular.step(.1));
  for (const options of [undefined, null, false, 4, { gazeX: NaN, headTilt: Infinity, resting: '1' }, { gazeX: -1e30, headTilt: 1e30, resting: -3 }]) bounded(motion.step(.03, options));
});

test('frame rate changes preserve the same gentle trajectory', () => {
  const poses = [30, 60, 120].map(hz => advance(createAnimeHairMotion(), 8, { gazeX: .4, headTilt: -.2 }, hz));
  for (const pose of poses) for (const key of Object.keys(pose)) assert.ok(Math.abs(pose[key] - poses[0][key]) < .000001);
});

test('reset is deterministic and returned poses cannot mutate internal state', () => {
  const motion = createAnimeHairMotion(), fresh = createAnimeHairMotion();
  const value = advance(motion, 2); value.leftX = 200;
  bounded(motion.step(0)); motion.reset();
  assert.deepEqual(motion.step(0), still);
  assert.deepEqual(advance(motion, 3, { gazeX: -.5 }), advance(fresh, 3, { gazeX: -.5 }));
});
