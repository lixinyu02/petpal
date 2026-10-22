import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createElement} from 'react';
import {renderToPipeableStream} from 'react-dom/server';
import {PassThrough} from 'node:stream';
import {text} from 'node:stream/consumers';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const bundle = await build({entryPoints:[fileURLToPath(new URL('../src/openui/AssistantOutput.tsx',import.meta.url))],bundle:true,write:false,format:'cjs',platform:'node',external:['react','react/jsx-runtime','react/jsx-dev-runtime'],loader:{'.css':'empty'},define:{'process.env.NODE_ENV':'"production"','process.env.OPENUI_RUNTIME_TELEMETRY_ENABLED':'"0"'}});
const compiled = {exports:{}};
new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),compiled,compiled.exports);
const Output = compiled.exports.default;
async function render(props) {
  const stream = new PassThrough(); let error;
  const renderer = renderToPipeableStream(createElement(Output,props),{onAllReady(){renderer.pipe(stream);},onError(e){error=e;}});
  const html = await text(stream); if(error) throw error; return html;
}
const source = '```openui\n$note = ""\nroot = Panel("补充要求", [Text("<script>alert(1)</script>"), Field("note", "备注", $note), Button("加入输入框", @UseInPrompt("继续"))])\n```';
test('official renderer produces escaped controls only on marked assistant output', async()=>{
  const html = await render({content:source,mode:'auto',status:'complete'});
  assert.match(html,/class="openui-panel"/); assert.match(html,/<input/); assert.match(html,/<button/);
  assert.doesNotMatch(html,/<script/); assert.match(html,/&lt;script&gt;/);
  for(const props of [{},{mode:'markdown'}]) {
    const plain = await render({content:source,status:'complete',...props});
    assert.doesNotMatch(plain,/class="openui-panel"/); assert.match(plain,/language-openui/);
  }
});
test('streaming actions are disabled and malformed final output keeps source',async()=>{
  const partial = await render({content:source,mode:'auto',status:'streaming'});
  assert.match(partial,/<button[^>]*disabled=""/);
  const invalid = await render({content:'```openui\nroot = Unknown("不可用")\n```',mode:'auto',status:'complete'});
  assert.match(invalid,/已保留原文/); assert.match(invalid,/Unknown/); assert.doesNotMatch(invalid,/<input/);
  const cancelled = await render({content:source,mode:'auto',status:'cancelled'});
  assert.match(cancelled,/<fieldset[^>]*disabled=""/);
});
