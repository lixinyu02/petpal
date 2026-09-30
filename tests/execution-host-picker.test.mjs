import test from 'node:test';
import assert from 'node:assert/strict';
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
