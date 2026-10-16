import {useEffect,useId,useRef,useState} from 'react';
import {Cloud,Loader2,Network,Power,RefreshCw,Upload} from 'lucide-react';
import {getIdentity,getSessionEpoch,subscribeSession} from './api';
import {androidAppProxyAction,supportsAndroidAppProxy,type AndroidAppProxyStatus,type AndroidProxyAction,type AndroidProxyInput} from './platform/android-app-proxy';
import {listServerProxyProfiles,type ServerProxyProfile} from './platform/server-proxy-profiles';
import './app-proxy.css';

const names={stopped:'未启用',checking:'检查配置',starting:'正在启用',running:'已启用',stopping:'正在关闭',error:'需要检查'};
const modes={rule:'规则',global:'全局',direct:'直连'} as const;
export default function AndroidAppProxySettings({connected}:{connected:boolean}){
  const id=useId(),[status,setStatus]=useState<AndroidAppProxyStatus|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[revision,setRevision]=useState(0);
  const [profiles,setProfiles]=useState<ServerProxyProfile[]>([]),[selected,setSelected]=useState(''),[catalogError,setCatalogError]=useState('');
  const [yaml,setYaml]=useState(''),[url,setUrl]=useState(''),[importKind,setImportKind]=useState<'text'|'url'|''>('');
  const life=useRef(0),operation=useRef(false),sequence=useRef(0);
  const epoch=getSessionEpoch(),identity=getIdentity(),loggedIn=connected&&!!identity,available=supportsAndroidAppProxy();
  const liveScope=()=>loggedIn&&available&&epoch===getSessionEpoch()&&identity?.instanceId===getIdentity()?.instanceId&&identity?.userId===getIdentity()?.userId;
  useEffect(()=>subscribeSession(()=>setRevision(value=>value+1)),[]);
  const current=(generation:number,captured:number,request:number)=>liveScope()&&generation===life.current&&captured===getSessionEpoch()&&request===sequence.current;
  async function catalog(generation:number,captured:number,request:number){
    try{const value=await listServerProxyProfiles();if(current(generation,captured,request)){setProfiles(value.profiles);setSelected(previous=>value.profiles.some(profile=>profile.id===previous)?previous:value.profiles[0]?.id||'');setCatalogError('');}}
    catch(failure){if(current(generation,captured,request)){setProfiles([]);setSelected('');setCatalogError((failure as {status?:number})?.status===404?'服务器尚未提供配置同步，请更新后端。':'无法读取服务器配置，稍后可刷新重试。');}}
  }
  async function refresh(generation=life.current,captured=getSessionEpoch()){
    if(operation.current||!liveScope()||captured!==epoch)return;
    operation.current=true;const request=++sequence.current;setBusy(true);setError('');
    try{await Promise.all([catalog(generation,captured,request),androidAppProxyAction('checkServer').then(value=>{if(current(generation,captured,request))setStatus(value);})]);}
    catch{if(current(generation,captured,request))setError('无法读取应用代理，请刷新重试。');}
    finally{if(current(generation,captured,request)){operation.current=false;setBusy(false);}}
  }
  useEffect(()=>{
    const generation=++life.current,captured=getSessionEpoch();sequence.current++;operation.current=false;
    setStatus(null);setProfiles([]);setSelected('');setCatalogError('');setYaml('');setUrl('');setImportKind('');setError('');setBusy(false);
    if(loggedIn&&available)void refresh(generation,captured);
    const visible=()=>{if(!document.hidden)void refresh(generation,captured);};document.addEventListener('visibilitychange',visible);
    return()=>{life.current++;sequence.current++;document.removeEventListener('visibilitychange',visible);};
  },[epoch,revision,loggedIn,available]);
  async function run(action:AndroidProxyAction,input?:AndroidProxyInput){
    if(operation.current||!liveScope())return;
    const generation=life.current,captured=getSessionEpoch(),request=++sequence.current;operation.current=true;setBusy(true);setError('');
    try{const value=await androidAppProxyAction(action,input);if(current(generation,captured,request)){setStatus(value);if(['importText','importUrl','importFile','importServer'].includes(action)){setImportKind('');setYaml('');setUrl('');}}}
    catch{if(current(generation,captured,request))setError('操作未完成，请检查配置、账号权限及网络后重试。');}
    finally{if(current(generation,captured,request)){operation.current=false;setBusy(false);}}
  }
  if(!available)return null;
  const disabled=busy||!status?.supported,locked=disabled||!!status?.running;
  return <section className="app-proxy-settings" aria-labelledby={`${id}-title`} aria-busy={busy}>
    <div className="app-proxy-heading"><div className="app-proxy-title"><span className="app-proxy-symbol"><Network size={20}/></span><div><h3 id={`${id}-title`}>小伴应用代理</h3><p>仅供小伴联网，无需系统 VPN 授权</p></div></div>{status&&<span className={`app-proxy-state is-${status.state}`}><i/>{names[status.state]}</span>}</div>
    {!loggedIn?<p className="app-proxy-note">请先登录小伴，查看分配给此账号的代理配置。</p>:<>
      {status&&<div className="app-proxy-summary"><span>{status.source==='server'?status.serverProfileName:status.configured?'已保存本机配置':'尚未导入配置'}</span><span>Mihomo {status.version} · {status.abi||'检查架构中'}</span></div>}
      {status&&!status.supported&&<p role="status" className="app-proxy-note">{status.unavailableReason}</p>}
      <div className="app-proxy-actions"><button type="button" className="primary-button" disabled={disabled||!status?.configured} onClick={()=>void run(status?.running?'stop':'start')}>{busy?<Loader2 size={15} className="spin"/>:<Power size={15}/>}{status?.running?'关闭代理':'启用代理'}</button><label className="app-proxy-mode"><span>模式</span><select aria-label="应用代理模式" value={status?.mode||'rule'} disabled={disabled||!status?.configured} onChange={event=>void run('mode',{mode:event.target.value as AndroidAppProxyStatus['mode']})}>{Object.entries(modes).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><button className="icon-button app-proxy-refresh" type="button" aria-label="刷新手机应用代理与服务器配置" disabled={busy} onClick={()=>void refresh()}><RefreshCw size={15}/></button></div>
      <label className="app-proxy-startup"><input type="checkbox" checked={status?.autoStart||false} disabled={disabled||!status?.configured} onChange={event=>void run('preferences',{autoStart:event.target.checked})}/><span>登录此账号后随小伴启用</span></label>
      <div className="app-proxy-server"><label htmlFor={`${id}-server`}><Cloud size={15}/>服务器下发的配置</label><div className="app-proxy-server-picker"><select id={`${id}-server`} value={selected} disabled={disabled||!profiles.length} onChange={event=>setSelected(event.target.value)}>{!profiles.length&&<option value="">暂无可用配置</option>}{profiles.map(profile=><option key={profile.id} value={profile.id}>{profile.name}</option>)}</select><button type="button" className="secondary-button" disabled={disabled||!selected} onClick={()=>void run('importServer',{profileId:selected})}>{status?.running?'切换并重启':'使用此配置'}</button></div>{catalogError?<p className="app-proxy-note" role="status">{catalogError}</p>:!busy&&!profiles.length&&<p className="app-proxy-note">管理员分配配置后，会显示在这里。</p>}
        {status?.source==='server'&&<div className="app-proxy-server-current"><span role="status">{status.serverStatus==='revoked'?'配置访问已撤销，请选择其他配置。':status.serverStatus==='unavailable'?'暂时无法检查服务器，保留本机配置。':status.serverUpdateAvailable?'服务器有新配置与策略。':'已保存服务器配置与本机选择。'}</span><div className="app-proxy-actions"><button type="button" className="secondary-button" disabled={disabled||status.serverStatus==='revoked'} onClick={()=>void run('updateServer')}>{status.running?'更新并重启':'更新配置'}</button><button type="button" className="secondary-button" disabled={disabled||status.serverStatus==='revoked'} onClick={()=>void run('updateServer',{resetPolicy:true})}>同步服务器策略{status.running?'并重启':''}</button></div></div>}
      </div>
      {status?.running&&status.groups.length>0&&<div className="app-proxy-groups">{status.groups.map((group,index)=><label className="app-proxy-group" key={group.name} htmlFor={`${id}-group-${index}`}><span>{group.name}</span><select id={`${id}-group-${index}`} value={group.selected} disabled={busy} onChange={event=>void run('select',{group:group.name,name:event.target.value})}>{!group.choices.includes(group.selected)&&<option value={group.selected} disabled>当前节点</option>}{group.choices.map(choice=><option key={choice} value={choice}>{choice}</option>)}</select></label>)}</div>}
      <details className="app-proxy-other"><summary>其他导入方式</summary><div className="app-proxy-actions"><button type="button" className="secondary-button" disabled={locked} onClick={()=>void run('importFile')}><Upload size={15}/>导入 YAML</button></div>
        <div className="app-proxy-paste"><button className="app-proxy-paste-toggle" type="button" disabled={locked} aria-expanded={importKind==='url'} onClick={()=>{setImportKind(importKind==='url'?'':'url');setUrl('');setYaml('');}}>HTTPS 订阅链接</button>{importKind==='url'&&<div className="app-proxy-paste-body app-proxy-remote-body"><label htmlFor={`${id}-url`}>HTTPS YAML 直链</label><input id={`${id}-url`} type="password" autoComplete="off" spellCheck={false} maxLength={4096} value={url} onChange={event=>setUrl(event.target.value)} disabled={locked}/><button type="button" className="secondary-button" disabled={locked||!url.trim()} onClick={()=>{const value=url.trim();setUrl('');void run('importUrl',{url:value});}}>下载并保存</button></div>}{status?.remoteConfigured&&<div className="app-proxy-remote-saved"><span>已保存订阅来源{status.remoteUpdatedAt&&<small>{new Date(status.remoteUpdatedAt).toLocaleString()}</small>}</span><button type="button" className="secondary-button" disabled={locked} onClick={()=>void run('updateRemote')}>更新订阅</button></div>}</div>
        <div className="app-proxy-paste"><button className="app-proxy-paste-toggle" type="button" disabled={locked} aria-expanded={importKind==='text'} onClick={()=>{setImportKind(importKind==='text'?'':'text');setYaml('');setUrl('');}}>粘贴 Clash YAML</button>{importKind==='text'&&<div className="app-proxy-paste-body"><label htmlFor={`${id}-yaml`}>完整配置（最多 4 MB）</label><textarea id={`${id}-yaml`} maxLength={4*1024*1024} autoComplete="off" spellCheck={false} value={yaml} disabled={locked} onChange={event=>setYaml(event.target.value)}/><button type="button" className="secondary-button" disabled={locked||!yaml.trim()} onClick={()=>{const value=yaml;setYaml('');if(new TextEncoder().encode(value).length>4*1024*1024){setError('配置超过 4 MB。');return;}void run('importText',{yaml:value});}}>保存配置</button></div>}</div>
      </details>
    </>}{(error||status?.error)&&<p role="alert" className="app-proxy-note app-proxy-error">{error||status?.error}</p>}
  </section>;
}
