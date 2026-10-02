import test from 'node:test';
import assert from 'node:assert/strict';
import { createAvatarPerformance } from '../src/avatar/performance.mjs';

const text = '今天有一件事情想告诉你。接下来我们可以慢慢聊。最后再说一件事。';
const speech = (emotion = 'happy', extra = {}) => ({ active: true, charIndex: 0, audioLevel: .5, emotion: { emotion, intensity: 'natural', source: 'manual' }, ...extra });
const input = (value = speech(), extra = {}) => ({ utteranceId: 'spoken-reply', text, phase: 'speaking', speech: value, ...extra });
const run = (controller, seconds, options) => Array.from({ length: Math.ceil(seconds / .025) }, () => controller.step(.025, options));
const quiet = frames => frames.every(frame => frame.gesture === 'none');
const nextSentence = text.indexOf('接下来');
const lastSentence = text.indexOf('最后');

test('authenticated happy and gentle speech keep one natural gesture across per-frame PCM updates', () => {
  for (const emotion of ['happy', 'gentle']) {
    const controller = createAvatarPerformance(), frames = [];
    for (let frame = 0; frame < 150; frame++) {
      controller.setInput(input(speech(emotion, { charIndex: Math.min(10, Math.floor(frame / 5)), audioLevel: frame % 2 ? .2 : .8 })));
      frames.push(controller.step(.025));
    }
    const active = frames.filter(frame => frame.gesture !== 'none');
    assert.ok(active.length > 70, 'the same metadata must not cancel movement on the next animation frame');
    assert.ok(active.every(frame => frame.gesture === 'sway'));
    assert.ok(active.every((frame, index) => index === 0 || frame.gestureProgress > active[index - 1].gestureProgress));
    assert.ok(quiet(frames.slice(-20)), 'the cue is not looped at stationary or advancing boundaries');
    controller.setInput(input(speech(emotion, { charIndex: nextSentence })));
    assert.equal(controller.step(.1).gesture, 'sway', 'a new sentence can perform after the cooldown');
  }
});

test('energy cannot choose a happy gesture for neutral, sad or angry speech or override authenticated text meaning', () => {
  for (const emotion of ['neutral', 'sad', 'angry']) {
    const controller = createAvatarPerformance();
    for (const audioLevel of [.1, .95, 0, .7]) {
      controller.setInput(input(speech(emotion, { audioLevel }), { text: '太好了，我特别开心！' }));
      assert.ok(quiet(run(controller, .5)), emotion);
    }
  }
  const controller = createAvatarPerformance();
  controller.setInput(input(speech('gentle'), { text: '不行，不能这样做。' }));
  assert.equal(controller.step(.1).gesture, 'sway', 'the voice mood wins over the contrary text-only shake');
});

test('changed upstream authority cancels a contrary speech pose once and cannot restart the visited sentence', () => {
  const controller = createAvatarPerformance();
  controller.setInput(input(speech()));
  assert.equal(controller.step(.3).gesture, 'sway');
  controller.setInput(input(speech('sad', { charIndex: 1 })));
  assert.equal(controller.step(0).gesture, 'none');
  run(controller, 3);
  controller.setInput(input(speech('happy', { charIndex: 2 })));
  assert.ok(quiet(run(controller, 3)), 'a metadata change cannot replay an already consumed sentence');
  controller.setInput(input(speech('gentle', { charIndex: nextSentence })));
  assert.equal(controller.step(.1).gesture, 'sway');
});

test('hidden, sleep, reduced motion, buffering and stop consume crossed boundaries without a catch-up gesture', () => {
  for (const interruption of ['hidden', 'sleeping', 'reducedMotion', 'buffering', 'stop']) {
    const controller = createAvatarPerformance();
    controller.setInput(input(speech()));
    assert.equal(controller.step(.3).gesture, 'sway');
    const options = ['hidden', 'sleeping', 'reducedMotion'].includes(interruption) ? { [interruption]: true } : {};
    controller.step(0, options);
    controller.setInput(input(speech('happy', { charIndex: nextSentence, ...(['buffering', 'stop'].includes(interruption) ? { active: false, emotion: null } : {}) }), interruption === 'stop' ? { phase: 'idle' } : {}));
    assert.equal(controller.step(0, options).gesture, 'none', interruption);
    run(controller, 3, options);
    controller.step(0);
    controller.setInput(input(speech('happy', { charIndex: nextSentence + 1 })));
    assert.ok(quiet(run(controller, 3)), `${interruption} cannot defer the skipped sentence`);
    controller.setInput(input(speech('gentle', { charIndex: lastSentence })));
    assert.equal(controller.step(.1).gesture, 'sway', `${interruption} permits a later fresh sentence`);
  }
});

