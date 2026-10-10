import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultWakeSettings, normalizeWakeSettings, matchWakePhrase} from '../server/voice-wake.mjs';
import {patchVoiceSettings, publicVoiceSettings} from '../server/voice.mjs';

test('legacy accounts get independent disabled wake settings; partial account patches persist and redact',()=>{
  const old={tts:{apiKey:'private-key'}};
  assert.deepEqual(publicVoiceSettings(old).wake,defaultWakeSettings());
  const saved=patchVoiceSettings(old,{wake:{enabled:true,phrases:['小伴','小 伴','HEY CAT'],extra:'private-extra'},userId:'another'});
  assert.deepEqual(saved.wake,{enabled:true,phrases:['小伴','HEY CAT'],idleTimeoutSeconds:45});
  const changed=patchVoiceSettings(saved,{wake:{idleTimeoutSeconds:60}});
  assert.equal(changed.wake.idleTimeoutSeconds,60);assert.equal(saved.wake.idleTimeoutSeconds,45);
  changed.wake.phrases.push('新的词');assert.equal(saved.wake.phrases.length,2);
  assert.equal(old.wake,undefined);assert.equal(JSON.stringify(publicVoiceSettings(saved)).includes('private'),false);
  assert.equal(publicVoiceSettings(saved).wake.extra,undefined);
});

test('wake settings reject unbounded, empty enabled, control characters and invalid types atomically',()=>{
  const bad=value=>assert.throws(()=>normalizeWakeSettings(value),error=>error.status===400);
  for(const value of [null,[],true,'wake',1])bad(value);
  for(const enabled of [null,'true',1])bad({enabled});
  for(const phrases of [null,'小伴',[null],[''],['啊'],['!!!'],['x'.repeat(41)],['小伴\n'],['😀😀'],Array(6).fill('小伴')])bad({phrases});
  for(const idleTimeoutSeconds of [null,'45',NaN,Infinity,14,301,15.5])bad({idleTimeoutSeconds});
  bad({enabled:true,phrases:[]});assert.deepEqual(normalizeWakeSettings({phrases:[]}).phrases,[]);
  const previous=patchVoiceSettings(null,{wake:{enabled:true}}),snapshot=structuredClone(previous);
  assert.throws(()=>patchVoiceSettings(previous,{tts:{voice:'changed'},wake:{phrases:[]}}));
  assert.deepEqual(previous,snapshot);
});

test('final phrase matcher uses sentence prefix, longest alias and original question offsets',()=>{
  const phrases=['小伴','你好','你好小伴','Hey Cat','cat','café','office'];
  for(const [text,phrase,question]of [
    ['「你好，小 伴！」','你好小伴',''],['你好小伴，帮我播放音乐。','你好小伴','帮我播放音乐。'],
    ['  ＨＥＹ ＣＡＴ: Play A Song!','Hey Cat','Play A Song!'],['CAT，播放音乐','cat','播放音乐'],
    ['cafe\u0301: Où est Paris?','café','Où est Paris?'],['oﬃce: keep ORIGINAL casing','office','keep ORIGINAL casing'],
  ])assert.deepEqual(matchWakePhrase(text,phrases),{phrase,text:question});
  for(const text of ['朋友叫小伴','我想说你好小伴','catch me','Hey Caterpillar','你好呀小伴'])assert.equal(matchWakePhrase(text,['你好小伴','小伴','cat','Hey Cat']),null,text);
  assert.ok(matchWakePhrase('你好小伴'.repeat(3001),['你好小伴'])===null);
  assert.equal(matchWakePhrase('cat play music',['cat']).text,'play music');
  assert.equal(matchWakePhrase('😀小伴',['小伴']),null);
  assert.equal(matchWakePhrase('㎑，播放音乐',['kh']),null);
  assert.equal(matchWakePhrase('㍿，播放音乐',['株式']),null);
  assert.deepEqual(matchWakePhrase('㎑，播放音乐',['khz']),{phrase:'khz',text:'播放音乐'});
  assert.deepEqual(matchWakePhrase('㍿，播放音乐',['株式会社']),{phrase:'株式会社',text:'播放音乐'});
  assert.deepEqual(matchWakePhrase('한글，播放音乐',['한글']),{phrase:'한글',text:'播放音乐'});
});
