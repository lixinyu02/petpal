import {useCallback,useEffect,useId,useLayoutEffect,useRef,useState,type CSSProperties} from 'react';
import {createPortal} from 'react-dom';
import {ArrowUpRight,Check,ChevronDown,Loader2,RefreshCw,Settings2,ShieldCheck,Square,Terminal,X} from 'lucide-react';
import {api,getSessionEpoch,isSessionChanged,type AgentHost,type AgentPermissions as Permissions,type AssistantTask,type ChatAssistantConfig,type Conversation,type Provider,type User} from './api';
import {chatAssistantTargetIssue,readChatAssistantPreferences,saveChatAssistantPreferences,snapshotChatAssistant,type ChatAssistantPreferences} from './chat-assistant-preferences.mjs';
import {executionPlatform} from './execution-hosts.mjs';
import AgentPermissions,{defaultAgentPermissions} from './AgentPermissions';
import {ModelPicker} from './WorkspaceControls';
import './chat-assistant.css';

const taskLabels={deciding:'正在安排',queued:'已排队',running:'执行中',completed:'已完成',error:'未完成',cancelled:'已取消',unknown:'状态待确认'};
type HostState={hosts:AgentHost[];loading:boolean;error:string;refresh():void};
type AssistantSelection=ChatAssistantPreferences&{enabled:boolean;permissions:Permissions};
const emptySelection:AssistantSelection={enabled:false,hostId:'',providerId:'',permissions:{...defaultAgentPermissions}};

