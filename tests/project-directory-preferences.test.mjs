import test from 'node:test';
import assert from 'node:assert/strict';
import {executionProjectDirectory,projectDirectoryIssue,readProjectDirectory,saveProjectDirectory} from '../src/project-directory-preferences.mjs';
import {chatAssistantForHost,readChatAssistantPreferences,saveChatAssistantPreferences,snapshotChatAssistant} from '../src/chat-assistant-preferences.mjs';

const storage=()=>{const data=new Map();return{getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value),data};};
const windows={id:'win',platform:'win32',codex:{projectDirectory:true}},linux={id:'ubuntu',platform:'linux',codex:{projectDirectory:true}};
const assistant={hostId:'win',providerId:'qwen',enabled:true,permissions:{access:'read-only',approval:'ask'},projectDirectory:'C:\\Projects\\猫'};

test('project preferences are isolated by service instance, account and execution computer',()=>{
  const local=storage();saveProjectDirectory(local,'instance:alice','win','C:\\Projects\\猫');saveProjectDirectory(local,'instance:alice','ubuntu','/home/me/猫');
  assert.equal(readProjectDirectory(local,'instance:alice','win'),'C:\\Projects\\猫');assert.equal(readProjectDirectory(local,'instance:alice','ubuntu'),'/home/me/猫');
  assert.equal(readProjectDirectory(local,'instance:bob','win'),'');assert.equal(readProjectDirectory(local,'other:alice','win'),'');assert.equal(readProjectDirectory(local,'','win'),'');
});

test('project preference history is bounded and restoring default is explicit',()=>{
  const local=storage();for(let index=0;index<15;index++)saveProjectDirectory(local,'scope',`pc-${index}`,`/project/${index}`);
  const saved=JSON.parse([...local.data.values()][0]);assert.equal(saved.length,12);assert.equal(saved[0].hostId,'pc-14');assert.equal(readProjectDirectory(local,'scope','pc-0'),'');
  saveProjectDirectory(local,'scope','pc-14','');assert.equal(readProjectDirectory(local,'scope','pc-14'),'');assert.equal(JSON.parse([...local.data.values()][0])[0].directory,'');
});

test('malformed and oversized persisted paths cannot replace a valid preference',()=>{
  const local=storage();saveProjectDirectory(local,'scope','win','C:\\real');
  for(const path of ['\n','C:\\bad\nsecret','a'.repeat(4097),null])saveProjectDirectory(local,'scope','win',path);
  assert.equal(readProjectDirectory(local,'scope','win'),'C:\\real');
  local.setItem([...local.data.keys()][0],'{broken');assert.equal(readProjectDirectory(local,'scope','win'),'');
});

test('custom paths require an explicit host capability and match the selected platform',()=>{
  assert.equal(projectDirectoryIssue('',{platform:'linux'}),'');assert.match(projectDirectoryIssue('/project',{platform:'linux',codex:{}}),/新版|更新/);
  assert.match(projectDirectoryIssue('/project',windows),/Windows/);assert.match(projectDirectoryIssue('C:\\project',linux),/绝对路径/);
  assert.equal(projectDirectoryIssue('C:\\Projects\\猫',windows),'');assert.match(projectDirectoryIssue('\\\\server\\share\\猫',windows),/Windows/);assert.equal(projectDirectoryIssue('/home/me/猫',linux),'');
  assert.match(projectDirectoryIssue('/project\nwrong',linux),/格式/);assert.match(projectDirectoryIssue('/'+'x'.repeat(4096),linux),/格式/);
});

test('running, unknown, queued and retry snapshots retain their exact directory, including defaults',()=>{
  const agent={run:{status:'running',projectDirectory:'/actual'},queue:[{projectDirectory:'/queued'}]};
  assert.equal(executionProjectDirectory(agent),'/actual');assert.equal(executionProjectDirectory({...agent,run:{status:'unknown'}}),'');
  assert.equal(executionProjectDirectory({...agent,run:{status:'completed'}}),'/queued');
  assert.equal(executionProjectDirectory(agent,{payload:{projectDirectory:'/submitted'}}),'/submitted');assert.equal(executionProjectDirectory(agent,{payload:{}}),'');
  assert.equal(executionProjectDirectory({run:{status:'completed'},queue:[]}),undefined);
});

test('Chat + Agent remembers a host directory without persisting permission or autonomy',()=>{
  const local=storage();saveChatAssistantPreferences(local,'scope',assistant);
  assert.deepEqual(readChatAssistantPreferences(local,'scope'),{hostId:'win',providerId:'qwen',projectDirectory:'C:\\Projects\\猫'});
  for(const data of local.data.values()){assert.equal(data.includes('enabled'),false);assert.equal(data.includes('permissions'),false);}
  assert.deepEqual(readChatAssistantPreferences(local,'other'),{hostId:'',providerId:''});
});

test('switching Chat + Agent hosts never carries a Windows path to Ubuntu',()=>{
  const local=storage();saveProjectDirectory(local,'scope','win',assistant.projectDirectory);saveProjectDirectory(local,'scope','ubuntu','/home/me/project');
  const ubuntu=chatAssistantForHost(assistant,'ubuntu',local,'scope');assert.equal(ubuntu.projectDirectory,'/home/me/project');assert.equal(ubuntu.providerId,'qwen');assert.equal(ubuntu.enabled,true);
  assert.equal(chatAssistantForHost(assistant,'new-host',local,'scope').projectDirectory,'');assert.equal(chatAssistantForHost(ubuntu,'win',local,'scope').projectDirectory,assistant.projectDirectory);
});

test('Chat + Agent captures a detached directory and refuses unsupported hosts instead of dropping it',()=>{
  const mutable={...assistant,permissions:{...assistant.permissions}},snapshot=snapshotChatAssistant(mutable,true,[windows]);mutable.projectDirectory='C:\\other';mutable.permissions.access='full-access';
  assert.equal(snapshot.projectDirectory,'C:\\Projects\\猫');assert.equal(snapshot.permissions.access,'read-only');
  assert.throws(()=>snapshotChatAssistant(assistant,true,[{...windows,codex:{}}]),/新版|更新/);
  assert.throws(()=>snapshotChatAssistant({...assistant,projectDirectory:'\n'},true,[windows]),/格式/);
  assert.equal(Object.hasOwn(snapshotChatAssistant({...assistant,projectDirectory:''},true,[{...windows,codex:{}}]),'projectDirectory'),false);
  assert.equal(snapshotChatAssistant(assistant,false,[{...windows,codex:{}}]),undefined);
});
