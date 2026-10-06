import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import * as reviewUi from '../src/approval-review-ui.mjs';

const source=ts.transpileModule(await readFile(new URL('../src/AgentPermissions.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):!tree||typeof tree!=='object'?[]:[tree,...nodes(tree.props?.children)];
const text=tree=>Array.isArray(tree)?tree.map(text).join(''):tree==null||typeof tree==='boolean'?'':typeof tree!=='object'?String(tree):text(tree.props?.children);
const capability={available:true,modelStrategy:'agent-model',dynamicTools:'bounded-audio-rules-with-manual-fallback',version:1};
const element=(type,props)=>({type,props}),module={exports:{}};
const modules={'react/jsx-runtime':{jsx:element,jsxs:element},'lucide-react':{Shield:Symbol('Shield'),Zap:Symbol('Zap')},'./WorkspaceDisclosure':{__esModule:true,default:Symbol('WorkspaceDisclosure')},'./approval-review-ui.mjs':reviewUi};
vm.runInNewContext(source,{module,exports:module.exports,require:name=>{if(name.endsWith('.css'))return{};assert.ok(Object.hasOwn(modules,name));return modules[name];}});
const render=(extra={})=>{const changes=[],props={value:{access:'full-access',approval:'review'},user:{isOwner:true},onChange:next=>changes.push(next),...extra},tree=module.exports.default(props);return{tree,props,changes,find:(type,predicate=()=>true)=>nodes(tree).find(node=>node.type===type&&predicate(node.props)),text:()=>text(tree)};};

test('unknown, older and malformed executor review contracts cannot enable a new automatic-review selection',()=>{
  for(const reviewCapability of [undefined,{...capability,available:false},{...capability,version:2},{...capability,modelStrategy:'unknown'},{...capability,dynamicTools:'automatic-all'}]){
    const f=render({reviewCapability,value:{access:'full-access',approval:'ask'}});
    assert.equal(f.find('option',props=>props.value==='review').props.disabled,true);
    f.find('select',props=>props['aria-label']==='Agent 运行方式').props.onChange({target:{value:'review'}});
    assert.equal(f.changes.length,0,'a stale or synthetic event must not bypass capability gating');
    assert.match(f.text(),/尚不支持|尚未确认/);
  }
});

test('an existing review permission is shown honestly without silently changing it on an older computer',()=>{
  const f=render({reviewCapability:{...capability,available:false,message:'执行器需要升级'}});
  assert.equal(f.find('select',props=>props['aria-label']==='Agent 运行方式').props.value,'review');
  assert.match(f.text(),/执行器需要升级/);assert.equal(f.changes.length,0);
  f.find('select',props=>props['aria-label']==='Agent 运行方式').props.onChange({target:{value:'ask'}});
  assert.equal(f.changes[0].approval,'ask');
});

test('the actual supported permission UI explains per-turn model reuse, bounded rules and manual host-tool fallback',()=>{
  const f=render({reviewCapability:capability,reviewModel:'qwen3.8flash'});
  assert.equal(f.find('option',props=>props.value==='review').props.disabled,false);
  assert.match(f.text(),/本轮 Agent 模型（qwen3\.8flash）/);assert.match(f.text(),/不另选模型/);assert.match(f.text(),/其他主机工具仍需要你确认/);
  assert.match(f.text(),/系统音量与播放器音量是独立/);assert.match(f.text(),/Windows 管理员确认仍需在执行电脑上处理/);
  f.find('select',props=>props['aria-label']==='Agent 运行方式').props.onChange({target:{value:'auto'}});assert.equal(f.changes[0].approval,'auto');
});

test('native reviewer copy does not claim third-party model reuse and guardian decisions are scoped to the operation',()=>{
  const native=render({reviewCapability:{...capability,modelStrategy:'native'},reviewModel:'third-party',reviewProgress:{status:'denied',rationale:'这次操作没有明确授权'}});
  assert.match(native.text(),/Codex 原生审查器/);assert.doesNotMatch(native.text(),/third-party/);assert.match(native.text(),/未放行本次操作/);assert.match(native.text(),/没有明确授权/);
  const local=render({reviewCapability:capability,reviewProgress:{status:'approved',source:'local-rule'}});assert.match(local.text(),/音量操作已通过本地规则审查/);
  for(const status of ['inProgress','approved','denied','timedOut','aborted'])assert.ok(reviewUi.approvalReviewLabel({status}));
  assert.equal(reviewUi.approvalReviewLabel({status:'invented'}),'');
  for(const status of ['constructor','__proto__','toString'])assert.equal(reviewUi.approvalReviewLabel({status}),'');
  assert.equal(typeof reviewUi.approvalReviewCapabilityNote({...capability,available:false,message:{malformed:true}}),'string');
});
