import type {CompanionKind} from '../api';
export const COMPANION_DISPLAY_KEY:string;
export function companionCatStorageKey(scope?:string):string;
export function effectiveCompanionKind(kind:unknown,enabled?:boolean):'anime';
export function companionDisplayRecord(kind:CompanionKind,enabled?:boolean):string;
export function readCompanionDisplay(raw:unknown):{kind:'anime';catEnabled:false};
export function isExplicitNativeCatOverlay(href:string):false;
export function resolveCompanionDisplay(options?:{kind?:CompanionKind;catEnabled?:boolean;search?:string;floating?:boolean;displayRaw?:string|null;href?:string}):'anime';
export function createCompanionCatCapability(options?:{storage?:Pick<Storage,'getItem'|'setItem'>;scope?:string}):{
  snapshot():false;
  subscribe(listener:()=>void):()=>void;
  setEnabled(enabled:boolean):void;
  refresh():void;
  storageChanged(key:string|null):void;
  dispose():void;
};
