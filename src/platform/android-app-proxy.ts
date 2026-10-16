import {Capacitor,registerPlugin} from '@capacitor/core';
import {getConnection,getIdentity,getSessionEpoch,subscribeSession,SessionChangedError} from '../api';

export type AndroidAppProxyStatus={supported:boolean;unavailableReason:string;scope:string;platform:'android';abi:string;version:string;state:'stopped'|'checking'|'starting'|'running'|'stopping'|'error';running:boolean;configured:boolean;autoStart:boolean;remoteConfigured:boolean;remoteUpdatedAt:string;source:'manual'|'url'|'server';mode:'rule'|'global'|'direct';serverProfileId:string;serverProfileName:string;serverProfileRevision:string;serverProfileUpdatedAt:string;serverUpdateAvailable:boolean;serverStatus:'none'|'ready'|'update-available'|'unavailable'|'revoked';groups:Array<{name:string;selected:string;choices:string[]}>;error:string};
type Scope={scope:string};
type Native={bindScope(input:{url:string;token:string;instanceId:string;userId:string}):Promise<AndroidAppProxyStatus>;clearScope():Promise<AndroidAppProxyStatus>;status():Promise<AndroidAppProxyStatus>;start(input:Scope):Promise<AndroidAppProxyStatus>;stop(input:Scope):Promise<AndroidAppProxyStatus>;importFile(input:Scope):Promise<AndroidAppProxyStatus>;importText(input:Scope&{yaml:string}):Promise<AndroidAppProxyStatus>;importUrl(input:Scope&{url:string}):Promise<AndroidAppProxyStatus>;updateRemote(input:Scope):Promise<AndroidAppProxyStatus>;importServer(input:Scope&{profileId:string;resetPolicy?:boolean}):Promise<AndroidAppProxyStatus>;updateServer(input:Scope&{resetPolicy?:boolean}):Promise<AndroidAppProxyStatus>;checkServer(input:Scope):Promise<AndroidAppProxyStatus>;mode(input:Scope&{mode:'rule'|'global'|'direct'}):Promise<AndroidAppProxyStatus>;preferences(input:Scope&{autoStart:boolean}):Promise<AndroidAppProxyStatus>;select(input:Scope&{group:string;name:string}):Promise<AndroidAppProxyStatus>};
const native=registerPlugin<Native>('PetAppProxy');
export const supportsAndroidAppProxy=()=>Capacitor.isNativePlatform()&&Capacitor.getPlatform()==='android'&&Capacitor.isPluginAvailable('PetAppProxy');
const clean=(value:unknown,max=256):value is string=>typeof value==='string'&&value.length<=max&&!/[\x00-\x1f\x7f]/.test(value);
export function readAndroidAppProxyStatus(input:unknown):AndroidAppProxyStatus{
  if(!input||typeof input!=='object')throw new Error('代理状态不完整，请刷新重试。');
  const value=input as Record<string,unknown>;
  if(typeof value.supported!=='boolean'||!clean(value.unavailableReason,300)||!clean(value.scope,160)||value.platform!=='android'||!clean(value.abi,40)||!clean(value.version,40)||!['stopped','checking','starting','running','stopping','error'].includes(value.state as string)||typeof value.running!=='boolean'||value.running!==(value.state==='running')||['configured','autoStart','remoteConfigured'].some(key=>typeof value[key]!=='boolean')||!clean(value.remoteUpdatedAt,64)||!Array.isArray(value.groups)||value.groups.length>128)throw new Error('代理状态不完整，请刷新重试。');
  if(!['manual','url','server'].includes(value.source as string)||!['rule','global','direct'].includes(value.mode as string)||!clean(value.serverProfileId,128)||!clean(value.serverProfileName)||!clean(value.serverProfileRevision,128)||!clean(value.serverProfileUpdatedAt,64)||typeof value.serverUpdateAvailable!=='boolean'||!['none','ready','update-available','unavailable','revoked'].includes(value.serverStatus as string))throw new Error('服务器代理状态不完整，请刷新重试。');
  if(value.source==='server'&&(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value.serverProfileId)||!value.serverProfileName||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.serverProfileRevision)||!value.serverProfileUpdatedAt||value.serverStatus==='none'||value.remoteConfigured))throw new Error('服务器代理状态不完整，请刷新重试。');
  const groups=value.groups.map(entry=>{
    if(!entry||!clean(entry.name)||!entry.name||!clean(entry.selected)||!Array.isArray(entry.choices)||entry.choices.length>2048||entry.choices.some((name:unknown)=>!clean(name)||!name))throw new Error('代理节点状态不完整。');
    return{name:entry.name,selected:entry.selected,choices:[...entry.choices] as string[]};
  });
  return{supported:value.supported,unavailableReason:value.unavailableReason,scope:value.scope,platform:'android',abi:value.abi,version:value.version,state:value.state as AndroidAppProxyStatus['state'],running:value.running,configured:value.configured as boolean,autoStart:value.autoStart as boolean,remoteConfigured:value.remoteConfigured as boolean,remoteUpdatedAt:value.remoteUpdatedAt,source:value.source as AndroidAppProxyStatus['source'],mode:value.mode as AndroidAppProxyStatus['mode'],serverProfileId:value.serverProfileId,serverProfileName:value.serverProfileName,serverProfileRevision:value.serverProfileRevision,serverProfileUpdatedAt:value.serverProfileUpdatedAt,serverUpdateAvailable:value.serverUpdateAvailable,serverStatus:value.serverStatus as AndroidAppProxyStatus['serverStatus'],groups,error:value.error?'应用代理需要检查，请关闭后重试。':''};
}
function owner(){const identity=getIdentity(),connection=getConnection();if(!identity||!connection.token)throw new Error('请先登录小伴账号。');return{...identity,...connection,key:`${getSessionEpoch()}:${identity.instanceId}:${identity.userId}:${connection.url}`};}
function current(key:string){try{return key===owner().key;}catch{return false;}}
let revision=0,active:{key:string;pending:Promise<AndroidAppProxyStatus>}|undefined,clearing:Promise<unknown>=Promise.resolve();
function invalidate(){revision++;active=undefined;clearing=native.clearScope().catch(()=>{});}
async function bound(){
  const value=owner();if(active?.key===value.key)return active.pending;
  const generation=++revision,state={key:value.key,pending:Promise.resolve(null as unknown as AndroidAppProxyStatus)};active=state;
  state.pending=(async()=>{await clearing;if(generation!==revision||!current(value.key))throw new SessionChangedError();const result=readAndroidAppProxyStatus(await native.bindScope({url:value.url||location.origin,token:value.token,instanceId:value.instanceId,userId:value.userId}));if(generation!==revision||!current(value.key)||active!==state)throw new SessionChangedError();if(!result.scope)throw new Error('代理登录绑定未完成。');return result;})().catch(error=>{if(active===state)active=undefined;throw error;});
  return state.pending;
}
export type AndroidProxyAction='status'|'start'|'stop'|'importFile'|'importText'|'importUrl'|'updateRemote'|'importServer'|'updateServer'|'checkServer'|'mode'|'preferences'|'select';
export type AndroidProxyInput={yaml:string}|{url:string}|{profileId:string;resetPolicy?:boolean}|{resetPolicy:boolean}|{mode:'rule'|'global'|'direct'}|{autoStart:boolean}|{group:string;name:string};
export async function androidAppProxyAction(action:AndroidProxyAction,input?:AndroidProxyInput){
  if(!supportsAndroidAppProxy())throw new Error('此客户端未提供 Android 应用代理。');
  const key=owner().key,status=await bound();if(!current(key))throw new SessionChangedError();
  const payload={...input,scope:status.scope};
  const result=readAndroidAppProxyStatus(action==='status'?await native.status():action==='importText'?await native.importText(payload as Scope&{yaml:string}):action==='importUrl'?await native.importUrl(payload as Scope&{url:string}):action==='importServer'?await native.importServer(payload as Scope&{profileId:string;resetPolicy?:boolean}):action==='updateServer'?await native.updateServer(payload as Scope&{resetPolicy?:boolean}):action==='mode'?await native.mode(payload as Scope&{mode:'rule'|'global'|'direct'}):action==='preferences'?await native.preferences(payload as Scope&{autoStart:boolean}):action==='select'?await native.select(payload as Scope&{group:string;name:string}):await native[action](payload));
  if(!current(key)||result.scope!==status.scope)throw new SessionChangedError();return result;
}
/** Mount at app level; closing the settings panel must not stop a live connection. */
export function mountAndroidAppProxyLifecycle(){
  if(!supportsAndroidAppProxy())return()=>{};
  let key='',alive=true;
  const change=()=>{let next='';try{next=owner().key;}catch{}if(next===key)return;key=next;invalidate();if(next)void bound().catch(()=>{});};
  const unsubscribe=subscribeSession(change);const sessionChange=()=>{if(!getIdentity()){key='';invalidate();}else change();};
  window.addEventListener('petpal:session-change',sessionChange);change();
  const visible=()=>{if(alive&&!document.hidden&&getIdentity())void androidAppProxyAction('checkServer').catch(()=>{});};document.addEventListener('visibilitychange',visible);
  return()=>{alive=false;unsubscribe();window.removeEventListener('petpal:session-change',sessionChange);document.removeEventListener('visibilitychange',visible);invalidate();};
}
