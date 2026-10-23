import type {Conversation,Message,State} from './api';
export function createChatRequestId(random?:Pick<Crypto,'getRandomValues'>&Partial<Pick<Crypto,'randomUUID'>>):string;
export function readChatTerminalSnapshot(value:unknown,conversationId:string,messageId?:string):{conversation:Conversation;reply:Message}|null;
export function mergeChatCompletionSnapshot(previous:State,incoming:Conversation,options:{conversationId:string;isCurrent():boolean;preserveOrganization?:boolean;deletedIds?:Set<string>}):State;
export type ChatCompletion={finish(reply?:Message,shouldSpeak?:boolean):boolean};
export function createChatCompletion(options:{isCurrent():boolean;release():void;speak(reply:Message):void}):ChatCompletion;
export type ChatRecovery={finished:Promise<void>;cancel():void};
export function startChatRecovery(options:{read(signal:AbortSignal):Promise<Conversation>;onConversation(value:Conversation,isCurrent:()=>boolean):void;onError?(error:unknown,isCurrent:()=>boolean):void;isCurrent():boolean;timeoutMs?:number;schedule?(callback:()=>void,delay:number):ReturnType<typeof setTimeout>;cancelTimer?(timer:ReturnType<typeof setTimeout>):void}):ChatRecovery;
