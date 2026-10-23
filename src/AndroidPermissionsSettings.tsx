import {useEffect,useRef,useState,useSyncExternalStore,type ReactNode} from 'react';
import {Bell,Camera,ChevronDown,Download,Loader2,Mic,PanelsTopLeft,RefreshCw,Settings2,ShieldCheck,Smartphone} from 'lucide-react';
import {getIdentity,getSessionEpoch,subscribeSession} from './api';
import {createDevicePreferences} from './media/device-preferences.mjs';
import {mediaFailure} from './media/devices';
import {PetPermissions,hasAndroidPermissionsBridge,supportsAndroidPermissions,type AndroidPermissionKind,type AndroidPermissionStatus} from './platform/android-permissions';
import {createMediaPermissionProbe,isAndroidPermissionKind,mediaPermissionPresentation,notificationChannelPresentation,permissionSettingsFeedback} from './platform/android-permission-policy.mjs';
import {batteryOptimizationLabel,phoneDeviceLabel,phoneSystemLabel} from './platform/background-settings-guide.mjs';
import './android-permissions.css';

function accountScope(){const identity=getIdentity();return `${getSessionEpoch()}:${identity?.instanceId||''}:${identity?.userId||''}`;}
type Actions={refresh:()=>void;open:(kind:AndroidPermissionKind)=>void;request:(kind:'microphone'|'camera')=>void};

