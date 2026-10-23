import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import {canSelectExecutionHost,executionHostChoices,groupExecutionHosts} from '../src/execution-host-picker.mjs';

const hosts=[
  {id:'other',name:'书房电脑',kind:'desktop',platform:'linux',online:true,codex:{available:true}},
  {id:'central',name:'小伴服务器',kind:'central',platform:'linux',online:true},
  {id:'mine',name:'办公电脑',kind:'desktop',platform:'win32',online:true,codex:{available:true,configured:false}},
  {id:'old',name:'旧电脑',kind:'desktop',platform:'win32',online:false},
];

test('only a native executor identity marks this computer; names cannot impersonate it',()=>{
  const source=[...hosts,{id:'imposter',name:'此电脑',kind:'desktop',platform:'win32',online:true}];
  const choices=executionHostChoices(source,'mine','mine');
  assert.deepEqual(choices.filter(choice=>choice.isLocal).map(choice=>choice.id),['mine']);
  assert.deepEqual(groupExecutionHosts(choices).map(group=>[group.id,group.choices.map(choice=>choice.id)]),[
    ['local',['mine']],['online',['other','imposter']],['central',['central']],['offline',['old']],
  ]);
  assert.equal(executionHostChoices(source,'mine','').some(choice=>choice.isLocal),false);
  assert.equal(executionHostChoices([{...hosts[1],id:'mine'}],'mine','mine')[0].isLocal,false);
});

test('offline and removed selections stay visible without falling back or mutating server records',()=>{
  const source=structuredClone(hosts),choices=executionHostChoices(source,'removed','mine');
  assert.deepEqual(source,hosts);
  const selected=choices.find(choice=>choice.id==='removed');
  assert.equal(selected.missing,true);assert.equal(selected.online,false);assert.equal(canSelectExecutionHost(selected),false);
  assert.match(selected.note,/不会自动切换/);
  assert.equal(groupExecutionHosts(choices).at(-1).choices.at(-1).id,'removed');
  assert.equal(executionHostChoices(hosts,'old','mine').filter(choice=>choice.id==='old').length,1);
  assert.equal(executionHostChoices([{...hosts[2],online:false}],'mine','mine')[0].group,'offline');
});

test('search matches names and operating systems, never internal IDs or credentials',()=>{
  const choices=executionHostChoices(hosts,'mine','mine');
  assert.deepEqual(groupExecutionHosts(choices,'ubuntu 书房').flatMap(group=>group.choices.map(choice=>choice.id)),['other']);
  assert.deepEqual(groupExecutionHosts(choices,'WINDOWS').flatMap(group=>group.choices.map(choice=>choice.id)),['mine','old']);
  assert.equal(groupExecutionHosts(choices,'mine').length,0);
  assert.equal(groupExecutionHosts(choices,'没有这个名字').length,0);
  assert.match(choices.find(choice=>choice.id==='central').note,/任务在服务器执行/);
});

test('online only describes connection and does not invent readiness or block an assigned provider',()=>{
  const choices=executionHostChoices(hosts,'mine','mine'),selected=choices.find(choice=>choice.id==='mine');
  assert.match(selected.note,/默认模型未配置/);assert.equal(canSelectExecutionHost(selected),true);
  const unavailable=executionHostChoices([{...hosts[2],codex:{available:false}}])[0];
  assert.match(unavailable.note,/CLI 暂不可用/);assert.equal(canSelectExecutionHost(unavailable),true);
  assert.equal(canSelectExecutionHost(selected,true),false);
  assert.equal(canSelectExecutionHost(choices.find(choice=>choice.id==='old')),false);
});

test('a refresh keeps the chosen identity and search criteria even when it goes offline',()=>{
  const selectedId='mine',query='办公 windows';
  const before=groupExecutionHosts(executionHostChoices(hosts,selectedId,'mine'),query);
  const after=groupExecutionHosts(executionHostChoices(hosts.map(host=>host.id===selectedId?{...host,online:false}:host),selectedId,'mine'),query);
  assert.equal(before[0].choices[0].id,selectedId);assert.equal(before[0].id,'local');
  assert.equal(after[0].choices[0].id,selectedId);assert.equal(after[0].id,'offline');
  assert.equal(canSelectExecutionHost(after[0].choices[0]),false);
});

test('duplicate names and systems get a short discriminator without exposing complete internal IDs',()=>{
  const choices=executionHostChoices([
    {...hosts[2],id:'desktop-private-prefix-abc123',name:'DESKTOP'},
    {...hosts[2],id:'desktop-private-prefix-def456',name:'DESKTOP'},
    {...hosts[0],id:'another-private-id',name:'DESKTOP'},
  ]);
  assert.deepEqual(choices.map(choice=>choice.disambiguator),['abc123','def456','']);
  assert.equal(groupExecutionHosts(choices,'private-prefix').length,0);
});

test('user choices hide the central server, other owners and inaccessible saved selections without silently replacing them',()=>{
  const source=[...hosts,{id:'foreign',name:'另一位用户的电脑',kind:'desktop',platform:'win32',online:true,isOwn:false}];
  const choices=executionHostChoices(source,'central','mine',false);
  assert.equal(choices.some(choice=>choice.id==='foreign'),false);
  assert.equal(choices.find(choice=>choice.id==='central'),undefined);
  assert.equal(choices.find(choice=>choice.id==='mine').isLocal,true);
  const empty=executionHostChoices([],'central','',false);
  assert.equal(empty.length,0);
  assert.equal(executionHostChoices(source,'removed','',false).some(choice=>choice.missing),false);
});

