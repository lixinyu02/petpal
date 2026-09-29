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
  const stalled=a.step(10),regular=b.step(.1);
  assert.deepEqual(mouth(stalled),mouth(regular),'stalled frames never fast-forward the bounded text articulation queue');
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

const expandedChannels=['sadAmount','downcastAmount','excitedAmount','shyAmount','eyeSmile','tearAmount','voiceEnergy'];
test('sad/downcast/excited/happy/shy have distinct strong but bounded facial channels',()=>{
  const snapshots={};
  for(const [kind,text]of [['sad','我很伤心。'],['downcast','我有点难过。'],['excited','我好兴奋。'],['happy','今天好开心。'],['shy','我有点害羞。']]){
    const controller=createAvatarPerformance();controller.setInput(input(text));const pose=run(controller,.8).at(-1);snapshots[kind]=pose;
    assert.equal(pose.expression,kind);
    for(const key of expandedChannels)assert.ok(Number.isFinite(pose[key])&&pose[key]>=0&&pose[key]<=1,`${kind}.${key}`);
  }
  assert.ok(snapshots.sad.sadAmount>.85&&snapshots.sad.tearAmount>.7&&snapshots.sad.smileAmount===0);
  assert.ok(snapshots.downcast.downcastAmount>.85&&snapshots.downcast.tearAmount<.2&&snapshots.downcast.gazeOffsetY<-.2);
  assert.ok(snapshots.excited.excitedAmount>.85&&snapshots.excited.eyeSmile<.35&&snapshots.excited.browRaise>.4);
  assert.ok(snapshots.happy.eyeSmile>.85&&snapshots.happy.smileAmount>.85);
  assert.ok(snapshots.shy.shyAmount>.85&&snapshots.shy.blush>.85&&snapshots.shy.gazeOffsetX<-.25);
});

test('PCM energy adjusts motion strength but never selects an emotion or changes mouth timing',()=>{
  for(const text of ['我很伤心。','今天很开心。','我好兴奋。','一般的说明文字。']){
    const soft=createAvatarPerformance(),loud=createAvatarPerformance();
    for(const [controller,audioLevel]of [[soft,.08],[loud,.8]])controller.setInput(input(text,{speech:{active:true,charIndex:0,ended:false,audioLevel}}));
    const low=run(soft,.5).at(-1),high=run(loud,.5).at(-1);
    assert.equal(low.expression,high.expression);assert.ok(high.voiceEnergy>low.voiceEnergy+.6);
    if(text.includes('伤心'))assert.equal(high.excitedAmount,0);
    assert.ok(low.mouthOpen>0&&high.mouthOpen>low.mouthOpen);
  }
});

test('silence/buffering/stop/hidden/reduced motion clear voice emphasis and keep mouth independent',()=>{
  const text='真的好兴奋。',controller=createAvatarPerformance(),speech={active:true,charIndex:0,ended:false,audioLevel:.8};
  controller.setInput(input(text,{speech}));const active=run(controller,.4).at(-1);assert.ok(active.voiceEnergy>.7);
  controller.setInput(input(text,{speech:{...speech,audioLevel:0}}));assert.equal(controller.step(.025).voiceEnergy,0);assert.equal(controller.step(.025).mouthOpen,0);
  controller.setInput(input(text,{speech}));run(controller,.2);controller.setInput(input(text,{speech:{...speech,active:false}}));assert.equal(controller.step(0).voiceEnergy,0);assert.equal(controller.step(0).mouthOpen,0);
  controller.setInput(input(text,{speech}));run(controller,.2);const reduced=controller.step(.025,{reducedMotion:true});assert.equal(reduced.voiceEnergy,0);assert.equal(reduced.headNod,0);assert.ok(reduced.mouthOpen>0);assert.ok(reduced.excitedAmount>0);
  const hidden=controller.step(0,{hidden:true});for(const key of expandedChannels)assert.equal(hidden[key],0,key);
  controller.setInput(input(text,{phase:'idle',speech:{...speech,ended:true}}));assert.equal(controller.step(.025).voiceEnergy,0);
  controller.reset();for(const key of expandedChannels)assert.equal(controller.step(0)[key],0,key);
});

