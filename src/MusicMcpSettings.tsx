import {useEffect,useRef,useState,type FormEvent} from 'react';
import {Check,ChevronDown,ExternalLink,Link2,Loader2,Music2,RefreshCw,Unplug} from 'lucide-react';
import {getSessionEpoch,isSessionChanged,type User} from './api';
import {musicMcpTransport,type MusicMcpConfig,type MusicMcpPlayer,type MusicMcpStatus} from './platform/music-mcp';
import './desktop-assistant.css';
import './music-mcp.css';

const sources=[
  {id:'netease' as const,name:'网易云音乐',repository:'Seraph310/cloudmusic-desktop-mcp',url:'https://github.com/Seraph310/cloudmusic-desktop-mcp'},
  {id:'qqmusic' as const,name:'QQ 音乐',repository:'Sina5byg5L2z/mcp-qqmusic',url:'https://github.com/Sina5byg5L2z/mcp-qqmusic'},
];
type Draft=Omit<MusicMcpConfig,'revision'|'cdpPort'>&{cdpPort:string};
const draftFrom=(config:MusicMcpConfig):Draft=>({pythonExecutable:config.pythonExecutable,cloudmusicExecutable:config.cloudmusicExecutable,cdpPort:String(config.cdpPort),neteaseEnabled:config.neteaseEnabled,qqmusicEnabled:config.qqmusicEnabled});

