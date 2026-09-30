import React, { lazy, Suspense, useEffect, useState, useSyncExternalStore } from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';
import './companion.css';
import './natural-companion.css';
import './adaptive-screen.css';
import { useViewport } from './platform/useViewport';
import { getIdentity, getSessionEpoch, initConnection, subscribeSession } from './api';
import { readCompanionCatEnabled, useCompanionCatEnabled } from './avatar/preference';
import { Capacitor } from '@capacitor/core';
import { PetOverlay as NativeOverlay, showPet } from './platform/overlay';
import LoginGate from './auth/LoginGate';
import { isPassiveNativeOverlay } from './auth/overlay-entry.mjs';
const App = lazy(() => import('./App'));
const CompanionWorld = lazy(() => import('./CompanionWorld'));
const PetOverlay = lazy(() => import('./pet/PetOverlay'));
const params = new URLSearchParams(location.search);
const overlay = isPassiveNativeOverlay(location.href, Capacitor.isNativePlatform() || !!window.petpal);
function SessionRoot(){
  useViewport();
  const epoch=useSyncExternalStore(subscribeSession,getSessionEpoch,getSessionEpoch);
  const [catEnabled]=useCompanionCatEnabled(),ownerIdentity=getIdentity();
  const[ready,setReady]=useState(overlay);
  useEffect(()=>{if(overlay)return;let alive=true;void initConnection(Capacitor.getPlatform()==='android'||window.petpal?'https://magicdatou.top:44318':'').finally(()=>{if(alive)setReady(true);}).catch(()=>{});return()=>{alive=false;};},[]);
  useEffect(()=>{const change=()=>{if(Capacitor.isNativePlatform())void NativeOverlay.stop().catch(()=>{});};window.addEventListener('petpal:session-change',change);return()=>window.removeEventListener('petpal:session-change',change);},[]);
  useEffect(()=>{
    if(overlay||catEnabled||!Capacitor.isNativePlatform())return;
    let alive=true;
    // The native asset WebView cannot receive storage events. Keep this sync in
    // the persistent root so leaving settings cannot leave an old cat running.
    void NativeOverlay.status().then(status=>{
      if(alive&&getSessionEpoch()===epoch&&getIdentity()===ownerIdentity&&!readCompanionCatEnabled()&&status.running&&status.companionKind==='cat')return showPet({companionKind:'anime'});
    }).catch(()=>{});
    return()=>{alive=false;};
  },[catEnabled,epoch,ownerIdentity]);
  if(!ready)return<div className="loading-view">正在准备账号连接…</div>;
  return<Suspense fallback={overlay?null:<div className="loading-view">小伴正在走来…</div>}>{overlay?<PetOverlay floating={params.has('pet')}/>:<LoginGate key={epoch}>{params.has('chat')?<App/>:<CompanionWorld/>}</LoginGate>}</Suspense>;
}
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><SessionRoot/></React.StrictMode>);
