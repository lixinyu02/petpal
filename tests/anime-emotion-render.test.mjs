import test from 'node:test';
import assert from 'node:assert/strict';
import { animeEmotionMix } from '../src/avatar/anime-emotion-render.mjs';
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

test('emotion visual mapping leaves PCM mouth articulation inputs untouched and never drives it', () => {
  const pose={sadAmount:.9,tearAmount:.8,mouthOpen:.6,mouthShape:'O',voiceEnergy:.7};
  const original=structuredClone(pose),result=animeEmotionMix(pose);
  assert.deepEqual(pose,original);assert.equal('mouthOpen' in result,false);assert.equal('mouthShape' in result,false);
  assert.deepEqual(animeEmotionMix({...pose,mouthOpen:0}),result);
});

test('sleep is quiet and every externally supplied channel remains finite and bounded', () => {
  const loud={sadAmount:1,downcastAmount:1,excitedAmount:1,shyAmount:1,eyeSmile:1,tearAmount:1,voiceEnergy:1,blinkLeft:0,blinkRight:0,smileAmount:1,blush:1};
  assert.deepEqual(animeEmotionMix(loud,{sleeping:true}),{sadness:0,downcast:0,blinkLeft:1,blinkRight:1,smile:0,blush:0,shy:0,tears:0,sparkle:0});
  for(const value of [undefined,NaN,Infinity,-100,100]){
    const result=animeEmotionMix(Object.fromEntries(Object.keys(loud).map(key=>[key,value])));
    for(const output of Object.values(result))assert.ok(Number.isFinite(output)&&output>=0&&output<=1);
  }
});