test('pet/greet never force a smile or wink over a sad/downcast/concerned spoken sentence',()=>{
  for(const text of ['我很伤心。','我有点难过。','别难过，我在这里。']){
    const controller=createAvatarPerformance(),control=createAvatarPerformance();const speech={active:true,charIndex:0,ended:false,audioLevel:.5};
    controller.setInput(input(text,{speech}));control.setInput(input(text,{speech}));run(controller,.2);run(control,.2);
    controller.react({id:'pet',kind:'pet'});controller.react({id:'greet',kind:'greet'});
    for(let frame=0;frame<20;frame++){
      const actual=controller.step(.025),expected=control.step(.025);
      assert.equal(actual.expression,expected.expression);assert.equal(actual.smileAmount,expected.smileAmount);assert.equal(actual.eyeSmile,expected.eyeSmile);assert.equal(actual.blinkRight,expected.blinkRight);assert.deepEqual(mouth(actual),mouth(expected));
    }
  }
});

test('new emotional channels crossfade on new sentences and reset without stale tear replay',()=>{
  const controller=createAvatarPerformance();controller.setInput(input('我很伤心。'));const sad=run(controller,.7).at(-1);
  controller.setInput(input('太好了！',{utteranceId:'happy'}));assert.equal(controller.step(0).tearAmount,sad.tearAmount);
  const first=controller.step(.025);assert.ok(first.tearAmount>0&&first.eyeSmile>0);assert.equal(first.expression,'happy');
  const happy=run(controller,1.5).at(-1);assert.ok(happy.tearAmount<.005&&happy.eyeSmile>.85);
  controller.reset();for(const key of expandedChannels)assert.equal(controller.step(0)[key],0,key);
});

test('spoken continuation keeps tears/shyness until a real new cue or sentence boundary',()=>{
  const controller=createAvatarPerformance(),text='我很伤心，眼泪快要掉下来了。不过现在已经不伤心了。';
  const set=index=>controller.setInput(input(text,{speech:{active:true,charIndex:index,ended:false,audioLevel:.5}}));
  set(0);run(controller,.6);set(text.indexOf('眼泪'));const continued=run(controller,.4).at(-1);
  assert.equal(continued.expression,'sad');assert.ok(continued.tearAmount>.7);
  set(text.indexOf('不过'));const neutral=run(controller,.9).at(-1);assert.notEqual(neutral.expression,'sad');assert.ok(neutral.tearAmount<.02);
  const shy='被你这样夸奖，我有点害羞，脸都红了。';
  controller.setInput(input(shy,{utteranceId:'shy',speech:{active:true,charIndex:0,ended:false,audioLevel:.5}}));assert.notEqual(controller.step(.025).expression,'shy');
  controller.setInput(input(shy,{utteranceId:'shy',speech:{active:true,charIndex:shy.indexOf('我有点'),ended:false,audioLevel:.5}}));run(controller,.5);
  controller.setInput(input(shy,{utteranceId:'shy',speech:{active:true,charIndex:shy.indexOf('脸都'),ended:false,audioLevel:.5}}));assert.equal(controller.step(.025).expression,'shy');
});

const gestureChannels=['gestureProgress','bodyLean','bodyLift','bodyTurn','headShake'];
test('new facial channels are vivid and crossfade without flashing neutral',()=>{
  for(const [text,kind,channel]of [['我有点得意。','smug','smugAmount'],['哼，我有点气鼓鼓。','pout','poutAmount'],['现在安心了。','relieved','reliefAmount'],['我会认真做好。','determined','determinedAmount']]){
    const controller=createAvatarPerformance();controller.setInput(input(text));const pose=run(controller,.8).at(-1);
    assert.equal(pose.expression,kind);assert.ok(pose[channel]>.85,channel);
    if(kind==='pout'||kind==='determined')assert.equal(pose.smileAmount,0);
    controller.setInput(input('普通说明。',{utteranceId:'next'}));assert.equal(controller.step(0)[channel],pose[channel]);
    assert.ok(run(controller,1.5).at(-1)[channel]<.002);
  }
});

test('incremental text triggers one complete motion per sentence and never replays old history',()=>{
  const controller=createAvatarPerformance(),text='好的，我会完成这项工作，然后继续检查。';
  const frames=[];
  for(let index=1;index<=text.length;index++){
    controller.setInput(input(text.slice(0,index)));frames.push(...run(controller,.1));
  }
  frames.push(...run(controller,2));
  let starts=0,active=false;
  for(const frame of frames){const next=frame.gesture!=='none';if(next&&!active)starts++;active=next;}
  assert.equal(starts,1);assert.equal(frames.at(-1).gesture,'none');
  controller.setInput(input(text));assert.equal(controller.step(.025).gesture,'none');
  controller.reset();controller.setInput(input(text));assert.equal(controller.step(.025).gesture,'none');
  controller.setInput(input(text+'太好了！'));assert.equal(controller.step(.025).gesture,'bounce');
});

