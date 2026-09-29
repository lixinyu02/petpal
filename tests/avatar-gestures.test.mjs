import test from 'node:test';
import assert from 'node:assert/strict';
import { createAvatarGestures, gestureAtSpeechBoundary as cue } from '../src/avatar/gestures.mjs';

const channels=['bodyLean','bodyLift','bodyTurn','headShake','headTilt','headNod'];
const run=(controller,seconds,options)=>Array.from({length:Math.ceil(seconds/.025)},()=>controller.step(.025,options));

test('dialogue selects seven intentional motions and leaves descriptions and neutral text still',()=>{
  for(const [text,gesture]of [['好的，我明白了。','nod'],['不行，不能这样做。','shake'],['为什么会这样呢？','tilt'],['你这么夸我，我有点害羞。','shy'],['太好了，今天真的很开心。','bounce'],['哇，真没想到！','recoil'],['终于松了一口气，现在安心了。','settle']])assert.equal(cue(text,text.length-1)?.gesture,gesture,text);
  for(const text of ['这是一段普通说明。','我不开心。','不要伤心，慢慢来。','列举点头和摇头动作。','表情有得意、鼓腮、安心、认真。'])assert.equal(cue(text,text.length-1),null,text);
  assert.equal(cue('No, I disagree.',14)?.gesture,'shake');
});

test('playback never borrows future clauses and sentence identifiers stay stable for long streamed text',()=>{
  const text='先说普通内容，我有点害羞。太好了！';
  assert.equal(cue(text,0),null);assert.equal(cue(text,text.indexOf('我有点'))?.gesture,'shy');
  assert.equal(cue(text,text.indexOf('太好了'))?.gesture,'bounce');
  assert.equal(cue('好的，我会去做。',7)?.gesture,'nod');
  assert.equal(cue('好的，不过换个话题。',7),null);
  const long='我很开心'+('继续说明'.repeat(1000));
  assert.equal(cue(long,0)?.sentenceStart,0);
  assert.equal(cue(long+'，真的很开心。',long.length+4)?.sentenceStart,0);
  for(const index of [-1,NaN,Infinity,text.length])assert.equal(cue(text,index),null);
});

test('every motion has a smooth onset, readable hold and finite return without looping',()=>{
  for(const gesture of ['nod','shake','tilt','shy','bounce','recoil','settle']){
    const controller=createAvatarGestures();assert.equal(controller.trigger('one',gesture),true);
    const frames=run(controller,3);
    assert.ok(frames.some(frame=>channels.some(key=>Math.abs(frame[key])>.1)),gesture);
    const active=frames.filter(frame=>frame.gesture!=='none');
    assert.ok(active.every((frame,index)=>index===0||frame.gestureProgress>active[index-1].gestureProgress));
    assert.ok(channels.every(key=>Math.abs(active[0][key])<.02),`${gesture} starts gently`);
    assert.ok(channels.every(key=>Math.abs(active.at(-1)[key])<.015),`${gesture} returns gently`);
    assert.ok(frames.slice(-20).every(frame=>frame.gesture==='none'&&channels.every(key=>frame[key]===0)),gesture);
    for(const frame of frames)for(const key of channels)assert.ok(Number.isFinite(frame[key])&&Math.abs(frame[key])<=1,`${gesture}.${key}`);
  }
});

test('sentence ids and cooldown consume repeats without deferring a second action',()=>{
  const controller=createAvatarGestures();assert.equal(controller.trigger('first','nod'),true);
  run(controller,.3);assert.equal(controller.trigger('first','bounce'),false);
  assert.equal(controller.trigger('second','shy'),false,'active movement consumes new cue');
  run(controller,.9);assert.equal(controller.trigger('third','tilt'),false,'cooldown still active after motion');
  assert.ok(run(controller,2).every(frame=>frame.gesture==='none'));
  assert.equal(controller.trigger('second','shy'),false);assert.equal(controller.trigger('third','tilt'),false);
  assert.equal(controller.trigger('fourth','tilt'),true);
});

