import test from 'node:test';
import assert from 'node:assert/strict';
import { animeEmotionMix, animeMouthLayerMix } from '../src/avatar/anime-emotion-render.mjs';
import { createAvatarPerformance } from '../src/avatar/performance.mjs';

test('actual dialogue poses keep downcast visibly gentler than sadness after combining both channels',()=>{
  const rendered=text=>{const controller=createAvatarPerformance();controller.setInput({utteranceId:text,text,phase:'speaking',speech:{active:true,charIndex:0,audioLevel:0}});let pose;for(let i=0;i<30;i++)pose=controller.step(1/30);return animeEmotionMix(pose);};
  const sad=rendered('我很伤心。'),downcast=rendered('我有点难过。');
  assert.ok(sad.sadness-downcast.sadness>.3,'combined channels must not collapse the two expressions');
  assert.ok(sad.tears>downcast.tears*5);
});

test('both renderers receive distinct happy, sad, downcast, excited and shy facial mixes', () => {
  const happy=animeEmotionMix({eyeSmile:.9,smileAmount:.8});
  const sad=animeEmotionMix({sadAmount:.9,tearAmount:.8});
  const downcast=animeEmotionMix({downcastAmount:.9,tearAmount:.12});
  const excited=animeEmotionMix({excitedAmount:.9,eyeSmile:.27,voiceEnergy:.7});
  const shy=animeEmotionMix({shyAmount:.9,blush:.75,eyeSmile:.16});
  assert.equal(happy.blinkLeft,1);assert.equal(happy.blinkRight,1);assert.equal(happy.smile,.8);
  assert.ok(sad.sadness>downcast.sadness+.3);assert.ok(sad.tears>downcast.tears*5);
  assert.ok(excited.sparkle>.6);assert.ok(excited.blinkLeft<.1);
  assert.ok(shy.blush>.9);assert.equal(shy.shy,.9);assert.equal(shy.blinkLeft,0);
  assert.equal(new Set([happy,sad,downcast,excited,shy].map(value=>JSON.stringify(value))).size,5);
});

test('negative semantics suppress smiling eye layers, and blink hides excitement glints', () => {
  const sad=animeEmotionMix({sadAmount:1,eyeSmile:1,smileAmount:1});
  assert.equal(sad.blinkLeft,0);assert.equal(sad.smile,0);
  const blink=animeEmotionMix({blinkLeft:1,excitedAmount:1,voiceEnergy:1});
  assert.equal(blink.blinkLeft,1);assert.equal(blink.sparkle,0);
});

test('a real gentle touch holds opaque smiling eyelids without closing the shy expression',()=>{
  const controller=createAvatarPerformance();
  controller.react({id:'gentle-touch',kind:'pet'});
  const poses=Array.from({length:80},()=>controller.step(.025));
  assert.ok(Math.max(...poses.map(pose=>pose.eyeSmile))<=.62,'use the real touch strength, not a full-strength dialogue');
  const closed=poses.map(pose=>animeEmotionMix(pose)).filter(face=>face.blinkLeft===1&&face.blinkRight===1);
  assert.ok(closed.length>=10,'touch must hold fully opaque lids for at least 250ms instead of staying double-exposed');
  const shy=animeEmotionMix({shyAmount:1,eyeSmile:.18});
  assert.equal(shy.blinkLeft,0);assert.equal(shy.blinkRight,0);
});