test('administrators see device owners and can search display names or usernames without exposing owner IDs',()=>{
  const source=[{...hosts[2],owner:{id:'secret-owner-id',username:'alice',displayName:'爱丽丝'},isOwn:false},
    {...hosts[0],owner:{id:'another-secret-id',username:'bob',displayName:'鲍勃'},isOwn:true},hosts[1]];
  const choices=executionHostChoices(source,'mine','',true);
  assert.equal(choices[0].ownerLabel,'爱丽丝 · @alice');assert.equal(choices[0].isOwn,false);
  assert.equal(choices[1].isOwn,true);assert.equal(choices[2].ownerLabel,'');
  assert.deepEqual(groupExecutionHosts(choices,'alice').flatMap(group=>group.choices.map(choice=>choice.id)),['mine']);
  assert.deepEqual(groupExecutionHosts(choices,'鲍勃').flatMap(group=>group.choices.map(choice=>choice.id)),['other']);
  assert.equal(groupExecutionHosts(choices,'secret-owner-id').length,0);
  assert.equal(canSelectExecutionHost(choices[0]),true);assert.equal(canSelectExecutionHost(choices[2]),true);
});

const pickerSource=ts.transpileModule(await readFile(new URL('../src/WorkspaceControls.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
const pickerNodes=tree=>Array.isArray(tree)?tree.flatMap(pickerNodes):!tree||typeof tree!=='object'?[]:[tree,...pickerNodes(tree.props?.children),...pickerNodes(tree.props?.summary)];
const pickerText=tree=>Array.isArray(tree)?tree.map(pickerText).join(''):tree==null||typeof tree==='boolean'?'':typeof tree!=='object'?String(tree):pickerText(tree.props?.children);
function renderPicker(overrides={}){
  const changes=[],react={useId:()=> 'host-fixture',useState:value=>[value,()=>{}],useRef:value=>({current:value}),useEffect(){},useMemo:callback=>callback()};
  const modules={react,'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},'react-dom':{},'lucide-react':new Proxy({},{get:(_target,name)=>Symbol.for(name)}),'./execution-host-picker.mjs':{executionHostChoices,groupExecutionHosts,canSelectExecutionHost},'./WorkspaceDisclosure':{__esModule:true,default:Symbol('WorkspaceDisclosure')}};
  const module={exports:{}};vm.runInNewContext(pickerSource,{module,exports:module.exports,window:{},require:name=>modules[name]||{}});
  const tree=module.exports.ExecutionHostPicker({hosts,value:'mine',localHostId:'mine',onChange:id=>changes.push(id),...overrides});
  const all=pickerNodes(tree),options=all.filter(node=>node.type==='button'&&node.props.className?.startsWith('workspace-host-option'));
  return{all,options,changes,find:(type,predicate)=>all.find(node=>node.type===type&&predicate(node.props))};
}

test('failed host refresh labels retained entries as pending without online dots or selection changes',()=>{
  const before=renderPicker(),failed=renderPicker({error:'合成 hosts 503'});
  assert.equal(failed.options.length,before.options.length);
  assert.deepEqual(failed.options.map(option=>[option.props['aria-pressed'],option.props.disabled]),before.options.map(option=>[option.props['aria-pressed'],option.props.disabled]));
  for(const option of failed.options){assert.match(pickerText(option),/状态待刷新/);assert.doesNotMatch(pickerText(option),/已连接|CLI 可用|未连接|离线/);}
  assert.ok(failed.find('strong',props=>props.title==='办公电脑 · 此电脑 · 状态待刷新'));
  assert.equal(failed.find('span',props=>props.className?.startsWith('workspace-host-connection')),undefined);
  assert.equal(pickerText(failed.find('span',props=>props.className==='workspace-target-error')),'合成 hosts 503');
  assert.deepEqual(failed.changes,[]);
  const other=failed.options.find(option=>pickerText(option).includes('书房电脑'));
  other.props.onClick({currentTarget:{closest:()=>null}});assert.deepEqual(failed.changes,['other'],'presentation must preserve existing selection behavior');
  const recovered=renderPicker();assert.ok(recovered.find('span',props=>props.className==='workspace-host-connection'));
  assert.match(pickerText(recovered.options.find(option=>option.props['aria-pressed'])),/已连接/);
});

test('a refresh failure does not relabel a retained selection as a newly confirmed offline host',()=>{
  const failed=renderPicker({value:'old',error:'合成 hosts 无效响应'});
  assert.ok(failed.find('strong',props=>props.title==='旧电脑 · 状态待刷新'));
  assert.equal(failed.find('span',props=>props.className==='workspace-target-host is-offline'),undefined);
  const recovered=renderPicker({value:'old'});
  assert.ok(recovered.find('span',props=>props.className==='workspace-target-host is-offline'));
  assert.ok(recovered.find('span',props=>props.className==='workspace-host-connection is-offline'));
});
