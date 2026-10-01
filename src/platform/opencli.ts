import { api, getSessionEpoch, SessionChangedError, type OpenCliStatus as BrowserStatus } from '../api';

export type OpenCliConfig = { revision:string; enabled:boolean; siteOrigins?:Record<string,string[]> };
export type OpenCliMode = 'public'|'browser'|'configured'|'inventory';
export type OpenCliLogin = 'optional'|'required'|'share';
export type OpenCliSite = {
  site:string; domains:string[]; commands:number; queryCommands:number; browserCommands:number;
  enabledCommands:string[]; needsBrowserBridge:boolean; local:boolean; id:string;
  label?:string; mode?:OpenCliMode; websiteStatus?:'ready'|'needs-url'; login?:OpenCliLogin;
};
export type OpenCliCommand = {
  site:string; command:string; description:string; access:string; strategy:string;
  browser:boolean; callable:boolean; inputSchema?:Record<string,unknown>;
  mode?:OpenCliMode; login?:OpenCliLogin;
};
export type OpenCliSitesArgs = { site?:string; command?:string };
export type OpenCliSites = {
  version:string;
  summary:{adapterNamespaces:number;totalCommands:number;readCommands:number;writeCommands:number;browserCommands:number;querySites:number;queryCommands:number;publicQueryCommands?:number;browserQueryCommands?:number;configuredSites?:number};
  sites:OpenCliSite[]; commands?:OpenCliCommand[];
  notebookSites?:{site:string;label:string;origins:string[];status:'ready'|'needs-url';commands:string[];login?:OpenCliLogin}[];
};
export type OpenCliSetup = {
  platform:string; arch:string; supported:boolean; chromeInstalled:boolean|null; installerSupported:boolean;
  extensionUrl:string; downloadPage:string; message:string;
};
export type OpenCliStatus = BrowserStatus & { config:OpenCliConfig; catalog:OpenCliSites['summary']|null; queryReady:boolean; setup?:OpenCliSetup };
export type OpenCliBrowserAction = {
  action:'connect'|'tabs'|'open'|'snapshot'|'click'|'fill'|'key'|'close';
  profileId?:string; tabId?:string; url?:string; target?:number; text?:string;
  key?:'Enter'|'Escape'|'ArrowUp'|'ArrowDown'|'ArrowLeft'|'ArrowRight'|'Space';
};
export type OpenCliActionResult = {
  ok?:boolean; action?:string; message?:string; error?:string; ready?:boolean;
  tab?:{id:string;url:string;title:string;active:boolean}; closed?:boolean;
  [key:string]:unknown;
};
export type DesktopOpenCli = {
  config():Promise<OpenCliConfig>; status():Promise<OpenCliStatus>;
  configure(body:OpenCliConfig):Promise<OpenCliConfig>;
  action(body:OpenCliBrowserAction):Promise<OpenCliActionResult>;
  sites(body?:OpenCliSitesArgs):Promise<OpenCliSites>;
  cancel():Promise<OpenCliStatus>;
};
export type OpenCliTransport = {
  native:boolean;
  config(signal?:AbortSignal):Promise<OpenCliConfig>;
  status(signal?:AbortSignal):Promise<OpenCliStatus>;
  configure(body:OpenCliConfig,signal?:AbortSignal):Promise<OpenCliConfig>;
  action(body:OpenCliBrowserAction,signal?:AbortSignal):Promise<OpenCliActionResult>;
  sites(body?:OpenCliSitesArgs,signal?:AbortSignal):Promise<OpenCliSites>;
  cancel():Promise<OpenCliStatus|void>;
};

export const openCliConfiguredSites=[
  {site:'dyyj',label:'电影云集',slots:2},
  {site:'switch520',label:'Switch520',slots:1},
  {site:'gamer520',label:'Gamer520',slots:1},
  {site:'dygang',label:'电影港',slots:1},
  {site:'wlgo',label:'围炉Go',slots:1},
  {site:'fire-exam',label:'消防职业技能鉴定考试网',slots:1},
] as const;
export type OpenCliOriginDraft = Record<string,string[]>;

export function openCliOriginDraft(config?:OpenCliConfig|null):OpenCliOriginDraft {
  return Object.fromEntries(openCliConfiguredSites.map(({site,slots})=>[
    site,Array.from({length:slots},(_,index)=>config?.siteOrigins?.[site]?.[index]||''),
  ]));
}

