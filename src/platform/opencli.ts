import { api, getSessionEpoch, SessionChangedError, type OpenCliStatus as BrowserStatus } from '../api';

export type OpenCliConfig = { revision:string; enabled:boolean };
export type OpenCliSite = {
  site:string; domains:string[]; commands:number; queryCommands:number; browserCommands:number;
  enabledCommands:string[]; needsBrowserBridge:boolean; local:boolean; id:string;
};
export type OpenCliCommand = {
  site:string; command:string; description:string; access:string; strategy:string;
  browser:boolean; callable:boolean; inputSchema?:Record<string,unknown>;
};
export type OpenCliSitesArgs = { site?:string; command?:string };
export type OpenCliSites = {
  version:string;
  summary:{adapterNamespaces:number;totalCommands:number;readCommands:number;writeCommands:number;browserCommands:number;querySites:number;queryCommands:number};
  sites:OpenCliSite[]; commands?:OpenCliCommand[];
};
export type OpenCliStatus = BrowserStatus & { config:OpenCliConfig; catalog:OpenCliSites['summary']|null; queryReady:boolean };
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
