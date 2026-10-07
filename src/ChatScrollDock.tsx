import {useEffect,useId,useRef,useState} from 'react';
import {ArrowDown,ChevronLeft,ChevronRight} from 'lucide-react';

export default function ChatScrollDock({onLatest}:{onLatest:()=>void}) {
  const [expanded,setExpanded]=useState(true);
  const [hovered,setHovered]=useState(false);
  const [focused,setFocused]=useState(false);
  const toggleRef=useRef<HTMLButtonElement>(null);
  const actionId=useId();

  useEffect(()=>{
    if(!expanded||hovered||focused)return;
    const timer=window.setTimeout(()=>setExpanded(false),2800);
    return()=>window.clearTimeout(timer);
  },[expanded,hovered,focused]);

  function collapse(){setExpanded(false);toggleRef.current?.focus({preventScroll:true});}

  return <div className="chat-scroll-dock" data-expanded={expanded}
    onPointerEnter={event=>{if(event.pointerType==='mouse')setHovered(true);}}
    onPointerLeave={()=>setHovered(false)}
    onFocusCapture={()=>setFocused(true)}
    onBlurCapture={event=>{if(!event.currentTarget.contains(event.relatedTarget))setFocused(false);}}
    onKeyDown={event=>{if(event.key==='Escape'&&expanded){event.preventDefault();event.stopPropagation();collapse();}}}>
    <div id={actionId} className="chat-scroll-dock-action" inert={!expanded} aria-hidden={!expanded}>
      <button type="button" className="chat-latest-button" aria-label="回到最新消息" title="回到最新消息" onClick={onLatest} tabIndex={expanded?0:-1}>
        <ArrowDown size={18} aria-hidden="true"/>
      </button>
    </div>
    <button ref={toggleRef} type="button" className="chat-scroll-dock-toggle" aria-label={expanded?'收起消息导航':'展开消息导航'} title={expanded?'收起消息导航':'展开消息导航'} aria-expanded={expanded} aria-controls={actionId} onClick={()=>setExpanded(value=>!value)}>
      {expanded?<ChevronRight size={14} aria-hidden="true"/>:<ChevronLeft size={14} aria-hidden="true"/>}
    </button>
  </div>;
}
