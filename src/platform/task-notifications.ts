import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
export type TaskNotificationStatus={enabled:boolean;running:boolean;permission:'granted'|'denied'|'prompt';connection:string;instanceId?:string;userId?:string;deviceId?:string;url?:string;cursor?:number;expiresAt?:string;error?:string};
export type TaskNotificationNavigation={conversationId:string;agentConversationId:string;runId:string;eventId:string;source:'agent'|'chat-agent'};
export type TaskNotificationDevice={deviceId:string;token:string;instanceId:string;userId:string;cursor:number;expiresAt:string};
export type BackgroundSettingsKind='battery'|'autostart'|'notifications'|'app';
export type PhoneVendor='xiaomi'|'huawei'|'honor'|'oppo'|'vivo'|'samsung'|'meizu'|'asus'|'generic';
export type BackgroundSettingsRoute={available:boolean;direct:boolean;route:string;fallback:boolean};
export type BackgroundSettingsStatus={manufacturer:string;brand:string;vendor:PhoneVendor;apiLevel:number;batteryExempt:boolean|null;routes:Record<BackgroundSettingsKind,BackgroundSettingsRoute>};
export type BackgroundSettingsOpened={opened:boolean;kind:BackgroundSettingsKind;route:string;fallback:boolean};
export interface PetTaskNotificationsPlugin{
  installation():Promise<{deviceId:string}>;
  status():Promise<TaskNotificationStatus>;
  start(input:TaskNotificationDevice & {url:string}):Promise<TaskNotificationStatus>;
  stop():Promise<TaskNotificationStatus>;
  clearScope():Promise<TaskNotificationStatus>;
  openSystemSettings():Promise<void>;
  backgroundSettings():Promise<BackgroundSettingsStatus>;
  openBackgroundSettings(input:{kind:BackgroundSettingsKind}):Promise<BackgroundSettingsOpened>;
  consumeNavigation(scope:{instanceId:string;userId:string}):Promise<{navigation?:TaskNotificationNavigation}>;
  addListener(event:'navigation'|'status',listener:()=>void):Promise<PluginListenerHandle>;
}
export const PetTaskNotifications=registerPlugin<PetTaskNotificationsPlugin>('PetTaskNotifications');
export const supportsTaskNotifications=()=>Capacitor.getPlatform()==='android'&&Capacitor.isNativePlatform();
