import { useSyncExternalStore } from 'react';
import { api, getConnection, getIdentity, getSessionEpoch, SessionChangedError, subscribeSession } from '../api';
import type { CompanionKind } from '../api';
import { createCompanionPreference } from './preference-store.mjs';
import { COMPANION_DISPLAY_KEY, companionDisplayRecord, createCompanionCatCapability, effectiveCompanionKind, resolveCompanionDisplay } from './cat-capability.mjs';

let storage:Storage|undefined;
try{storage=window.localStorage;}catch{}
const listeners=new Set<()=>void>();
let scope='',epoch=-1;
let preference:ReturnType<typeof createCompanionPreference>;
let catCapability:ReturnType<typeof createCompanionCatCapability>;
let unsubscribe:(()=>void)|undefined;
let unsubscribeCat:(()=>void)|undefined;
const controllers=new Set<AbortController>();
const notify=()=>{for(const listener of listeners)listener();};
const floating=new URLSearchParams(location.search).has('pet');
const overlay=new URLSearchParams(location.search).has('overlay');
const publish=()=>{
  if(floating||overlay)return;
  const kind=preference.snapshot().kind;
  // Only effective appearance and an explicit public capability cross windows.
  // No identity, credentials, or legacy raw preference is copied or overwritten.
  try{const record=companionDisplayRecord(kind,catCapability.snapshot());if(storage?.getItem(COMPANION_DISPLAY_KEY)!==record)storage?.setItem(COMPANION_DISPLAY_KEY,record);}catch{}
};
function switchScope(){
  const identity=getIdentity(),nextEpoch=getSessionEpoch();
  const nextScope=identity?`user:${identity.instanceId}:${identity.userId}`:`guest:${getConnection().url||location.origin}`;
  if(nextScope===scope&&nextEpoch===epoch)return;
  preference?.dispose();unsubscribe?.();catCapability?.dispose();unsubscribeCat?.();for(const controller of controllers)controller.abort();controllers.clear();
  scope=nextScope;epoch=nextEpoch;
  const ownerEpoch=epoch,ownerScope=scope,authenticated=!!identity;
  catCapability=createCompanionCatCapability({storage,scope});
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
  unsubscribe=preference.subscribe(changed);unsubscribeCat=catCapability.subscribe(changed);publish();notify();
}
switchScope();subscribeSession(switchScope);
window.addEventListener('storage',event=>{
  if(event.key===COMPANION_DISPLAY_KEY){if(floating||overlay)notify();return;}
  catCapability.storageChanged(event.key);
  if(!event.key||event.key===`petpal.companionPreference:${encodeURIComponent(scope)}`)preference.refresh();
  if(!event.key&&(floating||overlay))notify();
});
export function readCompanion():CompanionKind {
  if(!floating&&!overlay)return effectiveCompanionKind(preference.snapshot().kind,catCapability.snapshot());
  let displayRaw:string|null=null;try{displayRaw=storage?.getItem(COMPANION_DISPLAY_KEY)??null;}catch{}
  return resolveCompanionDisplay({kind:preference.snapshot().kind,catEnabled:catCapability.snapshot(),search:location.search,floating,displayRaw,href:location.href});
}
export const rememberCompanion=(kind:CompanionKind)=>preference.remember(kind);
export const chooseCompanion=(kind:CompanionKind)=>kind==='cat'&&!catCapability.snapshot()?Promise.reject(new Error('请先在“小伴个性”中启用 3D 小猫。')):preference.choose(kind);
export const hydrateCompanion=(kind:CompanionKind)=>preference.hydrate(kind);
export const readCompanionCatEnabled=()=>catCapability.snapshot();
export function useCompanionCatEnabled(){
  const enabled=useSyncExternalStore(listener=>{listeners.add(listener);return()=>{listeners.delete(listener);};},readCompanionCatEnabled,()=>false);
  const ownerEpoch=epoch,ownerScope=scope;
  const setEnabled=(next:boolean)=>{if(getSessionEpoch()!==ownerEpoch||epoch!==ownerEpoch||scope!==ownerScope)return;catCapability.setEnabled(next);};
  return[enabled,setEnabled]as const;
}
export function useCompanion(){const kind=useSyncExternalStore(listener=>{listeners.add(listener);return()=>{listeners.delete(listener);};},readCompanion,()=> 'anime' as const);return[kind,rememberCompanion]as const;}
