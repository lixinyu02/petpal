import type {AgentApproval} from './api';
import type {ChatDisplay} from './chat-display.mjs';
import type {ChatRecovery} from './chat-completion.mjs';
export type ChatRunPhase='running'|'complete'|'error'|'cancelled';
export type ChatRun={conversationId:string|null;requestId:number;clientRequestId:string;controller:AbortController;pending:boolean;phase:ChatRunPhase;status:string;error:string;approvals:AgentApproval[];unread:boolean;retryDraft:string;display?:ChatDisplay;recovery?:ChatRecovery};
export type ChatRuns={isClosed():boolean;owns(run:ChatRun):boolean;get(id:string|null):ChatRun|undefined;begin(id:string|null,options:{requestId:number;clientRequestId:string}):ChatRun;attach(run:ChatRun,id:string):void;finish(run:ChatRun,options?:{phase?:Exclude<ChatRunPhase,'running'>;unread?:boolean}):boolean;seen(id:string|null):void;pendingIds():Set<string>;activity():Record<string,ChatRunPhase>;discard(id:string|null):void;close():void};
export function createChatRuns(options?:{isCurrent?():boolean;onChange?():void}):ChatRuns;
