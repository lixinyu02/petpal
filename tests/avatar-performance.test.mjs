import test from 'node:test';
import assert from 'node:assert/strict';
import { createAvatarPerformance } from '../src/avatar/performance.mjs';

const run = (controller, seconds, options) => {
  const frames = [];
  for (let time = 0; time < seconds - .0001; time += .025) frames.push(controller.step(.025, options));
  return frames;
};
const input = (text, extra = {}) => ({ utteranceId: 'reply-1', text, phase: 'speaking', ...extra });
const mouthActive = frames => frames.some(frame => frame.mouthOpen > .05);

test('streaming PCM energy controls mouth even between text boundaries and closes in silence or buffering',()=>{
  const controller=createAvatarPerformance();
  const speech={active:true,charIndex:0,ended:false,audioLevel:.7};
  controller.setInput(input('你好，小伴。',{speech}));
  assert.equal(mouthActive(run(controller,.5)),true);
  controller.setInput(input('你好，小伴。',{speech:{...speech,audioLevel:0}}));
  assert.equal(controller.step(.025).mouthOpen,0);
  controller.setInput(input('你好，小伴。',{speech:{...speech,audioLevel:.5}}));
  assert.ok(controller.step(.025).mouthOpen>0);
  controller.setInput(input('你好，小伴。',{speech:{...speech,active:false}}));
  assert.equal(controller.step(.025).mouthOpen,0);
  controller.setInput(input('你好，小伴。',{speech}));
  assert.equal(controller.step(.025,{hidden:true}).mouthOpen,0);
  controller.reset();assert.equal(controller.step(.025).mouthOpen,0);
});

test('text deltas articulate once; identical snapshots and completed history never replay', () => {
  const controller = createAvatarPerformance();
  controller.setInput(input('a'));
  assert.equal(mouthActive(run(controller, .2)), true);
  controller.setInput(input('a'));
  assert.equal(mouthActive(run(controller, .5)), false);
  controller.setInput(input('ao'));
  assert.equal(run(controller, .025)[0].mouthShape, 'O');
  controller.setInput(input('ao', { phase: 'idle' }));
  assert.equal(controller.step(.025).mouthOpen, 0);
  controller.setInput(input('ao'));
  assert.equal(mouthActive(run(controller, .5)), false);
  controller.setInput(input('aoe'));
  assert.equal(mouthActive(run(controller, .1)), true);
  controller.setInput(input('a'));
  controller.setInput(input('aoe'));
  assert.equal(mouthActive(run(controller, .5)), false, 'restoring a shortened historical reply must not replay its prefix');
});

test('thinking, cancellation, topic switches and explicit reset discard queued speech', () => {
  const controller = createAvatarPerformance();
  controller.setInput(input('这是尚未播放完的长回复，接下来还会继续。'));
  run(controller, .1);
  controller.setInput(input('这是尚未播放完的长回复，接下来还会继续。', { phase: 'thinking' }));
  const waiting = run(controller, 2);
  assert.equal(mouthActive(waiting), false);
  assert.equal(waiting.at(-1).expression, 'thoughtful');
  controller.setInput(input('这是尚未播放完的长回复，接下来还会继续。'));
  assert.equal(mouthActive(run(controller, .5)), false);
  controller.setInput(input('a', { utteranceId: 'reply-2' }));
  assert.equal(controller.step(.025).mouthShape, 'A');
  controller.reset();
  assert.equal(controller.step(.025).speaking, false);
  controller.setInput(input('a', { utteranceId: 'reply-2' }));
  assert.equal(mouthActive(run(controller, .5)), false);
  controller.setInput(input('replacement text', { utteranceId: 'reply-2' }));
  assert.equal(mouthActive(run(controller, .5)), false, 'non-append replacement is not narrated as a fresh delta');
});

