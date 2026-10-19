import {useEffect,useRef,useState} from 'react';
import {Expand,Loader2,Minimize2,Monitor,MousePointer2,RefreshCw,X} from 'lucide-react';
import type RFB from '@novnc/novnc/lib/rfb.js';
import {getConnection,isSessionChanged,type AgentHost,type User} from './api';
import {useCloudSession} from './platform/cloud-session';
import type {DesktopTicket} from './platform/cloud-docker';
import {remoteDesktopUrl} from './remote-desktop-url.mjs';
import './cloud-docker.css';

export default function RemoteDesktopPanel({host,user,connected,onClose}:{host:AgentHost;user?:User;connected:boolean;onClose():void}){
  const scope=useCloudSession(connected,user),screen=useRef<HTMLDivElement>(null),rfb=useRef<RFB|null>(null);
  const [state,setState]=useState<'connecting'|'connected'|'disconnected'|'error'>('connecting'),[error,setError]=useState(''),[attempt,setAttempt]=useState(0),[expanded,setExpanded]=useState(false),[control,setControl]=useState(false);
  const [narrow,setNarrow]=useState(()=>window.matchMedia('(max-width: 1100px)').matches);
  useEffect(()=>{const query=window.matchMedia('(max-width: 1100px)'),changed=()=>setNarrow(query.matches);query.addEventListener('change',changed);return()=>query.removeEventListener('change',changed);},[]);
  useEffect(()=>{
    if(!scope.allowed||host.kind!=='docker')return;
    const generation=scope.capture(),controller=new AbortController(),baseUrl=getConnection().url;
    let client:RFB|null=null;setState('connecting');setError('');setControl(false);
    const current=()=>!controller.signal.aborted&&scope.current(generation);
    void (async()=>{
      // Fetch code first so a short-lived single-use ticket is consumed promptly.
      const {default:RemoteFramebuffer}=await import('@novnc/novnc/lib/rfb.js');
      if(!current())return;
      const ticket=await scope.request<DesktopTicket>(`/cloud-docker/${encodeURIComponent(host.id)}/desktop-ticket`,{method:'POST',body:'{}',signal:controller.signal},generation);
      if(!current()||!screen.current)return;
      client=new RemoteFramebuffer(screen.current,remoteDesktopUrl(baseUrl,host.id,ticket),{shared:true});
      client.scaleViewport=true;client.resizeSession=false;client.viewOnly=true;client.focusOnClick=true;rfb.current=client;
      client.addEventListener('connect',()=>{if(current())setState('connected');});
      client.addEventListener('disconnect',()=>{if(current()){rfb.current=null;setControl(false);setState('disconnected');}});
      client.addEventListener('securityfailure',()=>{if(current()){setError('远程桌面认证未完成，请重新连接。');setState('error');}});
    })().catch(failure=>{if(current()&&!isSessionChanged(failure)){setState('error');setError((failure as {status?:number}).status===409?'此环境的桌面尚未就绪，请启动后重试。':'无法连接远程桌面，请检查环境状态后重试。');}});
    return()=>{controller.abort();if(rfb.current===client)rfb.current=null;try{client?.disconnect();}catch{/* noVNC may already have released a failed connection. */}screen.current?.replaceChildren();};
  },[scope.allowed,scope.epoch,user?.id,host.id,host.kind,attempt]);
  useEffect(()=>{if(rfb.current)rfb.current.viewOnly=!control;},[control]);
  const modal=narrow||expanded;
  if(!scope.allowed)return null;
  return <aside className={`remote-desktop-panel${expanded?' is-expanded':''}`} role={modal?'dialog':'complementary'} aria-modal={modal||undefined} aria-label={`${host.name}远程桌面`} data-ui-layer={modal?'dialog':undefined}>
    <header><div className="remote-desktop-title"><Monitor size={17}/><div><strong>{host.name}</strong><span>Docker 远程桌面 · {state==='connected'?'已连接':state==='connecting'?'连接中':state==='error'?'连接失败':'已断开'}</span></div></div><div className="cloud-actions"><button className="icon-button" aria-label={expanded?'缩小远程桌面':'扩大远程桌面'} onClick={()=>setExpanded(value=>!value)}>{expanded?<Minimize2 size={17}/>:<Expand size={17}/>}</button><button className="icon-button" aria-label="收起远程桌面" data-ui-dismiss={modal?'dialog':undefined} onClick={onClose}><X size={18}/></button></div></header>
    <div className="remote-desktop-toolbar"><button className="secondary-button" aria-pressed={control} disabled={state!=='connected'} onClick={()=>{if(scope.live()&&rfb.current){setControl(value=>!value);if(!control)rfb.current.focus();}}}><MousePointer2 size={14}/>{control?'正在控制':'允许鼠标键盘'}</button><button className="icon-button" aria-label="重新连接远程桌面" disabled={state==='connecting'} onClick={()=>{if(scope.live())setAttempt(value=>value+1);}}><RefreshCw size={15}/></button></div>
    <div className="remote-desktop-canvas" ref={screen} aria-label="容器桌面画面"/>
    {state!=='connected'&&<div className="remote-desktop-feedback" role={error?'alert':'status'}>{state==='connecting'?<><Loader2 size={20} className="spin"/><span>正在连接容器桌面…</span></>:<><Monitor size={23}/><p>{error||'桌面连接已断开，Agent 任务状态保持独立。'}</p><button className="secondary-button" onClick={()=>{if(scope.live())setAttempt(value=>value+1);}}>重新连接</button></>}</div>}
    <footer>操作仅影响这个云端环境{control?' · 鼠标键盘已启用':' · 当前仅查看'}</footer>
  </aside>;
}
