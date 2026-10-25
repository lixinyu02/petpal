import {useEffect,useRef,useState,type FormEvent} from 'react';
import {Box,Cloud,Loader2,Monitor,Play,Plus,RefreshCw,Square,Terminal} from 'lucide-react';
import {isSessionChanged,type AgentHost,type User} from './api';
import {createVisiblePoll} from './platform/visible-poll.mjs';
import {useCloudSession} from './platform/cloud-session';
import {cloudNodeReady,cloudRuntimeName,dockerDesktopReady,dockerHasDesktop,dockerStateLabel,type CloudDockerCatalog,type CloudDockerHost} from './platform/cloud-docker';
import {clearCloudCreate,pendingCloudCreate,reserveCloudCreate,type PendingCloudCreate} from './cloud-create-request.mjs';
import './cloud-docker.css';

type Props={connected:boolean;user?:User;onUse(host:AgentHost):void;onDesktop(host:AgentHost):void;onConfigure():void;onChanged():void};
const confirmedCreation=(host:CloudDockerHost|undefined,requestId:string)=>host?.kind==='docker'&&host.online===true&&host.docker?.state==='running'&&(host.requestId===requestId||host.docker?.requestId===requestId);
export default function CloudDockerView({connected,user,onUse,onDesktop,onConfigure,onChanged}:Props){
  const scope=useCloudSession(connected,user),[hosts,setHosts]=useState<CloudDockerHost[]>([]),[catalog,setCatalog]=useState<CloudDockerCatalog>({});
  const [loading,setLoading]=useState(false),[busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [creating,setCreating]=useState(false),[name,setName]=useState('我的云端环境'),[source,setSource]=useState<'local'|'platform'>('local'),[bundle,setBundle]=useState<'desktop'|'agent'>('desktop'),[nodeId,setNodeId]=useState('');
  const [cpus,setCpus]=useState(2),[memoryMiB,setMemoryMiB]=useState(4096);
  const [pendingCreation,setPendingCreation]=useState<PendingCloudCreate|null>(null);
  const lock=useRef(false),read=useRef(0),[refresh,setRefresh]=useState(0);
  const admin=!!(user?.isAdmin||user?.isOwner);
  const visible=hosts.filter(host=>host.kind==='docker'&&(admin||host.isOwn===true||host.owner?.id===user?.id||host.userId===user?.id));
  const sources=catalog.sources??[];
  const localImageMissing=catalog.local?.imageAvailable===false||sources.find(item=>item.id==='local')?.imageAvailable===false;
  const sourceReady=(item:NonNullable<CloudDockerCatalog['sources']>[number])=>item.available!==false&&(item.id!=='local'||!localImageMissing);
  const selectedSource=sources.find(item=>item.id===source),nodes=catalog.nodes??[];
  const selectedNode=nodes.find(node=>node.id===nodeId),kubernetes=source==='platform'&&selectedNode?.runtimeKind==='kubernetes';
  const resourcesValid=Number.isFinite(cpus)&&cpus>=.1&&cpus<=128&&Number.isSafeInteger(memoryMiB)&&memoryMiB>=256&&memoryMiB<=1048576;
  const canCreate=!!selectedSource&&sourceReady(selectedSource)&&(source!=='platform'||resourcesValid&&(!nodes.length||cloudNodeReady(selectedNode))&&(!kubernetes||bundle==='agent'));
  useEffect(()=>{
    setHosts([]);setCatalog({});setCreating(false);setError('');setNotice('');setBusy('');setPendingCreation(pendingCloudCreate(scope.key));lock.current=false;read.current++;
  },[scope.epoch,user?.id,scope.allowed]);
  useEffect(()=>{
    if(!scope.allowed)return;
    const generation=scope.capture();
    return createVisiblePoll({document,window,intervalMs:12000,isCurrent:()=>scope.current(generation),run:async signal=>{
      const revision=++read.current;setLoading(true);
      try{
        const [instances,options]=await Promise.all([scope.request<{instances:CloudDockerHost[]}>('/cloud-docker',{signal},generation),scope.request<CloudDockerCatalog>('/cloud-docker/catalog',{signal},generation)]);
        if(scope.current(generation)&&revision===read.current&&!signal.aborted){
          setHosts(instances.instances??[]);setCatalog(options);setError('');
          const pending=pendingCloudCreate(scope.key);
          if(pending&&(instances.instances??[]).some(host=>confirmedCreation(host,pending.requestId))){clearCloudCreate(scope.key,pending.requestId);setPendingCreation(null);setCreating(false);setNotice('已确认上次创建的环境，未重复创建。');}
        }
      }catch(failure){if(scope.current(generation)&&revision===read.current&&!signal.aborted&&!isSessionChanged(failure))setError((failure as {status?:number}).status===404?'此服务器尚未提供云端环境，请更新服务端。':'暂时无法读取云端环境，请刷新重试。');}
      finally{if(scope.current(generation)&&revision===read.current&&!signal.aborted)setLoading(false);}
    }});
  },[scope.epoch,scope.allowed,user?.id,refresh]);
  async function perform(key:string,path:string,body:Record<string,unknown>,message:string){
    if(!scope.live()||lock.current)return;
    const generation=scope.capture();lock.current=true;read.current++;setLoading(false);setBusy(key);setError('');setNotice('');
    try{
      const result=await scope.request<{instance?:CloudDockerHost}>(path,{method:'POST',body:JSON.stringify(body)},generation);
      if(!scope.current(generation))return;
      setNotice(message);if(key==='create'){
        if(confirmedCreation(result.instance,String(body.requestId))){clearCloudCreate(scope.key,String(body.requestId));setPendingCreation(null);setCreating(false);}
        else setNotice('环境尚未运行，原创建请求和配置已保留。请确认上次创建，或查看启动状态。');
      }setRefresh(value=>value+1);onChanged();
    }catch(failure){if(scope.current(generation)&&!isSessionChanged(failure)){
      if(key==='create'&&(failure as {status?:number}).status===400){clearCloudCreate(scope.key,String(body.requestId));setPendingCreation(null);}
      setError(key==='create'&&(failure as {status?:number}).status!==400?'创建结果尚未确认。可以刷新环境列表，或确认上次创建；会沿用同一请求，不会创建第二个环境。':(failure as Error).message||'操作未完成，请查看环境状态后重试。');
    }}
    finally{if(scope.current(generation)){lock.current=false;setBusy('');}}
  }
  function submit(event:FormEvent){
    event.preventDefault();
    if(!scope.live()||lock.current)return;
    const existing=pendingCloudCreate(scope.key);
    if(!existing&&(!name.trim()||!canCreate))return;
    try{const request=existing??reserveCloudCreate(scope.key,{name:name.trim(),source,bundle,...(source==='platform'?{resources:{cpus,memoryMiB},...(nodeId?{nodeId}:{})}:{})});setPendingCreation(request);void perform('create','/cloud-docker',{...request.body,requestId:request.requestId},'云端环境已创建，可启动后用于 Agent 任务。');}
    catch(failure){setError((failure as Error).message);}
  }
  function openCreate(){if(!scope.live()||lock.current)return;const pending=pendingCloudCreate(scope.key);if(pending){setName(pending.body.name);setSource(pending.body.source);setBundle(pending.body.bundle);setNodeId(pending.body.nodeId||'');setCpus(pending.body.resources?.cpus??2);setMemoryMiB(pending.body.resources?.memoryMiB??4096);setPendingCreation(pending);}else{const first=sources.find(sourceReady);if(first)setSource(first.id);}setCreating(true);setError('');setNotice('');}
  return <div className="cloud-docker-page">
    <header className="cloud-heading"><div><span className="cloud-eyebrow"><Cloud size={16} aria-hidden="true"/>执行环境</span><h1>云端环境</h1><p>为 Agent 准备独立工作区，也可打开容器内的远程桌面。</p></div><div className="cloud-actions"><button className="icon-button" aria-label="刷新云端环境" disabled={!scope.allowed||!!busy||loading} onClick={()=>setRefresh(value=>value+1)}><RefreshCw size={17} className={loading?'spin':''}/></button><button className="primary-button" disabled={!scope.allowed||!!busy||!pendingCreation&&!sources.some(sourceReady)} onClick={openCreate}><Plus size={16}/>{pendingCreation?'确认上次创建':'新建环境'}</button></div></header>
    {!scope.allowed?<p className="cloud-empty" role="status">登录账号后即可查看和使用自己的云端环境。</p>:<>
      {localImageMissing&&sources.some(item=>item.id==='local'&&item.available!==false)&&<div className="cloud-runtime-prepare"><p>{admin?'服务器 Docker 已就绪，首次使用需要准备运行镜像。':'管理员尚未准备服务器的 Docker 运行镜像。'}</p>{admin&&<button className="secondary-button" disabled={!!busy} onClick={()=>void perform('prepare','/cloud-docker/prepare',{},'运行镜像已准备完成。')}>{busy==='prepare'?<Loader2 size={15} className="spin"/>:<Box size={15}/>}准备 Docker 环境</button>}</div>}
      {error&&<p className="cloud-feedback cloud-error" role="alert">{error}</p>}{notice&&<p className="cloud-feedback" role="status">{notice}</p>}
      {creating&&<form className="cloud-create" aria-label="新建云端环境" onSubmit={submit}>
        <h2>{pendingCreation?'确认上次创建':'新建环境'}</h2>{pendingCreation&&<p className="cloud-note">上次结果尚未确认，配置已固定。确认后再创建其他环境。</p>}<div className="cloud-form-grid"><label>环境名称<input aria-label="环境名称" required maxLength={80} disabled={!!busy||!!pendingCreation} value={name} onChange={event=>setName(event.target.value)}/></label><label>运行位置<select aria-label="Docker 运行位置" value={source} disabled={!!busy||!!pendingCreation} onChange={event=>{setSource(event.target.value as 'local'|'platform');setNodeId('');}}>{sources.map(item=><option key={item.id} value={item.id} disabled={item.available===false}>{item.name||(item.id==='local'?'中央服务器 Docker':'云端 Docker 平台')}{item.available===false?' · 暂不可用':''}</option>)}</select></label><label>环境类型<select aria-label="环境类型" value={bundle} disabled={!!busy||!!pendingCreation} onChange={event=>setBundle(event.target.value as 'desktop'|'agent')}><option value="desktop" disabled={kubernetes}>桌面与 Codex CLI</option><option value="agent">Codex CLI</option></select></label>{source==='platform'&&nodes.length>0&&<label>运行节点<select aria-label="运行节点" required value={nodeId} disabled={!!busy||!!pendingCreation} onChange={event=>{setNodeId(event.target.value);if(nodes.find(n=>n.id===event.target.value)?.runtimeKind==='kubernetes')setBundle('agent');}}><option value="">选择节点</option>{nodes.map(node=><option key={node.id} value={node.id} disabled={node.available===false}>{node.name} · {cloudRuntimeName(node.runtimeKind)}{!cloudNodeReady(node)?' · 待配置':''}</option>)}</select></label>}</div>
        {source==='platform'&&<div className="cloud-form-grid"><label>CPU 核数<input aria-label="CPU 核数" type="number" min={.1} max={128} step={.1} value={cpus} disabled={!!busy||!!pendingCreation} onChange={e=>setCpus(Number(e.target.value))}/></label><label>内存（MiB）<input aria-label="内存（MiB）" type="number" min={256} max={1048576} step={256} value={memoryMiB} disabled={!!busy||!!pendingCreation} onChange={e=>setMemoryMiB(Number(e.target.value))}/></label></div>}{kubernetes&&<p className="cloud-note" role="status">{selectedNode?.message||`K3s 独立 CLI · 持久工作目录 · 固定 ${selectedNode?.kubernetesConstraints?.pidsLimit} 个进程（含网关）`}</p>}
        {selectedSource?.message&&<p className="cloud-note">{selectedSource.message}</p>}<div className="cloud-actions"><button className="primary-button" disabled={!!busy||!pendingCreation&&!canCreate}>{busy==='create'?<Loader2 size={15} className="spin"/>:<Plus size={15}/>}{pendingCreation?'确认上次创建':'创建环境'}</button><button type="button" className="secondary-button" disabled={!!busy} onClick={()=>setCreating(false)}>取消</button></div>
      </form>}
      {!visible.length&&!creating&&<div className="cloud-empty"><Box size={34} aria-hidden="true"/><h2>{loading?'正在读取环境…':'还没有云端环境'}</h2><p>{sources.some(sourceReady)?'新建一个独立环境，随后在执行目标中选择它。':admin?'连接 Docker 平台，或准备中央服务器的 Docker 运行环境。':'请联系管理员准备 Docker 服务。'}</p>{admin&&!loading&&<button className="secondary-button" onClick={onConfigure}>连接 Docker 平台 / API Harbor</button>}</div>}
      <div className="cloud-instance-list" aria-label="Docker 环境列表" aria-busy={loading}>{visible.map(host=>{const state=host.docker?.state||host.state||'',transition=['starting','stopping'].includes(state),desktop=dockerHasDesktop(host);return <section className="cloud-instance" key={host.id}>
        <div className="cloud-instance-icon">{desktop?<Monitor size={23} aria-hidden="true"/>:<Terminal size={23} aria-hidden="true"/>}</div><div className="cloud-instance-copy"><h2>{host.name}</h2><p>{(host.docker?.source||host.source)==='platform'?`云端 ${cloudRuntimeName(host.docker?.runtimeKind)} 平台`:'服务器 Docker'} · {desktop?'桌面 + CLI':'CLI'}{host.owner&&!host.isOwn?` · ${host.owner.displayName||host.owner.username}`:''}</p><span className={`cloud-instance-state${host.online?' is-online':''}`}><i/>{dockerStateLabel(host)}</span></div>
        <div className="cloud-instance-actions"><button className="primary-button" disabled={!!busy||!host.online} onClick={()=>{if(scope.live()&&!lock.current&&host.online)onUse(host);}}>用于 Agent</button>{desktop&&<button className="secondary-button" disabled={!!busy||!dockerDesktopReady(host)} onClick={()=>{if(scope.live()&&!lock.current&&dockerDesktopReady(host))onDesktop(host);}}><Monitor size={15}/>桌面</button>}<button className="icon-button" aria-label={`${host.online?'停止':'启动'} ${host.name}`} disabled={!!busy||transition} onClick={()=>void perform(host.id,`/cloud-docker/${encodeURIComponent(host.id)}/${host.online?'stop':'start'}`,{},host.online?'停止请求已发送。':'启动请求已发送，执行器连接后即可使用。')}>{busy===host.id?<Loader2 size={17} className="spin"/>:host.online?<Square size={16}/>:<Play size={17}/>}</button></div>
      </section>;})}</div>
      {visible.length>0&&admin&&<button className="cloud-link" onClick={onConfigure}>管理平台配对</button>}
    </>}
  </div>;
}
