import test from 'node:test';
import assert from 'node:assert/strict';
import { createAvatarPresence } from '../src/avatar/presence.mjs';

const neutral = {
  gazeX: 0, gazeY: 0, headX: 0, headY: 0, headTilt: 0,
  bodyXPercent: 0, bodyYPercent: 0, bodyRotationDegrees: 0,
  breath: 0, breathScale: 1,
};
const limits = {
  gazeX: 1, gazeY: 1, headX: 1, headY: 1, headTilt: 1,
  bodyXPercent: .65, bodyYPercent: .4, bodyRotationDegrees: .5, breath: 1,
};
const advance = (controller, seconds, options, fps = 60) => {
  let pose = controller.step(0, options);
  const frames = Math.round(seconds * fps);
  for (let frame = 0; frame < frames; frame++) pose = controller.step(seconds / frames, options);
  return pose;
};
const near = (actual, expected, tolerance = 1e-10) => assert.ok(
  Math.abs(actual - expected) <= tolerance,
  `${actual} differs from ${expected} by more than ${tolerance}`,
);
function assertBounded(pose) {
  for (const [key, limit] of Object.entries(limits)) {
    assert.ok(Number.isFinite(pose[key]) && Math.abs(pose[key]) <= limit, key);
  }
  assert.ok(Number.isFinite(pose.breathScale) && pose.breathScale >= 1 && pose.breathScale <= 1.12);
}

test('a glance leads the head and the chest follows slowly without inventing gestures', () => {
  const controller = createAvatarPresence();
  const pose = controller.step(.1, { gazeX: 1, gazeY: -.8, headTilt: .6, headNod: 1 });
  assert.ok(pose.gazeX > pose.headX * 3);
  assert.ok(pose.headX > pose.bodyXPercent / .65 * 3);
  assert.ok(pose.gazeY < pose.headY && pose.headY < 0);
  assert.ok(pose.headTilt > 0);
  const settled = advance(controller, 6, { gazeX: 1, gazeY: -.8, headTilt: .6, headNod: 1 });
  near(settled.headY, -.8, 1e-8);
  near(settled.bodyYPercent, .33, 1e-6);
  assert.ok(pose.bodyYPercent>0 && pose.bodyRotationDegrees<0, 'CSS follow direction agrees with the head world axes');
  assert.equal('mouthOpen' in pose, false);
  assert.equal('gesture' in pose, false);
  assertBounded(settled);
});

test('reversing a pointer or tilt retains continuity and settles inside anatomical bounds', () => {
  const controller = createAvatarPresence();
  const positive = advance(controller, 2, { gazeX: 1, gazeY: 1, headTilt: 1, headNod: 1 });
  const negative = { gazeX: -1, gazeY: -1, headTilt: -1, headNod: -1 };
  assert.deepEqual(controller.step(0, negative), positive);
  const first = controller.step(1 / 120, negative);
  assert.ok(first.gazeX > .97 && first.headX > .98);
  assert.ok(Math.abs(first.bodyXPercent - positive.bodyXPercent) < .001);
  for (let frame = 0; frame < 720; frame++) assertBounded(controller.step(1 / 120, negative));
  const settled = controller.step(0);
  near(settled.gazeX, -1, 1e-8);
  near(settled.headTilt, -1, 1e-8);
  near(settled.bodyRotationDegrees, .5, 1e-6);
});

test('30, 60 and 120 Hz yield the same layered motion and breathing for matching input timings', () => {
  const sequence = [
    [.4, { gazeX: .9, gazeY: -.5, headTilt: .3, phase: 'listening' }],
    [.6, { gazeX: -.7, gazeY: .2, headTilt: -.6, phase: 'speaking', voiceEnergy: .8 }],
    [.8, { gazeX: .1, gazeY: -.2, headNod: .4, phase: 'speaking', voiceEnergy: .2 }],
    [.2, { phase: 'thinking' }],
    [1, { phase: 'idle' }],
  ];
  const frames = [30, 60, 120].map(fps => {
    const controller = createAvatarPresence();
    return sequence.map(([seconds, options]) => advance(controller, seconds, options, fps));
  });
  for (let index = 0; index < sequence.length; index++) {
    for (const key of Object.keys(neutral)) {
      near(frames[0][index][key], frames[1][index][key]);
      near(frames[1][index][key], frames[2][index][key]);
    }
  }
});

