import type {CompanionKind} from '../api';
export const COMPANION_DISPLAY_KEY:string;
export function companionCatStorageKey(scope?:string):string;
export function effectiveCompanionKind(kind:unknown,enabled?:boolean):CompanionKind;
export function companionDisplayRecord(kind:CompanionKind,enabled?:boolean):string;
export function readCompanionDisplay(raw:unknown):{kind:CompanionKind;catEnabled:boolean};
export function isExplicitNativeCatOverlay(href:string):boolean;
export function resolveCompanionDisplay(options?:{kind?:CompanionKind;catEnabled?:boolean;search?:string;floating?:boolean;displayRaw?:string|null;href?:string}):CompanionKind;
export function createCompanionCatCapability(options?:{storage?:Pick<Storage,'getItem'|'setItem'>;scope?:string}):{
  snapshot():boolean;
  subscribe(listener:()=>void):()=>void;
  setEnabled(enabled:boolean):void;
  refresh():void;
  storageChanged(key:string|null):void;
  dispose():void;
};