test('sentence punctuation pauses the mouth and lip consonants close it', () => {
  const controller = createAvatarPerformance();
  controller.setInput(input('a。o'));
  const frames = run(controller, .7);
  const firstOpen = frames.findIndex(frame => frame.mouthShape === 'A');
  const secondOpen = frames.findIndex(frame => frame.mouthShape === 'O');
  assert.ok(firstOpen >= 0 && secondOpen > firstOpen);
  const paused = frames.slice(firstOpen + 1, secondOpen).filter(frame => frame.mouthShape === 'rest' && frame.mouthOpen === 0);
  assert.ok(paused.length >= 12, 'sentence pause lasts at least 300 ms');
  controller.setInput(input('m', { utteranceId: 'lip' }));
  const closed = controller.step(.025);
  assert.equal(closed.mouthShape, 'M'); assert.equal(closed.mouthOpen, 0);
});

test('Chinese and English text use different approximate cadence; long chunks have bounded backlog', () => {
  const english = createAvatarPerformance(), chinese = createAvatarPerformance();
  english.setInput(input('aaaa')); chinese.setInput(input('你好世界'));
  assert.equal(run(english, .4).at(-1).speaking, false);
  assert.equal(run(chinese, .4).at(-1).speaking, true);
  const burst = createAvatarPerformance();
  burst.setInput(input('这是一段很长的历史内容。'.repeat(10_000) + '谢谢你。'));
  const frames = run(burst, 6);
  assert.equal(mouthActive(frames), true);
  assert.equal(frames.at(-1).speaking, false);
  assert.equal(frames.at(-1).mouthOpen, 0);
});

test('hidden periods discard queued and newly arriving old text without a catch-up burst', () => {
  const controller = createAvatarPerformance();
  controller.setInput(input('你好，这是等待播放的内容。'));
  run(controller, .05);
  assert.equal(controller.step(10, { hidden: true }).mouthOpen, 0);
  controller.setInput(input('你好，这是等待播放的内容。还有后台追加的内容。'));
  controller.step(10, { hidden: true });
  assert.equal(mouthActive(run(controller, 2)), false);
  controller.setInput(input('你好，这是等待播放的内容。还有后台追加的内容。a'));
  assert.equal(controller.step(.025).mouthShape, 'A');
});

test('external speech follows UTF-16 progress, closes on stalls, pause and end, and does not replay the text queue', () => {
  const controller = createAvatarPerformance();
  const speech = (active, charIndex, ended = false) => input('a😀ome', { speech: { active, charIndex, ended } });
  controller.setInput(speech(false, 0));
  assert.equal(mouthActive(run(controller, 1)), false);
  controller.setInput(speech(true, 0));
  assert.equal(controller.step(.025).mouthShape, 'A');
  assert.equal(mouthActive(run(controller, 1).slice(-10)), false);
  controller.setInput(speech(true, 0));
  assert.equal(mouthActive(run(controller, .4)), false, 'same boundary must not loop');
  controller.setInput(speech(true, 3)); // a + a UTF-16 surrogate pair.
  assert.equal(controller.step(.025).mouthShape, 'O');
  controller.setInput(speech(false, 3));
  assert.equal(controller.step(.025).mouthOpen, 0);
  controller.setInput(speech(true, 4));
  assert.equal(controller.step(.025).mouthShape, 'M');
  controller.setInput(speech(true, 5, true));
  assert.equal(mouthActive(run(controller, .5)), false);
  controller.setInput(input('a😀ome'));
  assert.equal(mouthActive(run(controller, 1)), false, 'removing speech does not replay completed text');
});

test('external onstart expresses already received text only while playback is active', () => {
  for (const [text, expected] of [['为什么呢？', 'curious'], ['有点害羞。', 'shy'], ['谢谢你。', 'warm']]) {
    const controller = createAvatarPerformance();
    controller.setInput(input(text, { phase: 'idle', speech: { active: false, charIndex: 0 } }));
    assert.equal(controller.step(.025).expression, 'neutral');
    assert.equal(mouthActive(run(controller, .2)), false);
    controller.setInput(input(text, { speech: { active: true, charIndex: 0 } }));
    const started = controller.step(.025);
    assert.equal(started.expression, expected);
    assert.ok(started.mouthOpen > 0, 'onstart articulates even though pending consumed the text');
    controller.setInput(input(text, { speech: { active: true, charIndex: 1, ended: true } }));
    const ended = controller.step(0);
    assert.equal(ended.mouthOpen, 0);
    assert.equal(ended.mouthShape, 'rest');
    assert.equal(ended.speaking, false);
    controller.setInput(input(text));
    assert.equal(mouthActive(run(controller, 1)), false, 'switching to silent history never replays completed text');
    assert.equal(controller.step(.025).expression, 'neutral');
  }
});

