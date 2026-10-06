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
  for(const reviewCapability of [undefined,{...capability,available:false},{...capability,version:3},{...capability,modelStrategy:'unknown'},{...capability,dynamicTools:'automatic-all'}]){
    const f=render({reviewCapability,value:{access:'full-access',approval:'ask'}});
    assert.equal(f.find('option',props=>props.value==='review').props.disabled,true);
    f.find('select',props=>props['aria-label']==='Agent 运行方式').props.onChange({target:{value:'review'}});
    assert.equal(f.changes.length,0,'a stale or synthetic event must not bypass capability gating');
    assert.equal(text(f.find('option',props=>props.value==='review')),'自动审查（不可用）');
    assert.equal(f.find('p'),undefined,'capability information must not add static hint copy');
  }
});

test('an existing review permission is shown honestly without silently changing it on an older computer',()=>{
  const f=render({reviewCapability:{...capability,available:false,message:'执行器需要升级'}});
  assert.equal(f.find('select',props=>props['aria-label']==='Agent 运行方式').props.value,'review');
  assert.equal(text(f.find('option',props=>props.value==='review')),'自动审查（不可用）');assert.equal(f.changes.length,0);
  assert.equal(f.find('p'),undefined);
  f.find('select',props=>props['aria-label']==='Agent 运行方式').props.onChange({target:{value:'ask'}});
  assert.equal(f.changes[0].approval,'ask');
});

test('permission controls remain usable without static explanation paragraphs for any access or run mode',()=>{
  for(const access of ['read-only','workspace-write','full-access'])for(const approval of ['ask','auto','review'])for(const disabled of [false,true]){
    const f=render({reviewCapability:capability,reviewModel:'qwen3.8flash',value:{access,approval},disabled});
    assert.equal(f.find('option',props=>props.value==='review').props.disabled,false);
    assert.equal(f.find('p'),undefined);assert.equal(f.find('select',props=>props['aria-label']==='Agent 运行方式').props.disabled,disabled);
    assert.doesNotMatch(f.text(),/沿用|不另选模型|完全访问可|所选范围|权限已固定/);
    f.find('select',props=>props['aria-label']==='Agent 运行方式').props.onChange({target:{value:'auto'}});assert.equal(f.changes.length,disabled?0:1);
  }
});

test('native reviewer copy does not claim third-party model reuse and guardian decisions are scoped to the operation',()=>{
  const native=render({reviewCapability:{...capability,modelStrategy:'native'},reviewModel:'third-party',reviewProgress:{status:'denied',rationale:'这次操作没有明确授权'}});
  assert.doesNotMatch(native.text(),/Codex 原生审查器|third-party/);assert.match(native.text(),/未放行本次操作/);assert.match(native.text(),/没有明确授权/);
  const local=render({reviewCapability:capability,reviewProgress:{status:'approved',source:'local-rule'}});assert.match(local.text(),/音量操作已通过本地规则审查/);
  for(const status of ['inProgress','approved','denied','timedOut','aborted'])assert.ok(reviewUi.approvalReviewLabel({status}));
  assert.equal(reviewUi.approvalReviewLabel({status:'invented'}),'');
  for(const status of ['constructor','__proto__','toString'])assert.equal(reviewUi.approvalReviewLabel({status}),'');
});

const reviewers=[{id:'review-one',name:'专用审查连接',model:'review-model',protocol:'responses'},{id:'chat-only',name:'普通聊天',model:'chat',protocol:'chat-completions'}];
const independentCapability={...capability,version:2,independentModel:true};

test('independent reviewer is selected from authorized Responses providers only and retains the rest of the task permissions',()=>{
  const f=render({reviewCapability:independentCapability,reviewProviders:reviewers});
  const picker=f.find('select',props=>props['aria-label']==='命令审查模型');
  assert.equal(picker.props.value,'');assert.equal(picker.props.disabled,false);
  assert.equal(text(f.find('option',props=>props.value==='')),'跟随 Agent');
  assert.equal(text(f.find('option',props=>props.value==='review-one')),'专用审查连接 · review-model');
  assert.equal(f.find('option',props=>props.value==='chat-only'),undefined);
  picker.props.onChange({target:{value:'review-one'}});
  assert.equal(f.changes[0].reviewProviderId,'review-one');assert.equal(f.changes[0].access,'full-access');assert.equal(f.changes[0].approval,'review');
  for(const value of ['chat-only','not-authorized'])picker.props.onChange({target:{value}});
  assert.equal(f.changes.length,1,'synthetic changes cannot select providers outside the authorized Responses catalog');
  picker.props.onChange({target:{value:''}});assert.equal(f.changes[1].reviewProviderId,null);
  for(const approval of ['ask','auto'])assert.equal(render({value:{access:'read-only',approval},reviewCapability:independentCapability,reviewProviders:reviewers}).find('select',props=>props['aria-label']==='命令审查模型'),undefined);
});

test('version one and non-independent version two preserve follow-Agent review without allowing independent models',()=>{
  for(const reviewCapability of [capability,{...independentCapability,independentModel:false},{...independentCapability,independentModel:undefined},{...independentCapability,independentModel:'true'}]){
    const f=render({reviewCapability,reviewProviders:reviewers,value:{access:'full-access',approval:'review',reviewProviderId:'review-one'}});
    assert.equal(f.find('option',props=>props.value==='review').props.disabled,false);
    assert.equal(f.find('option',props=>props.value==='review-one').props.disabled,true);
    const picker=f.find('select',props=>props['aria-label']==='命令审查模型');picker.props.onChange({target:{value:'review-one'}});assert.equal(f.changes.length,0);
    picker.props.onChange({target:{value:''}});assert.equal(f.changes[0].reviewProviderId,null);
  }
});

test('revoked review providers remain explicitly unavailable instead of falling back and task locking prevents all permission changes',()=>{
  const value={access:'workspace-write',approval:'review',reviewProviderId:'revoked-review'};
  for(const disabled of [false,true]){
    const f=render({value,disabled,reviewCapability:independentCapability,reviewProviders:reviewers});
    const picker=f.find('select',props=>props['aria-label']==='命令审查模型');assert.equal(picker.props.value,'revoked-review');assert.equal(picker.props.disabled,disabled);
    const selected=f.find('option',props=>props.value==='revoked-review');assert.equal(selected.props.disabled,true);assert.match(text(selected),/不可用/);assert.equal(f.changes.length,0);
    picker.props.onChange({target:{value:'review-one'}});
    f.find('select',props=>props['aria-label']==='Agent 访问范围').props.onChange({target:{value:'read-only'}});
    f.find('select',props=>props['aria-label']==='Agent 运行方式').props.onChange({target:{value:'ask'}});
    assert.equal(f.changes.length,disabled?0:3);
    if(!disabled){assert.equal(f.changes[1].reviewProviderId,'revoked-review');assert.equal(f.changes[2].reviewProviderId,'revoked-review');}
  }
  const unavailable=render({value,reviewCapability:{...independentCapability,available:false},reviewProviders:reviewers});
  const picker=unavailable.find('select',props=>props['aria-label']==='命令审查模型');assert.equal(picker.props.disabled,true);picker.props.onChange({target:{value:''}});assert.equal(unavailable.changes.length,0);
});
