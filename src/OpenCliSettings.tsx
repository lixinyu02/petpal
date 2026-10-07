import {useEffect,useRef,useState,type FormEvent} from 'react';
import {ArrowUpRight,Check,ChevronDown,Globe2,Loader2,RefreshCw,Search,Unplug} from 'lucide-react';
import {getSessionEpoch,isSessionChanged,type User} from './api';
import {openCliTransport,openCliConfiguredSites,openCliConfigChanged,openCliConfigPatch,openCliOriginDraft,type OpenCliOriginDraft,type OpenCliBrowserAction,type OpenCliConfig,type OpenCliSites,type OpenCliStatus,type OpenCliMode,type OpenCliLogin} from './platform/opencli';
import './desktop-assistant.css';
import './opencli-settings.css';

const officialSites=[{name:'QQ 音乐官网',url:'https://y.qq.com/'},{name:'网易云音乐官网',url:'https://music.163.com/'}];
const chromeDownloadUrl='https://www.google.com/chrome/';
const bridgeExtensionUrl='https://chromewebstore.google.com/detail/opencli/ildkmabpimmkaediidaifkhjpohdnifk';
const bridgeStates={stopped:'尚未启动',owned:'由小伴管理',shared:'已共享连接',external:'发现其他浏览器桥',unavailable:'当前不可用'};
type Command=NonNullable<OpenCliSites['commands']>[number];
const modeLabels:Record<OpenCliMode,string>={public:'公开查询',browser:'浏览器查询',configured:'站点页面查询',inventory:'仅打包'};
const loginLabels:Record<OpenCliLogin,string>={optional:'部分内容可能需要登录',required:'需要网站登录',share:'读取分享信息；可能需要提取码'};

function parameters(command:Command){
  const schema=command.inputSchema as {properties?:Record<string,{type?:string;description?:string}>;required?:string[]}|undefined;
  const entries=Object.entries(schema?.properties||{});
  return entries.length?entries.map(([name,value])=>`${name}${schema?.required?.includes(name)?'（必填）':'（可选）'}${value.description?`：${value.description}`:''}`).join('；'):'无需参数';
}