test('TTS performs only the current clause and does not replay a sentence while its character boundary advances',()=>{
  const controller=createAvatarPerformance(),text='这是普通内容，我有点害羞。现在安心了。';
  const set=index=>controller.setInput(input(text,{speech:{active:true,charIndex:index,audioLevel:.5}}));
  set(0);assert.equal(controller.step(.1).gesture,'none');
  set(text.indexOf('我有点'));assert.equal(controller.step(.1).gesture,'shy');
  run(controller,2.5);
  set(text.indexOf('害羞'));assert.equal(controller.step(.1).gesture,'none');
  set(text.indexOf('现在'));assert.equal(controller.step(.1).gesture,'settle');
});

test('hidden, stop, buffering and reduced motion immediately clear gestures and never replay the cancelled sentence',()=>{
  for(const interruption of ['hidden','stop','buffering','reduced']){
    const controller=createAvatarPerformance(),text='太好了，今天真的很开心。',speech={active:true,charIndex:0,audioLevel:.5};
    controller.setInput(input(text,{speech}));const moving=run(controller,.3).at(-1);assert.equal(moving.gesture,'bounce');assert.ok(moving.bodyLift>.2);
    if(interruption==='hidden')controller.step(0,{hidden:true});
    else if(interruption==='reduced')controller.step(0,{reducedMotion:true});
    else controller.setInput(input(text,{phase:interruption==='stop'?'idle':'speaking',speech:{...speech,active:false}}));
    const stopped=controller.step(0,{hidden:interruption==='hidden',reducedMotion:interruption==='reduced'});
    assert.equal(stopped.gesture,'none');for(const key of gestureChannels)assert.equal(stopped[key],0,`${interruption}.${key}`);
    controller.step(0);controller.setInput(input(text,{speech:{...speech,charIndex:4}}));
    assert.ok(run(controller,3).every(frame=>frame.gesture==='none'),interruption);
    controller.setInput(input(text+'现在安心了。',{speech:{...speech,charIndex:text.length}}));
    assert.equal(controller.step(.1).gesture,'settle','a genuinely new sentence can animate');
  }
});

test('direct touch and greeting trigger a gentle one-shot pose without a smile over negative dialogue',()=>{
  for(const [kind,gesture]of [['pet','tilt'],['greet','nod'],['wake','settle']]){
    const controller=createAvatarPerformance();controller.react({id:kind,kind});
    const pose=run(controller,.4).at(-1);assert.equal(pose.gesture,gesture);assert.deepEqual(mouth(pose),{open:0,shape:'rest',speaking:false});
    assert.ok(run(controller,3).every(frame=>frame.gesture===gesture||frame.gesture==='none'));
    assert.equal(controller.step(0).gesture,'none');
  }
  const sad=createAvatarPerformance();sad.setInput(input('我很伤心。'));run(sad,.3);sad.react({id:'gentle-pet',kind:'pet'});
  const pose=run(sad,.3).at(-1);assert.equal(pose.gesture,'settle');assert.equal(pose.smileAmount,0);assert.equal(pose.expression,'sad');
});

test('an enabled but idle TTS player does not disable touch gestures',()=>{
  const controller=createAvatarPerformance(),idle=input('',{phase:'idle',speech:{active:false,charIndex:0,ended:true}});
  controller.setInput(idle);controller.react({id:'idle-pet',kind:'pet'});
  const frames=[];
  for(let frame=0;frame<20;frame++){controller.setInput(idle);frames.push(controller.step(.025));}
  assert.ok(frames.every(frame=>frame.gesture==='tilt'));
  assert.ok(frames.at(-1).bodyTurn>.1);
});

test('all new motion and expression channels stay bounded across arbitrary input changes',()=>{
  const controller=createAvatarPerformance();
  for(let frame=0;frame<240;frame++){
    if(frame%15===0)controller.setInput(input(['我有点得意。','哼，我有点气鼓鼓。','现在安心了。','我会认真做好。'][Math.floor(frame/15)%4],{utteranceId:`id-${frame}`}));
    const pose=controller.step(.025);
    for(const key of ['smugAmount','poutAmount','reliefAmount','determinedAmount','gestureProgress'])assert.ok(Number.isFinite(pose[key])&&pose[key]>=0&&pose[key]<=1,key);
    for(const key of ['bodyLean','bodyLift','bodyTurn','headShake','headTilt','headNod'])assert.ok(Number.isFinite(pose[key])&&Math.abs(pose[key])<=1,key);
  }
});

