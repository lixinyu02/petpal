import type {AndroidMediaPermission,AndroidNotificationChannel,AndroidPermissionKind,AndroidPermissionSettingsResult} from './android-permissions';
export const ANDROID_PERMISSION_SETTINGS:readonly AndroidPermissionKind[];
export function isAndroidPermissionKind(value:unknown):value is AndroidPermissionKind;
export function mediaPermissionPresentation(permission:AndroidMediaPermission|undefined,kind:'microphone'|'camera'):{label:string;help:string;action:'none'|'settings'|'request'};
export function notificationChannelPresentation(channel:AndroidNotificationChannel|undefined):string;
export function permissionSettingsFeedback(result:AndroidPermissionSettingsResult|undefined):string;
export function createMediaPermissionProbe(options:{getUserMedia:(constraints:MediaStreamConstraints)=>Promise<MediaStream>;timeoutMs?:number;setTimer?:typeof setTimeout;clearTimer?:typeof clearTimeout;onSettled?:()=>void}):{pending():boolean;request(kind:'microphone'|'camera',deviceId?:string,signal?:AbortSignal):Promise<void>;dispose():void};