test('external expressions track the current sentence and do not refresh on a stalled boundary', () => {
  const controller = createAvatarPerformance();
  const text = '为什么呢？有点害羞。谢谢你。';
  controller.setInput(input(text, { speech: { active: false, charIndex: 0 } }));
  assert.equal(controller.step(.025).expression, 'neutral', 'pending TTS must not perform unspoken text');
  controller.setInput(input(text, { speech: { active: true, charIndex: 0 } }));
  assert.equal(controller.step(.025).expression, 'curious');
  controller.setInput(input(text, { speech: { active: true, charIndex: 5 } }));
  assert.equal(controller.step(.025).expression, 'shy');
  controller.setInput(input(text, { speech: { active: true, charIndex: 10 } }));
  assert.equal(controller.step(.025).expression, 'warm');
  for (let index = 0; index < 30; index++) {
    controller.setInput(input(text, { speech: { active: true, charIndex: 10 } }));
    controller.step(.1);
  }
  assert.equal(controller.step(.025).expression, 'neutral');
  assert.equal(controller.step(.025).mouthOpen, 0);
});

test('reduced motion stops autonomous blinking and head motion while keeping explicit articulation', () => {
  const controller = createAvatarPerformance();
  const autonomous = run(controller, 8);
  assert.ok(autonomous.some(frame => frame.blinkLeft > .1));
  controller.setInput(input('谢谢你，今天很开心！'));
  const reduced = run(controller, 4, { reducedMotion: true });
  assert.equal(mouthActive(reduced), true);
  for (const frame of reduced) assert.deepEqual([frame.headTilt, frame.headNod, frame.blinkLeft, frame.blinkRight], [0, 0, 0, 0]);
  assert.ok(reduced.some(frame => frame.expression === 'warm' && frame.expressionAmount > .2));
});

test('micro expressions remain finite and bounded; snapshots are isolated and invalid time never fast-forwards', () => {
  const samples = [['谢谢你的陪伴', 'warm'], ['为什么呢？', 'curious'], ['让我想一想', 'thoughtful'], ['哇！好惊喜', 'surprised'], ['有点害羞，不好意思', 'shy']];
  for (const [text, expected] of samples) {
    const controller = createAvatarPerformance(); controller.setInput(input(text));
    const frames = run(controller, 1);
    assert.equal(frames.at(-1).expression, expected);
    for (const frame of frames) {
      for (const key of ['expressionAmount', 'mouthOpen', 'blinkLeft', 'blinkRight', 'blush']) assert.ok(Number.isFinite(frame[key]) && frame[key] >= 0 && frame[key] <= 1, key);
      for (const key of ['browRaise', 'headTilt', 'headNod']) assert.ok(Number.isFinite(frame[key]) && Math.abs(frame[key]) <= 1, key);
    }
    frames.at(-1).mouthOpen = 100;
    assert.ok(controller.step(0).mouthOpen <= 1);
  }
  const a = createAvatarPerformance(), b = createAvatarPerformance();
  a.setInput(input('你好')); b.setInput(input('你好'));
  a.step(NaN); a.step(-10); a.step(Infinity);
  assert.deepEqual(a.step(10), b.step(.1));
  assert.throws(() => a.setInput(input('ok', { phase: 'unknown' })), /Invalid/);
  a.setInput(input('ok', { speech: { active: true, charIndex: NaN } }));
  assert.equal(a.step(.025).mouthOpen, 0);
});
