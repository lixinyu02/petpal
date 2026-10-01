import type {AgentHost,AgentPermissions,AssistantTask,ChatAssistantConfig,Conversation,Provider} from './api';
export type ChatAssistantPreferences={hostId:string;providerId:string;projectDirectory?:string};
export function readChatAssistantPreferences(storage:Pick<Storage,'getItem'>|undefined,scope:string):ChatAssistantPreferences;
export function saveChatAssistantPreferences(storage:Pick<Storage,'getItem'|'setItem'>|undefined,scope:string,value:ChatAssistantPreferences):void;
export function chatAssistantTargetIssue(value:ChatAssistantPreferences,hosts:AgentHost[],providers?:Provider[],owner?:boolean):string;
export function snapshotChatAssistant(value:ChatAssistantPreferences&{enabled:boolean;permissions:AgentPermissions},allowed:boolean,hosts?:AgentHost[]):ChatAssistantConfig|undefined;
export function chatAssistantForHost<T extends ChatAssistantPreferences>(value:T,hostId:string,storage:Pick<Storage,'getItem'>|undefined,scope:string):T&{projectDirectory:string};
export function mergeAssistantTask(tasks:AssistantTask[],task:AssistantTask|undefined):AssistantTask[];
export function mergeChatAssistantConversation(before:Conversation,updated:Conversation,activeId:string|null,busy:boolean):Conversation;