export default function OpenCliSettings({connected,user,onPrepareBrowser,prepareBrowserDisabled=false}:{connected:boolean;user?:User;onPrepareBrowser?:()=>void;prepareBrowserDisabled?:boolean}) {
  const transport=useRef(openCliTransport()).current;
  const [config,setConfig]=useState<OpenCliConfig|null>(null),[enabled,setEnabled]=useState(true);
  const [originDraft,setOriginDraft]=useState<OpenCliOriginDraft>(()=>openCliOriginDraft());
  const [status,setStatus]=useState<OpenCliStatus|null>(null),[catalog,setCatalog]=useState<OpenCliSites|null>(null);
  const [details,setDetails]=useState<Record<string,Command[]>>({});
  const [profileId,setProfileId]=useState(''),[search,setSearch]=useState(''),[filter,setFilter]=useState('callable');
  const [webUrl,setWebUrl]=useState('');
  const [busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const alive=useRef(false),epoch=useRef(getSessionEpoch()).current,requests=useRef(new Set<AbortController>());
  const operation=useRef<symbol|null>(null),nativeAction=useRef(false);
  const allowed=connected&&(transport.native?!!user?.canUseCodex&&(user.isOwner||user.agentAccess==='full'):!!user?.isOwner);
  const allowedNow=useRef(allowed);allowedNow.current=allowed;
  const current=(controller?:AbortController)=>alive.current&&allowedNow.current&&getSessionEpoch()===epoch&&!controller?.signal.aborted;
  const dirty=openCliConfigChanged(config,enabled,originDraft);
  const running=!!busy;
  const canPrepareBrowser=connected&&!!user&&!prepareBrowserDisabled&&!running;
  const prepareAllowedNow=useRef(canPrepareBrowser);prepareAllowedNow.current=canPrepareBrowser;

  function applyStatus(next:OpenCliStatus,replaceConfig=false){
    setStatus(next);
    setProfileId(previous=>next.profiles.some(profile=>profile.id===previous&&profile.connected)?previous:next.selectedProfileId||'');
    if(replaceConfig||!dirty){setConfig(next.config);setEnabled(next.config.enabled);setOriginDraft(openCliOriginDraft(next.config));}
  }
  async function run(label:string,work:(signal:AbortSignal)=>Promise<void>){
    if(!current()||operation.current)return;
    const token=Symbol(label),controller=new AbortController();operation.current=token;requests.current.add(controller);
    setBusy(label);setError('');setNotice('');
    try{await work(controller.signal);}
    catch(e){if(current(controller)&&!isSessionChanged(e))setError((e as Error).message||'OpenCLI 当前不可用，请刷新状态。');}
    finally{requests.current.delete(controller);if(operation.current===token){operation.current=null;if(current())setBusy('');}}
  }
  async function read(replaceConfig=false){await run('读取 OpenCLI',async signal=>{
    if(transport.native){
      // Native management shares one operation slot with browser actions.
      const nextStatus=await transport.status(signal);
      if(!current()||signal.aborted)return;
      applyStatus(nextStatus,replaceConfig);
      const nextCatalog=await transport.sites({},signal);
      if(current()&&!signal.aborted)setCatalog(nextCatalog);
      return;
    }
    const results=await Promise.allSettled([transport.status(signal),transport.sites({},signal)]);
    if(!current()||signal.aborted)return;
    if(results[0].status==='fulfilled')applyStatus(results[0].value,replaceConfig);
    if(results[1].status==='fulfilled')setCatalog(results[1].value);
    const failed=results.find(result=>result.status==='rejected');
    if(failed?.status==='rejected')throw failed.reason;
  });}
  useEffect(()=>{
    alive.current=true;
    if(allowed)void read(true);
    else{setConfig(null);setEnabled(true);setOriginDraft(openCliOriginDraft());setStatus(null);setCatalog(null);setDetails({});setProfileId('');setWebUrl('');setBusy('');setError('');setNotice('');}
    const cancelRequests=()=>{
      for(const request of requests.current)request.abort();
      if(nativeAction.current&&transport.native&&getSessionEpoch()===epoch)void transport.cancel().catch(()=>{});
    };
    window.addEventListener('petpal:session-change',cancelRequests);
    return()=>{alive.current=false;cancelRequests();requests.current.clear();operation.current=null;window.removeEventListener('petpal:session-change',cancelRequests);};
  },[allowed,epoch,transport]);

  async function save(event:FormEvent){
    event.preventDefault();if(!config||!dirty||running)return;
    await run('保存 OpenCLI',async signal=>{
      const next=await transport.configure(openCliConfigPatch(config,enabled,originDraft),signal);
      if(!current()||signal.aborted)return;
      setConfig(next);setEnabled(next.enabled);setOriginDraft(openCliOriginDraft(next));setDetails({});
      setNotice(next.enabled?'OpenCLI 设置已保存。Agent 可按当前权限调用网站查询；浏览器桥由你手动连接。':'已关闭 OpenCLI。新的 Agent 网站查询和网页操作将被禁用。');
      const nextStatus=await transport.status(signal);if(current()&&!signal.aborted)applyStatus(nextStatus,true);
      if(!current()||signal.aborted)return;
      const nextCatalog=await transport.sites({},signal);if(current()&&!signal.aborted)setCatalog(nextCatalog);
    });
  }
  async function loadDetails(site:string){
    if(details[site]||running)return;
    await run(`读取 ${site} 命令`,async signal=>{
      const next=await transport.sites({site},signal);
      if(current()&&!signal.aborted)setDetails(previous=>({...previous,[site]:next.commands||[]}));
    });
  }
  async function browserAction(body:OpenCliBrowserAction,label:string){
    if(!config?.enabled||dirty||running)return;
    await run(label,async signal=>{
      nativeAction.current=true;
      try{
        const result=await transport.action(body,signal);
        if(!current()||signal.aborted)return;
        if(result.ok===false)throw new Error(result.message||result.error||'网页操作未完成，请刷新状态。');
        const next=await transport.status(signal);
        if(!current()||signal.aborted)return;
        applyStatus(next);
        setNotice(body.action==='close'?'已断开小伴的浏览器连接。共享浏览器桥保持运行。':body.action==='open'?result.tab?.url?`已打开 ${result.tab.url}`:'已提交网页打开请求，请查看浏览器。':next.ready?'已连接所选 Chrome 档案。':'连接检查完成，请选择在线 Chrome 档案后连接。');
      }finally{nativeAction.current=false;}
    });
  }
  async function cancel(){
    if(!current()||!operation.current)return;
    const token=Symbol('cancel');operation.current=token;
    for(const request of requests.current)request.abort();
    const controller=new AbortController();requests.current.add(controller);setBusy('正在取消');
    try{
      if(transport.native&&current(controller))await transport.cancel();
      if(!current(controller))return;
      const next=await transport.status(controller.signal);
      if(current(controller)){applyStatus(next);setNotice('当前请求已取消。已发出的网页操作可能已生效，请检查浏览器和最新状态。');}
    }catch(e){if(current(controller)&&!isSessionChanged(e))setError((e as Error).message);}
    finally{requests.current.delete(controller);if(operation.current===token){operation.current=null;if(current())setBusy('');}}
  }
  function prepareBrowser(){
    if(!alive.current||!prepareAllowedNow.current||operation.current||getSessionEpoch()!==epoch||!onPrepareBrowser)return;
    onPrepareBrowser();
  }

  const summary=catalog?.summary||status?.catalog;
  const needle=search.trim().toLowerCase();
  const sites=(allowed?catalog?.sites||[]:[]).filter(site=>(filter!=='callable'||site.queryCommands>0)&&(!needle||[site.site,site.label||'',...site.domains,...site.enabledCommands].some(value=>value.toLowerCase().includes(needle))));
  const notebookSites=allowed?catalog?.notebookSites||[]:[];
  const awaitingOrigins=notebookSites.filter(site=>site.status==='needs-url').length;
  const selectedOnline=!!status?.profiles.some(profile=>profile.id===profileId&&profile.connected);
  const browserReady=!!status?.ready&&selectedOnline&&status.selectedProfileId===profileId;
  const browserAttached=status?.daemon.state==='owned'||status?.daemon.state==='shared';
  const actionDisabled=!allowed||running||dirty||!config?.enabled;
  const managedHost=transport.native?'这台电脑':'服务主机';
  const managedStatus=allowed?status:null;
  const chromeState=managedStatus?.setup?.chromeInstalled===true?'已检测到 Chrome':managedStatus?.setup?.chromeInstalled===false?'未检测到 Chrome':'Chrome 尚未检测';
  const bridgeState=managedStatus?`${bridgeStates[managedStatus.daemon.state]} · ${managedStatus.extension.connected?'扩展已连接':'扩展未连接'}`:'Browser Bridge 尚未检测';
  return <section className="assistant-section opencli-settings" aria-labelledby="opencli-title">
    <div className="assistant-section-heading"><div><h3 id="opencli-title"><Globe2 size={19}/>OpenCLI 网站工具</h3><p>{transport.native?'管理这台电脑':'管理服务主机'}的内置网站查询与 Chrome 网页工具。</p></div><button type="button" className="secondary-button" disabled={!allowed||running} onClick={()=>void read()}><RefreshCw size={14}/>刷新状态</button></div>
    {!allowed&&<p className="assistant-unavailable">{!connected?'登录后可以读取 OpenCLI 设置。':transport.native?'需要账号拥有完全访问这台电脑的 Agent 权限。':'服务主机的 OpenCLI 配置由主账号管理。网页和 Android 可通过所选执行电脑调用。'}</p>}
    {error&&<p className="form-error" role="alert">{error}</p>}
    <form id="opencli-config-form" className="opencli-enable-form" onSubmit={save} noValidate>
      <label className="opencli-enable"><input type="checkbox" checked={enabled} disabled={!allowed||running||!config} onChange={event=>{setEnabled(event.target.checked);setNotice('');}}/><span><strong>启用内置 OpenCLI</strong><small>首次配置默认开启，保留你保存的关闭选择。</small></span></label>
      <button type="submit" className="primary-button" disabled={!allowed||running||!config||!dirty}><Check size={15}/>保存</button>
    </form>
    {allowed&&dirty&&<div className="opencli-unsaved"><span>开关或网站网址尚未保存。</span><button type="button" className="assistant-tool-settings" disabled={running} onClick={()=>void read(true)}>恢复已保存设置</button></div>}
    <div className="opencli-status-line" aria-live="polite"><span className={`opencli-state${status?.queryReady?' is-ready':''}`}>{!allowed?'未读取':!status?'等待状态':!status.config.enabled?'已关闭':status.queryReady?'网站查询已就绪':'运行时未就绪'}</span>{allowed&&status?.version&&<span>OpenCLI {status.version}</span>}{allowed&&summary&&<span>{summary.querySites} 个查询入口 · {summary.queryCommands} 项开放命令{summary.publicQueryCommands!==undefined&&summary.browserQueryCommands!==undefined?`（公开 ${summary.publicQueryCommands} / 浏览器 ${summary.browserQueryCommands}）`:''}</span>}</div>
    <p className="field-help">公开网站查询无需 Chrome 扩展，交给 Agent 调用即可；仍遵循任务的访问权限和确认设置。网页操作需安装 Browser Bridge 并明确选择 Chrome 档案。</p>
    {allowed&&status?.message&&<p className="assistant-unavailable">{status.message}</p>}
    {busy&&<div className="opencli-progress" role="status"><span className="assistant-state"><Loader2 size={15} className="spin"/>{busy}…</span><button type="button" className="secondary-button" disabled={!allowed||busy==='正在取消'} onClick={()=>void cancel()}>取消请求</button></div>}

    <details className="opencli-notebook">
      <summary><span><strong>常用网站</strong><small>{notebookSites.length?`${notebookSites.length} 个入口${awaitingOrigins?` · ${awaitingOrigins} 个待配置网址`:''}`:'读取状态后查看常用网站'}</small></span><ChevronDown size={16}/></summary>
      <div className="opencli-notebook-body">
        <p className="field-help">Agent 可查询这些网站。Switch520 使用网站原生搜索，其余自建站点通过必应 site: 搜索；页面读取限于默认或已保存网址。入口已准备不代表所有网站已联网验收。</p>
        {!!notebookSites.length&&<ul className="opencli-notebook-list">{notebookSites.map(site=>{
          const entry=catalog?.sites.find(item=>item.site===site.site);
          const configured=openCliConfiguredSites.find(item=>item.site===site.site);
          return <li key={site.site}>
            <div className="opencli-notebook-row"><strong>{site.label}</strong><span className={`opencli-capability${site.status==='ready'?' is-callable':''}`}>{site.status==='needs-url'?'待配置网址':entry?.mode?modeLabels[entry.mode]:'查询入口'}</span></div>
            <p className="opencli-notebook-description">{site.origins.length?site.origins.join(' · '):'填写当前网站的 HTTPS 地址后使用'}{site.login?` · ${loginLabels[site.login]}`:''}</p>
            {!!site.commands.length&&<p className="opencli-command-names">{site.commands.map(command=><code key={command}>{command}</code>)}</p>}
            {configured&&<div className="opencli-origin-fields">{Array.from({length:configured.slots},(_,index)=><label key={index} htmlFor={`opencli-origin-${site.site}-${index}`}><span>{index?'自定义备用网址（可选）':'自定义网址（可选）'}</span><input id={`opencli-origin-${site.site}-${index}`} form="opencli-config-form" type="url" value={originDraft[site.site]?.[index]||''} placeholder={site.origins[index]||'https://网站域名'} maxLength={512} autoCapitalize="none" autoCorrect="off" spellCheck={false} disabled={!allowed||running||!config} onChange={event=>{const value=event.target.value;setOriginDraft(previous=>({...previous,[site.site]:Array.from({length:configured.slots},(_,at)=>at===index?value:previous[site.site]?.[at]||'')}));setNotice('');}}/></label>)}</div>}
          </li>;
        })}</ul>}
        {!notebookSites.length&&<p className="field-help">{!allowed?'登录并取得设置权限后可查看。':catalog?'当前执行端暂未提供常用网站配置，请升级该端运行时。':'请先读取 OpenCLI 状态。'}</p>}
        {!!notebookSites.length&&<p className="field-help">已配置计划中的默认网址。仅在网站换域名时填写自定义 HTTPS 源地址，省略页面路径和查询参数；清空并保存可恢复默认网址。修改后使用上方“保存”，未保存时不会用于 Agent。</p>}
      </div>
    </details>

    <details className="opencli-catalog">
      <summary><span><strong>网站与命令清单</strong><small>{summary?`已打包 ${summary.adapterNamespaces} 个适配器 · ${summary.totalCommands} 项命令`:'读取状态后查看'}</small></span><ChevronDown size={16}/></summary>
      <div className="opencli-catalog-body">
        <p className="field-help">“可调用”是小伴已开放的查询，公开查询无需 Chrome，浏览器查询使用所选档案的登录状态。其他适配器仅随运行时打包；清单不代表当前网络已通过测试。</p>
        <div className="opencli-catalog-search"><label><span className="opencli-visually-hidden">搜索网站或命令</span><Search size={15}/><input type="search" value={search} maxLength={120} placeholder="搜索网站、域名或命令" disabled={!allowed||!catalog} onChange={event=>setSearch(event.target.value)}/></label><select aria-label="网站清单范围" value={filter} disabled={!allowed||!catalog} onChange={event=>setFilter(event.target.value)}><option value="callable">可调用的查询</option><option value="all">所有内置适配器</option></select></div>
        <p className="opencli-result-count" role="status">{catalog?`${sites.length} 个结果`:'正在等待读取清单'}</p>
        <div className="opencli-site-list">{sites.map(site=><details className="opencli-site" key={site.site}>
          <summary><span><strong>{site.label||site.site}</strong><small>{site.domains.length?site.domains.join(' · '):site.websiteStatus==='needs-url'?'等待配置当前网站网址':site.local?'本地应用适配器':'上游适配器'}</small></span><span className={`opencli-capability${site.queryCommands?' is-callable':''}`}>{site.websiteStatus==='needs-url'?'待网址':site.queryCommands?`${site.queryCommands} 项可调用`:'仅打包'}</span><ChevronDown size={14}/></summary>
          <div className="opencli-site-body"><p className="field-help">共 {site.commands} 项内置命令{site.browserCommands?`，其中 ${site.browserCommands} 项依赖浏览器桥`:''}。{site.mode&&`${modeLabels[site.mode]}。`}{site.login&&`${loginLabels[site.login]}。`}{!site.queryCommands&&'当前尚未向 Agent 开放此适配器。'}{site.websiteStatus==='needs-url'&&'请先在“常用网站”保存当前网址。'}</p>
            {!!site.enabledCommands.length&&<><p className="opencli-command-names">{site.enabledCommands.map(command=><code key={command}>{command}</code>)}</p><button type="button" className="assistant-tool-settings" disabled={!allowed||running||!!details[site.site]} onClick={()=>void loadDetails(site.site)}>{details[site.site]?'已读取查询说明':'查看查询参数与说明'}</button></>}
            {details[site.site]&&<ul className="opencli-command-list">{details[site.site].filter(command=>command.callable).map(command=><li key={command.command}><code>{command.command}</code><p>{command.description}</p><small>{command.mode?`${modeLabels[command.mode]}。`:''}{command.login?`${loginLabels[command.login]}。`:''}{command.mode==='browser'||command.mode==='configured'?'需显式选择在线 Chrome 档案。':''}{parameters(command)}</small></li>)}</ul>}
          </div>
        </details>)}</div>
        {catalog&&!sites.length&&<p className="field-help">没有匹配的适配器，请更换搜索词或切换清单范围。</p>}
      </div>
    </details>

    <details className="opencli-browser">
      <summary><span><strong>Chrome 网页连接</strong><small>{managedHost} · {chromeState} · {managedStatus?.extension.connected?'Bridge 已连接':'需要 Browser Bridge'}</small></span><ChevronDown size={16}/></summary>
      <div className="opencli-browser-body">
        <p className="field-help">下方检测和连接管理{managedHost}；聊天任务使用你在聊天中选择的执行电脑。网页或 Android 没有 Chrome，也可通过远程电脑查询网站。</p>
        {onPrepareBrowser&&<div className="opencli-prepare-browser"><button type="button" className="secondary-button" disabled={!canPrepareBrowser} onClick={prepareBrowser}><Globe2 size={14}/>让 Agent 准备浏览器</button><p>生成任务草稿，在聊天所选执行电脑上准备；由你发送，沿用当前权限。</p></div>}
        <ol className="opencli-browser-steps">
          <li><div><strong>安装 Chrome</strong><span className="opencli-browser-detection">{managedHost}：{chromeState}{managedStatus?.setup?` · ${managedStatus.setup.platform}/${managedStatus.setup.arch}`:''}</span><p>在{managedHost}安装 Chrome 并打开要使用的档案。</p><a href={chromeDownloadUrl} target="_blank" rel="noreferrer">Chrome 官方下载 ↗</a>{managedStatus?.setup?.message&&<p>{managedStatus.setup.message}</p>}</div></li>
          <li><div><strong>安装 Browser Bridge 扩展</strong><p>在该 Chrome 档案中打开扩展商店，由你确认安装并授权连接。</p><a href={bridgeExtensionUrl} target="_blank" rel="noreferrer">安装 Browser Bridge 扩展 ↗</a></div></li>
          <li><div><strong>启动浏览器桥并选择档案</strong><span className="opencli-browser-detection">{managedHost}：{bridgeState}</span><p>扩展显示 Reconnecting 时，先启动浏览器桥，再选择在线 Chrome 档案并连接。</p>
            <label>Chrome 档案<select aria-label="OpenCLI 浏览器档案" value={allowed?profileId:''} disabled={actionDisabled} onChange={event=>setProfileId(event.target.value)}><option value="">请选择在线档案</option>{managedStatus?.profiles.map(profile=><option key={profile.id} value={profile.id} disabled={!profile.connected}>{profile.label}{profile.connected?'':'（离线）'}</option>)}</select></label>
            <div className="assistant-actions"><button type="button" className="secondary-button" disabled={actionDisabled||!managedStatus?.available||(managedStatus.daemon.state==='external'&&!managedStatus.daemon.compatible)||(!!profileId&&!selectedOnline)} onClick={()=>void browserAction({action:'connect',...(profileId?{profileId}:{})},'检查浏览器连接')}><Globe2 size={14}/>{managedStatus?.daemon.state==='stopped'?'启动浏览器桥':profileId?'连接所选档案':'检查连接'}</button><button type="button" className="secondary-button" disabled={actionDisabled||!browserAttached} onClick={()=>void browserAction({action:'close'},'断开浏览器')}><Unplug size={14}/>断开</button></div>
          </div></li>
        </ol>
        {allowed&&managedStatus?.websiteAccess==='all'&&<form className="opencli-web-open" onSubmit={event=>{event.preventDefault();if(!actionDisabled&&browserReady&&managedStatus?.websiteAccess==='all'&&webUrl.trim())void browserAction({action:'open',profileId,url:webUrl.trim()},'打开网页');}}>
          <label>打开网站<input type="url" aria-label="OpenCLI 网站地址" placeholder="https://…" value={webUrl} maxLength={2048} required disabled={actionDisabled||managedStatus?.websiteAccess!=='all'} onChange={event=>setWebUrl(event.target.value)}/></label>
          <button type="submit" className="secondary-button" disabled={actionDisabled||!browserReady||managedStatus?.websiteAccess!=='all'||!webUrl.trim()}><ArrowUpRight size={14}/>打开</button>
        </form>}
        <div className="assistant-actions opencli-browser-sites">{officialSites.map(site=><button type="button" className="secondary-button" key={site.url} disabled={actionDisabled||!browserReady} onClick={()=>void browserAction({action:'open',profileId,url:site.url},`打开${site.name}`)}><ArrowUpRight size={14}/>{site.name}</button>)}</div>
        <div className="assistant-links"><a href="https://github.com/jackwener/opencli" target="_blank" rel="noreferrer">OpenCLI 使用说明 ↗</a></div>
        <p className="field-help">{managedStatus?.websiteAccess==='all'?'默认支持所有 HTTP(S) 网站，常用查询列表是快捷入口。':'该执行电脑尚未报告全网站能力，请更新其客户端运行时。'} 网页操作沿用任务权限与审批。断开只关闭小伴自己的页面与自有进程。</p>
      </div>
    </details>
    {notice&&<p className="assistant-message" role="status"><Check size={15}/>{notice}</p>}
  </section>;
}
