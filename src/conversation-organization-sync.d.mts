import type {Conversation,ConversationProject,State} from './api';
export function mergeConversationOrganization(before:Conversation|undefined,incoming:Conversation,preserve:boolean):Conversation;
export function mergeOrganizationSnapshot(before:State,incoming:State,preserve:boolean,deletedIds:Set<string>):State;
export function creationProjectId(filter:string,projects:ConversationProject[]):string|null;
export function conversationHistoryScope(conversation:Conversation,filter:string):{projectFilter:string;archived:boolean};
