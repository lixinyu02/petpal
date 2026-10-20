import type { Conversation, State } from '../api';
import type { CompanionNotificationNavigation, PetTaskNotificationsPlugin, TaskAgentNotificationNavigation, TaskNotificationDevice, TaskNotificationNavigation, TaskNotificationStatus } from './task-notifications';
export type TaskNotificationSession={epoch:number;instanceId:string;userId:string;url:string;token:string};
export type CompanionNotificationRun={id:string;status:'completed';trigger:'manual'|'scheduled';scheduledFor:string|null;createdAt:string;finishedAt:string;content:string;title:string;warnings:string[];validUntil:string};
export type CompanionNotificationRunResponse={run:CompanionNotificationRun;instanceId:string;userId:string};
type VerifiedNotificationScope={epoch:number;instanceId:string;userId:string;state:State};
export type VerifiedAgentNavigation=TaskAgentNotificationNavigation & VerifiedNotificationScope & {conversation:Conversation};
export type VerifiedCompanionNavigation=CompanionNotificationNavigation & VerifiedNotificationScope & {companionRun:CompanionNotificationRun};
export type VerifiedTaskNavigation=VerifiedAgentNavigation|VerifiedCompanionNavigation;
export type TaskNotificationSnapshot={status:TaskNotificationStatus|null;busy:boolean;error:string;navigation:VerifiedTaskNavigation|null};
export function notificationServerUrl(value:string):string;
export function notificationNavigation(value:unknown):TaskNotificationNavigation;
export function createTaskNotificationController(dependencies:{native:PetTaskNotificationsPlugin;session():TaskNotificationSession|null;register(deviceId:string,signal:AbortSignal):Promise<TaskNotificationDevice>;revoke(deviceId:string,signal?:AbortSignal,scope?:TaskNotificationSession):Promise<unknown>;refreshState(signal:AbortSignal):Promise<State>;fetchConversation(id:string,signal:AbortSignal):Promise<Conversation>;fetchCompanionRun?(id:string,signal:AbortSignal):Promise<CompanionNotificationRunResponse>;foreground():boolean}):{
  snapshot():TaskNotificationSnapshot;subscribe(listener:()=>void):()=>void;refresh():Promise<TaskNotificationStatus>;reconcile():Promise<void>;consume():Promise<void>;enable():Promise<void>;disable():Promise<void>;invalidate():Promise<void>;takeNavigation():VerifiedTaskNavigation|null;
};
