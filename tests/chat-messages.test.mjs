import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createElement} from 'react';
import {renderToPipeableStream} from 'react-dom/server';
import {PassThrough} from 'node:stream';
import {text as streamText} from 'node:stream/consumers';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const bundle=await build({entryPoints:[fileURLToPath(new URL('../src/ChatMessages.tsx',import.meta.url))],bundle:true,write:false,format:'cjs',platform:'node',external:['react','react/jsx-runtime','react/jsx-dev-runtime'],loader:{'.css':'empty'}});
// Hook-bearing attachment rows must share the renderer's React instance.
const compiled={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),compiled,compiled.exports);
const {default:ChatMessages,ChatMessageRow}=compiled.exports;
const base={petName:'小伴',mode:'chat',working:false,busy:false,sleeping:false,speechId:'',speechPlaying:false,speechPending:false,speechSupported:true,speechFeedback:'已就绪',speechError:'',onRead(){},onStop(){},onNotice(){}};
const message=(id,extra={})=>({id,role:'assistant',content:'**安全的回复**',status:'complete',model:'model-one',...extra});
const render=async(messages,extra={})=>{
  const stream=new PassThrough();let renderingError;
  const renderer=renderToPipeableStream(createElement(ChatMessages,{...base,messages,...extra}),{onAllReady(){renderer.pipe(stream);},onError(error){renderingError=error;}});
  const html=await streamText(stream);if(renderingError)throw renderingError;return html;
};

test('list and stable rows are memoized; messages keep Markdown, model and attachment semantics',async()=>{
  assert.equal(ChatMessages.$$typeof,Symbol.for('react.memo'));assert.equal(ChatMessageRow.$$typeof,Symbol.for('react.memo'));
  const html=await render([message('one'),message('two',{role:'user',content:'**原样文字**',attachments:[{id:'image-one',name:'图',mimeType:'image/png',size:20,width:1,height:1}]})]);
  assert.ok(html.includes('<strong>安全的回复</strong>'));assert.ok(html.includes('**原样文字**'));assert.ok(html.includes('model-one'));assert.ok(html.includes('message-image-placeholder'));assert.equal(html.includes('<img'),false);
});
test('only the matching utterance owns the stop button and speech error',async()=>{
  const html=await render([message('one'),message('two')],{speechId:'two-auto-agent',speechPlaying:true,speechPending:true,speechError:'播放失败'});
  assert.equal((html.match(/aria-label="停止朗读这条回复"/g)||[]).length,1);
  assert.equal((html.match(/aria-label="朗读这条回复"/g)||[]).length,1);
  assert.equal((html.match(/播放失败/g)||[]).length,1);assert.ok(html.includes('准备语音中 · 停止'));
});
test('sleep, unsupported voice and running tasks disable a new read but preserve a current stop',async()=>{
  for(const extra of [{sleeping:true},{speechSupported:false},{working:true}]){
    const html=await render([message('one')],extra);assert.match(html,/aria-label="朗读这条回复"[^>]*disabled=""/);
    const playing=await render([message('one')],{...extra,speechId:'one-manual-42',speechPlaying:true});assert.doesNotMatch(playing,/aria-label="停止朗读这条回复"[^>]*disabled=/);
  }
});
test('incomplete, cancelled and steered messages retain their state and cannot be read as complete',async()=>{
  const html=await render([message('one',{status:'error'}),message('two',{status:'cancelled'}),message('three',{status:'streaming',content:'',steered:true})],{mode:'codex',working:true});
  assert.ok(html.includes('回复未完成'));assert.ok(html.includes('已停止'));assert.ok(html.includes('已追加到当前任务'));assert.ok(html.includes('typing-dots'));assert.equal(html.includes('aria-label="朗读这条回复"'),false);assert.ok(html.includes('Codex'));
});