test('low frame rate expires gestures, facial reactions and winks in real time with no stale head pose',()=>{
  const touched=createAvatarPerformance();touched.react({id:'hello',kind:'greet'});
  const moving=touched.step(.18);assert.equal(moving.gesture,'nod');assert.ok(moving.headNod>.1);
  const finished=touched.step(2);
  assert.equal(finished.gesture,'none');assert.equal(finished.expression,'neutral');
  assert.ok(finished.smileAmount<.001&&Math.abs(finished.headNod)<.03);
  assert.equal(finished.blinkLeft,finished.blinkRight,'old wink does not survive the frame gap');
  assert.ok(gestureChannels.every(key=>finished[key]===0));
  assert.equal(touched.react({id:'hello',kind:'greet'}),false);
  const text=createAvatarPerformance();text.setInput(input('我很伤心。'));text.step(.2);
  const expired=text.step(3);assert.notEqual(expired.expression,'sad');assert.ok(expired.sadAmount<.001&&expired.tearAmount<.001);
});

test('one-fps incremental updates cannot repeat a consumed sentence or replay after visibility returns',()=>{
  const controller=createAvatarPerformance(),text='好的，我会继续认真完成这项工作。';
  for(let index=2;index<=text.length;index++){
    controller.setInput(input(text.slice(0,index)));const frame=controller.step(1);
    if(index>=3)assert.equal(frame.gesture,'none',`frame ${index} never restarts the sentence`);
  }
  controller.step(0,{hidden:true});controller.setInput(input(text+'还有一段在后台追加的文字。'));
  const visible=controller.step(1);assert.equal(visible.gesture,'none');assert.equal(visible.mouthOpen,0);
});

test('audible PCM retains current emotion across slow frames while buffering cancels its motion immediately',()=>{
  const controller=createAvatarPerformance(),text='我有点害羞，脸红了。',speech={active:true,charIndex:0,audioLevel:.5};
  for(let frame=0;frame<5;frame++){
    controller.setInput(input(text,{speech}));const pose=controller.step(1);
    assert.equal(pose.expression,'shy');assert.ok(pose.mouthOpen>0);
    if(frame>=1)assert.equal(pose.gesture,'none');
  }
  controller.setInput(input(text,{speech:{...speech,active:false}}));
  const buffering=controller.step(0);assert.equal(buffering.gesture,'none');assert.equal(buffering.mouthOpen,0);
  controller.setInput(input(text,{speech:{...speech,charIndex:2}}));
  assert.equal(controller.step(1).gesture,'none');
});

test('new microacting faces have distinct strong channels and keep sleepy eyelids opaque-friendly',()=>{
  for(const [text,kind,gesture]of [['我有一点犹豫。','hesitant','shrug'],['我有点困了。','sleepy','doze'],['我很期待听你讲下去。','expectant','leanIn'],['我也会觉得委屈。','aggrieved','shrug'],['我会温柔地陪着你。','tender','sway']]){
    const controller=createAvatarPerformance();controller.setInput(input(text));const pose=run(controller,.7).at(-1);
    assert.equal(pose.expression,kind);assert.equal(pose.gesture,gesture);assert.ok(pose[`${kind}Amount`]>.85);
    assert.ok(pose.eyeSmile<.2,'new faces do not keep half-transparent closed-eye textures');
    if(kind==='aggrieved')assert.equal(pose.smileAmount,0);
  }
});

test('each new streamed intent triggers once, including listening after an incomplete determination phrase',()=>{
  for(const [text,gesture]of [['我在认真听你说。','leanIn'],['我有一点犹豫，还没想好呢。','shrug'],['真的很感谢你一直陪着我。','bow'],['让我偷偷看一眼。','peek'],['我会温柔地陪着你。','sway'],['我有点犯困了。','doze']]){
    const controller=createAvatarPerformance(),seen=[];let previous='none';
    for(let index=1;index<=text.length;index++){
      controller.setInput(input(text.slice(0,index)));const pose=controller.step(.15);
      if(pose.gesture!=='none'&&previous==='none')seen.push(pose.gesture);
      previous=pose.gesture;
    }
    assert.deepEqual(seen,[gesture],text);assert.equal(controller.step(4).gesture,'none');
  }
});

