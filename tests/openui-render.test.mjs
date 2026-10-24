import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Children,createElement,isValidElement} from 'react';
import {Renderer,defineComponent} from '@openuidev/react-lang';
import {createOpenUILibrary,openUILibrary} from '../src/openui/library.mjs';
import {copyBoundedData} from '../src/openui/validate.mjs';
import {renderToPipeableStream} from 'react-dom/server';
import {PassThrough} from 'node:stream';
import {text} from 'node:stream/consumers';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const bundle = await build({entryPoints:[fileURLToPath(new URL('../src/openui/AssistantOutput.tsx',import.meta.url))],bundle:true,write:false,format:'cjs',platform:'node',external:['react','react/jsx-runtime','react/jsx-dev-runtime'],loader:{'.css':'empty'},define:{'process.env.NODE_ENV':'"production"','process.env.OPENUI_RUNTIME_TELEMETRY_ENABLED':'"0"'}});
const compiled = {exports:{}};
new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),compiled,compiled.exports);
const Output = compiled.exports.default;
async function renderElement(element) {
  const stream = new PassThrough(); let error;
  const renderer = renderToPipeableStream(element,{onAllReady(){renderer.pipe(stream);},onError(e){error=e;}});
  const html = await text(stream); if(error) throw error; return html;
}
const render=props=>renderElement(createElement(Output,props));
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

test('numeric state and conditional scalar children render without a fallback', async()=>{
  const content='```openui\n$U = 5\n$R = 10\n$detail = false\ndetails = $detail ? "Detailed calculation" : ""\nroot = Panel("Local experiment", [Field("u", "Voltage", $U), Field("r", "Resistance", $R), Text("I = " + ($U / $R)), details, Checkbox("detail", "Show calculation", $detail), Button("Preset", Action([@Set($U, 10), @Set($R, 5)]))])\n```';
  const html=await render({content,mode:'auto',status:'complete'});
  assert.match(html,/class="openui-panel"/);
  assert.match(html,/>Voltage<\/label>/);assert.match(html,/>Resistance<\/label>/);
  assert.match(html,/<button[^>]*>Preset<\/button>/);
  assert.doesNotMatch(html,/已保留原文|交互内容暂时无法显示|language-openui/);
});

test('computed scalar text children are escaped and retain text layout', async()=>{
  const content='```openui\nroot = Panel("Plain values", ["<script>alert(1)</script>", 4, true, false, null, Text(3), Text(null), Stack(["line one\\nline two"])])\n```';
  const html=await render({content,mode:'auto',status:'complete'});
  assert.doesNotMatch(html,/<script/);
  assert.match(html,/<p class="openui-text">&lt;script&gt;alert\(1\)&lt;\/script&gt;<\/p>/);
  assert.match(html,/<p class="openui-text">4<\/p>/);
  assert.match(html,/<p class="openui-text">true<\/p>/);
  assert.match(html,/<p class="openui-text">false<\/p>/);
  assert.match(html,/<p class="openui-text">line one\nline two<\/p>/);
});

test('flat table rows render as one escaped row with all cells intact', async()=>{
  const html=await render({content:'```openui\nroot = Panel("Table", [Table(["Voltage", "Resistance", "Current"], ["10V", "<script>5Ω</script>", "2A"])])\n```',mode:'auto',status:'complete'});
  const body=/<tbody>([\s\S]*?)<\/tbody>/.exec(html)?.[1];
  assert.ok(body);assert.equal((body.match(/<tr>/g)||[]).length,1);
  assert.equal((body.match(/<td>/g)||[]).length,3);
  assert.match(body,/10V/);assert.match(body,/&lt;script&gt;5Ω&lt;\/script&gt;/);assert.match(body,/2A/);
  assert.doesNotMatch(html,/<script|已保留原文/);
});

test('actual unbound control handlers produce strict SDK snapshots and no actions', async()=>{
  const controls={},snapshots=[],actions=[];
  const findControl=element=>{
    if(!isValidElement(element))return null;
    if(['input','select','textarea'].includes(element.type))return element;
    for(const child of Children.toArray(element.props.children)){const control=findControl(child);if(control)return control;}
    return null;
  };
  const probes=['Field','Select','Checkbox'].map(type=>defineComponent({
    name:'Probe'+type,props:openUILibrary.components[type].props,
    component:({props})=>{
      const element=openUILibrary.components[type].component({props});
      controls[props.name]=findControl(element);return element;
    },
  }));
  const library=createOpenUILibrary(probes);
  const response='root = Panel("Local fields", [ProbeField("note", "Note"), ProbeField("amount", "Amount", 5), ProbeSelect("choice", "Choice", ["A", "B"]), ProbeCheckbox("accepted", "Accepted")])';
  await renderElement(createElement(Renderer,{response,library,isStreaming:false,publishObservability:false,onStateUpdate:value=>snapshots.push(copyBoundedData(value)),onAction:event=>actions.push(event)}));
  controls.note.props.onChange({target:{value:'hello'}});
  controls.choice.props.onChange({target:{value:'B'}});
  controls.accepted.props.onChange({target:{checked:true}});
  controls.amount.props.onChange({target:{value:''}});
  assert.deepEqual(snapshots.at(-1).amount,{value:'',componentType:'Field'});
  controls.amount.props.onChange({target:{value:'12.5'}});
  assert.deepEqual(snapshots.at(-1).amount,{value:12.5,componentType:'Field'});
  controls.amount.props.onChange({target:{value:'1e309'}});
  assert.deepEqual(snapshots.at(-1),{
    note:{value:'hello',componentType:'Field'},amount:{value:'',componentType:'Field'},
    choice:{value:'B',componentType:'Select'},accepted:{value:true,componentType:'Checkbox'},
  });
  assert.deepEqual(actions,[]);
});
