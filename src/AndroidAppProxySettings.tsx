import {useEffect,useId,useState} from 'react';
import {Loader2,Network,Power,RefreshCw,Upload} from 'lucide-react';
import {getIdentity,getSessionEpoch,subscribeSession} from './api';
import {androidAppProxyAction,supportsAndroidAppProxy,type AndroidAppProxyStatus,type AndroidProxyAction} from './platform/android-app-proxy';
import './app-proxy.css';

const names={stopped:'未启用',checking:'检查配置',starting:'正在启用',running:'已启用',stopping:'正在关闭',error:'需要检查'};
export default function AndroidAppProxySettings({connected}:{connected:boolean}){
  const id=useId(),[status,setStatus]=useState<AndroidAppProxyStatus|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[revision,setRevision]=useState(0);
  const [yaml,setYaml]=useState(''),[url,setUrl]=useState(''),[importKind,setImportKind]=useState<'text'|'url'|''>('');
  const epoch=getSessionEpoch(),loggedIn=connected&&!!getIdentity(),available=supportsAndroidAppProxy();
  useEffect(()=>subscribeSession(()=>setRevision(value=>value+1)),[]);
  useEffect(()=>{let active=true;setStatus(null);setYaml('');setUrl('');setError('');setBusy(false);if(loggedIn&&available)void androidAppProxyAction('status').then(value=>{if(active)setStatus(value);}).catch(()=>{if(active)setError('无法读取应用代理，请刷新重试。');});return()=>{active=false;};},[epoch,revision,loggedIn,available]);
  const run=async(action:AndroidProxyAction,input?:{yaml:string}|{url:string}|{autoStart:boolean}|{group:string;name:string})=>{
    if(busy||!loggedIn)return;setBusy(true);setError('');const captured=getSessionEpoch();
    try{const value=await androidAppProxyAction(action,input);if(captured===getSessionEpoch()){setStatus(value);if(['importText','importUrl'].includes(action))setImportKind('');}}
    catch{if(captured===getSessionEpoch())setError('应用代理操作未完成，请检查配置、Android 版本及网络。');}
    finally{if(captured===getSessionEpoch())setBusy(false);}
  };
  if(!available)return null;
  const disabled=busy||!status?.supported,locked=disabled||!!status?.running;
  return <section className="app-proxy-settings" aria-labelledby={`${id}-title`} aria-busy={busy}>
    <div className="app-proxy-heading"><div className="app-proxy-title"><span className="app-proxy-symbol"><Network size={20}/></span><div><h3 id={`${id}-title`}>小伴应用代理</h3><p>仅供小伴联网，无需系统 VPN 授权</p></div></div>{status&&<span className={`app-proxy-state is-${status.state}`}><i/>{names[status.state]}</span>}</div>
    {!loggedIn?<p className="app-proxy-note">请先登录小伴，再导入本机的代理配置。</p>:<>
      {status&&<div className="app-proxy-summary"><span>{status.configured?'已保存私有配置':'尚未导入配置'}</span><span>Mihomo {status.version} · {status.abi||'检查架构中'}</span></div>}
      {status&&!status.supported&&<p role="status" className="app-proxy-note">{status.unavailableReason}</p>}
      <div className="app-proxy-actions"><button type="button" className="primary-button" disabled={disabled||!status?.configured} onClick={()=>void run(status?.running?'stop':'start')}>{busy?<Loader2 size={15} className="spin"/>:<Power size={15}/>}{status?.running?'关闭代理':'启用代理'}</button><button type="button" className="secondary-button" disabled={locked} onClick={()=>void run('importFile')}><Upload size={15}/>导入 YAML</button><button className="icon-button app-proxy-refresh" type="button" aria-label="刷新手机应用代理状态" disabled={busy} onClick={()=>void run('status')}><RefreshCw size={15}/></button></div>
      <label className="app-proxy-startup"><input type="checkbox" checked={status?.autoStart||false} disabled={disabled||!status?.configured} onChange={event=>void run('preferences',{autoStart:event.target.checked})}/><span>登录此账号后随小伴启用</span></label>
      <div className="app-proxy-paste"><button className="app-proxy-paste-toggle" type="button" disabled={locked} aria-expanded={importKind==='url'} onClick={()=>{setImportKind(importKind==='url'?'':'url');setUrl('');setYaml('');}}>从服务器下载配置</button>{importKind==='url'&&<div className="app-proxy-paste-body app-proxy-remote-body"><label htmlFor={`${id}-url`}>HTTPS YAML 直链</label><input id={`${id}-url`} type="password" autoComplete="off" spellCheck={false} maxLength={4096} value={url} onChange={event=>setUrl(event.target.value)} disabled={locked}/><button type="button" className="secondary-button" disabled={locked||!url.trim()} onClick={()=>{const value=url.trim();setUrl('');void run('importUrl',{url:value});}}>下载并保存</button></div>}{status?.remoteConfigured&&<div className="app-proxy-remote-saved"><span>已保存远程来源{status.remoteUpdatedAt&&<small>{new Date(status.remoteUpdatedAt).toLocaleString()}</small>}</span><button type="button" className="secondary-button" disabled={locked} onClick={()=>void run('updateRemote')}>更新配置</button></div>}</div>
      <div className="app-proxy-paste"><button className="app-proxy-paste-toggle" type="button" disabled={locked} aria-expanded={importKind==='text'} onClick={()=>{setImportKind(importKind==='text'?'':'text');setYaml('');setUrl('');}}>粘贴 Clash YAML</button>{importKind==='text'&&<div className="app-proxy-paste-body"><label htmlFor={`${id}-yaml`}>完整配置（最多 4 MB）</label><textarea id={`${id}-yaml`} maxLength={4*1024*1024} autoComplete="off" spellCheck={false} value={yaml} disabled={locked} onChange={event=>setYaml(event.target.value)}/><button type="button" className="secondary-button" disabled={locked||!yaml.trim()} onClick={()=>{const value=yaml;setYaml('');if(new TextEncoder().encode(value).length>4*1024*1024){setError('配置超过 4 MB。');return;}void run('importText',{yaml:value});}}>保存配置</button></div>}</div>
      {status?.running&&status.groups.length>0&&<div className="app-proxy-groups">{status.groups.map((group,index)=><label className="app-proxy-group" key={group.name} htmlFor={`${id}-group-${index}`}><span>{group.name}</span><select id={`${id}-group-${index}`} value={group.selected} disabled={busy} onChange={event=>void run('select',{group:group.name,name:event.target.value})}>{!group.choices.includes(group.selected)&&<option value={group.selected} disabled>当前节点</option>}{group.choices.map(choice=><option key={choice} value={choice}>{choice}</option>)}</select></label>)}</div>}
      <p className="app-proxy-note">本机与局域网直连。官方登录打开的系统浏览器仍使用浏览器自身网络设置。</p>
    </>}{(error||status?.error)&&<p role="alert" className="app-proxy-note app-proxy-error">{error||status?.error}</p>}
  </section>;
}
