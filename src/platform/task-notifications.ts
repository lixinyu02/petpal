import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
export type TaskNotificationStatus={enabled:boolean;running:boolean;permission:'granted'|'denied'|'prompt';connection:string;instanceId?:string;userId?:string;deviceId?:string;url?:string;cursor?:number;expiresAt?:string;error?:string};
export type TaskNotificationNavigation={conversationId:string;agentConversationId:string;runId:string;eventId:string;source:'agent'|'chat-agent'};
export type TaskNotificationDevice={deviceId:string;token:string;instanceId:string;userId:string;cursor:number;expiresAt:string};
export interface PetTaskNotificationsPlugin{
  installation():Promise<{deviceId:string}>;
  status():Promise<TaskNotificationStatus>;
  start(input:TaskNotificationDevice & {url:string}):Promise<TaskNotificationStatus>;
  stop():Promise<TaskNotificationStatus>;
  clearScope():Promise<TaskNotificationStatus>;
  openSystemSettings():Promise<void>;
  consumeNavigation(scope:{instanceId:string;userId:string}):Promise<{navigation?:TaskNotificationNavigation}>;
  addListener(event:'navigation'|'status',listener:()=>void):Promise<PluginListenerHandle>;
}
export const PetTaskNotifications=registerPlugin<PetTaskNotificationsPlugin>('PetTaskNotifications');
export const supportsTaskNotifications=()=>Capacitor.getPlatform()==='android'&&Capacitor.isNativePlatform();
