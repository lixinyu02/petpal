import {useEffect,useRef,useState,type FormEvent} from 'react';
import {Download,RefreshCw,ShieldCheck} from 'lucide-react';
import {api,getSessionEpoch,isSessionChanged,type User} from './api';
import {androidUpdates,CLIENT_VERSION,nativeUpdates,updatePlatform,type UpdateConfig,type UpdateCheck,type UpdateStatus} from './platform/updates';
import {validVersion,webUpdateState,updateProgress} from './update-presentation.mjs';
import './desktop-assistant.css';
import './updates.css';

export default function UpdatesSettings({connected,user,hasDraft}:{connected:boolean;user?:User;hasDraft:boolean}) {
  const platform=updatePlatform(),owner=!!user?.isOwner;
  const [config,setConfig]=useState<UpdateConfig|null>(null),[repository,setRepository]=useState(''),[publicKey,setPublicKey]=useState('');
  const [status,setStatus]=useState<UpdateStatus|null>(null),[check,setCheck]=useState<UpdateCheck|null>(null);
  const [deployed,setDeployed]=useState<string|null>(null),[busy,setBusy]=useState(''),[error,setError]=useState(''),[message,setMessage]=useState('');
  const [confirmReload,setConfirmReload]=useState(false);
  const alive=useRef(false),epoch=useRef(getSessionEpoch()).current,operation=useRef(false),requests=useRef(new Set<AbortController>());
  const current=()=>alive.current&&getSessionEpoch()===epoch;
  const native=platform!=='web',allowed=connected&&(platform!=='desktop'||owner);
  const running=busy!==''||status?.phase==='downloading'||status?.phase==='verifying'||status?.phase==='checking';
  function controller(){const c=new AbortController();requests.current.add(c);return c;}
  async function run(label:string,fn:()=>Promise<void>){
    if(!current()||operation.current)return;operation.current=true;setBusy(label);setError('');setMessage('');
    try{await fn();}catch(e){if(current()&&!isSessionChanged(e))setError((e as Error).message||'更新功能当前不可用，请检查系统 WebView 或网络。');}
    finally{operation.current=false;if(current())setBusy('');}
  }
  async function request<T>(path:string,options:RequestInit={}){const c=controller();try{return await api<T>(path,{...options,signal:c.signal});}finally{requests.current.delete(c);}}
  async function refreshNative(){const next=await nativeUpdates().status();if(current())setStatus(next);return next;}
  async function loadConfig(){const next=await request<UpdateConfig>('/updates/config');if(current()){setConfig(next);setRepository(next.repository);setPublicKey(next.publicKey);}}
  useEffect(()=>{
    alive.current=true;
    if(connected)void run('读取配置',async()=>{await loadConfig();if(current()&&native&&allowed)await refreshNative();});
    const sessionChange=()=>{for(const c of requests.current)c.abort();if(native)void nativeUpdates().cancel().catch(()=>{});};
    window.addEventListener('petpal:session-change',sessionChange);
    const focus=()=>{if(current()&&native&&allowed&&!operation.current)void refreshNative().catch(()=>{});};
    window.addEventListener('focus',focus);
    return()=>{alive.current=false;for(const c of requests.current)c.abort();requests.current.clear();if(native)void nativeUpdates().cancel().catch(()=>{});window.removeEventListener('petpal:session-change',sessionChange);window.removeEventListener('focus',focus);};
  },[connected,epoch,allowed]);
  useEffect(()=>{
    if(!native||!allowed||!(status?.phase==='downloading'||status?.phase==='verifying'||status?.phase==='checking'||busy==='下载更新'))return;
    let cancelled=false;let timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{try{const next=await nativeUpdates().status();if(!cancelled&&current())setStatus(next);}catch{}finally{if(!cancelled)timer=setTimeout(poll,700);}};
    timer=setTimeout(poll,500);return()=>{cancelled=true;clearTimeout(timer);};
  },[native,allowed,status?.phase,busy]);
  async function save(event:FormEvent){event.preventDefault();if(!owner||!config||!connected)return;await run('保存更新源',async()=>{
    if(native)await nativeUpdates().cancel();if(!current())return;
    const next=await request<UpdateConfig>('/updates/config',{method:'PATCH',body:JSON.stringify({repository:repository.trim(),publicKey:publicKey.trim(),revision:config.revision})});
    if(!current())return;setConfig(next);setRepository(next.repository);setPublicKey(next.publicKey);setCheck(null);setStatus(null);setMessage('更新源已保存。点击检查更新后会验证发布清单。');
  });}
  async function checkUpdates(){if(!allowed)return;await run('检查更新',async()=>{
    if(platform==='desktop'){const next=await window.petpal!.updates!.check();if(current())setStatus(next);return;}
    let version=CLIENT_VERSION;
    if(platform==='android'){const next=await refreshNative();version=next.currentVersion;if(!current())return;}
    if(platform==='web'){
      const c=controller();try{const response=await fetch(new URL('version.json',document.baseURI),{cache:'no-store',credentials:'same-origin',signal:c.signal});if(!response.ok)throw new Error('当前站点没有可读取的 version.json，请先部署新版 Web 资源。');const body=await response.json();if(!validVersion(body.version))throw new Error('站点版本信息无效。');if(current())setDeployed(body.version);}finally{requests.current.delete(c);}
    }
    if(!current())return;
    const result=await request<UpdateCheck>('/updates/check',{method:'POST',body:JSON.stringify({target:platform==='android'?'android':'web',currentVersion:version})});
    if(current())setCheck(result);
  });}
  async function download(){const release=platform==='desktop'?status?.release:check?.release;if(!release||!allowed)return;await run('下载更新',async()=>{
    const next=platform==='desktop'?await window.petpal!.updates!.download(release.id):await androidUpdates.download({release});if(current())setStatus(next);
  });}
  async function install(){if(!allowed||!status?.release)return;await run('准备安装',async()=>{
    // Recheck authenticated session immediately before the explicit native handoff.
    await request('/auth/me');if(!current())return;
    if(platform==='android'){
      const fresh=await request<UpdateCheck>('/updates/check',{method:'POST',body:JSON.stringify({target:'android',currentVersion:status.currentVersion})});if(!current())return;
      const before=status.release!,after=fresh.release;
      const keys=['id','target','version','versionCode','url','sha256','bytes','format','repository','revision','manifestHash','sequence'] as const;
      if(!fresh.available||!after||keys.some(key=>before[key]!==after[key])){const cancelled=await androidUpdates.cancel();if(current()){setStatus(cancelled);setCheck(null);}throw new Error('发布清单或更新源已变化，请重新检查并下载。');}
    }
    if(!current())return;
    const next=platform==='desktop'?await window.petpal!.updates!.install(status.release!.id):await androidUpdates.install();if(current())setStatus(next);
  });}
  async function cancel(){for(const c of requests.current)c.abort();if(native){try{const next=await nativeUpdates().cancel();if(current())setStatus(next);}catch(e){if(current())setError((e as Error).message);}}}
  const release=platform==='desktop'?status?.release:check?.release;
  const percent=updateProgress(status?.progress || (status?.total?{received:status.received||0,total:status.total}:undefined)),webState=webUpdateState(CLIENT_VERSION,deployed,check?.release);
  const installReady=native&&(platform!=='desktop'||!!status?.canInstall)&&['downloaded','awaiting-permission'].includes(status?.phase||'');
  function reload(){if(hasDraft&&!confirmReload){setConfirmReload(true);return;}location.reload();}
  return <section className="settings-section desktop-assistant updates-settings" aria-label="软件更新">
    <div className="section-title"><div><h2>软件更新</h2><p>从 GitHub Releases 检查适合当前设备的新版本。</p></div><ShieldCheck size={24}/></div>
    <section className="assistant-section"><div className="assistant-section-heading"><div><h3>当前版本 {status?.currentVersion||CLIENT_VERSION}</h3><p>{platform==='desktop'?(status?.installMode==='reveal-archive'?'Ubuntu 桌面端':'桌面端'):platform==='android'?'Android 应用':'Web 网页端'} · 稳定版</p></div><button className="secondary-button" disabled={!allowed||running} onClick={()=>void checkUpdates()}><RefreshCw size={15}/>{busy==='检查更新'?'正在检查…':'检查更新'}</button></div>
      {platform==='desktop'&&!owner&&<p className="field-help">桌面程序更新由本机主账号操作。</p>}
      {config&&!config.configured&&<p className="assistant-unavailable">更新源尚未配置发布公钥。管理员填入公钥后即可验证 GitHub 发布清单。</p>}
      {error&&<p role="alert" className="form-error">{error}</p>}
      <div role="status" aria-live="polite">{(message||status?.error||status?.message||check?.message)&&<p className="assistant-message">{message||status?.error||status?.message||check?.message}</p>}</div>
      {release&&<div className="update-release"><h3>发现新版本 {release.version}</h3><p>{(release.bytes/1024/1024).toFixed(1)} MB · {release.target}</p>{release.notes&&<p className="update-notes">{release.notes}</p>}
        {native&&!installReady&&status?.phase!=='handed-off'&&<button className="primary-button" disabled={!allowed||running} onClick={()=>void download()}><Download size={16}/>下载并校验</button>}
      </div>}
      {status?.phase==='downloading'&&<div className="update-progress"><progress aria-label="更新下载进度" max={100} value={percent??undefined}/><span>{percent===null?'正在下载…':`${percent}%`}</span></div>}
      {running&&<button className="secondary-button" onClick={()=>void cancel()}>取消当前操作</button>}
      {installReady&&<button className="primary-button" disabled={!allowed||running} onClick={()=>void install()}>{platform==='android'?(status?.canInstall?'交给系统安装器':'允许安装并继续'):status?.installMode==='reveal-archive'?'显示更新包':'打开新版程序'}</button>}
      {platform==='web'&&webState==='waiting-deploy'&&<p className="field-help">GitHub 已发布新版，当前站点仍在等待部署。部署完成后才能刷新使用。</p>}
      {platform==='web'&&webState==='reload'&&<div className="update-reload"><p>当前站点已部署 {deployed}，刷新页面即可载入。</p>{confirmReload&&hasDraft&&<p role="alert">当前有未发送的聊天草稿。刷新会丢弃草稿，请先复制保存。</p>}<button className="primary-button" onClick={reload}>{confirmReload&&hasDraft?'确认放弃草稿并刷新':'刷新到已部署版本'}</button></div>}
      <p className="field-help">{platform==='web'?'Web 由服务管理员部署静态资源；刷新会保留服务端聊天记录。':platform==='android'?'下载完成后核对包名、签名及版本，再由系统安装器请求确认。需要系统允许安装此来源的应用。':status?.installMode==='reveal-archive'?'Ubuntu 更新包校验后会在文件管理器中显示。解压到新目录后启动，保留原目录以便回退。':'Windows 校验完成后退出当前程序并打开新版便携程序，原 EXE 保留。安装包中的 Codex 和 OpenCLI 随应用更新。'}</p>
    </section>
    <section className="assistant-section"><div className="assistant-section-heading"><div><h3>GitHub 发布源</h3><p>清单签名和文件校验通过后才允许下载与安装。</p></div></div>
      {owner?<form onSubmit={save}><fieldset disabled={!connected||running||!config}><label>公开仓库<input required aria-label="GitHub 公开仓库" value={repository} maxLength={201} placeholder="owner/repository" onChange={e=>setRepository(e.target.value)}/></label><label>发布公钥（Ed25519）<textarea aria-label="发布公钥" className="update-public-key" value={publicKey} maxLength={4096} rows={4} placeholder="-----BEGIN PUBLIC KEY-----" onChange={e=>setPublicKey(e.target.value)}/></label><p className="field-help">填写发布者生成的 PEM 公钥。签名私钥由发布者离线保管；此处不需要 GitHub Token。</p><div className="assistant-actions"><button className="primary-button" type="submit">保存更新源</button><button className="secondary-button" type="button" onClick={()=>void run('读取配置',loadConfig)}>重新读取</button></div></fieldset></form>:<p>{config?.repository||'等待连接服务'} · 由主机管理员配置</p>}
    </section>
  </section>;
}
