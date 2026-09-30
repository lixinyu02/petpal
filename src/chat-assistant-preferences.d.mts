import type {AgentHost,AgentPermissions,AssistantTask,ChatAssistantConfig,Conversation,Provider} from './api';
export type ChatAssistantPreferences={hostId:string;providerId:string};
export function readChatAssistantPreferences(storage:Pick<Storage,'getItem'>|undefined,scope:string):ChatAssistantPreferences;
export function saveChatAssistantPreferences(storage:Pick<Storage,'setItem'>|undefined,scope:string,value:ChatAssistantPreferences):void;
export function chatAssistantTargetIssue(value:ChatAssistantPreferences,hosts:AgentHost[],providers?:Provider[],owner?:boolean):string;
export function snapshotChatAssistant(value:ChatAssistantPreferences&{enabled:boolean;permissions:AgentPermissions},allowed:boolean):ChatAssistantConfig|undefined;
export function mergeAssistantTask(tasks:AssistantTask[],task:AssistantTask|undefined):AssistantTask[];
export function mergeChatAssistantConversation(before:Conversation,updated:Conversation,activeId:string|null,busy:boolean):Conversation;