export default function MusicMcpSettings({connected,user}:{connected:boolean;user?:User}) {
  const transport=useRef(musicMcpTransport()).current;
  const [config,setConfig]=useState<MusicMcpConfig|null>(null),[draft,setDraft]=useState<Draft|null>(null);
  const [status,setStatus]=useState<MusicMcpStatus|null>(null),[busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const alive=useRef(false),epoch=useRef(getSessionEpoch()).current;
  const requests=useRef(new Set<AbortController>()),operation=useRef<symbol|null>(null);
  const allowed=connected&&(transport.native?!!user?.canUseCodex&&(user.isOwner||user.agentAccess==='full'):!!user?.isOwner);
  const allowedNow=useRef(allowed);allowedNow.current=allowed;
  const current=(controller?:AbortController)=>alive.current&&allowedNow.current&&getSessionEpoch()===epoch&&!controller?.signal.aborted;
  const dirty=!!config&&!!draft&&JSON.stringify(draftFrom(config))!==JSON.stringify(draft);
  const running=!!busy||!!status?.busy;
  function applyConfig(next:MusicMcpConfig){setConfig(next);setDraft(draftFrom(next));}
  function update(patch:Partial<Draft>){setDraft(previous=>previous?{...previous,...patch}:previous);setNotice('');}
  async function run(label:string,action:(signal:AbortSignal)=>Promise<void>){
    if(!current()||operation.current)return;
    const token=Symbol(label),controller=new AbortController();operation.current=token;requests.current.add(controller);setBusy(label);setError('');setNotice('');
    try{await action(controller.signal);}catch(e){if(current(controller)&&!isSessionChanged(e))setError((e as Error).message||'音乐 MCP 当前不可用，请检查运行环境。');}
    finally{requests.current.delete(controller);if(operation.current===token){operation.current=null;if(current())setBusy('');}}
  }
  async function read(){await run('读取状态',async signal=>{
    const nextStatus=await transport.status(signal);
    if(!current()||signal.aborted)return;
    applyConfig(nextStatus.config);setStatus(nextStatus);
  });}
  async function refresh(){await run('刷新状态',async signal=>{
    const next=await transport.status(signal);if(!current()||signal.aborted)return;
    setStatus(next);if(!dirty)applyConfig(next.config);
  });}
  useEffect(()=>{
    alive.current=true;
    if(allowed)void read();
    else{setConfig(null);setDraft(null);setStatus(null);setBusy('');setError('');setNotice('');}
    const cancelRequests=()=>{for(const controller of requests.current)controller.abort();if(transport.native)void transport.cancel().catch(()=>{});};
    window.addEventListener('petpal:session-change',cancelRequests);
    return()=>{alive.current=false;cancelRequests();requests.current.clear();operation.current=null;window.removeEventListener('petpal:session-change',cancelRequests);};
  },[allowed,epoch,transport]);
  async function save(event:FormEvent){
    event.preventDefault();if(!config||!draft||!allowed||running)return;
    const port=Number(draft.cdpPort);if(!Number.isInteger(port)||port<1024||port>65535){setError('CDP 端口须为 1024 到 65535 之间的整数。');return;}
    await run('保存配置',async signal=>{
      const next=await transport.configure({...draft,revision:config.revision,pythonExecutable:draft.pythonExecutable.trim(),cloudmusicExecutable:draft.cloudmusicExecutable.trim(),cdpPort:port},signal);
      if(!current()||signal.aborted)return;
      applyConfig(next);setNotice('配置已保存。准备依赖并测试连接后，Agent 才能使用已发现的工具。');
      const nextStatus=await transport.status(signal);if(current()&&!signal.aborted)setStatus(nextStatus);
    });
  }
  async function action(player:MusicMcpPlayer,kind:'prepare'|'connect'|'disconnect'){
    if(!allowed||running||(dirty&&kind!=='disconnect'))return;
    const name=sources.find(source=>source.id===player)!.name;
    await run(`${name}：${kind==='prepare'?'准备依赖':kind==='connect'?'测试连接':'断开连接'}`,async signal=>{
      const next=await transport[kind](player,signal);if(!current()||signal.aborted)return;
      setStatus(next);
      const server=next.servers.find(item=>item.id===player);
      setNotice(server?.message||(kind==='prepare'?'依赖准备完成，可以测试连接。':kind==='disconnect'?'MCP 连接已断开。':'已完成工具发现，请查看连接状态与工具清单。'));
    });
  }
  async function cancel(){
    for(const controller of requests.current)controller.abort();
    const controller=new AbortController();requests.current.add(controller);
    try{
      const cancelled=await transport.cancel();
      const next=cancelled||await transport.status(controller.signal);
      if(current(controller)){setStatus(next);setNotice('已取消当前请求。请刷新状态确认依赖和连接的最新结果。');}
    }catch(e){if(current(controller)&&!isSessionChanged(e))setError((e as Error).message);}
    finally{requests.current.delete(controller);}
  }
  return <section className="assistant-section music-mcp-settings" aria-labelledby="music-mcp-title">
    <div className="assistant-section-heading"><div><h3 id="music-mcp-title"><Music2 size={19}/>音乐 MCP</h3><p>{transport.native?'管理这台电脑':'管理服务主机'}的专用音乐工具，供 Agent 在该电脑执行音乐请求。</p></div><button type="button" className="secondary-button" disabled={!allowed||!!busy} onClick={()=>void refresh()}><RefreshCw size={14}/>刷新状态</button></div>
    {!allowed&&<p className="assistant-unavailable">{!connected?'登录后可以读取音乐 MCP 设置。':transport.native?'此功能需要账号拥有完全访问这台电脑的 Agent 权限。':'服务主机的音乐 MCP 配置由主账号管理。'}</p>}
    {error&&<p className="form-error" role="alert">{error}</p>}
    {busy&&<p className="assistant-state" role="status"><Loader2 size={15} className="spin"/>{busy}…</p>}
    <form onSubmit={save}>
      <fieldset disabled={!allowed||running||!draft}>
        <div className="music-mcp-sources">{sources.map(source=>{
          const server=status?.servers.find(item=>item.id===source.id);
          const enabled=source.id==='netease'?draft?.neteaseEnabled:draft?.qqmusicEnabled;
          const unavailable=server?.platformSupported===false;
          const state=!allowed?'未读取':!server?'等待状态':unavailable?'平台不可用':server.connected?'已连接':server.enabled?'未连接':'未启用';
          return <details className="music-mcp-source" key={source.id}>
            <summary><span className="music-mcp-source-title"><strong>{source.name}</strong><span>{source.id==='netease'?'Windows 桌面客户端工具':'搜索、资料与播放链接'}</span></span><span className={`music-mcp-state${server?.connected?' is-connected':''}`}>{state}</span><ChevronDown className="music-mcp-chevron" size={16}/></summary>
            <div className="music-mcp-source-body">
              <a className="music-mcp-origin" href={source.url} target="_blank" rel="noreferrer">{source.repository}<ExternalLink size={13}/></a>
              <label className="music-mcp-enable"><input type="checkbox" checked={!!enabled} disabled={!allowed||running||!draft||unavailable} onChange={event=>update(source.id==='netease'?{neteaseEnabled:event.target.checked}:{qqmusicEnabled:event.target.checked})}/>启用{source.name} MCP</label>
              {source.id==='netease'?<>
                <p className="field-help">该适配器使用 Windows 网易云桌面客户端的 CDP 接口。Ubuntu 播放控制请使用上方音乐播放器的 MPRIS 能力。</p>
                {!unavailable&&<div className="music-mcp-fields"><label>网易云程序路径（可选）<input value={draft?.cloudmusicExecutable||''} maxLength={2048} placeholder="留空自动查找 cloudmusic.exe" autoComplete="off" spellCheck={false} onChange={event=>update({cloudmusicExecutable:event.target.value})}/></label><label>CDP 端口<input type="number" min={1024} max={65535} step={1} value={draft?.cdpPort||''} onChange={event=>update({cdpPort:event.target.value})}/></label></div>}
                <p className="field-help">只开放已审核的音乐工具，排除全局媒体键。测试连接只发现工具；需要播放时，由 Agent 按当前确认规则执行。</p>
              </>:<>
                <p className="field-help">支持歌曲搜索、详情、歌词、推荐、排行榜及播放地址。返回链接不会启动 QQ 桌面客户端，也不会开始播放。</p>
                <p className="field-help">QQ 登录凭据可选，请按上游说明将 credential.json 放入此电脑的私人登录目录。无需在小伴填写 QQ 密码或 API Key。</p>
                {server?.loginDirectory&&<div className="music-mcp-login"><span>本机登录目录</span><code>{server.loginDirectory}</code><span>{server.credentialConfigured?'已检测到凭据文件':'尚未检测到凭据文件'}</span></div>}
              </>}
              {server?.message&&<p className="assistant-unavailable">{server.message}</p>}
              <div className="assistant-actions"><button type="button" className="secondary-button" disabled={!allowed||running||dirty||!server||unavailable||!server.enabled} onClick={()=>void action(source.id,'prepare')}>准备依赖（联网下载）</button><button type="button" className="secondary-button" disabled={!allowed||running||dirty||!server||unavailable||!server.enabled} onClick={()=>void action(source.id,'connect')}><Link2 size={14}/>测试连接</button><button type="button" className="secondary-button" disabled={!allowed||running||!server?.connected} onClick={()=>void action(source.id,'disconnect')}><Unplug size={14}/>断开</button></div>
              <details className="music-mcp-tools"><summary>{server?.connected?`已发现 ${server.tools.length} 项工具`:'工具清单（连接后读取）'}</summary>{server?.tools.length?<ul>{server.tools.map(tool=><li key={tool.name}><code>{tool.name}</code><p>{tool.description}</p></li>)}</ul>:<p className="field-help">连接成功后显示这台电脑实际提供的工具名称和说明。</p>}</details>
            </div>
          </details>;
        })}</div>
        <details className="music-mcp-runtime"><summary>Python 运行环境<ChevronDown size={15}/></summary><div><label>Python 程序路径（可选）<input value={draft?.pythonExecutable||''} maxLength={2048} autoComplete="off" spellCheck={false} placeholder="留空自动查找 Python" onChange={event=>update({pythonExecutable:event.target.value})}/></label><p className="field-help">网易云需要 Python 3.11 以上，QQ 音乐需要 Python 3.10 以上。“准备依赖”会为固定的上游源码下载并安装 Python 依赖。</p></div></details>
        <div className="music-mcp-save"><button className="primary-button" type="submit" disabled={!allowed||running||!config||!draft||!dirty}><Check size={15}/>保存 MCP 配置</button>{dirty&&<span className="field-help">配置尚未保存，请先保存再准备或连接。</span>}</div>
      </fieldset>
    </form>
    {running&&<button type="button" className="secondary-button music-mcp-cancel" disabled={!allowed} onClick={()=>void cancel()}>取消当前请求</button>}
    {notice&&<p className="assistant-message" role="status"><Check size={15}/>{notice}</p>}
  </section>;
}
