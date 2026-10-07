import {reuseConversationMessages} from './conversation-message-reuse.mjs';

/** Keep local durable organization when an older stream/poll completes later. */
export function mergeConversationOrganization(before, incoming, preserve) {
  const snapshot = reuseConversationMessages(before, incoming);
  if (!before || before.id !== incoming.id || !preserve) return snapshot;
  return {...snapshot,title:before.title,customTitle:before.customTitle,projectId:before.projectId??null,archivedAt:before.archivedAt??null};
}

export function mergeOrganizationSnapshot(before, incoming, preserve, deletedIds) {
  const previous=new Map(before.conversations.map(item=>[item.id,item]));
  return {...incoming,...(preserve?{projects:before.projects??[]} : {}),conversations:incoming.conversations.filter(item=>!deletedIds.has(item.id)).map(item=>mergeConversationOrganization(previous.get(item.id),item,preserve))};
}

/** Project classification never changes Agent's filesystem working directory. */
export function creationProjectId(filter, projects) {
  return projects.some(project=>project.id===filter)?filter:null;
}

export function conversationHistoryScope(conversation, filter) {
  const project=conversation.projectId??null;
  return {projectFilter:filter==='all'?'all':project??'unassigned',archived:!!conversation.archivedAt};
}
