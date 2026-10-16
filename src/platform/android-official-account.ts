import {Capacitor,registerPlugin,type PluginListenerHandle} from '@capacitor/core';
import {getConnection,getIdentity,getSessionEpoch,subscribeSession,SessionChangedError,type OfficialAccountBridge,type OfficialAccountStatus} from '../api';

type NativeScope={scopeId:string};
type NativeOfficialAccount={
  bind(input:{url:string;token:string;instanceId:string;userId:string}):Promise<NativeScope&{status:OfficialAccountStatus}>;
  clearScope():Promise<void>;
  status(input:NativeScope):Promise<OfficialAccountStatus>;
  start(input:NativeScope&{profileId?:string}):Promise<OfficialAccountStatus>;
  cancel(input:NativeScope):Promise<OfficialAccountStatus>;
  select(input:NativeScope&{profileId:string}):Promise<OfficialAccountStatus>;
  logout(input:NativeScope):Promise<OfficialAccountStatus>;
  refresh(input:NativeScope):Promise<OfficialAccountStatus>;
  resumeUsage(input:NativeScope):Promise<OfficialAccountStatus>;
  completeCallback(input:NativeScope):Promise<OfficialAccountStatus>;
  addListener(event:'status',listener:()=>void):Promise<PluginListenerHandle>;
};
const native=registerPlugin<NativeOfficialAccount>('PetOfficialAccount');
export const supportsAndroidOfficialAccount=()=>Capacitor.isNativePlatform()&&Capacitor.getPlatform()==='android'&&Capacitor.isPluginAvailable('PetOfficialAccount');
let generation=0,active:{key:string;scopeId:string;pending:Promise<string>}|undefined,reset:Promise<unknown>=Promise.resolve();
type SessionSnapshot={epoch:number;url:string;hasToken:boolean;ownerKey?:string};
// Kept for this JS module's lifetime, rather than for one React effect. A
// StrictMode cleanup is not a logout and cannot cancel a native OAuth attempt.
let observed:SessionSnapshot|undefined;

function owner(){
  const identity=getIdentity(),connection=getConnection(),epoch=getSessionEpoch();
  if(!identity||!connection.token)throw new Error('请先登录小伴账号。');
  return{...identity,...connection,epoch,key:`${epoch}:${identity.instanceId}:${identity.userId}:${connection.url}`};
}
function current(value:ReturnType<typeof owner>){
  try{return value.key===owner().key;}catch{return false;}
}
function invalidate(){
  generation++;active=undefined;
  // Clear immediately in native code. A late bind must also fail its native
  // generation guard; never wait for a slow network request before revocation.
  reset=native.clearScope().catch(()=>{});
}
async function bound(value:ReturnType<typeof owner>){
  if(active?.key===value.key)return active.pending;
  const revision=++generation;
  const state={key:value.key,scopeId:'',pending:Promise.resolve('')};active=state;
  state.pending=(async()=>{
    await reset;
    if(generation!==revision||!current(value))throw new SessionChangedError();
    const result=await native.bind({url:value.url||location.origin,token:value.token,instanceId:value.instanceId,userId:value.userId});
    if(generation!==revision||!current(value)||active!==state)throw new SessionChangedError();
    if(typeof result.scopeId!=='string'||!result.scopeId||result.scopeId.length>160)throw new Error('手机官方账号连接不完整，请重试。');
    state.scopeId=result.scopeId;return state.scopeId;
  })().catch(error=>{if(active===state)active=undefined;throw error;});
  return state.pending;
}
async function call(action:'status'|'start'|'cancel'|'select'|'logout'|'refresh'|'resumeUsage'|'completeCallback',profileId?:string){
  const value=owner(),scopeId=await bound(value);
  if(!current(value))throw new SessionChangedError();
  const result=action==='start'?await native.start({scopeId,...(profileId?{profileId}:{})}):action==='select'?await native.select({scopeId,profileId:profileId||''}):await native[action]({scopeId});
  if(!current(value)||active?.scopeId!==scopeId)throw new SessionChangedError();
  return result;
}
// Callback text is accepted by a native-only dialog, never as a JS argument.
const bridge:OfficialAccountBridge={status:()=>call('status'),start:input=>call('start',input?.profileId),cancel:()=>call('cancel'),select:id=>call('select',id),logout:()=>call('logout'),refresh:()=>call('refresh'),resumeUsage:()=>call('resumeUsage'),completeCallback:()=>call('completeCallback')};
export const androidOfficialAccount=()=>supportsAndroidOfficialAccount()?bridge:undefined;

/** Keep the native account bound to the login independently of settings tabs. */
export function mountAndroidOfficialSession(){
  if(!supportsAndroidOfficialAccount())return()=>{};
  let alive=true,nativeListener:PluginListenerHandle|undefined;
  const changed=()=>{
    if(!alive)return;
    let value:ReturnType<typeof owner>|undefined;
    try{value=owner();}catch{}
    const connection=getConnection();
    const next:SessionSnapshot={epoch:getSessionEpoch(),url:connection.url,hasToken:!!connection.token,ownerKey:value?.key};
    const previous=observed;
    observed=next;
    // This lifecycle mounts only after initConnection has read saved login.
    // A token without identity is still awaiting /auth/me: let native bind
    // independently verify and reuse the existing host once identity arrives.
    // A confirmed empty login, real connection/epoch change or changed verified
    // owner must revoke immediately, including while an old bind is pending.
    const changedSession=previous&&(previous.epoch!==next.epoch||previous.url!==next.url||previous.hasToken!==next.hasToken||!!previous.ownerKey&&previous.ownerKey!==next.ownerKey);
    if((!previous&&!next.hasToken)||changedSession||value&&active&&active.key!==value.key)invalidate();
    if(value)void bound(value).catch(()=>{});
  };
  const unsubscribe=subscribeSession(changed);changed();
  void native.addListener('status',()=>{
    if(alive&&getIdentity())window.dispatchEvent(new Event('petpal:official-native-change'));
  }).then(listener=>{if(alive)nativeListener=listener;else void listener.remove();}).catch(()=>{});
  // Native callers verify session validity too; this warm status check updates
  // an already-bound relay after coming back from the system browser.
  const visible=()=>{if(alive&&!document.hidden&&getIdentity())void call('status').catch(()=>{});};
  document.addEventListener('visibilitychange',visible);
  return()=>{alive=false;unsubscribe();void nativeListener?.remove();document.removeEventListener('visibilitychange',visible);};
}
