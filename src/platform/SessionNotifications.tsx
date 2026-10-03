import {useEffect,useSyncExternalStore} from 'react';
import {getIdentity,getSessionEpoch,subscribeSession} from '../api';
import {mountTaskNotificationSession,taskNotificationSession} from './task-notification-session';

/** Android notification restoration is independent of the visible page and auth gate. */
export default function SessionNotifications(){
  const epoch=useSyncExternalStore(subscribeSession,getSessionEpoch,getSessionEpoch);
  const notification=useSyncExternalStore(taskNotificationSession.subscribe,taskNotificationSession.snapshot,taskNotificationSession.snapshot);
  useEffect(()=>mountTaskNotificationSession(),[]);
  useEffect(()=>{
    const target=notification.navigation,identity=getIdentity();
    if(new URLSearchParams(location.search).has('chat')||!target||target.epoch!==getSessionEpoch()||target.instanceId!==identity?.instanceId||target.userId!==identity?.userId)return;
    const query=new URLSearchParams({chat:'1',conversation:target.conversation.id,mode:target.conversation.mode});
    taskNotificationSession.takeNavigation();
    location.assign(`${location.pathname}?${query.toString()}`);
  },[notification.navigation,epoch]);
  return null;
}
