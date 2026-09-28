import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUpRight, Check, Globe2, Loader2, Music2, Pause, Play, RefreshCw, ShieldCheck, SkipBack, SkipForward, Terminal } from 'lucide-react';
import { api, getSessionEpoch, isSessionChanged, type CodexConfig, type DesktopToolsStatus, type MusicAction, type MusicPlayer, type User } from './api';
import { canControlPlayer, canOpenMusicSite, codexConfigPatch, playerStateLabel, type CodexConfigDraft } from './desktop-settings.mjs';
import './desktop-assistant.css';

const draftFrom = (config:CodexConfig):CodexConfigDraft => ({mode:config.mode,baseUrl:config.baseUrl,model:config.model,apiKey:'',clearApiKey:false});
const musicActions = [
  {action:'open' as const,label:'打开',Icon:ArrowUpRight}, {action:'play' as const,label:'播放',Icon:Play},
  {action:'pause' as const,label:'暂停',Icon:Pause}, {action:'previous' as const,label:'上一首',Icon:SkipBack},
  {action:'next' as const,label:'下一首',Icon:SkipForward},
];
const officialSites = [{name:'QQ 音乐官网',url:'https://y.qq.com/'},{name:'网易云音乐官网',url:'https://music.163.com/'}];
const bridgeStates = {stopped:'尚未启动',owned:'由小伴管理',shared:'已共享连接',external:'发现其他浏览器桥',unavailable:'当前不可用'};

