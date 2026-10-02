import test from 'node:test';
import assert from 'node:assert/strict';
import { createAvatarPerformance } from '../src/avatar/performance.mjs';
import { createAvatarGestures, gestureAtSpeechBoundary } from '../src/avatar/gestures.mjs';
import { createAvatarMicroacting } from '../src/avatar/microacting.mjs';

const frames = (controller, seconds, options) => Array.from({ length: Math.ceil(seconds / .025) }, () => controller.step(.025, options));
const phase = (value, extra = {}) => ({ utteranceId: 'presence', text: '', phase: value, ...extra });
const quiet = values => values.every(value => value.gesture === 'none' && value.gestureCueId === '');
const line = '开个玩笑，逗你一下。';

test('thinking and listening each start once on entry and retain one cue identity across input frames', () => {
  for (const [name, expected] of [['thinking', 'tilt'], ['listening', 'leanIn']]) {
    const controller = createAvatarPerformance(), poses = [];
    for (let index = 0; index < 160; index++) {
      controller.setInput(phase(name, { utteranceId: `chunk-${index}`, text: '.'.repeat(index) }));
      poses.push(controller.step(.025));
    }
    const active = poses.filter(pose => pose.gesture !== 'none');
    assert.ok(active.length > 40, name);
    assert.ok(active.every(pose => pose.gesture === expected));
    assert.equal(new Set(active.map(pose => pose.gestureCueId)).size, 1);
    assert.ok(active[0].gestureCueId);
    assert.ok(active.every((pose, index) => index === 0 || pose.gestureProgress > active[index - 1].gestureProgress));
    assert.ok(quiet(poses.slice(-20)), 'a waiting phase does not loop its entry cue');
    controller.setInput(phase('idle'));
    controller.setInput(phase(name));
    const second = controller.step(.025);
    assert.equal(second.gesture, expected);
    assert.notEqual(second.gestureCueId, active[0].gestureCueId, 'a genuinely new entry has a new cue');
  }
});

test('phase exits cancel immediately, phase changes can replace an unfinished automatic action, and neutral speech stays neutral', () => {
  const controller = createAvatarPerformance();
  controller.setInput(phase('thinking'));
  const thinking = controller.step(.2);
  assert.equal(thinking.expression, 'thoughtful');
  assert.equal(thinking.gesture, 'tilt');
  controller.setInput(phase('listening'));
  assert.equal(controller.step(0).gesture, 'none', 'outgoing automatic pose is removed at zero time');
  const listening = controller.step(.1);
  assert.equal(listening.expression, 'curious');
  assert.equal(listening.gesture, 'leanIn');
  assert.notEqual(listening.gestureCueId, thinking.gestureCueId);
  controller.setInput(phase('speaking', { text: line, speech: { active: true, charIndex: 0, audioLevel: .5, emotion: { emotion: 'neutral', intensity: 'natural', source: 'manual' } } }));
  assert.equal(controller.step(0).gesture, 'none');
  assert.ok(quiet(frames(controller, 2)), 'authoritative neutral cannot inherit thinking or trigger a playful line');
});

test('hidden, sleep and reduced motion consume phase entries without replaying them on return', () => {
  for (const option of ['hidden', 'sleeping', 'reducedMotion']) {
    const controller = createAvatarPerformance();
    controller.step(0, { [option]: true });
    controller.setInput(phase('thinking'));
    assert.ok(quiet(frames(controller, 3, { [option]: true })), option);
    controller.step(0);
    controller.setInput(phase('thinking', { utteranceId: 'later-chunk' }));
    assert.ok(quiet(frames(controller, 3)), `${option}: the same phase cannot replay`);
    controller.setInput(phase('idle'));
    controller.setInput(phase('listening'));
    assert.equal(controller.step(.1).gesture, 'leanIn', 'fresh entry is allowed');
    controller.step(0, { [option]: true });
    assert.equal(controller.step(0, { [option]: true }).gestureCueId, '');
  }
});

test('manual interaction replaces a phase action and a later phase cannot override or queue behind the touch', () => {
  const controller = createAvatarPerformance();
  controller.setInput(phase('listening'));
  const listening = controller.step(.2);
  controller.react({ id: 'touch-during-listen', kind: 'pet' });
  const touch = controller.step(.1);
  assert.equal(touch.gesture, 'tilt');
  assert.notEqual(touch.gestureCueId, listening.gestureCueId);
  controller.setInput(phase('thinking'));
  const held = controller.step(.1);
  assert.equal(held.gestureCueId, touch.gestureCueId);
  assert.ok(held.gestureProgress > touch.gestureProgress);
  frames(controller, 4);
  controller.setInput(phase('thinking', { text: 'still thinking' }));
  assert.ok(quiet(frames(controller, 3)), 'skipped thinking entry is not queued behind the touch');
});

