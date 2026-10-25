import {reuseConversationMessages} from './conversation-message-reuse.mjs';

/** Keep local durable organization when an older stream/poll completes later. */
export function mergeConversationOrganization(before, incoming, preserve) {
  const snapshot = reuseConversationMessages(before, incoming);
  if (!before || before.id !== incoming.id || !preserve) return snapshot;
  return {...snapshot,title:before.title,customTitle:before.customTitle,projectId:before.projectId??null,archivedAt:before.archivedAt??null};
}

export function mergeOrganizationSnapshot(before, incoming, preserve, deletedIds, pendingChatIds=new Set()) {
  const previous=new Map(before.conversations.map(item=>[item.id,item]));
  const conversations=incoming.conversations.filter(item=>!deletedIds.has(item.id)).map(item=>{
    const prior=previous.get(item.id),snapshot=mergeConversationOrganization(prior,item,preserve);
    return prior&&prior.mode==='chat'&&pendingChatIds.has(item.id)?{...snapshot,messages:prior.messages,assistantTasks:prior.assistantTasks}:snapshot;
  });
  const ids=new Set(conversations.map(item=>item.id));
  for(const prior of before.conversations)if(prior.mode==='chat'&&pendingChatIds.has(prior.id)&&!deletedIds.has(prior.id)&&!ids.has(prior.id))conversations.push(prior);
  return {...incoming,...(preserve?{projects:before.projects??[]} : {}),conversations};
}

/** Project classification never changes Agent's filesystem working directory. */
export function creationProjectId(filter, projects) {
  return projects.some(project=>project.id===filter)?filter:null;
}

export function conversationHistoryScope(conversation, filter) {
  const project=conversation.projectId??null;
  return {projectFilter:filter==='all'?'all':project??'unassigned',archived:!!conversation.archivedAt};
}
