import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Battery, Bell, BellOff, ChevronDown, Loader2, RefreshCw, Settings2, Smartphone } from 'lucide-react';
import { getConnection, getIdentity, getSessionEpoch, subscribeSession } from './api';
import { PetTaskNotifications, supportsTaskNotifications, type BackgroundSettingsKind, type BackgroundSettingsStatus } from './platform/task-notifications';
import { backgroundSettingsNotice, batteryOptimizationLabel, isBackgroundSettingsKind, phoneSettingsGuide } from './platform/background-settings-guide.mjs';
import { taskNotificationSession } from './platform/task-notification-session';
import { notificationServerUrl } from './platform/task-notification-controller.mjs';
import './task-notifications.css';

function backgroundSettingsScope(){const identity=getIdentity();return `${getSessionEpoch()}:${identity?.instanceId||''}:${identity?.userId||''}`;}

export default function TaskNotificationsSettings({connected}:{connected:boolean}){
  const state=useSyncExternalStore(taskNotificationSession.subscribe,taskNotificationSession.snapshot,taskNotificationSession.snapshot);
  const sessionScope=useSyncExternalStore(subscribeSession,backgroundSettingsScope,backgroundSettingsScope);
  const [systemError,setSystemError]=useState('');
  const [device,setDevice]=useState<BackgroundSettingsStatus|null>(null);
  const [settingsError,setSettingsError]=useState('');
  const [settingsNotice,setSettingsNotice]=useState('');
  const [opening,setOpening]=useState<BackgroundSettingsKind|null>(null);
  const settingsGeneration=useRef(0),settingsRequest=useRef(0),launching=useRef(false);
  const supported=supportsTaskNotifications();
  const refreshDevice=useCallback(async()=>{
    if(!supported||!connected||document.visibilityState!=='visible')return;
    const generation=settingsGeneration.current,request=++settingsRequest.current,scope=backgroundSettingsScope();
    try{
      const result=await PetTaskNotifications.backgroundSettings();
      if(generation!==settingsGeneration.current||request!==settingsRequest.current||scope!==backgroundSettingsScope())return;
      setDevice(result);setSettingsError('');
    }catch{
      if(generation===settingsGeneration.current&&request===settingsRequest.current&&scope===backgroundSettingsScope())setSettingsError('暂时无法读取手机设置，仍可按下方常见路径手动检查。');
    }
  },[supported,connected,sessionScope]);
  useEffect(()=>{if(supported)void taskNotificationSession.refresh().catch(()=>{});},[supported]);
  useEffect(()=>{
    ++settingsGeneration.current;launching.current=false;setOpening(null);setDevice(null);setSystemError('');setSettingsError('');setSettingsNotice('');
    void refreshDevice();
    const visible=()=>{if(document.visibilityState==='visible'){void refreshDevice();void taskNotificationSession.refresh().catch(()=>{});}};
    window.addEventListener('focus',visible);document.addEventListener('visibilitychange',visible);
    return()=>{++settingsGeneration.current;window.removeEventListener('focus',visible);document.removeEventListener('visibilitychange',visible);};
  },[refreshDevice]);
  if(!supported)return null;
  const status=state.status;
  const needsRestart=!!status?.enabled&&!status.running&&status.connection==='idle';
  let https=true;try{notificationServerUrl(getConnection().url);}catch{https=false;}
  const permission=status?.permission==='granted'?'已允许':status?.permission==='denied'?'未允许':'开启时申请';
  const connection=needsRestart?'已停止，需要重新开启':status?.enabled&&!status.running&&status.connection==='connecting'?'正在启动':({connected:'已连接',online:'已连接',starting:'正在启动',connecting:'连接中',reconnecting:'重连中',waiting:'等待任务',offline:'等待网络',error:'连接异常',stopped:'已停止'} as Record<string,string>)[status?.connection||'']||(status?.running?'监听中':status?.enabled?'正在启动':'未开启');
  const error=systemError||state.error||status?.error;
  const guide=phoneSettingsGuide(device);
  function openSystemSettings(){
    if(document.visibilityState!=='visible'||launching.current||!connected)return;
    const generation=settingsGeneration.current,scope=backgroundSettingsScope();launching.current=true;setOpening('app');
    setSystemError('');
    void PetTaskNotifications.openSystemSettings().catch(()=>{if(generation===settingsGeneration.current&&scope===backgroundSettingsScope())setSystemError('暂时无法打开系统设置，请在手机设置中查找“小伴”。');}).finally(()=>{if(generation===settingsGeneration.current){launching.current=false;setOpening(null);}});
  }
  async function openBackgroundSettings(kind:BackgroundSettingsKind){
    if(!isBackgroundSettingsKind(kind)||document.visibilityState!=='visible'||launching.current||!connected)return;
    const generation=settingsGeneration.current,scope=backgroundSettingsScope();launching.current=true;setOpening(kind);setSettingsNotice('');setSettingsError('');
    try{
      const result=await PetTaskNotifications.openBackgroundSettings({kind});
      if(generation===settingsGeneration.current&&scope===backgroundSettingsScope())setSettingsNotice(backgroundSettingsNotice(result));
    }catch{
      if(generation===settingsGeneration.current&&scope===backgroundSettingsScope())setSettingsError('暂时无法打开设置，请按下方常见路径在手机设置中手动查找小伴。');
    }finally{if(generation===settingsGeneration.current){launching.current=false;setOpening(null);}}
  }
  return<details className="task-notification-settings">
    <summary><Bell size={18} aria-hidden="true"/><span><strong>后台任务提醒</strong><small>{needsRestart?connection:status?.enabled?'已开启 · '+connection:'离开应用后提醒 Agent 任务结果'}</small></span><ChevronDown size={16} className="task-notification-chevron" aria-hidden="true"/></summary>
    <div className="task-notification-body">
      <p>收到远程 Agent 的完成或失败提醒，点击返回对应对话。Chat 派发的任务会回到原来的 Chat。</p>
      <dl aria-label="任务提醒状态"><div><dt>通知权限</dt><dd>{permission}</dd></div><div><dt>后台监听</dt><dd>{status?.running?'正在运行':status?.enabled&&!needsRestart?'正在启动':'已停止'}</dd></div><div><dt>服务连接</dt><dd>{connection}</dd></div></dl>
      {!https&&<p className="form-error" role="alert">请先连接可信的 HTTPS 服务，再开启后台提醒。</p>}
      {error&&<p className="form-error" role="alert">{error}</p>}
      <div className="task-notification-actions">{needsRestart&&<button className="primary-button" disabled={!connected||!https||state.busy} onClick={()=>void taskNotificationSession.enable().catch(()=>{})}>{state.busy?<Loader2 size={15} className="spin" aria-hidden="true"/>:<RefreshCw size={15} aria-hidden="true"/>}重新开启</button>}{status?.enabled?<button className="secondary-button" disabled={state.busy} onClick={()=>void taskNotificationSession.disable().catch(()=>{})}><BellOff size={15} aria-hidden="true"/>停止提醒</button>:<button className="primary-button" disabled={!connected||!https||state.busy} onClick={()=>void taskNotificationSession.enable().catch(()=>{})}>{state.busy?<Loader2 size={15} className="spin" aria-hidden="true"/>:<Bell size={15} aria-hidden="true"/>}开启后台提醒</button>}<button className="secondary-button" disabled={state.busy} onClick={()=>{void taskNotificationSession.refresh().catch(()=>{});void refreshDevice();}}><RefreshCw size={14} aria-hidden="true"/>刷新状态</button><button className="secondary-button" disabled={state.busy||!!opening||!connected} onClick={openSystemSettings}><Settings2 size={14} aria-hidden="true"/>系统设置</button></div>
      <details className="task-reliability-settings">
        <summary><Battery size={17} aria-hidden="true"/><span><strong>让提醒更稳定</strong><small>{device?`${guide.name} · ${batteryOptimizationLabel(device.batteryExempt)}`:'检查手机的省电与后台设置'}</small></span><ChevronDown size={15} className="task-reliability-chevron" aria-hidden="true"/></summary>
        <div className="task-reliability-body" aria-busy={!!opening}>
          <p className="task-phone-label"><Smartphone size={15} aria-hidden="true"/><strong>{guide.name}</strong></p>
          <p className="field-help">系统电池优化：{batteryOptimizationLabel(device?.batteryExempt)}。此状态不代表厂商的自启动或后台运行开关已允许。</p>
          <div className="task-reliability-actions">{([['battery','省电限制',Battery],['autostart','自启动设置',Settings2],['notifications','应用通知',Bell]] as const).map(([kind,label,Icon])=><button key={kind} className="secondary-button" disabled={!connected||state.busy||!!opening||device?.routes?.[kind]?.available===false} onClick={()=>void openBackgroundSettings(kind)}>{opening===kind?<Loader2 size={14} className="spin" aria-hidden="true"/>:<Icon size={14} aria-hidden="true"/>}{label}</button>)}</div>
          {settingsError&&<p className="form-error" role="alert">{settingsError}</p>}
          {settingsNotice&&<p className="task-settings-notice" role="status">{settingsNotice}</p>}
          <ol className="task-phone-paths"><li><strong>省电与后台</strong><span>{guide.battery}</span></li><li><strong>启动管理</strong><span>{guide.autostart}</span></li><li><strong>通知</strong><span>{guide.notifications}</span></li></ol>
          <p className="field-help">以上是常见路径，菜单会因系统版本变化。{guide.tips.join(' ')}这些设置由你手动确认，小伴不会自动修改。</p>
          <p className="field-help">强制停止或手机重启后，仍需重新打开小伴并检查后台提醒。允许自启动也不代表重启后会自动开始监听。</p>
        </div>
      </details>
      <p className="field-help">开启后会显示持续通知，可随时停止。系统强制停止或省电限制可能中断提醒；需要时请手动检查系统通知与电池设置。退出或切换账号会停止此设备的提醒。</p>
    </div>
  </details>;
}
