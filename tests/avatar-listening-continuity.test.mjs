import test from 'node:test';
import assert from 'node:assert/strict';
import { createAvatarPerformance } from '../src/avatar/performance.mjs';

const input = (phase, id = phase, text = '') => ({ utteranceId: id, text, phase });
const bodies = ['bodyLean', 'bodyLift', 'bodyTurn', 'headShake', 'shoulderLift'];
const advance = (controller, seconds, options) => Array.from({ length: Math.ceil(seconds * 60) }, () => controller.step(1 / 60, options));

test('changing ASR drafts retain one entry cue and a sustained quiet listening pose after its motion ends', () => {
  const controller = createAvatarPerformance(), poses = [];
  for (let frame = 0; frame < 600; frame++) {
    controller.setInput(input('listening', `asr-${frame}`, `正在识别${frame}`));
    poses.push(controller.step(1 / 60));
  }
  const entry = poses.filter(pose => pose.gesture !== 'none'), held = poses.slice(-180);
  assert.ok(entry.length > 60); assert.equal(new Set(entry.map(pose => pose.gestureCueId)).size, 1);
  assert.ok(entry.every(pose => pose.gesture === 'leanIn'));
  assert.ok(held.every(pose => pose.gesture === 'none' && pose.gestureCueId === '' && pose.bodyLean > .23 && pose.bodyLean < .25));
  assert.ok(held.every(pose => pose.browRaise > .16 && pose.eyeSmile > .07));
  assert.ok(held.every(pose => pose.mouthOpen === 0 && !pose.speaking));
  const nods = held.map(pose => pose.headNod);
  assert.ok(Math.max(...nods) - Math.min(...nods) > .025); assert.ok(nods.every(value => Math.abs(value) < .08));
});

test('listening exits preserve the zero-time rendered pose and return smoothly without delaying TTS articulation', () => {
  const controller = createAvatarPerformance(); controller.setInput(input('listening'));
  const before = advance(controller, .8).at(-1);
  controller.setInput(input('thinking'));
  const exit = controller.step(0);
  assert.equal(exit.gesture, 'none'); assert.equal(exit.headTilt, before.headTilt); assert.equal(exit.headNod, before.headNod);
  for (const key of bodies) assert.equal(exit[key], before[key], key);
  const retreat = advance(controller, 3);
  for (let i = 1; i < retreat.length; i++) {
    assert.ok(Math.abs(retreat[i].bodyLean - retreat[i - 1].bodyLean) < .075);
    assert.ok(Math.abs(retreat[i].headNod - retreat[i - 1].headNod) < .04);
  }
  assert.ok(Math.abs(retreat.at(-1).bodyLean) < .0001);
  controller.setInput({ ...input('speaking', 'reply', '你好'), speech: { active: true, charIndex: 0, audioLevel: .6 } });
  assert.ok(controller.step(1 / 60).mouthOpen > .1, 'geometry easing must not delay audible speech');
  controller.setInput({ ...input('speaking', 'reply', '你好'), speech: { active: false, charIndex: 0, audioLevel: .6 } });
  assert.equal(controller.step(0).mouthOpen, 0);
});

test('cancelled visible poses have one bounded return, repeated zero-time frames cannot accumulate it, and hard stops clear it', () => {
  for (const state of ['hidden', 'sleeping', 'reducedMotion']) {
    const controller = createAvatarPerformance(); controller.setInput(input('listening'));
    advance(controller, .6); controller.setInput(input('idle'));
    const pose = controller.step(0);
    assert.ok(pose.bodyLean > .2);
    for (let count = 0; count < 10; count++) for (const key of bodies) assert.equal(controller.step(0)[key], pose[key]);
    const quiet = controller.step(0, { [state]: true });
    for (const key of bodies) assert.equal(quiet[key], 0);
    assert.equal(quiet.headNod, 0); assert.equal(quiet.mouthOpen, 0);
    controller.step(0); controller.setInput(input('idle'));
    assert.ok(advance(controller, .6).every(value => value.gesture === 'none' && value.bodyLean === 0));
  }
});

test('hand interaction is a gentle distinct response and has no authority over active speech', () => {
  const controller = createAvatarPerformance(); controller.setInput(input('listening'));
  advance(controller, .5);
  assert.equal(controller.react({ id: 'hand-1', kind: 'hand' }), true);
  assert.equal(controller.react({ id: 'hand-1', kind: 'hand' }), false);
  const hand = advance(controller, .35).at(-1);
  assert.equal(hand.gesture, 'sway'); assert.ok(hand.tenderAmount > .2); assert.equal(hand.mouthOpen, 0);
  const spoken = { ...input('speaking', 'speech', '我很难过'), speech: { active: true, charIndex: 0, audioLevel: .5, emotion: { emotion: 'sad', intensity: 'natural', source: 'manual' } } };
  const touched = createAvatarPerformance(), control = createAvatarPerformance();
  touched.setInput(spoken); control.setInput(spoken);
  touched.react({ id: 'sad-hand', kind: 'hand' });
  for (let frame = 0; frame < 40; frame++) {
    const a = touched.step(.025), b = control.step(.025);
    assert.equal(a.mouthOpen, b.mouthOpen); assert.equal(a.mouthShape, b.mouthShape); assert.equal(a.smileAmount, b.smileAmount);
    assert.ok(a.gesture === 'settle' || a.gesture === 'none');
  }
});