export default function AndroidPermissionsSettings({connected}:{connected:boolean}){
  const scope=useSyncExternalStore(subscribeSession,accountScope,accountScope),supported=supportsAndroidPermissions();
  const [status,setStatus]=useState<AndroidPermissionStatus|null>(null),[busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [outdated,setOutdated]=useState(false);
  const actions=useRef<Actions|null>(null);
  useEffect(()=>{
    let alive=true,revision=0,frame=0,reading=false,queued=false,operation=false;
    let request:AbortController|null=null;
    const current=()=>alive&&connected&&supported&&scope===accountScope();
    const foreground=()=>current()&&!document.hidden;
    setStatus(null);setBusy('');setError('');setNotice('');setOutdated(false);
    if(!supported||!connected){actions.current=null;return()=>{alive=false;};}
    if(!hasAndroidPermissionsBridge()){setOutdated(true);actions.current=null;return()=>{alive=false;};}
    const probe=createMediaPermissionProbe({
      getUserMedia:constraints=>{
        if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia)throw new Error('当前系统 WebView 未提供媒体访问，请更新 Android System WebView 后重试。');
        return navigator.mediaDevices.getUserMedia(constraints);
      },
      onSettled:()=>{if(foreground())schedule();},
    });
    async function read(){
      if(!foreground())return;
      if(reading||operation||probe.pending()){queued=true;return;}
      queued=false;reading=true;const at=revision;setBusy('refresh');
      try{
        const next=await PetPermissions.status();
        if(foreground()&&at===revision){setStatus(next);setOutdated(false);}
      }catch(failure){
        if(foreground()&&at===revision){
          if((failure as {code?:string}).code==='UNIMPLEMENTED'){setOutdated(true);setStatus(null);}
          else setError('暂时无法读取系统权限，请返回小伴后刷新状态。');
        }
      }finally{
        reading=false;if(current()&&at===revision)setBusy('');
        if(queued&&foreground()&&!operation&&!probe.pending())schedule();
      }
    }
    function schedule(){if(!foreground())return;cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{frame=0;void read();});}
    async function open(kind:AndroidPermissionKind){
      if(!foreground()||operation||probe.pending()||!isAndroidPermissionKind(kind))return;
      operation=true;const at=revision;setBusy(kind);setError('');setNotice('');
      try{const result=await PetPermissions.openSettings({kind});if(current()&&at===revision)setNotice(permissionSettingsFeedback(result));}
      catch{if(current()&&at===revision)setError('暂时无法打开系统设置，请在手机设置中查找“小伴”。');}
      finally{operation=false;if(current()&&at===revision){setBusy('');schedule();}}
    }
    async function check(kind:'microphone'|'camera'){
      if(!foreground()||operation)return;
      operation=true;const at=revision;request=new AbortController();setBusy(kind);setError('');setNotice('');
      let storage:Storage|undefined;try{storage=window.localStorage;}catch{}
      const identity=getIdentity(),preferences=createDevicePreferences(storage,`${identity?.instanceId}:${identity?.userId}`);
      const deviceId=preferences.read()[kind==='microphone'?'microphoneId':'cameraId'];preferences.dispose();
      try{await probe.request(kind,deviceId,request.signal);if(foreground()&&at===revision)setNotice(`${kind==='camera'?'摄像头':'麦克风'}访问检查已完成，设备已释放。`);}
      catch(failure){if(current()&&at===revision&&(failure as Error).name!=='AbortError')setError(mediaFailure(failure));}
      finally{operation=false;request=null;if(current()&&at===revision){setBusy('');schedule();}}
    }
    const resume=()=>schedule();
    const pause=()=>{++revision;cancelAnimationFrame(frame);frame=0;queued=false;request?.abort();if(current())setBusy('');};
    const visibility=()=>{if(document.hidden)pause();else schedule();};
    const changed=()=>{++revision;cancelAnimationFrame(frame);frame=0;request?.abort();if(alive){setStatus(null);setBusy('');setNotice('');setError('');}};
    actions.current={refresh:()=>{if(foreground()){setError('');setNotice('');schedule();}},open:kind=>void open(kind),request:kind=>void check(kind)};
    window.addEventListener('focus',resume);window.addEventListener('pageshow',resume);window.addEventListener('pagehide',pause);
    document.addEventListener('visibilitychange',visibility);window.addEventListener('petpal:session-change',changed);schedule();
    return()=>{alive=false;++revision;actions.current=null;cancelAnimationFrame(frame);request?.abort();probe.dispose();window.removeEventListener('focus',resume);window.removeEventListener('pageshow',resume);window.removeEventListener('pagehide',pause);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('petpal:session-change',changed);};
  },[connected,scope,supported]);
  if(!supported)return null;
  const disabled=!connected||!!busy||!status||outdated;
  const canOpen=(kind:AndroidPermissionKind)=>!disabled&&status?.routes?.[kind]?.available===true;
  const settingsButton=(kind:AndroidPermissionKind,label='系统设置')=><button type="button" className="secondary-button" disabled={!canOpen(kind)} onClick={()=>actions.current?.open(kind)}><Settings2 size={14} aria-hidden="true"/>{label}</button>;
  const row=(key:string,icon:ReactNode,title:string,label:string,help:string,action?:ReactNode)=><div key={key} className="android-permission-row"><div className="android-permission-icon" aria-hidden="true">{icon}</div><div className="android-permission-copy"><strong>{title}<span>{label}</span></strong><p>{help}</p></div>{action&&<div className="android-permission-action">{action}</div>}</div>;
  return <details className="android-permissions-settings">
    <summary><ShieldCheck size={18} aria-hidden="true"/><span><strong>权限与兼容性</strong><small>{!connected?'登录后管理这部手机的权限':outdated?'更新客户端以查看系统权限':'按功能检查授权与系统限制'}</small></span><ChevronDown size={16} aria-hidden="true" className="android-permission-chevron"/></summary>
    <div className="android-permissions-body" aria-busy={!!busy}>
      {!connected?<p className="android-permission-note">登录后可检查权限；只在使用对应功能时申请。</p>:outdated?<p className="android-permission-note" role="status">当前安卓客户端尚未提供完整权限检查，请升级客户端。原有功能仍可按需申请权限。</p>:<>
        <div className="android-permission-toolbar"><div><Smartphone size={16} aria-hidden="true"/><span>{status?phoneDeviceLabel(status.device):'正在读取设备'}<small>{status?phoneSystemLabel(status.device):'读取期间不会申请权限'}</small></span></div><button type="button" className="secondary-button" disabled={!!busy} onClick={()=>actions.current?.refresh()}>{busy==='refresh'?<Loader2 size={14} className="spin" aria-hidden="true"/>:<RefreshCw size={14} aria-hidden="true"/>}刷新</button></div>
        {status&&<div className="android-permission-list">
          {(['microphone','camera'] as const).map(kind=>{const value=status[kind],presentation=mediaPermissionPresentation(value,kind),name=kind==='camera'?'摄像头':'麦克风';return row(kind,kind==='camera'?<Camera size={18}/>:<Mic size={18}/>,name,presentation.label,presentation.help,presentation.action==='request'?<button type="button" className="secondary-button" disabled={disabled} onClick={()=>actions.current?.request(kind)}>{busy===kind?<Loader2 size={14} className="spin" aria-hidden="true"/>:null}{value.state==='granted'?'检查':'允许'}{name}</button>:presentation.action==='settings'?settingsButton(kind,'权限设置'):undefined);})}
          {row('notifications',<Bell size={18}/>,'应用通知',status.notifications.runtimeGranted&&status.notifications.enabled?'已允许':'尚未允许','任务完成、每日问候与持续服务通知共用应用通知总开关。',settingsButton('notifications','通知设置'))}
          <div className="android-permission-channels" aria-label="通知类别">{([['task','任务结果'],['companion','每日陪伴'],['watch','后台监听'],['overlay','悬浮伙伴']] as const).map(([kind,label])=><div key={kind}><span><strong>{label}</strong><small>{notificationChannelPresentation(status.notifications.channels[kind])}</small></span>{status.notifications.channels[kind]?.created&&settingsButton(kind==='overlay'?'notifications':kind,'设置')}</div>)}</div>
          {row('overlay',<PanelsTopLeft size={18}/>,'悬浮伙伴',!status.overlay.supported?'设备不支持':status.overlay.granted?'已允许':'尚未允许','允许后可在其他应用上方显示伙伴；开启仍由你操作。',status.overlay.supported?settingsButton('overlay','悬浮窗设置'):undefined)}
          {row('install',<Download size={18}/>,'应用内更新',!status.install.supported?'系统不支持':status.install.granted?'允许此来源':'尚未允许','下载并校验更新包后，由系统安装器确认安装。',status.install.supported?settingsButton('install','安装来源'):undefined)}
          {row('battery',<Smartphone size={18}/>,'后台与省电',batteryOptimizationLabel(status.battery.exempt),'系统豁免不代表厂商已允许自启动。当前品牌的设置指南见下方“后台任务提醒”。',settingsButton('battery','省电设置'))}
        </div>}
      </>}
      {error&&<p className="form-error" role="alert">{error}</p>}
      {notice&&<p className="android-permission-note" role="status">{notice}</p>}
    </div>
  </details>;
}
