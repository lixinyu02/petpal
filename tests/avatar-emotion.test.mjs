import test from 'node:test';
import assert from 'node:assert/strict';
import { detectAvatarEmotion as emotion, emotionAtSpeechBoundary as at } from '../src/avatar/emotion.mjs';

test('five requested emotions have distinct conservative text cues',()=>{
  for(const [text,expected] of [['今天好开心呀。','happy'],['太好了，终于完成了！','happy'],['我真的很伤心，心都碎了。','sad'],['今天有一点难过，感觉很失落。','downcast'],['我好兴奋，已经迫不及待了！','excited'],['被你夸得有点害羞，脸都红了。','shy'],['I am excited!','excited'],['I feel sad.','sad'],['I am shy.','shy']])assert.equal(emotion(text),expected,text);
});

test('negated emotions do not accidentally trigger the corresponding positive or negative cue',()=>{
  for(const text of ['我不开心。','今天不太高兴。','我不是很开心。','I am not happy.','I am not very happy.'])assert.equal(emotion(text),'downcast',text);
  for(const [text,rejected]of [['我不伤心。','sad'],['我不是很伤心。','sad'],['我没有感到难过。','downcast'],['我并不兴奋。','excited'],['我不害羞。','shy'],['I am not excited.','excited'],['I am not very sad.','sad'],["I wasn't happy.",'happy'],['我不是不开心。','downcast'],['我没有不开心。','downcast'],['没有觉得开心。','happy']])assert.notEqual(emotion(text),rejected,text);
  for(const text of ['别难过，我会陪着你。','不要伤心，慢慢来。','不用担心，我陪你。',"Don't be sad, I am here."])assert.equal(emotion(text),'concerned',text);
});

test('emotion lists and descriptive requests are not performed as actual feelings',()=>{
  for(const text of ['开心、伤心、难过、兴奋、害羞。','支持开心和伤心两种表情。','表情可以在开心和难过之间切换。','“伤心”这个词是什么意思？','列举 happy, sad, excited expressions.'])assert.equal(emotion(text),null,text);
  const list='表情有开心，伤心，难过，兴奋和害羞。';
  for(const label of ['开心','伤心','难过','兴奋','害羞'])assert.equal(at(list,list.indexOf(label)),null,label);
});

test('playback cues follow the current sentence or clause, never an unheard later emotion',()=>{
  const text='我有点难过。现在已经很开心了。想到明天就很兴奋！夸得我有点害羞。';
  for(const [word,expected]of [['难过','downcast'],['开心','happy'],['兴奋','excited'],['害羞','shy']])assert.equal(at(text,text.indexOf(word)),expected,word);
  const mixed='有点难过，但现在很开心。';
  assert.equal(at(mixed,0),'downcast');assert.equal(at(mixed,mixed.indexOf('但')),'happy');
  for(const index of [-1,NaN,Infinity,text.length])assert.equal(at(text,index),null);
});

test('a neutral continuation inherits only an earlier cue inside the same sentence',()=>{
  const sad='我很伤心，眼泪快要掉下来了。下一句是普通内容。';
  assert.equal(at(sad,0),'sad');assert.equal(at(sad,sad.indexOf('眼泪')),'sad');assert.equal(at(sad,sad.indexOf('下一句')),null);
  const shy='被你这样夸奖，我有点害羞，脸都红了。';
  assert.equal(at(shy,0),null,'do not borrow the later shy cue before it is spoken');
  assert.equal(at(shy,shy.indexOf('我有点')),'shy');assert.equal(at(shy,shy.indexOf('脸都')),'shy');
  const comfort='别难过，慢慢来，先坐下来休息一会。';
  assert.equal(at(comfort,comfort.indexOf('慢慢')),'concerned');assert.equal(at(comfort,comfort.indexOf('先坐')),'concerned');
});

test('explicit denial or neutral transition clears inherited cues and prevents later carryover',()=>{
  for(const text of ['我很伤心，现在已经不伤心了，继续做事。','我很兴奋，不过先说一下安排，然后继续。','我有点害羞，现在没有这种感觉了，继续聊天。','I am excited, however we should check the schedule, then proceed.']){
    const boundaries=[...text.matchAll(/[，,]/gu)].map(match=>match.index+1);
    for(const index of boundaries)assert.equal(at(text,index),null,`${text} at ${index}`);
  }
  const changed='我很伤心，不过现在很开心，想和你分享一下。';
  assert.equal(at(changed,changed.indexOf('不过')),'happy');assert.equal(at(changed,changed.indexOf('想和')),'happy');
});
