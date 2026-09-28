import React, { lazy, Suspense, useEffect, useState, useSyncExternalStore } from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';
import './companion.css';
import { getSessionEpoch, initConnection, subscribeSession } from './api';
import { Capacitor } from '@capacitor/core';
import { PetOverlay as NativeOverlay } from './platform/overlay';
import LoginGate from './auth/LoginGate';
const App = lazy(() => import('./App'));
const CompanionWorld = lazy(() => import('./CompanionWorld'));
const PetOverlay = lazy(() => import('./pet/PetOverlay'));
const params = new URLSearchParams(location.search);
const overlay = (params.has('overlay') || params.has('pet')) && (Capacitor.isNativePlatform() || !!window.petpal);
function SessionRoot(){
  const epoch=useSyncExternalStore(subscribeSession,getSessionEpoch,getSessionEpoch);
  const[ready,setReady]=useState(overlay);
  useEffect(()=>{if(overlay)return;let alive=true;void initConnection(Capacitor.getPlatform()==='android'?'https://magicdatou.top:44318':'').finally(()=>{if(alive)setReady(true);}).catch(()=>{});return()=>{alive=false;};},[]);
  useEffect(()=>{const change=()=>{if(Capacitor.isNativePlatform())void NativeOverlay.stop().catch(()=>{});};window.addEventListener('petpal:session-change',change);return()=>window.removeEventListener('petpal:session-change',change);},[]);
  if(!ready)return<div className="loading-view">正在准备账号连接…</div>;
  return<Suspense fallback={overlay?null:<div className="loading-view">小伴正在走来…</div>}>{overlay?<PetOverlay floating={params.has('pet')}/>:<LoginGate key={epoch}>{params.has('chat')?<App/>:<CompanionWorld/>}</LoginGate>}</Suspense>;
}
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><SessionRoot/></React.StrictMode>);