test('first playback waiting does not consume a cue, but a boundary crossed later in buffering does', () => {
  const controller = createAvatarPerformance();
  controller.setInput(input(speech('happy', { active: false, emotion: null }), { phase: 'idle' }));
  assert.ok(quiet(run(controller, 1)));
  controller.setInput(input(speech()));
  assert.equal(controller.step(.1).gesture, 'sway');
  controller.setInput(input(speech('happy', { active: false, emotion: null, charIndex: 2 })));
  controller.step(.1);
  controller.setInput(input(speech('happy', { active: false, emotion: null, charIndex: nextSentence })));
  run(controller, 3);
  controller.setInput(input(speech('happy', { charIndex: nextSentence + 1 })));
  assert.ok(quiet(run(controller, 1)), 'the buffered cue is consumed even after active became false');
});

test('cues first received while hidden, asleep or reduced are consumed, and ended playback never leaves a live motion', () => {
  for (const option of ['hidden', 'sleeping', 'reducedMotion']) {
    const controller = createAvatarPerformance();
    controller.step(0, { [option]: true });
    controller.setInput(input(speech()));
    assert.ok(quiet(run(controller, 3, { [option]: true })), option);
    controller.step(0);
    controller.setInput(input(speech('happy', { charIndex: 1 })));
    assert.ok(quiet(run(controller, 1)), `${option} cannot replay on return`);
    controller.setInput(input(speech('gentle', { charIndex: nextSentence })));
    assert.equal(controller.step(.1).gesture, 'sway');
    controller.setInput(input(speech('gentle', { ended: true, charIndex: text.length })));
    assert.equal(controller.step(0).gesture, 'none');
    assert.equal(controller.step(0).mouthOpen, 0);
  }
});

test('rapid new sentences during an active motion or cooldown are consumed instead of queued', () => {
  const controller = createAvatarPerformance();
  controller.setInput(input(speech()));
  assert.equal(controller.step(.1).gesture, 'sway');
  controller.setInput(input(speech('gentle', { charIndex: nextSentence })));
  run(controller, 2.15);
  assert.equal(controller.step(0).gesture, 'none');
  controller.setInput(input(speech('gentle', { charIndex: lastSentence })));
  assert.ok(quiet(run(controller, 3)), 'the cooldown consumes its new sentence without deferral');
  for (const charIndex of [nextSentence + 1, lastSentence + 1]) {
    controller.setInput(input(speech('happy', { charIndex })));
    assert.ok(quiet(run(controller, 1)), 'active/cooldown suppression is permanent for that sentence');
  }
});

test('manual touch interrupts speech movement, remains stable under PCM updates and consumes blocked speech cues', () => {
  const controller = createAvatarPerformance();
  controller.setInput(input(speech()));
  assert.equal(controller.step(.3).gesture, 'sway');
  controller.react({ id: 'head-pet', kind: 'pet' });
  assert.equal(controller.step(.1).gesture, 'tilt', 'manual interaction replaces the automatic gesture immediately');
  for (let frame = 0; frame < 20; frame++) {
    controller.setInput(input(speech('happy', { charIndex: nextSentence })));
    assert.equal(controller.step(.025).gesture, 'tilt', 'PCM updates must not cancel the touch response');
  }
  run(controller, 3);
  controller.setInput(input(speech('happy', { charIndex: nextSentence + 1 })));
  assert.ok(quiet(run(controller, 1)), 'the sentence skipped during interaction cannot play afterwards');
  controller.setInput(input(speech('gentle', { charIndex: lastSentence })));
  assert.equal(controller.step(.1).gesture, 'sway');
});

test('utterance switch and reset cannot leak old gestures or replay visited speech while fresh sentences still work', () => {
  const controller = createAvatarPerformance();
  controller.setInput(input(speech()));
  assert.equal(controller.step(.3).gesture, 'sway');
  controller.setInput(input(speech('neutral'), { utteranceId: 'other-reply' }));
  assert.equal(controller.step(0).gesture, 'none');
  run(controller, 3);
  controller.setInput(input(speech()));
  assert.ok(quiet(run(controller, 1)), 'returning to an old utterance is not a new performance');
  controller.reset();
  controller.setInput(input(speech()));
  assert.ok(quiet(run(controller, 1)), 'reset retains replay protection');
  controller.setInput(input(speech('gentle'), { utteranceId: 'fresh-reply' }));
  assert.equal(controller.step(.1).gesture, 'sway');
});

test('authoritative neutral consumes a sentence even if happy metadata arrives later, without suppressing future text-only cues', () => {
  const controller = createAvatarPerformance();
  controller.setInput(input(speech('neutral')));
  run(controller, 3);
  controller.setInput(input(speech('happy', { charIndex: 2 })));
  assert.ok(quiet(run(controller, 1)));
  controller.setInput({ utteranceId: 'text-only', text: '我有点害羞。', phase: 'speaking' });
  assert.equal(controller.step(.1).gesture, 'shy');
});