test('speech energy changes breathing amplitude smoothly without resetting its phase', () => {
  const controller = createAvatarPresence();
  const idle = advance(controller, 1.3, { phase: 'idle' });
  near(idle.breath, 1);
  assert.equal(idle.breathScale, 1);
  assert.deepEqual(controller.step(0, { phase: 'speaking', voiceEnergy: 1 }), idle);
  const began = controller.step(1 / 120, { phase: 'speaking', voiceEnergy: 1 });
  assert.ok(began.breath > .999, 'energy change cannot move a breath peak to an unrelated phase');
  assert.ok(began.breathScale > 1 && began.breathScale < 1.01);
  const voiced = advance(controller, 1, { phase: 'speaking', voiceEnergy: 1 });
  assert.ok(voiced.breathScale > 1.11 && voiced.breathScale <= 1.12);
  const stopped = controller.step(1 / 120, { phase: 'idle', voiceEnergy: 1 });
  assert.ok(Math.abs(stopped.breath - voiced.breath) < .02);
  assert.ok(stopped.breathScale < voiced.breathScale && stopped.breathScale > 1.1);
  near(advance(controller, 6, { phase: 'idle', voiceEnergy: 1 }).breathScale, 1, 1e-10);
});

test('reduced motion, sleep and hidden pages immediately reset and resume gently from neutral', () => {
  for (const flag of ['reducedMotion', 'sleeping', 'hidden']) {
    const controller = createAvatarPresence();
    const options = { gazeX: 1, gazeY: -.8, headTilt: .7, phase: 'speaking', voiceEnergy: 1 };
    advance(controller, 2, options);
    assert.deepEqual(controller.step(0, { ...options, [flag]: true }), neutral);
    assert.deepEqual(controller.step(100000, { ...options, [flag]: true }), neutral);
    assert.deepEqual(controller.step(0, options), neutral);
    const resumed = controller.step(1 / 60, options);
    const fresh = createAvatarPresence().step(1 / 60, options);
    assert.deepEqual(resumed, fresh);
    assert.ok(resumed.gazeX < .04 && resumed.headX < .005);
    assert.ok(resumed.breath > 0 && resumed.breath < .03);
    controller.reset();
    assert.deepEqual(controller.step(0), neutral);
  }
});

test('invalid and long deltas cannot catch up a suspended scene or corrupt snapshots', () => {
  const options = { gazeX: 1, gazeY: -1, headTilt: .5, phase: 'speaking', voiceEnergy: .8 };
  const controller = createAvatarPresence();
  for (const dt of [NaN, Infinity, -1, '1', undefined]) assert.deepEqual(controller.step(dt, options), neutral);
  assert.deepEqual(controller.step(10000, options), createAvatarPresence().step(.1, options));
  const before = controller.step(0);
  before.gazeX = Infinity;
  before.breathScale = -100;
  assertBounded(controller.step(0));
  const invalid = { gazeX: NaN, gazeY: Infinity, headTilt: '1', headNod: -Infinity, voiceEnergy: NaN, phase: 'unknown' };
  assertBounded(controller.step(.1, invalid));
  assertBounded(controller.step(.1, null));
  assertBounded(controller.step(.1, 'invalid'));
  const extreme = { gazeX: 1e20, gazeY: -1e20, headTilt: 1e20, headNod: -1e20, voiceEnergy: 1e20, phase: 'speaking' };
  const clamped = { gazeX: 1, gazeY: -1, headTilt: 1, headNod: -1, voiceEnergy: 1, phase: 'speaking' };
  assert.deepEqual(createAvatarPresence().step(.1, extreme), createAvatarPresence().step(.1, clamped));
});

test('an hour of idle breathing remains finite, periodic, and deterministic', () => {
  const controller = createAvatarPresence();
  let pose;
  for (let frame = 0; frame < 36000; frame++) {
    pose = controller.step(.1, { phase: 'idle' });
    assertBounded(pose);
  }
  near(pose.breath, Math.sin((3600 % 5.2) / 5.2 * Math.PI * 2), 1e-8);
  assert.equal(pose.breathScale, 1);
  for (const key of ['gazeX', 'gazeY', 'headX', 'headY', 'headTilt', 'bodyXPercent', 'bodyYPercent', 'bodyRotationDegrees']) {
    assert.equal(pose[key], 0, key);
  }
});