export default function DesktopAssistantSettings({connected,user,onConfigSaved}:{connected:boolean;user?:User;onConfigSaved?():Promise<unknown>}) {
  const [config,setConfig]=useState<CodexConfig|null>(null),[draft,setDraft]=useState<CodexConfigDraft|null>(null);
  const [tools,setTools]=useState<DesktopToolsStatus|null>(null),[profileId,setProfileId]=useState('');
  const [configBusy,setConfigBusy]=useState(false),[toolsBusy,setToolsBusy]=useState(false),[actionBusy,setActionBusy]=useState('');
  const [configError,setConfigError]=useState(''),[toolsError,setToolsError]=useState('');
  const [configNotice,setConfigNotice]=useState(''),[actionNotice,setActionNotice]=useState('');
  const alive=useRef(false),epoch=useRef(getSessionEpoch()).current,controllers=useRef(new Set<AbortController>());
  const operation=useRef(false),loadRevision=useRef({config:0,tools:0});
  const activeAction=useRef<AbortController|null>(null);
  const owner=!!user?.isOwner,enabled=owner&&connected;
  const current=(controller?:AbortController)=>alive.current&&getSessionEpoch()===epoch&&!controller?.signal.aborted;
  function controller(){const next=new AbortController();controllers.current.add(next);return next;}
  async function loadConfig(){
    if(!enabled||!current())return;
    const request=controller(),revision=++loadRevision.current.config;setConfigBusy(true);setConfigError('');
    try{const next=await api<CodexConfig>('/codex/config',{signal:request.signal});if(current(request)&&revision===loadRevision.current.config){setConfig(next);setDraft(draftFrom(next));}}
    catch(error){if(current(request)&&!isSessionChanged(error))setConfigError((error as Error).message);}
    finally{controllers.current.delete(request);if(current(request)&&revision===loadRevision.current.config)setConfigBusy(false);}
  }
  async function loadTools(){
    if(!enabled||!current())return;
    const request=controller(),revision=++loadRevision.current.tools;setToolsBusy(true);setToolsError('');
    try{const next=await api<DesktopToolsStatus>('/desktop-tools/status',{signal:request.signal});if(current(request)&&revision===loadRevision.current.tools){setTools(next);setProfileId(previous=>next.opencli.profiles.some(profile=>profile.id===previous&&profile.connected)?previous:next.opencli.selectedProfileId||'');}}
    catch(error){if(current(request)&&!isSessionChanged(error))setToolsError((error as Error).message);}
    finally{controllers.current.delete(request);if(current(request)&&revision===loadRevision.current.tools)setToolsBusy(false);}
  }
  useEffect(()=>{
    alive.current=true;
    if(enabled)void Promise.allSettled([loadConfig(),loadTools()]);
    return()=>{alive.current=false;for(const request of controllers.current)request.abort();controllers.current.clear();};
  },[enabled,epoch]);
  function update(patch:Partial<CodexConfigDraft>){setDraft(previous=>previous?{...previous,...patch}:previous);setConfigNotice('');}
  async function save(event:FormEvent){
    event.preventDefault();if(!enabled||!current()||!config||!draft||operation.current)return;
    operation.current=true;const request=controller();setConfigBusy(true);setConfigError('');setConfigNotice('');
    try{
      const body=codexConfigPatch(config,draft);
      const next=await api<CodexConfig>('/codex/config',{method:'PATCH',body:JSON.stringify(body),signal:request.signal});
      if(!current(request))return;
      setConfig(next);setDraft(draftFrom(next));
      setConfigNotice(next.mode==='api'?'API 配置已保存。尚未验证模型连接；下一次 Codex 对话将使用这份配置。':'已切换为本机 Codex 配置，继续使用主机已有登录。');
      void onConfigSaved?.().catch(()=>{});
    }catch(error){if(current(request)&&!isSessionChanged(error))setConfigError((error as Error).message);}
    finally{controllers.current.delete(request);operation.current=false;if(current(request))setConfigBusy(false);}
  }
  async function action(tool:'petpal_music_command'|'petpal_browser',args:Record<string,string>,busyLabel:string){
    if(!enabled||!current()||operation.current||tools?.busy)return;
    operation.current=true;const request=controller();activeAction.current=request;setActionBusy(busyLabel);setToolsError('');setActionNotice('');
    try{
      const result=await api<{ok?:boolean;message?:string;error?:string;action?:string;tab?:{url:string};ready?:boolean}>('/desktop-tools/action',{method:'POST',body:JSON.stringify({tool,arguments:args}),signal:request.signal});
      if(!current(request))return;
      if(result.ok===false)throw new Error(result.message||result.error||'操作未完成，请检查工具状态。');
      if(tool==='petpal_music_command')setActionNotice(result.message||'播放器已确认接收操作，请查看最新媒体状态。');
      else if(args.action==='open')setActionNotice(result.tab?.url?`已打开 ${result.tab.url}`:'已提交网页打开请求，请查看浏览器中的结果。');
      else if(args.action==='close'){setProfileId('');setActionNotice('已断开浏览器连接并清除所选档案。小伴使用的页面已关闭；共享浏览器桥保持运行。');}
      else setActionNotice(result.ready?'浏览器档案已连接，可打开音乐官网。':result.message||'已完成连接检查，请选择在线浏览器档案后连接。');
      await loadTools();
    }catch(error){if(current(request)&&!isSessionChanged(error))setToolsError((error as Error).message);}
    finally{controllers.current.delete(request);if(activeAction.current===request)activeAction.current=null;operation.current=false;if(current())setActionBusy('');}
  }
  function cancelAction(){activeAction.current?.abort();if(current())setActionNotice('已取消当前请求。已发出的播放器或网页操作可能已经生效，请刷新状态确认。');}
  function control(player:MusicPlayer,next:MusicAction){if(canControlPlayer(player,next))void action('petpal_music_command',{player:player.id,action:next},`${player.id}:${next}`);}
  if(!owner)return null;
  const busy=configBusy||toolsBusy||!!actionBusy;
  const actionDisabled=busy||!!tools?.busy;
  const opencli=tools?.opencli,selectedOnline=!!opencli?.profiles.some(profile=>profile.id===profileId&&profile.connected);
  const browserReady=canOpenMusicSite(opencli,profileId);
  const browserAttached=opencli?.daemon.state==='owned'||opencli?.daemon.state==='shared';
  return <section className="settings-section desktop-assistant" aria-label="电脑助手配置">
    <div className="section-title"><div><h2>电脑助手</h2><p>配置 Codex，管理服务主机上的音乐和浏览器工具。</p></div><ShieldCheck size={24}/></div>
    {!connected&&<p className="assistant-unavailable">登录主机管理员账号后，可以读取配置和使用工具。</p>}
    <section className="assistant-section" aria-labelledby="assistant-api-title">
      <div className="assistant-section-heading"><div><h3 id="assistant-api-title"><Terminal size={19}/>Codex 连接</h3><p>API 模式使用独立配置；本机模式沿用主机已有登录。</p></div><button type="button" className="secondary-button" disabled={!enabled||busy} onClick={()=>void loadConfig()}><RefreshCw size={14}/>重新读取</button></div>
      {configError&&<p className="form-error" role="alert">{configError}</p>}
      {configBusy&&!config&&<p className="assistant-state" role="status"><Loader2 size={15} className="spin"/>正在读取 Codex 配置…</p>}
      {draft&&config&&<form onSubmit={save}><fieldset disabled={!enabled||busy}>
        <label>使用方式<select aria-label="Codex 使用方式" value={draft.mode} onChange={event=>update({mode:event.target.value as 'host'|'api'})}><option value="host">本机 Codex 登录与配置</option><option value="api">配置 Responses API</option></select></label>
        {draft.mode==='api'?<><div className="assistant-fields"><label>Responses 服务地址<input type="url" required maxLength={2048} placeholder="https://api.openai.com/v1" value={draft.baseUrl} onChange={event=>update({baseUrl:event.target.value})}/></label><label>Codex 模型 ID<input required maxLength={160} placeholder="服务商支持的模型 ID" value={draft.model} onChange={event=>update({model:event.target.value})}/></label></div><label>Codex API Key<input type="password" maxLength={8192} autoComplete="new-password" disabled={draft.clearApiKey} value={draft.apiKey} placeholder={config.hasApiKey?'已保存，留空保留':'本地免密服务可留空'} onChange={event=>update({apiKey:event.target.value})}/></label>{config.hasApiKey&&<label className="assistant-clear-key"><input type="checkbox" checked={draft.clearApiKey} onChange={event=>update({clearApiKey:event.target.checked,apiKey:''})}/>清除已保存的 Codex 密钥</label>}<p className="field-help">仅支持 Responses 接口及工具调用。更换服务地址时，请重新填写密钥或明确清除旧密钥。</p><div className="assistant-runtime">API 模式使用受限音乐与网页工具；需要执行的操作会显示确认卡。保存不会调用模型，也不会修改主机的全局 Codex 配置。</div></>:<div className="assistant-runtime">继续使用主机现有 Codex 登录和配置。API 设置单独保存，切换模式不会写入全局 CLI 配置。</div>}
        <button className="primary-button" type="submit" disabled={!enabled||busy}>{configBusy?<Loader2 size={15} className="spin"/>:<Check size={15}/>}保存 Codex 配置</button>
      </fieldset><p className="assistant-state">{config.mode==='api'?(config.configured?'Responses API 已配置 · 连接尚未验证':'Responses API 配置尚未完整'):'当前使用本机 Codex 配置'}</p></form>}
      {configNotice&&<p className="assistant-message" role="status"><Check size={16}/>{configNotice}</p>}
    </section>
    <section className="assistant-section" aria-labelledby="assistant-music-title">
      <div className="assistant-section-heading"><div><h3 id="assistant-music-title"><Music2 size={19}/>音乐播放器</h3><p>控制服务主机上的 QQ 音乐或网易云音乐；按钮只在对应能力可用时启用。</p></div><button type="button" className="secondary-button" disabled={!enabled||busy} onClick={()=>void loadTools()}>{toolsBusy?<Loader2 size={14} className="spin"/>:<RefreshCw size={14}/>}刷新状态</button></div>
      {toolsError&&<p className="form-error" role="alert">{toolsError}</p>}
      {tools?.busy&&<p className="assistant-unavailable" role="status">主机正在执行另一项电脑操作，请稍后刷新状态。</p>}
      {actionBusy&&<div className="assistant-actions" role="status"><span className="assistant-state"><Loader2 size={14} className="spin"/>正在执行请求…</span><button type="button" className="secondary-button" onClick={cancelAction}>取消当前请求</button></div>}
      {toolsBusy&&!tools&&<p className="assistant-state" role="status">正在检测工具状态…</p>}
      {tools?.music.message&&<p className="assistant-unavailable">{tools.music.message}</p>}
      {tools?.music.players.map(player=><div className="assistant-player" key={player.id}><div><h4>{player.name}</h4><span className="assistant-state">{playerStateLabel(player)}</span>{player.message&&<p>{player.message}</p>}</div><div className="assistant-actions">{musicActions.map(({action:next,label,Icon})=><button type="button" className="secondary-button" key={next} aria-label={`${player.name}：${label}`} disabled={!enabled||actionDisabled||!canControlPlayer(player,next)} onClick={()=>control(player,next)}>{actionBusy===`${player.id}:${next}`?<Loader2 size={14} className="spin"/>:<Icon size={14}/>}<span>{label}</span></button>)}</div></div>)}
      <p className="field-help">这里提供打开、播放、暂停和切歌。播放器需公开系统媒体会话；本地曲库搜索不在此功能范围内。刷新状态不会启动或播放音乐。</p>
      {actionNotice&&<p className="assistant-message" role="status"><Check size={16}/>{actionNotice}</p>}
    </section>
    <section className="assistant-section" aria-labelledby="assistant-browser-title">
      <div className="assistant-section-heading"><div><h3 id="assistant-browser-title"><Globe2 size={19}/>OpenCLI 网页工具</h3><p>连接 Chrome 的 Browser Bridge，再打开音乐官网。</p></div><span className="assistant-state">{opencli?.version?`OpenCLI ${opencli.version}`:'等待状态'}</span></div>
      {opencli&&<><dl className="assistant-bridge-status"><dt>内置运行时</dt><dd>{opencli.available?'已就绪':'当前不可用'}</dd><dt>浏览器桥</dt><dd>{bridgeStates[opencli.daemon.state]}</dd><dt>扩展连接</dt><dd>{opencli.extension.connected?'已检测到连接':'尚未连接'}</dd><dt>当前档案</dt><dd>{opencli.profiles.find(profile=>profile.id===opencli.selectedProfileId)?.label||'尚未选择'}</dd></dl>{opencli.message&&<p className="assistant-unavailable">{opencli.message}</p>}
        <label>浏览器档案<select aria-label="OpenCLI 浏览器档案" value={profileId} disabled={!enabled||busy} onChange={event=>setProfileId(event.target.value)}><option value="">请选择在线档案</option>{opencli.profiles.map(profile=><option key={profile.id} value={profile.id} disabled={!profile.connected}>{profile.label}{profile.connected?'':'（离线）'}</option>)}</select></label>
        <div className="assistant-actions"><button type="button" className="secondary-button" disabled={!enabled||actionDisabled||!opencli.available||(opencli.daemon.state==='external'&&!opencli.daemon.compatible)||(!!profileId&&!selectedOnline)} onClick={()=>void action('petpal_browser',{action:'connect',...(profileId?{profileId}:{})},'browser:connect')}>{actionBusy==='browser:connect'?<Loader2 size={14} className="spin"/>:<Globe2 size={14}/>}<span>{profileId?'连接所选档案':'启动连接检查'}</span></button><button type="button" className="secondary-button" disabled={!enabled||actionDisabled||!browserAttached} onClick={()=>void action('petpal_browser',{action:'close'},'browser:close')}>{actionBusy==='browser:close'&&<Loader2 size={14} className="spin"/>}断开浏览器</button>{officialSites.map(site=><button type="button" className="secondary-button" key={site.url} disabled={!enabled||actionDisabled||!browserReady} onClick={()=>void action('petpal_browser',{action:'open',profileId,url:site.url},site.url)}><ArrowUpRight size={14}/>{site.name}</button>)}</div>
      </>}
      <div className="assistant-links"><a href="https://chromewebstore.google.com/detail/opencli/ildkmabpimmkaediidaifkhjpohdnifk" target="_blank" rel="noreferrer">安装官方 Browser Bridge 扩展 ↗</a><a href="https://github.com/jackwener/opencli" target="_blank" rel="noreferrer">OpenCLI 使用说明 ↗</a></div>
      <p className="field-help">安装扩展并打开相应 Chrome 档案后，先检查连接，再明确选择档案。OpenCLI 不包含 QQ 音乐、网易云音乐专用适配器；网页操作通过 Codex 的确认卡执行。</p>
      <p className="field-help">兼容的浏览器桥可共享连接。打开官网时，OpenCLI 可能复用其标签组内未被其他任务使用的空闲页面。</p>
    </section>
  </section>;
}
