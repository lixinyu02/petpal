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
  const samples = [['谢谢你的陪伴', 'warm'], ['为什么呢？', 'curious'], ['让我想一想', 'thoughtful'], ['哇！好惊喜', 'surprised'], ['有点害羞，不好意思', 'shy'], ['太好了', 'happy'], ['开个玩笑', 'playful'], ['别着急，我陪你', 'concerned']];
  for (const [text, expected] of samples) {
    const controller = createAvatarPerformance(); controller.setInput(input(text));
    const frames = run(controller, 1);
    assert.equal(frames.at(-1).expression, expected);
    for (const frame of frames) {
      for (const key of ['expressionAmount', 'warmAmount', 'curiousAmount', 'surpriseAmount', 'concernAmount', 'smileAmount', 'mouthOpen', 'blinkLeft', 'blinkRight', 'blush']) assert.ok(Number.isFinite(frame[key]) && frame[key] >= 0 && frame[key] <= 1, key);
      for (const key of ['browRaise', 'browTilt', 'headTilt', 'headNod', 'gazeOffsetX', 'gazeOffsetY']) assert.ok(Number.isFinite(frame[key]) && Math.abs(frame[key]) <= 1, key);
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

const faceChannels = ['expressionAmount','warmAmount','curiousAmount','surpriseAmount','concernAmount','smileAmount','browRaise','browTilt','blush','headTilt','headNod','gazeOffsetX','gazeOffsetY'];
const facial = pose => Object.fromEntries(faceChannels.map(name => [name,pose[name]]));
const mouth = pose => ({open:pose.mouthOpen,shape:pose.mouthShape,speaking:pose.speaking});

test('new utterances and changing expressions crossfade independent channels without flashing neutral', () => {
  const controller=createAvatarPerformance(); controller.setInput(input('谢谢你的陪伴'));
  const before=run(controller,.8).at(-1); assert.ok(before.warmAmount>.8);
  controller.setInput(input('为什么呢？',{utteranceId:'new-reply'}));
  assert.deepEqual(facial(controller.step(0)),facial(before),'setInput must not reset the face');
  const after=controller.step(.025); assert.equal(after.expression,'curious');
  assert.ok(after.warmAmount>.65 && after.curiousAmount>0); assert.ok(after.expressionAmount>.8);
  for(const key of faceChannels)assert.ok(Math.abs(after[key]-before[key])<.2,key);
  const curious=run(controller,.6).at(-1); assert.ok(curious.curiousAmount>.8); assert.ok(curious.warmAmount<.1);
  controller.setInput(input('为什么呢？',{utteranceId:'new-reply',phase:'idle'}));
  const settling=controller.step(.025); assert.equal(settling.expression,'neutral'); assert.ok(settling.curiousAmount>.65);
  assert.ok(run(controller,2).at(-1).curiousAmount<.001);
});

test('error expresses concern while new happy and playful cues have distinct facial channels', () => {
  const controller=createAvatarPerformance(); controller.setInput(input('',{phase:'error'}));
  const concern=run(controller,.7).at(-1);
  assert.equal(concern.expression,'concerned'); assert.ok(concern.concernAmount>.35); assert.equal(concern.surpriseAmount,0);
  assert.ok(concern.warmAmount>0 && concern.curiousAmount>0 && concern.browTilt>0); assert.deepEqual(mouth(concern),{open:0,shape:'rest',speaking:false});
  const happy=createAvatarPerformance(); happy.setInput(input('太好了'));
  const joy=run(happy,.5).at(-1); assert.equal(joy.expression,'happy'); assert.ok(joy.smileAmount>.7);
  const playful=createAvatarPerformance(); playful.setInput(input('开个玩笑'));
  const tease=run(playful,.5).at(-1); assert.equal(tease.expression,'playful'); assert.ok(tease.smileAmount>.6); assert.ok(tease.browTilt<0);
  assert.equal(tease.blinkRight,0,'text does not loop a greeting wink');
});

test('frequent idle input ids do not restart the natural blink clock', () => {
  const updated=createAvatarPerformance(), control=createAvatarPerformance(); let blinked=false;
  for(let frame=0;frame<160;frame++){
    updated.setInput(input('',{phase:'idle',utteranceId:`local-${frame}`}));
    const actual=updated.step(.025), expected=control.step(.025);
    assert.equal(actual.blinkLeft,expected.blinkLeft);assert.equal(actual.blinkRight,expected.blinkRight);
    if(actual.blinkLeft>.1)blinked=true;
  }
  assert.equal(blinked,true);
});

test('reactions survive local input ids and never inject speech into an idle companion', () => {
  for(const [kind,expression] of [['pet','happy'],['greet','playful'],['wake','warm']]){
    const controller=createAvatarPerformance(); assert.equal(controller.react({id:'touch-1',kind}),true);
    controller.setInput(input('',{phase:'idle',utteranceId:'interaction-1'}));
    const frames=run(controller,.45); assert.ok(frames.some(frame=>frame.expression===expression && frame.smileAmount>.04),kind);
    for(const frame of frames)assert.deepEqual(mouth(frame),{open:0,shape:'rest',speaking:false},kind);
    assert.equal(controller.react({id:'touch-1',kind}),false);
    const end=run(controller,4).at(-1); assert.equal(end.expression,'neutral'); assert.ok(end.smileAmount<.001);
  }
});

test('pet and greet reactions do not change text queues or PCM mouth timing, pauses or buffering', () => {
  for(const external of [false,true]){
    const withReaction=createAvatarPerformance(), control=createAvatarPerformance();
    for(let frame=0;frame<90;frame++){
      const speaking=frame<60;
      const active=frame<35 || frame>=45;
      const next=input('a。ome你好，继续。',{phase:speaking?'speaking':'idle',...(external?{speech:{active,charIndex:Math.min(10,Math.floor(frame/8)),audioLevel:active?.6:0}}:{})});
      withReaction.setInput(next);control.setInput(next);
      if(frame===5)withReaction.react({id:'pet-during-reply',kind:'pet'});
      if(frame===20)withReaction.react({id:'greet-during-reply',kind:'greet'});
      if(frame===50)withReaction.react({id:'wake-during-reply',kind:'wake'});
      assert.deepEqual(mouth(withReaction.step(.025)),mouth(control.step(.025)),`external=${external}, frame=${frame}`);
    }
  }
});

test('a greeting winks once and repeated ids or rapid greetings cannot spam another wink', () => {
  const controller=createAvatarPerformance();controller.react({id:'hello-1',kind:'greet'});
  const first=run(controller,.6); assert.ok(first.some(frame=>frame.blinkRight>.8 && frame.blinkLeft===0));
  let segments=0,active=false;
  for(const frame of first){const current=frame.blinkRight-frame.blinkLeft>.05;if(current&&!active)segments++;active=current;}
  assert.equal(segments,1);assert.equal(controller.react({id:'hello-1',kind:'greet'}),false);
  controller.react({id:'hello-2',kind:'greet'});
  assert.ok(run(controller,1).every(frame=>frame.blinkRight===frame.blinkLeft));
  run(controller,1);controller.react({id:'hello-3',kind:'greet'});
  assert.ok(run(controller,.6).some(frame=>frame.blinkRight-frame.blinkLeft>.8));
});

test('hidden state discards active and newly arriving reactions without replay on return', () => {
  const controller=createAvatarPerformance();controller.react({id:'before-hidden',kind:'greet'});run(controller,.15);
  const hidden=controller.step(0,{hidden:true}); assert.equal(hidden.expression,'neutral'); assert.ok(Object.values(facial(hidden)).every(value=>value===0));
  assert.equal(controller.react({id:'while-hidden',kind:'greet'}),false);
  const restored=run(controller,1); assert.ok(restored.every(frame=>frame.smileAmount===0 && frame.blinkRight===frame.blinkLeft));
  assert.equal(controller.react({id:'before-hidden',kind:'greet'}),false); assert.equal(controller.react({id:'while-hidden',kind:'greet'}),false);
});

test('reduced motion cancels an active wink and gaze immediately while keeping static reactions and articulation', () => {
  const controller=createAvatarPerformance();controller.setInput(input('为什么呢？'));
  controller.react({id:'greet',kind:'greet'}); const moving=run(controller,.2).at(-1);
  assert.ok(moving.blinkRight>.8);assert.notEqual(moving.gazeOffsetX,0);
  const stopped=controller.step(0,{reducedMotion:true});
  for(const key of ['blinkLeft','blinkRight','headTilt','headNod','gazeOffsetX','gazeOffsetY'])assert.equal(stopped[key],0,key);
  assert.equal(stopped.smileAmount,moving.smileAmount);
  controller.react({id:'static-greet',kind:'greet'});
  const staticFrames=run(controller,.6,{reducedMotion:true}); assert.ok(staticFrames.some(frame=>frame.smileAmount>.2));assert.equal(mouthActive(staticFrames),true);
  for(const frame of staticFrames)for(const key of ['blinkLeft','blinkRight','headTilt','headNod','gazeOffsetX','gazeOffsetY'])assert.equal(frame[key],0,key);
  assert.ok(run(controller,.5).every(frame=>frame.blinkRight===frame.blinkLeft),'preference change never replays the cancelled wink');
});

test('reset clears every facial channel and reaction but retains recent event replay protection', () => {
  const controller=createAvatarPerformance();controller.react({id:'one-shot',kind:'greet'});run(controller,.2);controller.reset();
  const cleared=controller.step(0);assert.equal(cleared.expression,'neutral');assert.ok(Object.values(facial(cleared)).every(value=>value===0));assert.deepEqual(mouth(cleared),{open:0,shape:'rest',speaking:false});
  assert.equal(controller.react({id:'one-shot',kind:'greet'}),false);
  for(const event of [{id:'',kind:'pet'},{id:'x',kind:'invalid'},null])assert.throws(()=>controller.react(event),/Invalid avatar reaction/);
});
