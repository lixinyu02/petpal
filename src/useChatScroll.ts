import {useCallback,useLayoutEffect,useRef,useState,type RefObject} from 'react';
import {createChatScroll} from './chat-scroll.mjs';

export function useChatScroll({scrollRef,conversationId,active,messages,approvalKey}:{scrollRef:RefObject<HTMLDivElement|null>;conversationId:string;active:boolean;messages:unknown;approvalKey:string}) {
  const contentRef=useRef<HTMLDivElement>(null),controller=useRef<ReturnType<typeof createChatScroll>|null>(null);
  const [following,setFollowing]=useState(true);
  useLayoutEffect(()=>{
    const element=scrollRef.current;
    if(!active||!element)return;
    const follow=createChatScroll({read:()=>element,scrollBottom:()=>element.scrollTo({top:element.scrollHeight,behavior:'instant'}),onFollowing:setFollowing,isCurrent:()=>element.isConnected});
    controller.current=follow;setFollowing(true);follow.latest();
    const observer=typeof ResizeObserver==='function'?new ResizeObserver(()=>follow.contentChanged()):undefined;
    if(contentRef.current)observer?.observe(contentRef.current);
    // Container resizes also cover the software keyboard and a collapsed partner panel.
    observer?.observe(element);
    return()=>{observer?.disconnect();follow.close();if(controller.current===follow)controller.current=null;};
  },[active,conversationId,scrollRef]);
  useLayoutEffect(()=>{if(active)controller.current?.contentChanged();},[active,messages,approvalKey]);
  const onScroll=useCallback(()=>controller.current?.userScrolled(),[]);
  const latest=useCallback(()=>controller.current?.latest(),[]);
  return {contentRef,onScroll,latest,showLatest:active&&!following};
}