function nonemptyOrigins(draft:OpenCliOriginDraft):Record<string,string[]> {
  return Object.fromEntries(openCliConfiguredSites.map(({site})=>[site,(draft[site]||[]).map(origin=>origin.trim()).filter(Boolean)]).filter(([,origins])=>origins.length));
}

export function openCliConfigChanged(config:OpenCliConfig|null,enabled:boolean,draft:OpenCliOriginDraft):boolean {
  return !!config&&(config.enabled!==enabled||JSON.stringify(nonemptyOrigins(openCliOriginDraft(config)))!==JSON.stringify(nonemptyOrigins(draft)));
}

export function openCliConfigPatch(config:OpenCliConfig,enabled:boolean,draft:OpenCliOriginDraft):OpenCliConfig {
  const siteOrigins:Record<string,string[]>={};
  for(const {site,label,slots} of openCliConfiguredSites){
    const origins=(draft[site]||[]).map(origin=>origin.trim()).filter(Boolean);
    if(origins.length>slots)throw new Error(`${label}最多设置 ${slots} 个网址。`);
    for(const origin of origins){
      let url:URL;
      try{url=new URL(origin);}catch{throw new Error(`${label}的网址格式不正确，请使用 https://域名。`);}
      if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||(url.pathname!==''&&url.pathname!=='/'))throw new Error(`${label}只接受 HTTPS 源地址，请移除账号、路径、查询参数和片段。`);
      if(!siteOrigins[site])siteOrigins[site]=[];
      if(!siteOrigins[site].includes(url.origin))siteOrigins[site].push(url.origin);
    }
  }
  return {revision:config.revision,enabled,siteOrigins};
}

// Keep the bridge type here without redefining the rest of Window.petpal.
export function nativeOpenCli():DesktopOpenCli|undefined {
  return (window.petpal as unknown as {opencli?:DesktopOpenCli}|undefined)?.opencli;
}

export function openCliTransport():OpenCliTransport {
  const native=nativeOpenCli(),prefix='/desktop-tools/opencli',epoch=getSessionEpoch();
  let cancellation:Promise<OpenCliStatus|void>|undefined;
  const guarded=async<T>(run:()=>Promise<T>,signal?:AbortSignal,cancellable=false):Promise<T>=>{
    if(epoch!==getSessionEpoch())throw new SessionChangedError();
    signal?.throwIfAborted();
    const stop=()=>{if(cancellable&&epoch===getSessionEpoch())void cancelNative().catch(()=>{});};
    signal?.addEventListener('abort',stop,{once:true});
    try {
      const result=await run();
      if(epoch!==getSessionEpoch())throw new SessionChangedError();
      signal?.throwIfAborted();return result;
    } finally {signal?.removeEventListener('abort',stop);}
  };
  const cancelNative=():Promise<OpenCliStatus|void>=>{
    if(epoch!==getSessionEpoch())return Promise.reject(new SessionChangedError());
    if(!native)return Promise.resolve();
    if(!cancellation){
      const pending=guarded(()=>native.cancel());cancellation=pending;
      void pending.finally(()=>{if(cancellation===pending)cancellation=undefined;}).catch(()=>{});
    }
    return cancellation;
  };
  return {
    native:!!native,
    config:signal=>guarded(()=>native?native.config():api<OpenCliConfig>(`${prefix}/config`,{signal}),signal),
    status:signal=>guarded(()=>native?native.status():api<OpenCliStatus>(`${prefix}/status`,{signal}),signal),
    configure:(body,signal)=>guarded(()=>native?native.configure(body):api<OpenCliConfig>(`${prefix}/config`,{method:'PATCH',body:JSON.stringify(body),signal}),signal),
    action:(body,signal)=>guarded(()=>native?native.action(body):api<OpenCliActionResult>(`${prefix}/action`,{method:'POST',body:JSON.stringify(body),signal}),signal,!!native),
    sites:(body={},signal)=>guarded(()=>{
      if(native)return native.sites(body);
      const query=new URLSearchParams();
      if(body.site!==undefined)query.set('site',body.site);
      if(body.command!==undefined)query.set('command',body.command);
      return api<OpenCliSites>(`${prefix}/sites${query.size?`?${query}`:''}`,{signal});
    },signal),
    cancel:cancelNative,
  };
}
