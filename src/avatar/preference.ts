import { useSyncExternalStore } from 'react';
import { api, getConnection, getIdentity, getSessionEpoch, SessionChangedError, subscribeSession } from '../api';
import type { CompanionKind } from '../api';
import { createCompanionPreference, overlayCompanion } from './preference-store.mjs';

const DISPLAY_KEY='petpal.displayCompanion';
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
  // Only the public shape selection crosses windows. Credentials and account state never do.
  try{storage?.setItem(DISPLAY_KEY,JSON.stringify({kind}));storage?.setItem('petpal.companionKind',kind);}catch{}
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
  unsubscribe=preference.subscribe(()=>{publish();notify();});publish();notify();
}
switchScope();subscribeSession(switchScope);
window.addEventListener('storage',event=>{
  if(event.key===DISPLAY_KEY){if(floating)notify();return;}
  if(!event.key||event.key===`petpal.companionPreference:${encodeURIComponent(scope)}`)preference.refresh();
});
export function readCompanion():CompanionKind {
  const specified=overlayCompanion(location.search);if(specified)return specified;
  if(floating){try{const value=JSON.parse(storage?.getItem(DISPLAY_KEY)||'{}');if(value.kind==='cat'||value.kind==='anime')return value.kind;}catch{}return'anime';}
  return preference.snapshot().kind;
}
export const rememberCompanion=(kind:CompanionKind)=>preference.remember(kind);
export const chooseCompanion=(kind:CompanionKind)=>preference.choose(kind);
export const hydrateCompanion=(kind:CompanionKind)=>preference.hydrate(kind);
export function useCompanion(){const kind=useSyncExternalStore(listener=>{listeners.add(listener);return()=>{listeners.delete(listener);};},readCompanion,()=> 'anime' as const);return[kind,rememberCompanion]as const;}
