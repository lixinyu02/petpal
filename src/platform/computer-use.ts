import {api} from '../api';
export type ComputerUseProfile='core'|'ax'|'scripting'|'windows-admin'|'full';
export type ComputerUseConfig={revision:string;enabled:boolean;profile:ComputerUseProfile};
export type ComputerUseStatus={config:ComputerUseConfig;version:string;platform:string;arch:string;connected:boolean;busy:boolean;toolsCount:number;readiness:{supported:boolean;nativeCompatible:boolean;interactiveDesktop:boolean;message:string}};
type NativeComputerUse={config():Promise<ComputerUseConfig>;status():Promise<ComputerUseStatus>;configure(body:ComputerUseConfig):Promise<ComputerUseConfig>;connect():Promise<ComputerUseStatus>;disconnect():Promise<ComputerUseStatus>;cancel():Promise<ComputerUseStatus>};
export function nativeComputerUse():NativeComputerUse|undefined{return(window.petpal as unknown as {computerUse?:NativeComputerUse}|undefined)?.computerUse;}
export function computerUseTransport(){
  const native=nativeComputerUse(),prefix='/desktop-tools/computer-use';
  const guarded=async<T>(run:()=>Promise<T>,signal?:AbortSignal)=>{signal?.throwIfAborted();const result=await run();signal?.throwIfAborted();return result;};
  return{
    native:!!native,
    config:(signal?:AbortSignal)=>native?guarded(()=>native.config(),signal):api<ComputerUseConfig>(`${prefix}/config`,{signal}),
    status:(signal?:AbortSignal)=>native?guarded(()=>native.status(),signal):api<ComputerUseStatus>(`${prefix}/status`,{signal}),
    configure:(body:ComputerUseConfig,signal?:AbortSignal)=>native?guarded(()=>native.configure(body),signal):api<ComputerUseConfig>(`${prefix}/config`,{method:'PATCH',body:JSON.stringify(body),signal}),
    connect:(signal?:AbortSignal)=>native?guarded(()=>native.connect(),signal):api<ComputerUseStatus>(`${prefix}/connect`,{method:'POST',body:'{}',signal}),
    disconnect:(signal?:AbortSignal)=>native?guarded(()=>native.disconnect(),signal):api<ComputerUseStatus>(`${prefix}/disconnect`,{method:'POST',body:'{}',signal}),
    cancel:()=>native?native.cancel():Promise.resolve(),
  };
}
