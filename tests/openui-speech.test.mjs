import test from 'node:test';
import assert from 'node:assert/strict';
import {markdownSpeechText,markdownSafeCuts} from '../src/voice/markdown-speech.mjs';
import {createSentenceSplitter} from '../src/voice/speech-flow.mjs';

const dsl='root = Panel("不应朗读DSL", [Text("代码中的```和~~~；以及句号。"), Button("加入输入框", @UseInPrompt("继续"))])';
function stream(source,size=3,max=40) {
  const splitter=createSentenceSplitter(max),pieces=[];
  for(let i=0;i<source.length;i+=size)pieces.push(...splitter.push(source.slice(i,i+size)));
  pieces.push(...splitter.finish());
  assert.ok(pieces.every(piece=>piece.length<=max));
  return pieces.join('');
}

test('manual speech excludes complete and truncated OpenUI while retaining surrounding prose and ordinary code',()=>{
  for(const fence of ['```','~~~','````']) {
    assert.equal(markdownSpeechText(`先填写下面的要求。\n${fence}openui\n${dsl}\n${fence}\n然后确认发送。`),'先填写下面的要求。\n\n然后确认发送。');
    assert.equal(markdownSpeechText(`先填写下面的要求。\n${fence}openui\n${dsl}`),'先填写下面的要求。');
  }
  assert.equal(markdownSpeechText('```js\nconst answer = 5;\n```'),'const answer = 5;');
  assert.equal(markdownSpeechText('行内 `root = Panel()` 示例'),'行内 root = Panel() 示例');
  assert.equal(markdownSpeechText('- 示例\n  ```openui\n  '+dsl+'\n  ```'),'示例');
  assert.equal(markdownSpeechText('> ```openui\n> '+dsl+'\n> ```'),'');
});

test('streaming split fences and long OpenUI never leak program text to TTS',()=>{
  for(const fence of ['```','~~~','````'])for(const size of [1,2,3,7,31,400]) {
    const content=`请填写下面的要求，然后继续。\n${fence}openui\n${dsl}\n${fence}\n完成以后我会继续分析。`;
    assert.equal(stream(content,size),'请填写下面的要求，然后继续。完成以后我会继续分析。');
    assert.equal(stream(`请填写下面的要求，然后继续。\n${fence}openui\n${dsl}`,size),'请填写下面的要求，然后继续。');
  }
  const long='root = Panel("长交互", [Text("'+ '内容。'.repeat(2500)+'")])';
  assert.equal(stream(`前面的说明是可以朗读的。\n\`\`\`openui\n${long}\n\`\`\`\n后面的说明也是可以朗读的。`,1000),'前面的说明是可以朗读的。后面的说明也是可以朗读的。');
});

test('delimiter-looking text inside fenced code cannot cut a block; ordinary code is still spoken intact',()=>{
  const prefix='```openui\n'+dsl;
  assert.deepEqual(markdownSafeCuts(prefix),[]);
  // Even a complete-looking end of a chunk must wait for the rest of the line.
  const splitter=createSentenceSplitter(20);
  assert.deepEqual(splitter.push('```openui\n'+dsl+'\n```'),[]);
  assert.deepEqual(splitter.push('still-inside\n'+dsl+'\n```\n'),[]);
  assert.deepEqual(splitter.finish(),[]);
  const ordinary='```js\nconst text = "```不在行首";\nconst answer = 5;\n```\n后续说明。';
  assert.equal(stream(ordinary,1),'const text = "```不在行首";\nconst answer = 5;后续说明。');
});

test('quoted/list examples and CRLF preserve prose after the block during streaming',()=>{
  const examples=[
    '- 示例\n  ```openui\n  '+dsl+'\n  ```',
    '> ```openui\n> '+dsl+'\n> ```',
    '```openui\r\n'+dsl+'\r\n```',
  ];
  for(const example of examples)for(const size of [1,3,19,100]) {
    const spoken=stream('先说明一下这里的内容。\n'+example+'\n然后继续说明。',size,20);
    assert.ok(spoken.startsWith('先说明一下这里的内容。'));
    assert.ok(spoken.endsWith('然后继续说明。'));
    for(const leaked of ['root','Panel','不应朗读','UseInPrompt'])assert.equal(spoken.includes(leaked),false);
  }
});