test('blocked, cancelled and reset actions never replay, including cues received while blocked',()=>{
  for(const method of ['blocked','cancel','reset']){
    const controller=createAvatarGestures();controller.trigger('active','bounce');run(controller,.35);
    if(method==='blocked')controller.step(0,{blocked:true});else controller[method]();
    const stopped=controller.step(0);assert.equal(stopped.gesture,'none');assert.ok(channels.every(key=>stopped[key]===0));
    assert.equal(controller.trigger('active','bounce'),false);
    assert.equal(controller.trigger('suppressed','nod',false),false);
    run(controller,3);assert.equal(controller.trigger('suppressed','nod'),false);
    assert.ok(run(controller,1).every(frame=>frame.gesture==='none'));
  }
});

test('a covered window at one frame per second cannot stretch motion or cooldown lifetimes',()=>{
  for(const gesture of ['nod','shake','tilt','shy','bounce','recoil','settle']){
    const slow=createAvatarGestures();slow.trigger('one',gesture);
    const first=slow.step(1);assert.ok(first.gestureProgress>.5,gesture);
    const ended=slow.step(1);assert.equal(ended.gesture,'none',gesture);
    assert.ok(channels.every(key=>ended[key]===0));
    slow.step(.6);assert.equal(slow.trigger('next','nod'),true,'cooldown also follows wall time');
  }
  const stalled=createAvatarGestures();stalled.trigger('stalled','shy');
  assert.equal(stalled.step(10).gesture,'none','long gaps discard the finished motion');
  assert.equal(stalled.trigger('stalled','shy'),false,'discarding is not permission to replay');
});

test('six new intentions use natural clauses and do not perform denied or descriptive actions',()=>{
  for(const [text,gesture]of [['我在认真听你说。','leanIn'],['我有一点犹豫，还没想好呢。','shrug'],['真的很感谢你一直陪着我。','bow'],['让我偷偷看一眼。','peek'],['我会温柔地陪着你。','sway'],['我有点犯困了。','doze']])assert.equal(cue(text,text.length-1)?.gesture,gesture,text);
  for(const text of ['我不想偷偷看。','我不会看一眼。','别鞠躬。','列举鞠躬动作。','表情有期待、温柔、犹豫。'])assert.equal(cue(text,text.length-1),null,text);
  const text='这是普通内容，我会温柔地陪着你。';assert.equal(cue(text,0),null);assert.equal(cue(text,text.indexOf('我会'))?.gesture,'sway');
});

test('new motions remain distinguishable, phone-readable, bounded and wall-clock limited',()=>{
  const poses={};
  for(const gesture of ['leanIn','shrug','bow','peek','sway','doze']){
    const controller=createAvatarGestures();controller.trigger(gesture,gesture);poses[gesture]=controller.step(.6);
    const frames=run(controller,3);
    assert.equal(frames.at(-1).gesture,'none');
    for(const pose of [poses[gesture],...frames]){
      for(const key of [...channels,'shoulderLift'])assert.ok(Number.isFinite(pose[key])&&Math.abs(pose[key])<=1,`${gesture}.${key}`);
      assert.ok(pose.shoulderLift>=0);
    }
    assert.equal(controller.trigger(gesture,gesture),false);
    controller.trigger(`${gesture}-next`,gesture);assert.equal(controller.step(3).gesture,'none');
  }
  assert.ok(poses.leanIn.bodyLean>.6);assert.ok(poses.shrug.shoulderLift>.65);
  assert.ok(poses.bow.headNod>.6);assert.ok(poses.peek.bodyTurn>.5);
  assert.ok(Math.abs(poses.sway.bodyTurn)>.4);assert.ok(poses.doze.headNod>.6);
  const old=createAvatarGestures();old.trigger('old','nod');assert.equal(old.step(.3).shoulderLift,0);
});
