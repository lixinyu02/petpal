import {useEffect,useRef,useState,type FormEvent} from 'react';
import {Cloud,KeyRound,Loader2,RefreshCw,Unplug} from 'lucide-react';
import {isSessionChanged,type User} from './api';
import {useCloudSession} from './platform/cloud-session';
import {normalizeServiceLinks,serviceLinkName,serviceLinkPaired,serviceLinkState,type ServiceLink,type ServiceLinkKind} from './platform/cloud-docker';
import './cloud-docker.css';

export default function ServiceLinksSettings({connected,user}:{connected:boolean;user?:User}){
  const scope=useCloudSession(connected,user),admin=!!(user?.isAdmin||user?.isOwner),[links,setLinks]=useState<ServiceLink[]>([]),[kind,setKind]=useState<ServiceLinkKind>('docker-platform');
  const [baseUrl,setBaseUrl]=useState(''),[code,setCode]=useState(''),[busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[disconnect,setDisconnect]=useState<ServiceLinkKind|null>(null);
  const [refresh,setRefresh]=useState(0),lock=useRef(false),revision=useRef(0);
  const allowed=scope.allowed&&admin;
  useEffect(()=>{setLinks([]);setCode('');setBaseUrl('');setDisconnect(null);setError('');setNotice('');setBusy('');lock.current=false;revision.current++;},[scope.epoch,user?.id,allowed]);
  useEffect(()=>{
    if(!allowed)return;
    const generation=scope.capture(),version=++revision.current,controller=new AbortController();setBusy('load');
    void scope.request<{links:ServiceLink[]|Record<string,ServiceLink>}>('/service-links',{signal:controller.signal},generation).then(value=>{if(scope.current(generation)&&version===revision.current){setLinks(normalizeServiceLinks(value.links));setError('');}}).catch(failure=>{if(!controller.signal.aborted&&scope.current(generation)&&version===revision.current&&!isSessionChanged(failure))setError((failure as {status?:number}).status===404?'此服务器尚未提供平台配对，请更新服务端。':'暂时无法读取配对状态，请刷新重试。');}).finally(()=>{if(!controller.signal.aborted&&scope.current(generation)&&version===revision.current)setBusy('');});
    return()=>controller.abort();
  },[allowed,scope.epoch,user?.id,refresh]);
  async function perform(action:'pair'|'refresh'|'disconnect',selected:ServiceLinkKind){
    if(!allowed||!scope.live()||lock.current||busy)return;
    const generation=scope.capture();lock.current=true;revision.current++;setBusy(action);setError('');setNotice('');
    const body=action==='pair'?{baseUrl:baseUrl.trim(),code:code.trim()}:{};
    // Pairing codes are intentionally held only in this form and cleared as
    // soon as the one authorized request starts; a failed call is not retried.
    if(action==='pair')setCode('');
    try{
      await scope.request(`/service-links/${selected}${action==='disconnect'?'':`/${action}`}`,{method:action==='disconnect'?'DELETE':'POST',...(action!=='disconnect'?{body:JSON.stringify(body)}:{})},generation);
      if(!scope.current(generation))return;setDisconnect(null);setNotice(action==='pair'?'配对成功，目录已同步。':action==='refresh'?'目录已刷新。':'服务连接已断开。');setRefresh(value=>value+1);
    }catch(failure){if(scope.current(generation)&&!isSessionChanged(failure))setError(action==='pair'?'配对未完成，请检查地址，并从对应平台获取新的配对码。':(failure as Error).message||'操作未完成，请刷新状态后重试。');}
    finally{if(scope.current(generation)){lock.current=false;setBusy('');}}
  }
  function submit(event:FormEvent){event.preventDefault();if(!baseUrl.trim()||!code.trim())return;void perform('pair',kind);}
  if(!admin)return null;
  return <section className="service-links-settings settings-section"><header className="cloud-heading"><div><h2>服务配对</h2><p>使用平台生成的配对码，连接 Docker 环境和模型目录。</p></div><button className="icon-button" aria-label="刷新服务配对" disabled={!allowed||!!busy} onClick={()=>setRefresh(value=>value+1)}><RefreshCw size={17} className={busy==='load'?'spin':''}/></button></header>
    {!allowed?<p role="status">请先登录管理员账号。</p>:<>
      <div className="service-link-list">{(['docker-platform','api-harbor'] as const).map(value=>{const link=links.find(item=>item.kind===value);return <div className="service-link-row" key={value}><Cloud size={20}/><div><strong>{serviceLinkName(value)}</strong><span>{serviceLinkState(link)}{link?.baseUrl?` · ${link.baseUrl}`:''}</span>{(link?.error||link?.lastError)&&<p role="status">{link?.error||link?.lastError}</p>}{link?.catalogUpdatedAt&&<span>目录更新于 {new Date(link.catalogUpdatedAt).toLocaleString('zh-CN')}</span>}</div><div className="cloud-actions">{(serviceLinkPaired(link)||['pending','confirming','offline'].includes(link?.state||''))?<><button className="secondary-button" disabled={!!busy} onClick={()=>void perform('refresh',value)}>{serviceLinkPaired(link)?'同步目录':'继续配对'}</button><button className="icon-button" aria-label={`断开${serviceLinkName(value)}`} disabled={!!busy} onClick={()=>setDisconnect(value)}><Unplug size={16}/></button></>:<button className="secondary-button" disabled={!!busy} onClick={()=>{setKind(value);setBaseUrl(link?.baseUrl||'');setCode('');}}>配对</button>}</div></div>;})}</div>
      <form className="service-link-form" aria-label="配对平台服务" onSubmit={submit}><h3><KeyRound size={17}/>连接服务</h3><label>服务类型<select aria-label="配对服务类型" value={kind} disabled={!!busy} onChange={event=>{setKind(event.target.value as ServiceLinkKind);setCode('');setBaseUrl(links.find(link=>link.kind===event.target.value)?.baseUrl||'');}}><option value="docker-platform">Docker 平台</option><option value="api-harbor">API Harbor</option></select></label><label>服务地址<input aria-label="配对服务地址" type="url" required placeholder="https://…" value={baseUrl} disabled={!!busy} autoComplete="off" onChange={event=>setBaseUrl(event.target.value)}/></label><label>一次性配对码<input aria-label="一次性配对码" type="password" required maxLength={512} value={code} disabled={!!busy} autoComplete="off" spellCheck={false} onChange={event=>setCode(event.target.value)}/></label><button className="primary-button" disabled={!!busy||!baseUrl.trim()||!code.trim()}>{busy==='pair'?<Loader2 size={16} className="spin"/>:<KeyRound size={16}/>}配对并同步</button></form>
      {disconnect&&<div className="cloud-confirm" role="group" aria-label="确认断开服务"><p>断开 {serviceLinkName(disconnect)}？正在执行的任务不会切换到其他环境。</p><div className="cloud-actions"><button className="secondary-button" disabled={!!busy} onClick={()=>setDisconnect(null)}>取消</button><button className="danger-button" disabled={!!busy} onClick={()=>void perform('disconnect',disconnect)}>确认断开</button></div></div>}
      {error&&<p className="cloud-feedback cloud-error" role="alert">{error}</p>}{notice&&<p className="cloud-feedback" role="status">{notice}</p>}
    </>}
  </section>;
}
