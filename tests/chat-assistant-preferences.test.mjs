import test from 'node:test';
import assert from 'node:assert/strict';
import {chatAssistantDefaultIssue,chatAssistantTargetIssue,mergeAssistantTask,mergeChatAssistantConversation,readChatAssistantPreferences,restoreChatAssistantPreferences,saveChatAssistantPreferences,snapshotChatAssistant} from '../src/chat-assistant-preferences.mjs';

const storage=()=>{const entries=new Map();return{getItem:key=>entries.get(key)||null,setItem:(key,value)=>entries.set(key,value),entries};};
const selected={hostId:'desk-one',providerId:'model-one',enabled:true,permissions:{access:'full-access',approval:'auto'}};

test('a remembered target never persists autonomy or execution permissions, and is isolated by account',()=>{
  const local=storage();saveChatAssistantPreferences(local,'server:alice',selected);
  assert.deepEqual(readChatAssistantPreferences(local,'server:alice'),{hostId:'desk-one',providerId:'model-one'});
  assert.deepEqual(readChatAssistantPreferences(local,'server:bob'),{hostId:'',providerId:''});
  assert.deepEqual(readChatAssistantPreferences(local,''),{hostId:'',providerId:''});
  const saved=JSON.parse([...local.entries.values()][0]);assert.equal(Object.hasOwn(saved,'enabled'),false);assert.equal(Object.hasOwn(saved,'permissions'),false);
  local.setItem([...local.entries.keys()][0],JSON.stringify({...selected,enabled:true}));
  assert.equal(Object.hasOwn(readChatAssistantPreferences(local,'server:alice'),'enabled'),false);
});

test('each turn takes a detached host, model and permission snapshot; disabled or unauthenticated returns nothing',()=>{
  const mutable={...selected,permissions:{...selected.permissions}},turn=snapshotChatAssistant(mutable,true);
  mutable.hostId='desk-two';mutable.providerId='model-two';mutable.permissions.access='read-only';
  assert.deepEqual(turn,{enabled:true,hostId:'desk-one',providerId:'model-one',permissions:{access:'full-access',approval:'auto'}});
  assert.equal(snapshotChatAssistant(selected,false),undefined);
  assert.equal(snapshotChatAssistant({...selected,enabled:false},true),undefined);
  assert.throws(()=>snapshotChatAssistant({...selected,hostId:''},true),/默认执行电脑/);
});

test('account default overrides a stale browser target without persisting authority or changing other accounts',()=>{
  const local=storage();saveChatAssistantPreferences(local,'server:alice',selected);
  const restored=restoreChatAssistantPreferences(local,'server:alice','central');
  assert.equal(restored.hostId,'central');assert.equal(restored.providerId,'model-one');
  assert.equal(Object.hasOwn(restored,'enabled'),false);assert.equal(Object.hasOwn(restored,'permissions'),false);
  assert.equal(restoreChatAssistantPreferences(local,'server:bob',null).hostId,'');
  assert.equal(restoreChatAssistantPreferences(local,'server:alice',null).hostId,'desk-one');
  assert.match(chatAssistantDefaultIssue(selected,''),/保存/);
  assert.equal(chatAssistantDefaultIssue(selected,'desk-one'),'');
});

test('an enabled turn cannot use an unsaved candidate or silently switch away from an unavailable account default',()=>{
  assert.throws(()=>snapshotChatAssistant(selected,true,undefined,''),/默认执行电脑/);
  assert.throws(()=>snapshotChatAssistant(selected,true,undefined,'desk-two'),/默认执行电脑/);
  assert.equal(snapshotChatAssistant({...selected,enabled:false},true,undefined,''),undefined);
  const local=storage();saveChatAssistantPreferences(local,'server:alice',selected);
  const restored=restoreChatAssistantPreferences(local,'server:alice','missing-desktop');
  assert.equal(restored.hostId,'missing-desktop');
  assert.match(chatAssistantTargetIssue(restored,[{id:'central',online:true}],[],true),/离线/);
  assert.equal(snapshotChatAssistant({...selected,hostId:'missing-desktop'},true,undefined,'missing-desktop').hostId,'missing-desktop');
});

test('offline or missing targets are preserved and never rerouted to another online computer',()=>{
  const hosts=[{id:'central',kind:'central',online:true,codex:{available:true}},{id:'desk-one',kind:'desktop',online:false}];
  assert.match(chatAssistantTargetIssue(selected,hosts,[{id:'model-one'}]),/离线/);
  assert.equal(snapshotChatAssistant(selected,true).hostId,'desk-one');
  assert.match(chatAssistantTargetIssue({...selected,hostId:'gone'},hosts,[{id:'model-one'}]),/离线/);
  assert.match(chatAssistantTargetIssue({...selected,hostId:''},hosts,[{id:'model-one'}]),/选择/);
  assert.equal(chatAssistantTargetIssue({...selected,hostId:'central'},hosts,[{id:'model-one'}]),'');
});

test('ordinary accounts need an assigned Agent model; owners can explicitly use the host default',()=>{
  const hosts=[{id:'desk-one',online:true,codex:{available:true}}];
  assert.match(chatAssistantTargetIssue({...selected,providerId:''},hosts,[]),/Agent 模型/);
  assert.equal(chatAssistantTargetIssue({...selected,providerId:''},hosts,[],true),'');
  assert.match(chatAssistantTargetIssue(selected,hosts,[]),/已不可用/);
  assert.match(chatAssistantTargetIssue(selected,[{id:'desk-one',online:true,codex:{available:false}}],[{id:'model-one'}]),/Agent 暂不可用/);
});

test('late task events cannot regress a completed or running task while separate tasks retain order',()=>{
  let tasks=mergeAssistantTask([],{id:'one',status:'deciding',message:'判定'});
  tasks=mergeAssistantTask(tasks,{id:'one',status:'running',conversationId:'child',message:'执行'});
  assert.equal(mergeAssistantTask(tasks,{id:'one',status:'queued'}),tasks);
  tasks=mergeAssistantTask(tasks,{id:'one',status:'completed',message:'完成'});
  assert.equal(tasks[0].conversationId,'child');
  assert.equal(mergeAssistantTask(tasks,{id:'one',status:'running'}),tasks);
  tasks=mergeAssistantTask(tasks,{id:'two',status:'queued'});
  assert.deepEqual(tasks.map(item=>item.id),['one','two']);
  assert.equal(mergeAssistantTask(tasks,{id:'two',status:'invalid'}),tasks);
});

test('background progress cannot overwrite a foreground reply or replay an older streaming snapshot',()=>{
  const before={id:'chat',messages:[{id:'user'},{id:'reply',status:'streaming',content:'fresh'}],assistantTasks:[{id:'task',status:'running'}]};
  const old={id:'chat',messages:[{id:'user'},{id:'reply',status:'streaming',content:'stale'}],assistantTasks:[{id:'task',status:'completed'}]};
  const busy=mergeChatAssistantConversation(before,old,'chat',true);
  assert.equal(busy.messages,before.messages);assert.equal(busy.assistantTasks[0].status,'completed');
  const completed={...before,messages:[{id:'user'},{id:'reply',status:'complete',content:'finished'}]};
  assert.equal(mergeChatAssistantConversation(completed,old,null,false).messages,completed.messages);
  const delivered={...old,messages:[...completed.messages,{id:'background-result',status:'complete',content:'result'}]};
  assert.deepEqual(mergeChatAssistantConversation(completed,delivered,null,false).messages.map(message=>message.id),['user','reply','background-result']);
  assert.equal(mergeChatAssistantConversation(delivered,completed,null,false).messages,delivered.messages);
});
