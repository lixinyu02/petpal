import { useSyncExternalStore } from 'react';
import { api, getConnection, getIdentity, getSessionEpoch, SessionChangedError, subscribeSession } from '../api';
import type { CompanionKind } from '../api';
import { createCompanionPreference } from './preference-store.mjs';
import { COMPANION_DISPLAY_KEY, companionDisplayRecord, effectiveCompanionKind, resolveCompanionDisplay } from './cat-capability.mjs';

let storage:Storage|undefined;
try{storage=window.localStorage;}catch{}
const listeners=new Set<()=>void>();
let scope='',epoch=-1;
let preference:ReturnType<typeof createCompanionPreference>;
let unsubscribe:(()=>void)|undefined;
const controllers=new Set<AbortController>();
const notify=()=>{for(const listener of listeners)listener();};
const floating=new URLSearchParams(location.search).has('pet');
const overlay=new URLSearchParams(location.search).has('overlay');
const publish=()=>{
  if(floating||overlay)return;
  const kind=preference.snapshot().kind;
  // Only the supported effective appearance crosses windows.
  // No identity, credentials, or legacy raw preference is copied or overwritten.
  try{const record=companionDisplayRecord(kind);if(storage?.getItem(COMPANION_DISPLAY_KEY)!==record)storage?.setItem(COMPANION_DISPLAY_KEY,record);}catch{}
};
function switchScope(){
  const identity=getIdentity(),nextEpoch=getSessionEpoch();
  const nextScope=identity?`user:${identity.instanceId}:${identity.userId}`:`guest:${getConnection().url||location.origin}`;
  if(nextScope===scope&&nextEpoch===epoch)return;
  preference?.dispose();unsubscribe?.();for(const controller of controllers)controller.abort();controllers.clear();
  scope=nextScope;epoch=nextEpoch;
  const ownerEpoch=epoch,ownerScope=scope,authenticated=!!identity;
  preference=createCompanionPreference({storage,scope,allowLegacy:!identity,
    connected:()=>authenticated&&getSessionEpoch()===ownerEpoch&&scope===ownerScope&&!!getConnection().token,
    persist:async companionKind=>{
      if(getSessionEpoch()!==ownerEpoch||scope!==ownerScope)throw new SessionChangedError();
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);controllers.add(controller);
      try{await api('/settings',{method:'PATCH',body:JSON.stringify({companionKind}),signal:controller.signal});}
      finally{clearTimeout(timer);controllers.delete(controller);}
    },
  });
  const changed=()=>{if(scope!==ownerScope||getSessionEpoch()!==ownerEpoch)return;publish();notify();};
  unsubscribe=preference.subscribe(changed);publish();notify();
}
switchScope();subscribeSession(switchScope);
window.addEventListener('storage',event=>{
  if(event.key===COMPANION_DISPLAY_KEY){if(floating||overlay)notify();return;}
  if(!event.key||event.key===`petpal.companionPreference:${encodeURIComponent(scope)}`)preference.refresh();
  if(!event.key&&(floating||overlay))notify();
});
export function readCompanion():CompanionKind {
  if(!floating&&!overlay)return effectiveCompanionKind(preference.snapshot().kind);
  let displayRaw:string|null=null;try{displayRaw=storage?.getItem(COMPANION_DISPLAY_KEY)??null;}catch{}
  return resolveCompanionDisplay({kind:preference.snapshot().kind,search:location.search,floating,displayRaw,href:location.href});
}
export const rememberCompanion=(kind:CompanionKind)=>preference.remember(kind);
export const chooseCompanion=(kind:CompanionKind)=>kind==='anime'||kind==='cat'?preference.choose(effectiveCompanionKind(kind)):Promise.reject(new TypeError('Companion kind is invalid.'));
export const hydrateCompanion=(kind:CompanionKind)=>preference.hydrate(kind);
export const readCompanionCatEnabled=()=>false as const;
export function useCompanionCatEnabled(){
  // Compatibility only: retired appearance capabilities cannot be enabled.
  return[false,(_next:boolean)=>{}]as const;
}
export function useCompanion(){const kind=useSyncExternalStore(listener=>{listeners.add(listener);return()=>{listeners.delete(listener);};},readCompanion,()=> 'anime' as const);return[kind,rememberCompanion]as const;}
