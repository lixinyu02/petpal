import {useEffect,useRef,useState} from 'react';
import {api,getIdentity,getSessionEpoch,subscribeSession,SessionChangedError,type User} from '../api';

/** UI lifetimes supplement the API's immutable login scope: unmounting must
 * cancel ticket requests and must not publish old-account catalogs. */
export function useCloudSession(connected:boolean,user?:User){
  const [,changed]=useState(0);
  useEffect(()=>subscribeSession(()=>changed(value=>value+1)),[]);
  const epoch=getSessionEpoch(),identity=getIdentity(),life=useRef(0),active=useRef(false),controllers=useRef(new Set<AbortController>());
  const allowed=connected&&!!user&&identity?.userId===user.id;
  useEffect(()=>{
    life.current++;active.current=true;
    return()=>{active.current=false;life.current++;for(const controller of controllers.current)controller.abort();controllers.current.clear();};
  },[connected,user?.id,epoch,identity?.instanceId]);
  const live=()=>active.current&&allowed&&epoch===getSessionEpoch()&&identity?.instanceId===getIdentity()?.instanceId&&identity?.userId===getIdentity()?.userId;
  const capture=()=>{if(!live())throw new SessionChangedError();return life.current;};
  const current=(generation:number)=>generation===life.current&&live();
  async function request<T>(path:string,options:RequestInit={},generation=capture()):Promise<T>{
    if(!current(generation))throw new SessionChangedError();
    const controller=new AbortController(),cancel=()=>controller.abort();
    controllers.current.add(controller);
    if(options.signal?.aborted)controller.abort();else options.signal?.addEventListener('abort',cancel,{once:true});
    try{const result=await api<T>(path,{...options,signal:controller.signal});if(controller.signal.aborted||!current(generation))throw new SessionChangedError();return result;}
    finally{controllers.current.delete(controller);options.signal?.removeEventListener('abort',cancel);}
  }
  return {allowed,epoch,key:allowed?`${identity?.instanceId}:${user?.id}`:'',live,capture,current,request};
}
