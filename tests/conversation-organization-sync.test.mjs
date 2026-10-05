import test from 'node:test';
import assert from 'node:assert/strict';
import {creationProjectId,conversationHistoryScope,mergeConversationOrganization,mergeOrganizationSnapshot} from '../src/conversation-organization-sync.mjs';

test('late stream preserves durable classification and rename without losing fresh messages',()=>{
  const before={id:'chat',title:'手动名称',customTitle:'手动名称',projectId:'work',archivedAt:'today',messages:[]};
  const incoming={id:'chat',title:'自动名称',projectId:null,archivedAt:null,messages:[{content:'new'}],assistantTasks:[{status:'completed'}]};
  const merged=mergeConversationOrganization(before,incoming,true);
  assert.equal(merged.title,'手动名称');assert.equal(merged.projectId,'work');assert.equal(merged.archivedAt,'today');assert.equal(merged.customTitle,'手动名称');
  assert.equal(merged.messages,incoming.messages);assert.equal(merged.assistantTasks,incoming.assistantTasks);
  assert.equal(mergeConversationOrganization(before,incoming,false),incoming);
});
test('older state cannot resurrect deleted conversations or project catalog',()=>{
  const before={projects:[{id:'new'}],conversations:[{id:'keep',title:'renamed',projectId:null,archivedAt:'now'}]};
  const incoming={projects:[{id:'old'}],settings:{value:'fresh'},conversations:[{id:'gone'},{id:'keep',title:'old',messages:['fresh']} ]};
  const merged=mergeOrganizationSnapshot(before,incoming,true,new Set(['gone']));
  assert.deepEqual(merged.projects,before.projects);assert.equal(merged.conversations.length,1);assert.equal(merged.conversations[0].title,'renamed');assert.deepEqual(merged.conversations[0].messages,['fresh']);assert.equal(merged.settings,incoming.settings);
  assert.deepEqual(mergeOrganizationSnapshot(before,incoming,false,new Set()).projects,incoming.projects);
});
test('new Chat and Agent only inherit an existing selected conversation project',()=>{
  const projects=[{id:'group',name:'项目'}];
  for(const filter of ['all','unassigned','deleted'])assert.equal(creationProjectId(filter,projects),null);
  assert.equal(creationProjectId('group',projects),'group');
});
test('archived deep links and notifications reveal the selected conversation',()=>{
  assert.deepEqual(conversationHistoryScope({projectId:'work',archivedAt:'now'},'different'),{projectFilter:'work',archived:true});
  assert.deepEqual(conversationHistoryScope({projectId:null},'work'),{projectFilter:'unassigned',archived:false});
  assert.deepEqual(conversationHistoryScope({projectId:'work'},'all'),{projectFilter:'all',archived:false});
});
