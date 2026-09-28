import { Capacitor, registerPlugin } from '@capacitor/core';

export type UpdateRelease = {id:string;target:string;version:string;versionCode?:number;url?:string;repository?:string;revision?:string;manifestHash?:string;sequence?:number;sha256:string;bytes:number;format:string;notes:string};
export type UpdateStatus = {platform?:string;received?:number;total?:number;target:string;currentVersion:string;versionCode?:number;phase:string;progress?:{received:number;total:number};release?:UpdateRelease;error?:string;message?:string;canInstall:boolean;installMode?:string};
export type DesktopUpdates = {
  status():Promise<UpdateStatus>;check():Promise<UpdateStatus>;download(id:string):Promise<UpdateStatus>;
  install(id:string):Promise<UpdateStatus>;cancel():Promise<UpdateStatus>;
};
export type UpdateConfig = {repository:string;publicKey:string;revision:string;configured:boolean;channel:string};
export type UpdateCheck = {configured:boolean;currentVersion:string;target:string;available:boolean;release:UpdateRelease|null;message:string};
export const CLIENT_VERSION = __PETPAL_VERSION__;
declare const __PETPAL_VERSION__:string;
export const androidUpdates = registerPlugin<{
  status():Promise<UpdateStatus>;download(options:{release:UpdateRelease}):Promise<UpdateStatus>;
  install():Promise<UpdateStatus>;cancel():Promise<UpdateStatus>;
}>('PetUpdater');
export const updatePlatform = () => window.petpal?.updates ? 'desktop' : Capacitor.getPlatform()==='android' ? 'android' : 'web';
export function nativeUpdates() {return updatePlatform()==='desktop' ? window.petpal!.updates! : androidUpdates;}
