import {api} from '../api';

export type MusicMcpPlayer = 'netease'|'qqmusic';
export type MusicMcpConfig = {
  revision:string;
  pythonExecutable:string;
  cloudmusicExecutable:string;
  cdpPort:number;
  neteaseEnabled:boolean;
  qqmusicEnabled:boolean;
};
export type MusicMcpTool = {name:string;description:string;inputSchema:Record<string,unknown>};
export type MusicMcpServer = {
  id:MusicMcpPlayer;
  name:string;
  repository:string;
  url:string;
  platformSupported:boolean;
  enabled:boolean;
  connected:boolean;
  tools:MusicMcpTool[];
  message:string;
  credentialConfigured?:boolean;
  loginDirectory?:string;
};
export type MusicMcpStatus = {config:MusicMcpConfig;servers:MusicMcpServer[];busy:boolean};
export type DesktopMusicMcp = {
  config():Promise<MusicMcpConfig>;
  status():Promise<MusicMcpStatus>;
  configure(body:MusicMcpConfig):Promise<MusicMcpConfig>;
  prepare(body:{player:MusicMcpPlayer}):Promise<MusicMcpStatus>;
  connect(body:{player:MusicMcpPlayer}):Promise<MusicMcpStatus>;
  disconnect(body:{player:MusicMcpPlayer}):Promise<MusicMcpStatus>;
  cancel():Promise<MusicMcpStatus>;
};
export type MusicMcpTransport = {
  native:boolean;
  config(signal?:AbortSignal):Promise<MusicMcpConfig>;
  status(signal?:AbortSignal):Promise<MusicMcpStatus>;
  configure(body:MusicMcpConfig,signal?:AbortSignal):Promise<MusicMcpConfig>;
  prepare(player:MusicMcpPlayer,signal?:AbortSignal):Promise<MusicMcpStatus>;
  connect(player:MusicMcpPlayer,signal?:AbortSignal):Promise<MusicMcpStatus>;
  disconnect(player:MusicMcpPlayer,signal?:AbortSignal):Promise<MusicMcpStatus>;
  cancel():Promise<MusicMcpStatus|void>;
};

// Keep the bridge type here without redefining Window.petpal's existing members.
export function nativeMusicMcp():DesktopMusicMcp|undefined {
  return (window.petpal as unknown as {musicMcp?:DesktopMusicMcp}|undefined)?.musicMcp;
}

export function musicMcpTransport():MusicMcpTransport {
  const native=nativeMusicMcp();
  const guarded=async<T>(run:()=>Promise<T>,signal?:AbortSignal)=>{
    signal?.throwIfAborted();
    const result=await run();
    signal?.throwIfAborted();
    return result;
  };
  const path='/desktop-tools/music-mcp';
  const post=(action:'prepare'|'connect'|'disconnect',player:MusicMcpPlayer,signal?:AbortSignal)=>
    api<MusicMcpStatus>(`${path}/${action}`,{method:'POST',body:JSON.stringify({player}),signal});
  return {
    native:!!native,
    config:signal=>native?guarded(()=>native.config(),signal):api<MusicMcpConfig>(`${path}/config`,{signal}),
    status:signal=>native?guarded(()=>native.status(),signal):api<MusicMcpStatus>(`${path}/status`,{signal}),
    configure:(body,signal)=>native?guarded(()=>native.configure(body),signal):api<MusicMcpConfig>(`${path}/config`,{method:'PATCH',body:JSON.stringify(body),signal}),
    prepare:(player,signal)=>native?guarded(()=>native.prepare({player}),signal):post('prepare',player,signal),
    connect:(player,signal)=>native?guarded(()=>native.connect({player}),signal):post('connect',player,signal),
    disconnect:(player,signal)=>native?guarded(()=>native.disconnect({player}),signal):post('disconnect',player,signal),
    cancel:()=>native?native.cancel():Promise.resolve(),
  };
}