/** Autonomy is in memory for this authenticated page; only target preferences persist. */
export function useChatAssistant({scope,allowed,hostState}:{scope:string;allowed:boolean;hostState?:HostState}) {
  const epoch=getSessionEpoch();
  const [selection,setSelection]=useState({scope:'',epoch,value:emptySelection});
  const [remoteHosts,setRemoteHosts]=useState<AgentHost[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState(''),[revision,setRevision]=useState(0);
  const value=selection.scope===scope&&selection.epoch===epoch?selection.value:emptySelection;
  useEffect(()=>{
    let storage:Storage|undefined;try{storage=localStorage;}catch{}
    setSelection({scope,epoch,value:{...readChatAssistantPreferences(storage,scope),enabled:false,permissions:{...defaultAgentPermissions}}});
  },[scope,epoch]);
  useEffect(()=>{
    const disable=()=>setSelection(previous=>({...previous,value:{...previous.value,enabled:false}}));
    window.addEventListener('petpal:session-change',disable);return()=>window.removeEventListener('petpal:session-change',disable);
  },[]);
  useEffect(()=>{
    if(hostState||!allowed||!scope){setRemoteHosts([]);setError('');setLoading(false);return;}
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
    const poll=async()=>{
      setLoading(true);
      try{
        const next=await api<{hosts:AgentHost[]}>('/agent/hosts',{signal:controller.signal});
        if(!controller.signal.aborted&&epoch===getSessionEpoch()){setRemoteHosts(next.hosts);setError('');}
      }catch(cause){if(!controller.signal.aborted&&!isSessionChanged(cause))setError((cause as Error).message||'暂时无法连接执行电脑。');}
      finally{if(!controller.signal.aborted){setLoading(false);timer=setTimeout(()=>void poll(),10000);}}
    };
    void poll();return()=>{controller.abort();if(timer)clearTimeout(timer);};
  },[scope,allowed,!!hostState,revision,epoch]);
  const change=useCallback((next:AssistantSelection)=>{
    let storage:Storage|undefined;try{storage=localStorage;}catch{}
    saveChatAssistantPreferences(storage,scope,next);
    setSelection({scope,epoch,value:{...next,enabled:allowed&&next.enabled}});
  },[scope,epoch,allowed]);
  const hosts=hostState?.hosts??remoteHosts;
  const snapshot=useCallback(():ChatAssistantConfig|undefined=>snapshotChatAssistant(value,allowed&&epoch===getSessionEpoch()),[value,allowed,epoch]);
  return {value,change,hosts,loading:hostState?.loading??loading,error:hostState?.error??error,refresh:hostState?.refresh??(()=>setRevision(previous=>previous+1)),snapshot};
}

export function ChatAssistantControls({assistant,allowed,user,providers,disabled=false,compact=false}:{assistant:ReturnType<typeof useChatAssistant>;allowed:boolean;user?:User;providers:Provider[];disabled?:boolean;compact?:boolean}) {
  const id=useId(),{value,hosts}=assistant;
  const [open,setOpen]=useState(false),[placement,setPlacement]=useState<{layer:CSSProperties;panel:CSSProperties;sheet:boolean}>(),[ownedPortal,setOwnedPortal]=useState('');
  const trigger=useRef<HTMLButtonElement>(null),panel=useRef<HTMLElement>(null),body=useRef<HTMLDivElement>(null),heading=useRef<HTMLDivElement>(null),closeButton=useRef<HTMLButtonElement>(null);
  const selected=hosts.find(host=>host.id===value.hostId),issue=chatAssistantTargetIssue(value,hosts,providers,!!user?.isOwner);
  const ownedPopup=()=>{
    const control=panel.current?.querySelector<HTMLElement>('.workspace-model-trigger[aria-controls]');
    const list=control?.getAttribute('aria-controls');
    return list?document.getElementById(list)?.closest<HTMLElement>('.workspace-model-popup'):null;
  };
  useLayoutEffect(()=>{
    if(!open)return;
    let frame=0;
    const place=()=>{
      const anchor=trigger.current?.getBoundingClientRect();if(!anchor||!panel.current)return;
      const viewport=window.visualViewport,left=viewport?.offsetLeft||0,top=viewport?.offsetTop||0,width=viewport?.width||window.innerWidth,height=viewport?.height||window.innerHeight;
      const sheet=width<=650,gutter=sheet?0:12,panelWidth=sheet?width:Math.min(380,width-gutter*2),fullHeight=Math.max(1,height-(sheet?10:24));
      const naturalHeight=(heading.current?.offsetHeight||72)+(body.current?.scrollHeight||330)+2;
      const below=top+height-anchor.bottom-19,above=anchor.top-top-19;
      const aboveAnchor=below<Math.min(naturalHeight,330)&&above>below;
      const available=aboveAnchor?above:below;
      const maxHeight=sheet?fullHeight:Math.min(fullHeight,available>180?available:fullHeight),renderedHeight=Math.min(naturalHeight,maxHeight);
      const panelTop=sheet?top+height-renderedHeight:Math.max(top+12,Math.min(aboveAnchor?anchor.top-renderedHeight-7:anchor.bottom+7,top+height-12-renderedHeight));
      const next={sheet,layer:{left,top,width,height} as CSSProperties,panel:{left:sheet?left:Math.max(left+gutter,Math.min(anchor.right-panelWidth,left+width-gutter-panelWidth)),top:panelTop,width:panelWidth,maxHeight,height:renderedHeight} as CSSProperties};
      setPlacement(previous=>JSON.stringify(previous)===JSON.stringify(next)?previous:next);
    };
    const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(place);};
    place();
    const observer=new ResizeObserver(schedule);if(panel.current)observer.observe(panel.current);if(body.current)observer.observe(body.current);
    window.addEventListener('resize',schedule);window.addEventListener('scroll',schedule,true);window.visualViewport?.addEventListener('resize',schedule);window.visualViewport?.addEventListener('scroll',schedule);
    return()=>{cancelAnimationFrame(frame);observer.disconnect();window.removeEventListener('resize',schedule);window.removeEventListener('scroll',schedule,true);window.visualViewport?.removeEventListener('resize',schedule);window.visualViewport?.removeEventListener('scroll',schedule);};
  },[open]);
  useEffect(()=>{
    if(!open)return;
    const previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';
    closeButton.current?.focus({preventScroll:true});
    const focusables=()=>Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex]:not([tabindex="-1"])')||[]).filter(element=>{
      if(!element.getClientRects().length)return false;
      const style=getComputedStyle(element);
      if(style.display==='none'||style.visibility==='hidden'||style.visibility==='collapse')return false;
      // Fixed-position descendants of closed details can retain geometry without being keyboard reachable.
      for(let ancestor=element.parentElement;ancestor;ancestor=ancestor.parentElement){
        if(ancestor instanceof HTMLDetailsElement&&!ancestor.open){
          const summary=Array.from(ancestor.children).find(child=>child.tagName==='SUMMARY');
          if(!summary?.contains(element))return false;
        }
      }
      return true;
    });
    const focusInside=(event:FocusEvent)=>{
      const target=event.target as Node,popup=ownedPopup();
      if(!panel.current?.contains(target)&&!popup?.contains(target))closeButton.current?.focus({preventScroll:true});
    };
    const keyDown=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){
        // Nested selectors handle Escape first; a permissions disclosure may be open without focus inside it.
        if(ownedPopup())return;
        const disclosure=panel.current?.querySelector<HTMLDetailsElement>('.workspace-disclosure[open]');
        if(disclosure){event.preventDefault();disclosure.open=false;disclosure.querySelector<HTMLElement>('summary')?.focus({preventScroll:true});return;}
        event.preventDefault();setOpen(false);return;
      }
      if(event.key!=='Tab')return;
      const items=focusables();if(!items.length){event.preventDefault();panel.current?.focus({preventScroll:true});return;}
      const active=document.activeElement,popup=ownedPopup();
      if(popup?.contains(active)){
        // ModelPicker closes itself on Tab. Continue from its trigger, rather than jumping to page controls.
        const modelTrigger=panel.current?.querySelector<HTMLElement>('.workspace-model-trigger');
        const index=modelTrigger?items.indexOf(modelTrigger):-1;
        event.preventDefault();items[(index+(event.shiftKey?-1:1)+items.length)%items.length]?.focus({preventScroll:true});return;
      }
      const index=items.indexOf(active as HTMLElement);
      if(index<0||(!event.shiftKey&&index===items.length-1)||(event.shiftKey&&index===0)){event.preventDefault();items[event.shiftKey?items.length-1:0].focus({preventScroll:true});}
    };
    const attachPortal=()=>{
      const popup=ownedPopup();if(popup&&!popup.id)popup.id=`${id}-model-layer`;
      setOwnedPortal(previous=>previous===(popup?.id||'')?previous:popup?.id||'');
    };
    const observer=new MutationObserver(attachPortal);observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['aria-controls']});attachPortal();
    document.addEventListener('keydown',keyDown);document.addEventListener('focusin',focusInside);
    return()=>{observer.disconnect();document.removeEventListener('keydown',keyDown);document.removeEventListener('focusin',focusInside);document.body.style.overflow=previousOverflow;setOwnedPortal('');if(trigger.current?.isConnected)trigger.current.focus({preventScroll:true});};
  },[open,id]);
  useEffect(()=>{if(!allowed)setOpen(false);},[allowed]);
  const targetSummary=selected?`${selected.name}${selected.online?'':' · 离线'}`:value.hostId?'此前电脑 · 未连接':'选择执行电脑';
  return <div className={`chat-assistant-controls${compact?' is-compact':''}`}>
    <button ref={trigger} type="button" className={`chat-assistant-trigger${value.enabled?' is-enabled':''}`} aria-label={`Chat + Agent 设置：${value.enabled?'开启':'关闭'}，${targetSummary}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open?`${id}-dialog`:undefined} onClick={()=>setOpen(previous=>!previous)}>
      <Terminal size={14} aria-hidden="true"/><span className="chat-assistant-trigger-copy"><strong>Chat + Agent</strong><small>{targetSummary}</small></span><span className="chat-assistant-trigger-state">{value.enabled?'开':'关'}</span><Settings2 size={13} aria-hidden="true"/>
    </button>
    {open&&createPortal(<div className="chat-assistant-layer" style={placement?.layer} onClick={event=>{if(event.target===event.currentTarget)setOpen(false);}}>
      <section ref={panel} id={`${id}-dialog`} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} aria-owns={ownedPortal||undefined} tabIndex={-1} className={`chat-assistant-dialog${placement?.sheet?' is-sheet':''}`} style={placement?.panel}>
        <div ref={heading} className="chat-assistant-dialog-heading"><div><h2 id={`${id}-title`}>Chat + Agent</h2><p id={`${id}-description`}>需要操作电脑时交给后台 Agent，聊天继续。</p></div><button ref={closeButton} type="button" aria-label="关闭 Chat + Agent 设置" onClick={()=>setOpen(false)}><X size={18}/></button></div>
        <div ref={body} className="chat-assistant-options">
      <label className="chat-assistant-enable"><input type="checkbox" role="switch" aria-label="启用 Chat + Agent" checked={value.enabled} disabled={disabled||!allowed||(!value.enabled&&!!issue)} onChange={event=>assistant.change({...value,enabled:event.target.checked})}/><span>自动派发 Agent 任务<small>按下方设置执行，仅本次登录有效。</small></span></label>
      <div className="chat-assistant-target-row">
        <label htmlFor={`${id}-host`}><span>执行电脑</span><select id={`${id}-host`} aria-label="Chat + Agent 执行电脑" value={value.hostId} disabled={disabled||!allowed} onChange={event=>assistant.change({...value,hostId:event.target.value})}>
          <option value="">请选择一台电脑</option>
          {value.hostId&&!selected&&<option value={value.hostId} disabled>此前选择的电脑 · 未连接</option>}
          {hosts.map(host=><option key={host.id} value={host.id} disabled={!host.online}>{host.name} · {host.kind==='central'?'服务器':executionPlatform(host.platform)} · {host.online?'在线':'离线'}</option>)}
        </select></label>
        <button type="button" className="chat-assistant-refresh" aria-label="刷新 Chat + Agent 电脑" disabled={assistant.loading||!allowed} onClick={assistant.refresh}>{assistant.loading?<Loader2 size={15} className="spin"/>:<RefreshCw size={15}/>}</button>
      </div>
      <ModelPicker providers={providers} value={value.providerId} label="后台 Agent 模型" fallbackLabel={user?.isOwner?'主机默认模型':'选择 Agent 模型'} fallbackOption={user?.isOwner?{label:'主机默认模型',description:'使用执行主机的 Codex 配置'}:undefined} disabled={disabled||!allowed} onChange={providerId=>assistant.change({...value,providerId})}/>
      <div className="chat-assistant-permissions"><AgentPermissions value={value.permissions} user={user} disabled={disabled||!allowed} onChange={permissions=>assistant.change({...value,permissions})}/></div>
      {!allowed?<p className="chat-assistant-note">请先登录并开通 Agent 权限。</p>:assistant.error?<p className="chat-assistant-note is-error" role="status">{assistant.error}</p>:issue?<p className="chat-assistant-note" role="status">{issue}</p>:disabled?<p className="chat-assistant-note" role="status">当前回复结束后，可以调整下一次任务的设置。</p>:null}
        </div>
      </section>
    </div>,document.body)}
  </div>;
}

/** Refresh background tasks without making the foreground conversation busy. */
export function ChatAssistantTasks({conversationId,tasks=[],onUpdate}:{conversationId?:string;tasks?:AssistantTask[];onUpdate(conversation:Conversation):void}) {
  const [cancelling,setCancelling]=useState(''),[error,setError]=useState('');
  const [children,setChildren]=useState<Record<string,Conversation>>({}),[expanded,setExpanded]=useState(false),[approvalPending,setApprovalPending]=useState('');
  const running=tasks.some(task=>['deciding','queued','running'].includes(task.status)),last=tasks.at(-1),epoch=getSessionEpoch();
  const childIds=tasks.slice(-8).filter(task=>expanded||['queued','running'].includes(task.status)).map(task=>task.conversationId).filter((id):id is string=>!!id).join(',');
  useEffect(()=>{setError('');setCancelling('');setChildren({});setExpanded(false);setApprovalPending('');},[conversationId]);
  useEffect(()=>{
    if(!conversationId||!running)return;
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
    const poll=async()=>{
      try{
        const next=await api<Conversation>(`/conversations/${encodeURIComponent(conversationId)}`,{signal:controller.signal});
        if(!controller.signal.aborted&&epoch===getSessionEpoch())onUpdate(next);
      }catch(cause){if(!controller.signal.aborted&&!isSessionChanged(cause))setError('暂时无法确认后台 Agent 的进度，请检查连接。');}
      finally{if(!controller.signal.aborted)timer=setTimeout(()=>void poll(),2000);}
    };
    timer=setTimeout(()=>void poll(),1000);return()=>{controller.abort();if(timer)clearTimeout(timer);};
  },[conversationId,running,epoch,onUpdate]);
  useEffect(()=>{
    if(!childIds)return;
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
    const poll=async()=>{
      const results=await Promise.allSettled(childIds.split(',').map(id=>api<Conversation>(`/conversations/${encodeURIComponent(id)}`,{signal:controller.signal})));
      if(controller.signal.aborted||epoch!==getSessionEpoch())return;
      setChildren(previous=>{const next={...previous};for(const result of results)if(result.status==='fulfilled')next[result.value.id]=result.value;return next;});
      timer=setTimeout(()=>void poll(),3000);
    };
    void poll();return()=>{controller.abort();if(timer)clearTimeout(timer);};
  },[childIds,epoch]);
  async function cancel(task:AssistantTask){
    if(!conversationId||cancelling)return;setCancelling(task.id);setError('');
    try{
      await api(`/conversations/${encodeURIComponent(conversationId)}/assistant/tasks/${encodeURIComponent(task.id)}/stop`,{method:'POST'});
      const next=await api<Conversation>(`/conversations/${encodeURIComponent(conversationId)}`);
      if(epoch===getSessionEpoch())onUpdate(next);
    }catch(cause){if(!isSessionChanged(cause))setError((cause as Error).message||'未能取消任务。');}
    finally{if(epoch===getSessionEpoch())setCancelling('');}
  }
  async function approve(child:Conversation,approvalId:string,decision:string){
    if(approvalPending)return;setApprovalPending(approvalId);setError('');
    try{
      await api(`/codex/approvals/${encodeURIComponent(approvalId)}`,{method:'POST',body:JSON.stringify({decision})});
      const next=await api<Conversation>(`/conversations/${encodeURIComponent(child.id)}`);
      if(epoch===getSessionEpoch())setChildren(previous=>({...previous,[next.id]:next}));
    }catch(cause){if(!isSessionChanged(cause))setError((cause as Error).message||'未能处理确认请求。');}
    finally{if(epoch===getSessionEpoch())setApprovalPending('');}
  }
  if(!last)return null;
  const pendingApprovals=tasks.filter(task=>['queued','running'].includes(task.status)).flatMap(task=>task.conversationId?children[task.conversationId]?.agent?.approvals||[]:[]).length;
  const taskIcon=(task:AssistantTask)=>['deciding','queued','running'].includes(task.status)?<Loader2 size={13} className="spin"/>:task.status==='completed'?<Check size={13}/>:<Terminal size={13}/>;
  const canCancel=(task:AssistantTask)=>['deciding','queued','running','unknown'].includes(task.status);
  return <div className="chat-assistant-tasks" aria-label="后台 Agent 任务">
    <div className="chat-assistant-task-latest" role="status"><span className={`assistant-task-state is-${last.status}`}>{taskIcon(last)}{taskLabels[last.status]}</span><span className="assistant-task-label" title={`${last.hostName} · ${last.message}`}>{last.hostName} · 后台 Agent</span>{pendingApprovals>0&&<button type="button" onClick={()=>setExpanded(true)} className="assistant-task-approval-jump">确认 ({pendingApprovals})</button>}{canCancel(last)&&<button type="button" disabled={!!cancelling} onClick={()=>void cancel(last)} aria-label="取消后台 Agent 任务">{cancelling===last.id?<Loader2 size={12} className="spin"/>:<Square size={11}/>}取消</button>}</div>
    <details className="chat-assistant-task-details" open={expanded} onToggle={event=>setExpanded(event.currentTarget.open)}><summary>任务详情<ChevronDown size={12}/></summary><div>{tasks.slice(-8).reverse().map(task=>{
      const child=task.conversationId?children[task.conversationId]:undefined;
      return <section className="chat-assistant-task-entry" key={task.id}><p><strong>{taskLabels[task.status]} · {task.hostName}</strong><span>{task.message||'后台 Agent 正在处理任务。'}</span></p>
        <div className="assistant-task-actions">{task.conversationId&&<a href={`/?chat=1&mode=codex&conversation=${encodeURIComponent(task.conversationId)}`}>查看 Agent<ArrowUpRight size={12}/></a>}{canCancel(task)&&task.id!==last.id&&<button type="button" disabled={!!cancelling} onClick={()=>void cancel(task)}>取消任务</button>}</div>
        {['queued','running'].includes(task.status)&&child?.agent?.approvals.map(approval=><div className="assistant-task-approval" key={approval.id}><strong><ShieldCheck size={13}/>Agent 等待确认</strong><p>{approval.description}</p><div><button type="button" disabled={!!approvalPending} onClick={()=>void approve(child,approval.id,'decline')}>拒绝</button><button type="button" disabled={!!approvalPending} onClick={()=>void approve(child,approval.id,'accept')}>允许本次</button></div></div>)}
      </section>;
    })}</div></details>
    {error&&<p className="chat-assistant-note is-error" role="alert">{error}</p>}
  </div>;
}
