import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PhoneVendor } from './task-notifications';

export type AndroidPermissionKind = 'app'|'microphone'|'camera'|'notifications'|'task'|'companion'|'watch'|'overlay'|'install'|'battery'|'autostart';
export type AndroidMediaPermission = { state:'granted'|'prompt'|'denied'|'settings'|'unsupported'; supported:boolean; blocked:boolean|null };
export type AndroidNotificationChannel = {created:boolean;enabled:boolean};
export type AndroidPermissionStatus = {
  device:{manufacturer:string;brand:string;model:string;apiLevel:number;androidRelease:string;vendor:PhoneVendor};
  microphone:AndroidMediaPermission; camera:AndroidMediaPermission;
  notifications:{runtimeGranted:boolean;enabled:boolean;channels:Record<'task'|'companion'|'watch'|'overlay',AndroidNotificationChannel>};
  overlay:{granted:boolean;supported:boolean}; install:{granted:boolean;supported:boolean}; battery:{exempt:boolean|null};
  routes:Partial<Record<AndroidPermissionKind,{available:boolean}>>;
};
export type AndroidPermissionSettingsResult = {opened:boolean;kind:AndroidPermissionKind;route:string;fallback:boolean};
export const PetPermissions = registerPlugin<{
  status():Promise<AndroidPermissionStatus>;
  openSettings(input:{kind:AndroidPermissionKind}):Promise<AndroidPermissionSettingsResult>;
}>('PetPermissions');
export const supportsAndroidPermissions = () => Capacitor.getPlatform()==='android' && Capacitor.isNativePlatform();
export const hasAndroidPermissionsBridge = () => Capacitor.isPluginAvailable('PetPermissions');
