import test from 'node:test';
import assert from 'node:assert/strict';
import { createAvatarPerformance } from '../src/avatar/performance.mjs';

const text = 'aeobmp，。普通的话';
const input = (overrides = {}, speech = {}) => ({
  utteranceId: 'voice', text, phase: 'speaking', ...overrides,
  speech: { active: true, charIndex: 0, audioLevel: .5, emotion: { emotion: 'neutral', intensity: 'natural', source: 'manual' }, ...speech },
});
const advance = (controller, seconds, options, hz = 30) => {
  let pose = controller.step(0, options);
  for (let frame = 0; frame < Math.round(seconds * hz); frame++) pose = controller.step(1 / hz, options);
  return pose;
};
const audible = () => {
  const controller = createAvatarPerformance();
  controller.setInput(input()); advance(controller, 1);
  return controller;
};
const closed = pose => {
  assert.equal(pose.mouthOpen, 0);
  assert.equal(pose.mouthShape, 'rest');
  assert.equal(pose.speaking, false);
};

test('advancing estimated shapes never invents silence over continuously audible PCM', () => {
  for (const hz of [30, 60, 120]) {
    const controller = audible(), reference = audible();
    for (let charIndex = 1; charIndex < text.length; charIndex++) {
      const before = controller.step(0).mouthOpen;
      controller.setInput(input({}, { charIndex }));
      assert.equal(controller.step(0).mouthOpen, before, `boundary ${charIndex} at ${hz} Hz`);
      const actual = controller.step(1 / hz), expected = reference.step(1 / hz);
      assert.equal(actual.mouthOpen, expected.mouthOpen);
      assert.equal(actual.speaking, true);
      assert.ok(actual.mouthOpen > .4, 'punctuation and closed text shapes cannot close actually audible PCM');
    }
  }
  const controller = audible();
  controller.setInput(input({}, { charIndex: 1 })); assert.equal(controller.step(1 / 120).mouthShape, 'E');
  controller.setInput(input({}, { charIndex: 2 })); assert.equal(controller.step(1 / 120).mouthShape, 'O');
});

test('PCM continuity never carries an old open mouth through stop, silence, rewind, rewrite or a different utterance', () => {
  const cases = [
    ['buffering', input({}, { active: false })],
    ['ended', input({}, { ended: true })],
    ['silent', input({}, { audioLevel: 0 })],
    ['below energy threshold', input({}, { charIndex: 2, audioLevel: .025 })],
    ['phase ended', input({ phase: 'idle' })],
    ['text ended', input({}, { charIndex: text.length })],
    ['rewound', input({}, { charIndex: 0 })],
    ['rewritten', input({ text: '另一段文字' }, { charIndex: 2 })],
    ['different utterance', input({ utteranceId: 'another' }, { charIndex: 2 })],
  ];
  for (const [name, next] of cases) {
    const controller = audible();
    controller.setInput(input({}, { charIndex: 1 })); advance(controller, .1);
    assert.ok(controller.step(0).mouthOpen > .4, name);
    controller.setInput(next); closed(controller.step(0));
  }
  for (const option of ['hidden', 'sleeping']) closed(audible().step(0, { [option]: true }));
});

test('text-only playback boundaries retain their bounded articulation timing', () => {
  const controller = createAvatarPerformance();
  const first = input({}, { audioLevel: undefined });
  controller.setInput(first); assert.ok(advance(controller, .1).mouthOpen > .1);
  controller.setInput(input({}, { charIndex: 1, audioLevel: undefined })); closed(controller.step(0));
  assert.equal(controller.step(1 / 30).mouthShape, 'E');
  closed(advance(controller, .4));
});

test('small voice energy changes cannot rephase a long-running nod', () => {
  for (const seconds of [30, 120, 180]) {
    const stable = createAvatarPerformance(), changed = createAvatarPerformance();
    stable.setInput(input()); changed.setInput(input());
    advance(stable, seconds); advance(changed, seconds);
    changed.setInput(input({}, { audioLevel: .51 }));
    const actual = changed.step(1 / 30), reference = stable.step(1 / 30);
    assert.ok(Math.abs(actual.headNod - reference.headNod) < .0005, `energy transition after ${seconds} seconds`);
  }
});

test('nod phase restarts after lifecycle cancellation without replaying time spent inactive', () => {
  for (const interruption of ['hidden', 'sleeping', 'reducedMotion', 'buffering', 'stop', 'reset']) {
    const controller = audible(); advance(controller, 120);
    if (interruption === 'reset') controller.reset();
    else if (interruption === 'buffering') controller.setInput(input({}, { active: false }));
    else if (interruption === 'stop') controller.setInput(input({ phase: 'idle' }));
    else controller.step(0, { [interruption]: true });
    assert.equal(controller.step(0, { [interruption]: ['hidden', 'sleeping', 'reducedMotion'].includes(interruption) }).headNod, 0, interruption);
    controller.step(0); controller.setInput(input());
    const fresh = createAvatarPerformance(); fresh.setInput(input());
    for (let frame = 0; frame < 30; frame++) {
      const resumed = controller.step(1 / 30), expected = fresh.step(1 / 30);
      assert.ok(Math.abs(resumed.headNod - expected.headNod) < 1e-12, `${interruption} frame ${frame}`);
    }
  }
});
