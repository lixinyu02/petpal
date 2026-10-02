import test from 'node:test';
import assert from 'node:assert/strict';
import { detectAvatarEmotion as emotion, emotionAtSpeechBoundary as at } from '../src/avatar/emotion.mjs';
import { createAvatarPerformance } from '../src/avatar/performance.mjs';

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

test('Galgame cues distinguish small pride, pouting, relief and determination without performing negations',()=>{
  for(const [text,kind]of [['嘿嘿，我有一点小得意，我厉害吧。','smug'],['哼，我有点气鼓鼓，不理你了。','pout'],['终于松了一口气，现在安心了。','relieved'],['我会认真做好这件事，交给我吧。','determined'],['I feel relieved.','relieved'],['I am determined.','determined'],['I am smug.','smug'],['I am pouting.','pout']])assert.equal(emotion(text),kind,text);
  for(const [text,kind]of [['我不得意。','smug'],['别得意。','smug'],['我没有鼓腮。','pout'],['我不安心。','relieved'],['我并不认真。','determined'],['I am not relieved.','relieved'],['I am not determined.','determined']])assert.notEqual(emotion(text),kind,text);
  for(const text of ['得意、鼓腮、安心、认真。','支持得意和鼓腮两种表情。','“安心”这个词是什么意思？'])assert.equal(emotion(text),null,text);
  const text='先看看情况，现在安心了，终于可以休息。接下来是普通说明。';
  assert.equal(at(text,0),null);assert.equal(at(text,text.indexOf('现在')),'relieved');assert.equal(at(text,text.indexOf('终于')),'relieved');assert.equal(at(text,text.indexOf('接下来')),null);
});

test('hesitation, sleepiness, expectation, hurt feelings and tenderness stay distinct and conservative',()=>{
  for(const [text,kind]of [['嗯，我有一点犹豫。','hesitant'],['我还没想好呢。','hesitant'],['我有点困了。','sleepy'],['我有点犯困了。','sleepy'],['我很期待听你讲下去。','expectant'],['我也会觉得委屈。','aggrieved'],['我会温柔地陪着你。','tender'],['I feel hesitant.','hesitant'],['I feel drowsy.','sleepy'],['I am looking forward to it.','expectant'],['I feel wronged.','aggrieved'],['I feel tender.','tender']])assert.equal(emotion(text),kind,text);
  for(const [text,kind]of [['我没有犹豫。','hesitant'],['不要犹豫。','hesitant'],['我不困了。','sleepy'],['我不期待。','expectant'],['我没有觉得委屈。','aggrieved'],['我并不温柔。','tender'],['I am not sleepy.','sleepy'],['I am not hesitant.','hesitant']])assert.notEqual(emotion(text),kind,text);
  assert.equal(emotion('别委屈，我会听你说。'),'concerned');
  for(const text of ['犹豫、困倦、期待、委屈、温柔。','“犹豫”这个词是什么意思？','支持期待和温柔两种表情。'])assert.equal(emotion(text),null,text);
  const text='先听我说，现在有一点犹豫，还没想好呢。但是接下来说普通内容。';
  assert.equal(at(text,0),null);assert.equal(at(text,text.indexOf('现在')),'hesitant');assert.equal(at(text,text.indexOf('还没')),'hesitant');assert.equal(at(text,text.indexOf('但是')),null);
});

test('literal surprise cues describe a reaction without acting out negations or someone else\'s feelings',()=>{
  for(const text of ['我很惊讶。','我现在有点吃惊。','我也感到意外。','这个结果让我很惊讶。','真让人吃惊。','有些意外呢。','I am surprised.','I feel very surprised.','哇，居然是这样！'])assert.equal(emotion(text),'surprised',text);
  for(const text of ['我不惊讶。','我一点都不吃惊。','我没有感到意外。','不要惊讶。','我并非很惊讶。','I am not surprised.','I am not at all surprised.','你很惊讶吗？','你可能会感到吃惊。','她觉得很意外。','小明很惊讶。','They are surprised.','I am surprised or not?'])assert.notEqual(emotion(text),'surprised',text);
});

test('surprise descriptions, emotion menus and accidental failures stay factual',()=>{
  for(const text of ['支持害羞和惊讶两种表情。','“吃惊”这个词是什么意思？','惊讶、开心、安心。','这只是一起意外事故。','意外退出了。','意外中断已经恢复。','我感到意外故障仍未排除。'])assert.equal(emotion(text),null,text);
  const menu='表情包括害羞，惊讶，安心。';
  for(const word of ['害羞','惊讶','安心'])assert.equal(at(menu,menu.indexOf(word)),null,word);
});

test('surprise follows spoken clauses and clears on explicit denial before a later relieved expression',()=>{
  const text='先看看结果，我很惊讶，刚才完全没准备，但现在已经不惊讶了，继续检查。终于安心了。';
  assert.equal(at(text,0),null);
  assert.equal(at(text,text.indexOf('我很')),'surprised');
  assert.equal(at(text,text.indexOf('刚才')),'surprised');
  assert.equal(at(text,text.indexOf('但现在')),null);
  assert.equal(at(text,text.indexOf('继续')),null);
  assert.equal(at(text,text.indexOf('终于')),'relieved');
  assert.equal(emotion('我有点伤心，这让我很惊讶。'),'sad','existing negative priority remains intact');
});

test('literal surprise drives the face during speech while upstream voice metadata remains authoritative',()=>{
  for(const [metadata,expected]of [[null,'surprised'],[{emotion:'neutral',intensity:'natural',source:'manual'},'neutral'],[{emotion:'sad',intensity:'natural',source:'rules'},'sad'],[{emotion:'gentle',intensity:'natural',source:'choice'},'tender']]){
    const controller=createAvatarPerformance();
    controller.setInput({utteranceId:'literal-surprise',phase:'speaking',text:'我现在很惊讶。',speech:{active:true,charIndex:0,audioLevel:.6,...(metadata?{emotion:metadata}:{})}});
    const pose=controller.step(.25);
    assert.equal(pose.expression,expected);
    assert.ok(pose.mouthOpen>0,'the emotional face does not prevent active speech');
    if(metadata)assert.equal(pose.surpriseAmount,0,'text cannot replace explicit voice metadata');
    else assert.ok(pose.surpriseAmount>.5);
  }
});
