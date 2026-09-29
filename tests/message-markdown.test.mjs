import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { markdownSpeechText } from '../src/voice/markdown-speech.mjs';
import { createSentenceSplitter, createSpeechQueue } from '../src/voice/speech-flow.mjs';

const bundle=await build({entryPoints:[fileURLToPath(new URL('../src/MessageMarkdown.tsx',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node',loader:{'.css':'empty'}});
const {default:MessageMarkdown,safeMarkdownUrl}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const render=(content,compact=false)=>renderToStaticMarkup(createElement(MessageMarkdown,{content,compact}));

test('replies render common Markdown and GFM semantic elements without showing formatting delimiters',()=>{
  const html=render('# 标题\n\n二加三等于 **5**，*正确*。\n\n- 第一项\n- 第二项\n\n1. 顺序项\n\n> 引用\n\n`inline`\n\n```js\nconst answer = 5;\n```\n\n| 名称 | 值 |\n| --- | --- |\n| 结果 | 5 |\n\n- [x] 完成',true);
  for(const fragment of ['<h1>标题</h1>','<strong>5</strong>','<em>正确</em>','<ul>','<ol>','<blockquote>','<code>inline</code>','<pre>','<table>','type="checkbox"','disabled=""','message-markdown-compact'])assert.ok(html.includes(fragment),fragment);
  assert.equal(html.includes('**5**'),false);assert.equal(html.includes('```'),false);
});

test('unsafe links, raw HTML, scripts, event handlers and tracking images cannot become active content',()=>{
  const html=render('[危险](javascript:alert%281%29)\n\n[数据](data:text/html;base64,YQ==)\n\n<script>alert("x")</script>\n\n<img src="https://tracker.example/pixel" onerror="alert(1)">\n\n![参考图](https://tracker.example/image.png)\n\n<div onclick="alert(2)">隐藏容器</div>');
  for(const forbidden of ['<script','<img','onerror=','onclick=','href="javascript:','href="data:','src=','tracker.example'])assert.equal(html.includes(forbidden),false,forbidden);
  assert.ok(html.includes('图片：参考图'));
  for(const url of ['javascript:alert(1)','JAVASCRIPT:alert(1)','data:text/html,hi','vbscript:msgbox(1)','file:///etc/passwd','intent://open','java\nscript:alert(1)'])assert.equal(safeMarkdownUrl(url),'',url);
});

test('safe links preserve their labels and open with opener/referrer protection',()=>{
  const html=render('[查看文档](https://example.com/a?q=1&b=2) 与 [站内](/?chat=1)');
  assert.ok(html.includes('href="https://example.com/a?q=1&amp;b=2"'));assert.ok(html.includes('target="_blank"'));assert.ok(html.includes('rel="noopener noreferrer"'));assert.ok(html.includes('>查看文档</a>'));
  assert.equal(safeMarkdownUrl('https://example.com'),'https://example.com');
  assert.equal(safeMarkdownUrl('/?chat=1'),'/?chat=1');
});

test('partial streamed Markdown renders safely until delimiters finish and component is memoized',()=>{
  for(const content of ['二加三等于 **','二加三等于 **5','二加三等于 **5**。','[链接](https://example','```js\nalert("hi")'])assert.doesNotThrow(()=>render(content));
  assert.equal(MessageMarkdown.$$typeof,Symbol.for('react.memo'));
});

test('manual TTS extracts content instead of Markdown markers, link URLs and raw HTML',()=>{
  const text=markdownSpeechText('# 标题\n\n二加三等于 **5**。*温柔一点*\n\n- 第一项\n- 第二项\n\n[查看文档](https://example.com/private?token=secret)\n\n`inline`\n\n```js\nconst answer = 5;\n```\n\n<script>不应朗读</script>');
  for(const wanted of ['标题','二加三等于 5。温柔一点','第一项','第二项','查看文档','inline','const answer = 5;'])assert.ok(text.includes(wanted),wanted);
  for(const unwanted of ['**','```','# ','- ','https://','token=','不应朗读'])assert.equal(text.includes(unwanted),false,unwanted);
  assert.equal(markdownSpeechText('some_key 与 2 * 3'),'some_key 与 2 * 3');
  assert.equal(markdownSpeechText('二加三等于 **5**。'),'二加三等于 5。');
  assert.equal(markdownSpeechText(markdownSpeechText('some_key 与 2 * 3')),'some_key 与 2 * 3');
  assert.equal(markdownSpeechText('10**2 与 some__key 与 2 * 3'),'10**2 与 some__key 与 2 * 3');
  assert.equal(markdownSpeechText('\\*文字\\* 与 `**literal**` 与 `[label](https://example.com)`'),'*文字* 与 **literal** 与 [label](https://example.com)');
});

test('streamed speech cleans split formatting and never exposes protected link destinations',()=>{
  const splitter=createSentenceSplitter(40),pieces=[];
  for(const delta of ['二加三等于 **','5','**。你可以查看 [','说明文档',' ](https://example.com/a?','token=secret&b=1)。这是一段追加文字。'])pieces.push(...splitter.push(delta));
  pieces.push(...splitter.finish());const text=pieces.join('');
  assert.ok(text.includes('二加三等于 5。'));assert.ok(text.includes('说明文档'));assert.ok(text.includes('这是一段追加文字。'));
  for(const mark of ['**','[',']','https://','secret','token='])assert.equal(text.includes(mark),false,mark);
  assert.ok(pieces.every(piece=>piece.length<=40));
});

test('long inline code/links are bounded after extraction; fenced language markers are never spoken',()=>{
  const splitter=createSentenceSplitter(20),pieces=[];
  const text='请看 `'+ '代码'.repeat(30)+'`。\n```typescript\nconst answer = 5;\n```\n以及 [链接](https://example.com/?token=private)。';
  for(let i=0;i<text.length;i+=3)pieces.push(...splitter.push(text.slice(i,i+3)));
  pieces.push(...splitter.finish());assert.ok(pieces.every(piece=>piece.length<=20));
  const spoken=pieces.join('');assert.ok(spoken.includes('const answer = 5;'));assert.ok(spoken.includes('链接'));
  for(const unwanted of ['`','typescript','https://','private'])assert.equal(spoken.includes(unwanted),false,unwanted);
});

test('streamed emphasis waits for its closing delimiter without deleting literal operators or identifiers',()=>{
  const splitter=createSentenceSplitter(20);
  assert.deepEqual(splitter.push('**这是一句需要等待强调标记闭合的文字。'),[]);
  assert.deepEqual(splitter.push('**'),['这是一句需要等待强调标记闭合的文字。']);
  assert.deepEqual(splitter.finish(),[]);
  const plain=createSentenceSplitter(20),pieces=[];
  for(const chunk of ['计算 10**','2，变量 some__','key；','代码 `**literal**`。'])pieces.push(...plain.push(chunk));
  pieces.push(...plain.finish());const spoken=pieces.join('');
  assert.ok(spoken.includes('10**2'));assert.ok(spoken.includes('some__key'));assert.ok(spoken.includes('**literal**'));
  const unfinished=createSentenceSplitter();assert.deepEqual(unfinished.push('**未闭合的字面文本'),[]);assert.deepEqual(unfinished.finish(),['**未闭合的字面文本']);
});

test('180-character streaming pieces preserve emphasis across sentences and keep extracted inline code literal through playback queue',async()=>{
  const bold='粗体跨句子。'.repeat(40),splitter=createSentenceSplitter(180),pieces=[];
  for(const delta of ['**',bold.slice(0,120),bold.slice(120),'**。代码 `**literal**` 和 `[label](https://example.com)`。'])pieces.push(...splitter.push(delta));
  pieces.push(...splitter.finish());
  assert.ok(pieces.every(piece=>piece.length<=180));
  assert.equal(pieces.join(''),`${bold}。代码 **literal** 和 [label](https://example.com)。`);
  const played=[],queue=createSpeechQueue({play:async text=>{played.push(text);}});
  for(const piece of pieces)queue.enqueue(piece);
  await queue.finish();assert.deepEqual(played,pieces,'already-extracted plain text must reach playback without another Markdown parse');
});
