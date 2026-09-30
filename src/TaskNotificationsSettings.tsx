import { useEffect, useState, useSyncExternalStore } from 'react';
import { Bell, BellOff, ChevronDown, Loader2, RefreshCw, Settings2 } from 'lucide-react';
import { getConnection } from './api';
import { PetTaskNotifications, supportsTaskNotifications } from './platform/task-notifications';
import { taskNotificationSession } from './platform/task-notification-session';
import { notificationServerUrl } from './platform/task-notification-controller.mjs';
import './task-notifications.css';

export default function TaskNotificationsSettings({connected}:{connected:boolean}){
  const state=useSyncExternalStore(taskNotificationSession.subscribe,taskNotificationSession.snapshot,taskNotificationSession.snapshot);
  const [systemError,setSystemError]=useState('');
  const supported=supportsTaskNotifications();
  useEffect(()=>{if(supported)void taskNotificationSession.refresh().catch(()=>{});},[supported]);
  if(!supported)return null;
  const status=state.status;
  const needsRestart=!!status?.enabled&&!status.running&&status.connection==='idle';
  let https=true;try{notificationServerUrl(getConnection().url);}catch{https=false;}
  const permission=status?.permission==='granted'?'已允许':status?.permission==='denied'?'未允许':'开启时申请';
  const connection=needsRestart?'已停止，需要重新开启':status?.enabled&&!status.running&&status.connection==='connecting'?'正在启动':({connected:'已连接',online:'已连接',starting:'正在启动',connecting:'连接中',reconnecting:'重连中',waiting:'等待任务',offline:'等待网络',error:'连接异常',stopped:'已停止'} as Record<string,string>)[status?.connection||'']||(status?.running?'监听中':status?.enabled?'正在启动':'未开启');
  const error=systemError||state.error||status?.error;
  function openSystemSettings(){
    if(document.visibilityState!=='visible')return;
    setSystemError('');
    void PetTaskNotifications.openSystemSettings().catch(()=>setSystemError('暂时无法打开系统设置，请在手机设置中查找“小伴”。'));
  }
  return<details className="task-notification-settings">
    <summary><Bell size={18} aria-hidden="true"/><span><strong>后台任务提醒</strong><small>{needsRestart?connection:status?.enabled?'已开启 · '+connection:'离开应用后提醒 Agent 任务结果'}</small></span><ChevronDown size={16} className="task-notification-chevron" aria-hidden="true"/></summary>
    <div className="task-notification-body">
      <p>收到远程 Agent 的完成或失败提醒，点击返回对应对话。Chat 派发的任务会回到原来的 Chat。</p>
      <dl aria-label="任务提醒状态"><div><dt>通知权限</dt><dd>{permission}</dd></div><div><dt>后台监听</dt><dd>{status?.running?'正在运行':status?.enabled&&!needsRestart?'正在启动':'已停止'}</dd></div><div><dt>服务连接</dt><dd>{connection}</dd></div></dl>
      {!https&&<p className="form-error" role="alert">请先连接可信的 HTTPS 服务，再开启后台提醒。</p>}
      {error&&<p className="form-error" role="alert">{error}</p>}
      <div className="task-notification-actions">{needsRestart&&<button className="primary-button" disabled={!connected||!https||state.busy} onClick={()=>void taskNotificationSession.enable().catch(()=>{})}>{state.busy?<Loader2 size={15} className="spin" aria-hidden="true"/>:<RefreshCw size={15} aria-hidden="true"/>}重新开启</button>}{status?.enabled?<button className="secondary-button" disabled={state.busy} onClick={()=>void taskNotificationSession.disable().catch(()=>{})}><BellOff size={15} aria-hidden="true"/>停止提醒</button>:<button className="primary-button" disabled={!connected||!https||state.busy} onClick={()=>void taskNotificationSession.enable().catch(()=>{})}>{state.busy?<Loader2 size={15} className="spin" aria-hidden="true"/>:<Bell size={15} aria-hidden="true"/>}开启后台提醒</button>}<button className="secondary-button" disabled={state.busy} onClick={()=>void taskNotificationSession.refresh().catch(()=>{})}><RefreshCw size={14} aria-hidden="true"/>刷新状态</button><button className="secondary-button" disabled={state.busy} onClick={openSystemSettings}><Settings2 size={14} aria-hidden="true"/>系统设置</button></div>
      <p className="field-help">开启后会显示持续通知，可随时停止。系统强制停止或省电限制可能中断提醒；需要时请手动检查系统通知与电池设置。退出或切换账号会停止此设备的提醒。</p>
    </div>
  </details>;
}
