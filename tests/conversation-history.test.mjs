import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const bundle=await build({entryPoints:[fileURLToPath(new URL('../src/ConversationHistory.tsx',import.meta.url))],bundle:true,write:false,format:'cjs',platform:'node',external:['react','react/jsx-runtime','react/jsx-dev-runtime']});
const compiled={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),compiled,compiled.exports);
const {default:ConversationHistory,ConversationHistoryRow,sameConversationHistory}=compiled.exports;
const item=(id,extra={})=>({id,title:`对话 ${id}`,mode:'chat',messages:[{id:'m',role:'assistant',content:'旧内容'}],...extra});
const base={conversations:[item('one'),item('two',{mode:'codex'})],selectedId:'one',active:true,busy:false,onSelect(){},onDelete(){}};

test('voice ticks and streaming content do not invalidate navigation labels',()=>{
  assert.equal(ConversationHistory.$$typeof,Symbol.for('react.memo'));assert.equal(ConversationHistoryRow.$$typeof,Symbol.for('react.memo'));
  const next={...base,conversations:base.conversations.map(conversation=>({...conversation,messages:[{id:'m',role:'assistant',content:'持续增长的流式内容'}],updatedAt:'later',agent:{revision:100}}))};
  assert.equal(sameConversationHistory(base,next),true);
});

test('selection, title, mode, order, deletion and current callback guards remain observable',()=>{
  for(const next of [
    {...base,selectedId:'two'}, {...base,active:false}, {...base,busy:true},
    {...base,onSelect(){}}, {...base,onDelete(){}},
    {...base,conversations:[item('one',{title:'已重命名'}),base.conversations[1]]},
    {...base,conversations:[item('one',{mode:'codex'}),base.conversations[1]]},
    {...base,conversations:[...base.conversations].reverse()},
    {...base,conversations:[base.conversations[0]]},
    {...base,conversations:[item('replacement'),base.conversations[1]]},
  ])assert.equal(sameConversationHistory(base,next),false);
});

test('history exposes the selected conversation and escapes labels without rendering message bodies',()=>{
  const html=renderToStaticMarkup(createElement(ConversationHistory,{...base,conversations:[item('one',{title:'<script>标题</script>',messages:[{content:'PRIVATE_MESSAGE_CONTENT'}]}),base.conversations[1]]}));
  assert.equal((html.match(/aria-current="page"/g)||[]).length,1);
  assert.ok(html.includes('&lt;script&gt;标题&lt;/script&gt;'));assert.equal(html.includes('PRIVATE_MESSAGE_CONTENT'),false);
  assert.ok(html.includes('aria-label="删除对话 '));
  assert.equal(renderToStaticMarkup(createElement(ConversationHistory,{...base,active:false})).includes('aria-current="page"'),false);
});

test('busy state disables deletion and empty history retains the welcome cue',()=>{
  const busy=renderToStaticMarkup(createElement(ConversationHistory,{...base,busy:true}));
  assert.equal((busy.match(/disabled=""/g)||[]).length,2);
  const empty=renderToStaticMarkup(createElement(ConversationHistory,{...base,conversations:[]}));assert.ok(empty.includes('我们的故事，从一句你好开始。'));assert.equal(empty.includes('history-item'),false);
});