test('idle microacting is low priority and cancellation restores the exact underlying channels',()=>{
  for(const phase of ['listening','thinking','speaking','error']){
    const controller=createAvatarPerformance();run(controller,9);
    const glance=controller.step(0);assert.equal(glance.microExpression,'glance');assert.ok(glance.gazeOffsetX>.2);
    controller.setInput(input(phase==='speaking'?'你好':'',{phase}));const interrupted=controller.step(0);
    assert.equal(interrupted.microExpression,'none');assert.equal(interrupted.microProgress,0);assert.equal(interrupted.gazeOffsetX,0);
    run(controller,12);assert.equal(controller.step(0).microExpression,'none');
    controller.setInput(input('',{phase:'idle'}));assert.ok(run(controller,8).every(pose=>pose.microExpression==='none'));
  }
  const touch=createAvatarPerformance();run(touch,9);touch.react({id:'pet-idle',kind:'pet'});
  assert.equal(touch.step(0).microExpression,'none');assert.equal(touch.step(.1).gesture,'tilt');
});

test('idle soft smile never contaminates the next reply or changes text and PCM mouth timing',()=>{
  for(const external of [false,true]){
    const idle=createAvatarPerformance(),fresh=createAvatarPerformance();
    let smile=null;
    for(let frame=0;frame<2400;frame++){
      const pose=idle.step(.025);
      if(pose.microExpression==='softSmile'&&pose.smileAmount>.18){smile=pose;break;}
    }
    assert.ok(smile);
    const next=input('a你好，继续。',external?{speech:{active:true,charIndex:0,audioLevel:.5}}:{});
    idle.setInput(next);fresh.setInput(next);
    assert.equal(idle.step(0).smileAmount,fresh.step(0).smileAmount,'the idle overlay is removed, not eased into the next reply');
    for(let frame=0;frame<60;frame++)assert.deepEqual(mouth(idle.step(.025)),mouth(fresh.step(.025)));
  }
});

test('hidden, reduced motion and real sleep suppress microacting without catch-up on return',()=>{
  for(const option of ['hidden','reducedMotion','sleeping']){
    const controller=createAvatarPerformance();run(controller,9);
    assert.equal(controller.step(0,{[option]:true}).microExpression,'none');
    assert.ok(run(controller,30,{[option]:true}).every(pose=>pose.microExpression==='none'));
    assert.ok(run(controller,8).every(pose=>pose.microExpression==='none'));
    assert.notEqual(run(controller,.7).at(-1).microExpression,'none');
  }
});

test('sleep clears all active motion and articulation, consumes sleeping input and does not replay after wake',()=>{
  const controller=createAvatarPerformance();controller.setInput(input('我有一点犹豫。'));run(controller,.4);
  const sleeping=controller.step(0,{sleeping:true});assert.equal(sleeping.gesture,'none');assert.equal(sleeping.shoulderLift,0);assert.equal(sleeping.microExpression,'none');assert.deepEqual(mouth(sleeping),{open:0,shape:'rest',speaking:false});
  controller.setInput(input('我有一点犹豫。后来很开心。'));
  assert.equal(controller.react({id:'asleep-pet',kind:'pet'}),false);
  controller.step(3,{sleeping:true});controller.step(.1);controller.setInput(input('我有一点犹豫。后来很开心。'));
  const awake=controller.step(.1);assert.equal(awake.gesture,'none');assert.equal(awake.mouthOpen,0);
  assert.equal(controller.react({id:'asleep-pet',kind:'pet'}),false);
});

test('independent head pets alternate gently after cooldown while the first and negative response stay unchanged',()=>{
  const controller=createAvatarPerformance();controller.react({id:'first',kind:'pet'});
  const first=run(controller,.4).at(-1);assert.equal(first.expression,'happy');assert.equal(first.gesture,'tilt');
  run(controller,3);controller.react({id:'second',kind:'pet'});
  const second=run(controller,.6).at(-1);assert.equal(second.expression,'tender');assert.equal(second.gesture,'sway');assert.ok(second.tenderAmount>.6);
  assert.equal(controller.react({id:'second',kind:'pet'}),false);
  run(controller,3);controller.setInput(input('我也会觉得委屈。'));run(controller,3);
  controller.setInput(input('我也会觉得委屈。',{utteranceId:'fresh-hurt'}));run(controller,.2);controller.react({id:'gentle',kind:'pet'});
  assert.equal(controller.step(.1).expression,'aggrieved');assert.ok(controller.step(.1).smileAmount<.00001,'the old smile only has a negligible smoothing remainder');
});
