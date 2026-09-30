import { api, getConnection, getIdentity, getSessionEpoch, subscribeSession, type Conversation, type State } from '../api';
import { createTaskNotificationController, type TaskNotificationSession } from './task-notification-controller.mjs';
import { PetTaskNotifications, supportsTaskNotifications, type TaskNotificationDevice } from './task-notifications';
import { connectionFetch } from '../auth/native-fetch';

function session():TaskNotificationSession|null{
  const identity=getIdentity(),connection=getConnection();
  return identity&&connection.token?{...identity,...connection,epoch:getSessionEpoch()}:null;
}
export const taskNotificationSession=createTaskNotificationController({
  native:PetTaskNotifications,session,
  register:(deviceId,signal)=>api<TaskNotificationDevice>('/notifications/devices',{method:'POST',body:JSON.stringify({deviceId}),signal}),
  revoke:async(deviceId,_signal,scope)=>{
    if(!scope)return;
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),4000);
    try{
      // This narrow cleanup uses only the original registration session. The
      // backend also matches its source session before revoking the installation.
      const response=await connectionFetch(`${scope.url}/api/notifications/devices/${encodeURIComponent(deviceId)}`,{method:'DELETE',headers:{Authorization:`Bearer ${scope.token}`},signal:controller.signal});
      if(!response.ok&&response.status!==401&&response.status!==403)throw new Error('设备提醒已停止，服务端凭据将在到期时清理。');
    }finally{clearTimeout(timer);}
  },
  refreshState:signal=>api<State>('/state',{signal}),
  fetchConversation:(id,signal)=>api<Conversation>(`/conversations/${encodeURIComponent(id)}`,{signal}),
  foreground:()=>document.visibilityState==='visible',
});

/** Unmount only removes JS observers; it must never stop an existing native service. */
export function mountTaskNotificationSession(){
  if(!supportsTaskNotifications())return()=>{};
  let alive=true,reconciling=false,again=false;
  const handles:Array<{remove():Promise<void>}>=[];
  const reconcile=()=>{
    if(!alive||!session())return;
    if(reconciling){again=true;return;}
    reconciling=true;
    void taskNotificationSession.reconcile().catch(()=>{}).finally(()=>{reconciling=false;if(again){again=false;reconcile();}});
  };
  const change=(event:Event)=>{
    const reason=(event as Event & {detail?:{reason:string}}).detail?.reason;
    // Cold-start authentication is not a confirmed account switch yet. Native
    // restoration survives until /auth/me verifies its exact account/server;
    // reconcile clears a mismatch before consuming any pending notification tap.
    if(reason==='restore'||reason==='authenticate')return;
    void taskNotificationSession.invalidate().then(reconcile);
  };
  const visible=()=>{if(document.visibilityState==='visible'){void taskNotificationSession.refresh().catch(()=>{});reconcile();}};
  window.addEventListener('petpal:session-change',change);
  const unsubscribe=subscribeSession(reconcile);
  document.addEventListener('visibilitychange',visible);window.addEventListener('focus',visible);
  for(const name of ['navigation','status'] as const)void PetTaskNotifications.addListener(name,()=>{
    if(!alive)return;
    if(name==='navigation')void taskNotificationSession.consume();else void taskNotificationSession.refresh().catch(()=>{});
  }).then(handle=>{if(alive)handles.push(handle);else void handle.remove();}).catch(()=>{});
  void taskNotificationSession.refresh().then(reconcile).catch(()=>{});
  return()=>{alive=false;unsubscribe();window.removeEventListener('petpal:session-change',change);document.removeEventListener('visibilitychange',visible);window.removeEventListener('focus',visible);for(const handle of handles)void handle.remove();};
}