test('smug, pout, relief and determination have distinct facial cues without driving articulation', () => {
  const smug=animeEmotionMix({smugAmount:1});
  const pout=animeEmotionMix({poutAmount:1,eyeSmile:1,smileAmount:1});
  const relieved=animeEmotionMix({reliefAmount:1});
  const determined=animeEmotionMix({determinedAmount:1});
  assert.ok(smug.eyeSquintLeft>smug.eyeSquintRight,'smug expression has an asymmetric half-eye');
  assert.ok(smug.browLeftLift>0&&smug.browRightLift<0,'smug expression lifts only one brow');
  assert.equal(pout.pout,1);assert.equal(pout.smile,0);assert.equal(pout.blinkLeft,0);
  assert.ok(relieved.smile>0&&relieved.eyeSquintLeft>0);assert.equal(relieved.browFocus,0);
  assert.equal(determined.eyeSquintLeft,determined.eyeSquintRight);
  assert.ok(determined.browFocus>0&&determined.browLeftLift<0&&determined.browRightLift<0);
  assert.equal(new Set([smug,pout,relieved,determined].map(value=>JSON.stringify(value))).size,4);
  for(const expression of [smug,pout,relieved,determined])assert.equal('mouthOpen' in expression,false);
});

test('negative expressions suppress incompatible smug and relieved layers during transitions', () => {
  for(const channel of ['sadAmount','downcastAmount','poutAmount']){
    const mixed=animeEmotionMix({[channel]:1,smugAmount:1,reliefAmount:1,smileAmount:1,eyeSmile:1});
    assert.equal(mixed.smug,0);assert.equal(mixed.relief,0);assert.equal(mixed.smile,0);
    assert.equal(mixed.blinkLeft,0);
  }
  const focused=animeEmotionMix({determinedAmount:1,smugAmount:1,reliefAmount:1});
  assert.ok(focused.smug<.16&&focused.relief<.16);
});

test('emotion visual mapping leaves PCM mouth articulation inputs untouched and never drives it', () => {
  const pose={sadAmount:.9,tearAmount:.8,mouthOpen:.6,mouthShape:'O',voiceEnergy:.7};
  const original=structuredClone(pose),result=animeEmotionMix(pose);
  assert.deepEqual(pose,original);assert.equal('mouthOpen' in result,false);assert.equal('mouthShape' in result,false);
  assert.deepEqual(animeEmotionMix({...pose,mouthOpen:0}),result);
});

test('DOM speech shapes crossfade without leaking the closed expression beneath the lips',()=>{
  for(const opacity of [0,.25,.5,.75,1])for(const roundness of [0,.25,.5,.75,1]){
    const layers=animeMouthLayerMix(opacity,roundness);
    const closedContribution=(1-layers.talk)*(1-layers.round);
    const talkContribution=layers.talk*(1-layers.round);
    assert.ok(Math.abs(closedContribution-(1-opacity))<1e-10);
    assert.ok(Math.abs(talkContribution-opacity*(1-roundness))<1e-10);
    assert.ok(Math.abs(layers.round-opacity*roundness)<1e-10);
    assert.ok(layers.talk>=0&&layers.talk<=1&&layers.round>=0&&layers.round<=1);
  }
  assert.deepEqual(animeMouthLayerMix(1,.5),{talk:1,round:.5});
  assert.deepEqual(animeMouthLayerMix(NaN,Infinity),{talk:0,round:0});
});

test('sleep is quiet and every externally supplied channel remains finite and bounded', () => {
  const loud={sadAmount:1,downcastAmount:1,excitedAmount:1,shyAmount:1,eyeSmile:1,tearAmount:1,voiceEnergy:1,blinkLeft:0,blinkRight:0,smileAmount:1,blush:1,smugAmount:1,poutAmount:1,reliefAmount:1,determinedAmount:1};
  const asleep=animeEmotionMix(loud,{sleeping:true});
  for(const [key,value] of Object.entries(asleep))assert.equal(value,key==='blinkLeft'||key==='blinkRight'?1:0,`sleep clears ${key}`);
  for(const value of [undefined,NaN,Infinity,-100,100]){
    const result=animeEmotionMix(Object.fromEntries(Object.keys(loud).map(key=>[key,value])));
    for(const [key,output] of Object.entries(result)){
      const lower=key==='browLeftLift'||key==='browRightLift'?-1:0;
      assert.ok(Number.isFinite(output)&&output>=lower&&output<=1,`${key} stays bounded`);
    }
  }
});
