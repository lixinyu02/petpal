import React, { lazy, Suspense, useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';
import './natural-companion.css';
import './adaptive-screen.css';
import './theme.css';
import './ui-motion.css';
import './ui-polish.css';
import { mountUiMotionLifecycle } from './platform/ui-motion.ts';
import { mountInteractionLayers } from './platform/interaction-layers.mjs';
import {mountThemeLifecycle} from './platform/theme.ts';
import { useViewport } from './platform/useViewport';
import { useAndroidScreen } from './platform/useAndroidScreen';
import { getIdentity, getSessionEpoch, initConnection, subscribeSession, warmInitialState, type LoginSessionBridge } from './api';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { PetOverlay as NativeOverlay, showPet } from './platform/overlay';
import LoginGate from './auth/LoginGate';
import { isPassiveNativeOverlay } from './auth/overlay-entry.mjs';
const SessionNotifications=lazy(()=>import('./platform/SessionNotifications'));
const loadApp=()=>import('./App'),loadCompanionWorld=()=>import('./CompanionWorld');
const App = lazy(loadApp);
const CompanionWorld = lazy(loadCompanionWorld);
const PetOverlay = lazy(() => import('./pet/PetOverlay'));
const params = new URLSearchParams(location.search);
// Authentication remains the gate. Fetch independent page code and startup
// data together only once /auth/me has confirmed the current account.
const prepareVerifiedPage=()=>{void(params.has('chat')?loadApp():loadCompanionWorld()).catch(()=>{});warmInitialState({history:params.has('chat')});};
const overlay = isPassiveNativeOverlay(location.href, Capacitor.isNativePlatform() || !!window.petpal);
if(!overlay&&Capacitor.isNativePlatform()&&Capacitor.getPlatform()==='android'){
  window.petpalLoginSession=registerPlugin<LoginSessionBridge>('PetLoginSession');
}
function SessionRoot(){
  useViewport();
  useAndroidScreen(overlay);
  const[ready,setReady]=useState(overlay);
  useLayoutEffect(() => mountUiMotionLifecycle({ disabled: overlay }), []);
  useEffect(() => overlay ? undefined : mountInteractionLayers(), []);
  useEffect(()=>mountThemeLifecycle({transparent:overlay}),[]);
  useEffect(()=>{
    // An Activity rebuild starts with an empty JS session. Wait for the saved
    // login before allowing the official-account lifecycle to revoke a scope.
    if(!ready||overlay||Capacitor.getPlatform()!=='android'||!Capacitor.isNativePlatform())return;
    let disposed=false,cleanup:(()=>void)|undefined;
    void import('./platform/android-official-account').then(module=>{if(!disposed)cleanup=module.mountAndroidOfficialSession();});
    return()=>{disposed=true;cleanup?.();};
  },[ready]);
  useEffect(()=>{
    if(overlay||Capacitor.getPlatform()!=='android'||!Capacitor.isNativePlatform())return;
    let disposed=false,cleanup:(()=>void)|undefined;
    void import('./platform/android-app-proxy').then(module=>{if(!disposed)cleanup=module.mountAndroidAppProxyLifecycle();});
    return()=>{disposed=true;cleanup?.();};
  },[]);
  const epoch=useSyncExternalStore(subscribeSession,getSessionEpoch,getSessionEpoch);
  const ownerIdentity=getIdentity();
  useEffect(()=>{if(overlay)return;let alive=true;void initConnection(Capacitor.getPlatform()==='android'?'https://magicdatou.top:44318':window.petpal?'':location.origin).finally(()=>{if(alive)setReady(true);}).catch(()=>{});return()=>{alive=false;};},[]);
  useEffect(()=>{const change=()=>{if(Capacitor.isNativePlatform())void NativeOverlay.stop().catch(()=>{});};window.addEventListener('petpal:session-change',change);return()=>window.removeEventListener('petpal:session-change',change);},[]);
  useEffect(()=>{
    if(overlay||!Capacitor.isNativePlatform())return;
    let alive=true;
    // The native asset WebView cannot receive storage events. Keep this sync in
    // the persistent root so leaving settings cannot leave an old cat running.
    void NativeOverlay.status().then(status=>{
      if(alive&&getSessionEpoch()===epoch&&getIdentity()===ownerIdentity&&status.running&&status.companionKind==='cat')return showPet({companionKind:'anime'});
    }).catch(()=>{});
    return()=>{alive=false;};
  },[epoch,ownerIdentity]);
  if(!ready)return<div className="loading-view">正在准备账号连接…</div>;
  return<><Suspense fallback={null}>{!overlay&&Capacitor.getPlatform()==='android'&&Capacitor.isNativePlatform()&&<SessionNotifications/>}</Suspense><Suspense fallback={overlay?null:<div className="loading-view">小伴正在走来…</div>}>{overlay?<PetOverlay floating={params.has('pet')}/>:<LoginGate key={epoch} onVerified={prepareVerifiedPage}>{params.has('chat')?<App/>:<CompanionWorld/>}</LoginGate>}</Suspense></>;
}
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><SessionRoot/></React.StrictMode>);
