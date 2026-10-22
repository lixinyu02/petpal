import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createElement} from 'react';
import {renderToPipeableStream} from 'react-dom/server';
import {PassThrough} from 'node:stream';
import {text} from 'node:stream/consumers';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const bundle=await build({entryPoints:[fileURLToPath(new URL('../src/voice/VoiceReplyCaption.tsx',import.meta.url))],bundle:true,write:false,metafile:true,format:'cjs',platform:'node',external:['react','react/jsx-runtime','react/jsx-dev-runtime'],loader:{'.css':'empty'}});
const compiled={exports:{}};
new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),compiled,compiled.exports);
const Caption=compiled.exports.default;
async function render(content,conversationId='voice-current') {
  const stream=new PassThrough();let error;
  const renderer=renderToPipeableStream(createElement(Caption,{content,conversationId}),{onAllReady(){renderer.pipe(stream);},onError(e){error=e;}});
  const html=await text(stream);if(error)throw error;return html;
}
const source='root = Panel("参数", [Field("topic", "输入", ""), Button("加入输入框", @UseInPrompt())])';
test('voice captions retain Markdown prose and link to the same conversation without UI controls or SDK',async()=>{
  const html=await render(`**请补充要求**。\n\n\`\`\`openui\n${source}\n\`\`\`\n\n之后继续。`,'voice id&settings=1');
  assert.match(html,/<strong>请补充要求<\/strong>/);assert.match(html,/之后继续。/);
  assert.match(html,/href="\/\?chat=1&amp;conversation=voice%20id%26settings%3D1"/);
  assert.match(html,/在对话中查看交互内容/);
  for(const hidden of ['Panel','Field','UseInPrompt','<input','<button'])assert.equal(html.includes(hidden),false,hidden);
  assert.equal(Object.keys(bundle.metafile.inputs).some(path=>path.includes('@openuidev')||path.includes('OpenUIBlock')),false);
});
test('partial, malformed, over-limit and multiple UI blocks keep DSL out of captions',async()=>{
  for(const content of [
    '之前的说明。\n```openui\nroot = Panel("未闭合", [',
    '之前的说明。\n~~~openui\nnot-valid("DSL")\n~~~',
    '之前的说明。\n```openui',
    '之前的说明。\n```openui\n'+source.repeat(4000),
    '之前的说明。\n'+('```openui\n'+source+'\n```\n').repeat(9),
  ]) {
    const html=await render(content);
    assert.match(html,/之前的说明/);assert.match(html,/在对话中查看交互内容/);
    for(const hidden of ['root =','Panel','not-valid','<button'])assert.equal(html.includes(hidden),false,hidden);
  }
  const empty=await render('```openui\n'+source+'\n```','');
  assert.match(empty,/href="\/\?chat=1"/);
});
test('ordinary replies and fenced examples retain their previous caption behavior',async()=>{
  const plain=await render('这是 **普通说明**。\n```js\nconst answer = 5;\n```');
  assert.match(plain,/<strong>普通说明<\/strong>/);assert.match(plain,/const answer = 5/);
  assert.doesNotMatch(plain,/voice-openui-link/);
  const example=await render('````markdown\n```openui\n'+source+'\n```\n````');
  assert.match(example,/root = Panel/);assert.doesNotMatch(example,/voice-openui-link/);
  const hidden=await render('<!--\n```openui\n'+source+'\n```\n-->\n\n可见解释。');
  assert.match(hidden,/可见解释/);assert.doesNotMatch(hidden,/Panel|voice-openui-link/);
});