test('native playful wink is one bounded gesture without a second performance right-eye wink', () => {
  assert.equal(gestureAtSpeechBoundary(line, 0)?.gesture, 'wink');
  const controller = createAvatarPerformance();
  controller.setInput(phase('speaking', { text: line }));
  const poses = frames(controller, 1.5);
  assert.ok(poses.some(pose => pose.gesture === 'wink' && pose.expression === 'playful'));
  assert.ok(poses.every(pose => pose.blinkRight === 0), 'native Wink owns closure; performance does not retrigger its greeting wink');
  assert.ok(quiet(poses.slice(-4)));
  const gestures = createAvatarGestures();
  assert.equal(gestures.trigger('wink', 'wink'), true);
  assert.equal(gestures.step(1.34).gesture, 'wink');
  assert.equal(gestures.step(.02).gesture, 'none');
  const greeting = createAvatarPerformance();
  greeting.react({ id: 'deliberate-greeting', kind: 'greet' });
  assert.ok(greeting.step(.2).blinkRight > .5, 'existing deliberate greeting remains expressive');
});

test('curiosity, surprise and reassurance have semantic gestures while negative and upstream authority suppress a playful wink', () => {
  for (const [text, expected] of [
    ['我有一点好奇呢。', 'tilt'],
    ['哇，居然是这样！', 'recoil'],
    ['没关系，辛苦了，我在这里陪着你。', 'settle'],
  ]) assert.equal(gestureAtSpeechBoundary(text, 0)?.gesture, expected, text);
  for (const text of ['我有点伤心，开个玩笑而已。', '不要调皮。', '列举调皮的动作和表情。']) {
    assert.notEqual(gestureAtSpeechBoundary(text, 0)?.gesture, 'wink', text);
  }
  for (const emotion of ['neutral', 'sad', 'angry']) {
    const controller = createAvatarPerformance();
    controller.setInput(phase('speaking', { text: line, speech: { active: true, charIndex: 0, audioLevel: .8, emotion: { emotion, intensity: 'natural', source: 'manual' } } }));
    assert.ok(quiet(frames(controller, 2)), emotion);
  }
});

test('negative text arriving during a playful streamed cue cancels the wink without replay and mixed sad text stays still', () => {
  const controller = createAvatarPerformance();
  controller.setInput(phase('speaking', { text: '开个玩笑' }));
  assert.equal(controller.step(.2).gesture, 'wink');
  controller.setInput(phase('speaking', { text: '开个玩笑，但其实我很伤心。' }));
  assert.equal(controller.step(0).gesture, 'none');
  assert.ok(quiet(frames(controller, 3)));
  controller.setInput(phase('speaking', { utteranceId: 'mixed-mood', text: '我很伤心，刚才只是开个玩笑。' }));
  assert.ok(quiet(frames(controller, 2)), 'negative sentence meaning cannot animate the joking subordinate clause');
});

test('expanded idle repertoire preserves the first three cues, quiet intervals and two separate blinks', () => {
  const controller = createAvatarMicroacting(), starts = [], ends = [], samples = [];
  let previous = 'none';
  for (let time = 0; time < 100; time += .025) {
    const pose = controller.step(.025);
    if (pose.microExpression !== 'none' && previous === 'none') starts.push({ time, kind: pose.microExpression });
    if (pose.microExpression === 'none' && previous !== 'none') ends.push(time);
    if (pose.microExpression === 'doubleBlink') samples.push(pose.blink);
    for (const [key, value] of Object.entries(pose)) if (key !== 'microExpression') assert.ok(Number.isFinite(value) && Math.abs(value) <= 1, key);
    previous = pose.microExpression;
  }
  assert.deepEqual(starts.slice(0, 6).map(value => value.kind), ['glance', 'softBlink', 'softSmile', 'doubleBlink', 'headTilt', 'breathPause']);
  for (let index = 1; index < starts.length; index++) assert.ok(starts[index].time - ends[index - 1] >= 10);
  const closures = samples.map(value => value > .8);
  assert.equal(closures.filter((closed, index) => closed && !closures[index - 1]).length, 2, 'two distinct closures with an open-eye gap');
});

test('head and body micro overlays never accumulate on zero-time frames and restore at end or interruption', () => {
  const controller = createAvatarPerformance();
  const seen = new Set();
  for (let time = 0; time < 100; time += .025) {
    const pose = controller.step(.025);
    if (!['headTilt', 'breathPause'].includes(pose.microExpression)) continue;
    seen.add(pose.microExpression);
    const repeated = controller.step(0);
    for (const channel of ['headTilt', 'headNod', 'bodyLean', 'bodyLift', 'gazeOffsetX']) assert.equal(repeated[channel], pose[channel], channel);
    assert.ok(Math.abs(pose.bodyLift) <= .03 && Math.abs(pose.bodyLean) <= .025);
  }
  assert.equal(seen.size, 2);
  const restored = controller.step(.025);
  assert.equal(restored.bodyLift, 0);
  assert.equal(restored.bodyLean, 0);
  controller.setInput(phase('thinking'));
  assert.equal(controller.step(0).microExpression, 'none');
  for (const option of ['hidden', 'sleeping', 'reducedMotion']) {
    const idle = createAvatarPerformance();
    frames(idle, 9);
    assert.equal(idle.step(0, { [option]: true }).microExpression, 'none');
    frames(idle, 60, { [option]: true });
    assert.ok(frames(idle, 8).every(pose => pose.microExpression === 'none'), `${option} starts a fresh quiet interval`);
  }
});
