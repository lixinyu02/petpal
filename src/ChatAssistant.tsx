import {useCallback,useEffect,useId,useLayoutEffect,useRef,useState,type CSSProperties} from 'react';
import {createPortal} from 'react-dom';
import {ArrowUpRight,Check,ChevronDown,Loader2,Monitor,Settings2,ShieldCheck,Square,Terminal,X} from 'lucide-react';
import {api,getSessionEpoch,isSessionChanged,type AgentHost,type AgentPermissions as Permissions,type AssistantTask,type ChatAssistantConfig,type Conversation,type Provider,type State,type User} from './api';
import {chatAssistantDefaultIssue,chatAssistantForHost,chatAssistantTargetIssue,restoreChatAssistantPreferences,saveChatAssistantPreferences,snapshotChatAssistant,type ChatAssistantPreferences} from './chat-assistant-preferences.mjs';
import {reuseConversationMessages} from './conversation-message-reuse.mjs';
import AgentPermissions,{defaultAgentPermissions} from './AgentPermissions';
import {approvalReviewLabel} from './approval-review-ui.mjs';
import {ExecutionHostPicker,ModelPicker} from './WorkspaceControls';
import ProjectDirectory from './ProjectDirectory';
import {projectDirectoryIssue} from './project-directory-preferences.mjs';
import {useUiEntrance} from './platform/ui-motion.ts';
import './chat-assistant.css';

const taskLabels={deciding:'正在安排',queued:'已排队',running:'执行中',completed:'已完成',error:'未完成',cancelled:'已取消',unknown:'状态待确认'};
type HostState={hosts:AgentHost[];loading:boolean;error:string;refresh():void};
type AssistantSelection=ChatAssistantPreferences&{enabled:boolean;permissions:Permissions};
const emptySelection:AssistantSelection={enabled:false,hostId:'',providerId:'',permissions:{...defaultAgentPermissions}};

/** The account remembers a target; autonomy and permissions remain session-only. */
export function useChatAssistant({scope,allowed,hostState,defaultHostId,onSettingsChanged}:{scope:string;allowed:boolean;hostState?:HostState;defaultHostId?:string|null;onSettingsChanged?(settings:State['settings']):void}) {
  const epoch=getSessionEpoch();
  const [selection,setSelection]=useState({scope:'',epoch,savedHostId:'',value:emptySelection});
  const [savingDefault,setSavingDefault]=useState(false),[defaultError,setDefaultError]=useState('');
  const saveSequence=useRef(0);
  const [remoteHosts,setRemoteHosts]=useState<AgentHost[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState(''),[revision,setRevision]=useState(0);
  const value=selection.scope===scope&&selection.epoch===epoch?selection.value:emptySelection;
  const savedHostId=selection.scope===scope&&selection.epoch===epoch?selection.savedHostId:'';
  useEffect(()=>{
    let storage:Storage|undefined;try{storage=localStorage;}catch{}
    const saved=defaultHostId||'';
    saveSequence.current++;setSavingDefault(false);setDefaultError('');
    setSelection(previous=>{
      if(previous.scope===scope&&previous.epoch===epoch){
        if(previous.savedHostId===saved)return previous;
        const next=previous.value.hostId===saved?previous.value:chatAssistantForHost(previous.value,saved,storage,scope);
        return {...previous,savedHostId:saved,value:{...next,enabled:previous.value.hostId===saved&&previous.value.enabled}};
      }
      const restored=restoreChatAssistantPreferences(storage,scope,defaultHostId);
      return {scope,epoch,savedHostId:saved,value:{...restored,enabled:false,permissions:{...defaultAgentPermissions,...(restored.reviewProviderId?{reviewProviderId:restored.reviewProviderId}:{})}}};
    });
  },[scope,epoch,defaultHostId]);
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
    if(savingDefault||epoch!==getSessionEpoch())return;
    let storage:Storage|undefined;try{storage=localStorage;}catch{}
    const normalized=next.hostId===value.hostId?next:chatAssistantForHost(next,next.hostId,storage,scope);
    saveChatAssistantPreferences(storage,scope,normalized);
    setDefaultError('');
    setSelection({scope,epoch,savedHostId,value:{...normalized,enabled:allowed&&normalized.enabled&&normalized.hostId===savedHostId}});
  },[scope,epoch,allowed,value.hostId,savedHostId,savingDefault]);
  const saveDefault=useCallback(async()=>{
    if(!allowed||!scope||!value.hostId||savingDefault||epoch!==getSessionEpoch())return;
    const chosen=value.hostId,sequence=++saveSequence.current;
    setSavingDefault(true);setDefaultError('');
    try{
      const settings=await api<State['settings']>('/settings',{method:'PATCH',body:JSON.stringify({chatAssistantHostId:chosen})});
      if(sequence!==saveSequence.current||epoch!==getSessionEpoch())return;
      if(settings.chatAssistantHostId!==chosen)throw new Error('服务端尚不支持账号默认执行电脑，请更新后端。');
      setSelection(previous=>previous.scope===scope&&previous.epoch===epoch?{...previous,savedHostId:chosen}:previous);
      onSettingsChanged?.(settings);
    }catch(cause){if(sequence===saveSequence.current&&epoch===getSessionEpoch()&&!isSessionChanged(cause))setDefaultError((cause as Error).message||'默认执行电脑未保存，请重试。');}
    finally{if(sequence===saveSequence.current)setSavingDefault(false);}
  },[scope,epoch,allowed,value.hostId,savingDefault,onSettingsChanged]);
  const hosts=hostState?.hosts??remoteHosts;
  const snapshot=useCallback(():ChatAssistantConfig|undefined=>snapshotChatAssistant(value,allowed&&epoch===getSessionEpoch(),hosts,savedHostId),[value,allowed,epoch,hosts,savedHostId]);
  return {value,change,hosts,savedHostId,saveDefault,savingDefault,loading:hostState?.loading??loading,error:defaultError||(hostState?.error??error),refresh:hostState?.refresh??(()=>setRevision(previous=>previous+1)),snapshot};
}

export function ChatAssistantControls({assistant,allowed,user,providers,reviewProviders=[],disabled=false,compact=false,localHostId='',onDownload}:{assistant:ReturnType<typeof useChatAssistant>;allowed:boolean;user?:User;providers:Provider[];reviewProviders?:Provider[];disabled?:boolean;compact?:boolean;localHostId?:string;onDownload?():void}) {
  const id=useId(),{value,hosts}=assistant;
  const [open,setOpen]=useState(false),[placement,setPlacement]=useState<{layer:CSSProperties;panel:CSSProperties;sheet:boolean}>(),[ownedPortal,setOwnedPortal]=useState('');
  const layer=useUiEntrance<HTMLDivElement>(`${id}-dialog`,open);
  const trigger=useRef<HTMLButtonElement>(null),panel=useRef<HTMLElement>(null),body=useRef<HTMLDivElement>(null),heading=useRef<HTMLDivElement>(null),closeButton=useRef<HTMLButtonElement>(null);
  disabled=disabled||assistant.savingDefault;
  const selected=hosts.find(host=>host.id===value.hostId),issue=chatAssistantTargetIssue(value,hosts,providers,!!user?.isOwner)||chatAssistantDefaultIssue(value,assistant.savedHostId)||projectDirectoryIssue(value.projectDirectory||'',selected);
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
    {open&&createPortal(<div ref={layer} className="chat-assistant-layer" style={placement?.layer} onClick={event=>{if(event.target===event.currentTarget)setOpen(false);}}>
      <section ref={panel} id={`${id}-dialog`} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} aria-owns={ownedPortal||undefined} tabIndex={-1} className={`chat-assistant-dialog${placement?.sheet?' is-sheet':''}`} style={placement?.panel}>
        <div ref={heading} className="chat-assistant-dialog-heading"><div><h2 id={`${id}-title`}>Chat + Agent</h2><p id={`${id}-description`}>需要操作电脑时交给后台 Agent，聊天继续。</p></div><button ref={closeButton} type="button" aria-label="关闭 Chat + Agent 设置" onClick={()=>setOpen(false)}><X size={18}/></button></div>
        <div ref={body} className="chat-assistant-options">
      <ExecutionHostPicker hosts={hosts} value={value.hostId} label="默认执行电脑" disabled={disabled||!allowed} loading={assistant.loading} localHostId={localHostId} lockReason={!allowed?'请先登录并开通 Agent 权限。':'当前回复结束后，可以调整下一次任务的设置。'} onRefresh={allowed?assistant.refresh:undefined} onDownload={onDownload} onChange={hostId=>{if(!disabled&&allowed&&hosts.some(host=>host.id===hostId&&host.online))assistant.change({...value,hostId});}}/>
      <div className="chat-assistant-default"><button type="button" disabled={disabled||!allowed||!selected||value.hostId===assistant.savedHostId} onClick={()=>void assistant.saveDefault()}>{assistant.savingDefault?<Loader2 size={14} className="spin"/>:value.hostId&&value.hostId===assistant.savedHostId?<Check size={14}/>:<Monitor size={14}/>}<span>{assistant.savingDefault?'正在保存…':value.hostId&&value.hostId===assistant.savedHostId?'已保存为账号默认':'设为默认执行电脑'}</span></button><small>开启后，聊天和语音派发的 Agent 任务在这台电脑执行。</small></div>
      <label className="chat-assistant-enable"><input type="checkbox" role="switch" aria-label="启用 Chat + Agent" checked={value.enabled} disabled={disabled||!allowed||(!value.enabled&&!!issue)} onChange={event=>assistant.change({...value,enabled:event.target.checked})}/><span>自动派发 Agent 任务<small>按下方权限执行，仅本次登录有效。</small></span></label>
      <ProjectDirectory value={value.projectDirectory||''} onChange={projectDirectory=>assistant.change({...value,projectDirectory})} host={selected} user={user} disabled={disabled||!allowed} lockReason="当前回复结束后，可以调整下一次后台任务的项目目录。"/>
      <ModelPicker providers={providers} value={value.providerId} label="后台 Agent 模型" fallbackLabel={user?.isOwner?'主机默认模型':'选择 Agent 模型'} fallbackOption={user?.isOwner?{label:'主机默认模型',description:'使用执行主机的 Codex 配置'}:undefined} disabled={disabled||!allowed} onChange={providerId=>assistant.change({...value,providerId})}/>
      <div className="chat-assistant-permissions"><AgentPermissions value={value.permissions} user={user} disabled={disabled||!allowed} onChange={permissions=>assistant.change({...value,permissions})} reviewCapability={selected?.codex?.approvalReview} reviewModel={providers.find(item=>item.id===value.providerId)?.model||selected?.codex?.model} reviewProviders={reviewProviders}/></div>
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
  const [approvalReadError,setApprovalReadError]=useState(''),[approvalRefreshing,setApprovalRefreshing]=useState('');
  const [approvalDecisions,setApprovalDecisions]=useState<Record<string,'pending'|'consumed'|'uncertain'>>({});
  const approvalDecisionsRef=useRef<Record<string,'pending'|'consumed'|'uncertain'>>({}),approvalLock=useRef(false),approvalReadLock=useRef(false),alive=useRef(true);
  const context=useRef(conversationId);context.current=conversationId;
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const running=tasks.some(task=>['deciding','queued','running'].includes(task.status)),last=tasks.at(-1),epoch=getSessionEpoch();
  const childIds=tasks.slice(-8).filter(task=>expanded||['queued','running'].includes(task.status)).map(task=>task.conversationId).filter((id):id is string=>!!id).join(',');
  useEffect(()=>{setError('');setApprovalReadError('');setCancelling('');setChildren({});setExpanded(false);setApprovalPending('');setApprovalRefreshing('');approvalDecisionsRef.current={};setApprovalDecisions({});},[conversationId]);
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
      const results=await Promise.allSettled(childIds.split(',').map(async id=>{const child=await api<Conversation>(`/conversations/${encodeURIComponent(id)}`,{signal:controller.signal});if(child.id!==id)throw new Error('后台任务回执与当前请求不一致。');return child;}));
      if(controller.signal.aborted||epoch!==getSessionEpoch())return;
      setChildren(previous=>{const next={...previous};for(const result of results)if(result.status==='fulfilled')next[result.value.id]=reuseConversationMessages(previous[result.value.id],result.value);return next;});
      setApprovalReadError(results.some(result=>result.status==='rejected')?'暂时无法读取后台 Agent 的审批状态，请检查连接或刷新审批状态。':'');
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
  const approvalKey=(childId:string,id:string)=>`${childId}:${id}`;
  function recordApprovalDecision(key:string,value?:'pending'|'consumed'|'uncertain'){
    const next={...approvalDecisionsRef.current};if(value)next[key]=value;else delete next[key];approvalDecisionsRef.current=next;setApprovalDecisions(next);
  }
  const current=()=>alive.current&&epoch===getSessionEpoch()&&context.current===conversationId;
  async function readChild(id:string){
    const next=await api<Conversation>(`/conversations/${encodeURIComponent(id)}`);
    if(next.id!==id)throw new Error('后台任务回执与当前请求不一致。');
    if(current())setChildren(previous=>({...previous,[id]:reuseConversationMessages(previous[id],next)}));
    return next;
  }
  async function refreshApprovalState(childId?:string){
    if(approvalLock.current||approvalReadLock.current||!current())return;
    approvalReadLock.current=true;setApprovalRefreshing(childId||'all');setError('');
    try{
      const ids=childId?[childId]:childIds.split(',').filter(Boolean);
      const results=await Promise.allSettled(ids.map(readChild));
      if(!current())return;
      for(const result of results)if(result.status==='fulfilled'){
        const child=result.value,active=new Set(child.agent?.approvals.map(item=>item.id)||[]);
        for(const [key,value] of Object.entries(approvalDecisionsRef.current))if(value==='uncertain'&&key.startsWith(`${child.id}:`))recordApprovalDecision(key,active.has(key.slice(child.id.length+1))?undefined:'consumed');
      }
      setApprovalReadError(results.some(result=>result.status==='rejected')?'暂时无法读取后台 Agent 的审批状态；请勿重复提交确认。':'');
    }finally{approvalReadLock.current=false;if(current())setApprovalRefreshing('');}
  }
  async function approve(child:Conversation,approvalId:string,decision:string){
    const key=approvalKey(child.id,approvalId);
    if(approvalLock.current||approvalReadLock.current||approvalDecisionsRef.current[key]||!current())return;
    approvalLock.current=true;setApprovalPending(approvalId);recordApprovalDecision(key,'pending');setError('');
    try{
      await api(`/codex/approvals/${encodeURIComponent(approvalId)}`,{method:'POST',body:JSON.stringify({decision})});
      if(!current())return;
      recordApprovalDecision(key,'consumed');
      setChildren(previous=>{const before=previous[child.id];return before?.agent?{...previous,[child.id]:{...before,agent:{...before.agent,approvals:before.agent.approvals.filter(item=>item.id!==approvalId)}}}:previous;});
      try{await readChild(child.id);}
      catch(cause){if(current()&&!isSessionChanged(cause))setError('确认已提交，后台任务进度暂时无法刷新；请勿重复提交。');}
    }catch(cause){if(current()&&!isSessionChanged(cause)){recordApprovalDecision(key,'uncertain');setError('确认结果尚未收到，请先刷新审批状态，再决定是否操作；不会自动重复提交。');}}
    finally{approvalLock.current=false;if(current())setApprovalPending('');}
  }
  if(!last)return null;
  const visibleApprovals=(child?:Conversation)=>child?.agent?.approvals.filter(item=>approvalDecisions[approvalKey(child.id,item.id)]!=='consumed')||[];
  const pendingApprovals=tasks.filter(task=>['queued','running'].includes(task.status)).flatMap(task=>visibleApprovals(task.conversationId?children[task.conversationId]:undefined)).length;
  const reviewing=tasks.some(task=>['queued','running'].includes(task.status)&&task.conversationId&&children[task.conversationId]?.agent?.run?.approvalReview?.status==='inProgress');
  const taskIcon=(task:AssistantTask)=>['deciding','queued','running'].includes(task.status)?<Loader2 size={13} className="spin"/>:task.status==='completed'?<Check size={13}/>:<Terminal size={13}/>;
  const canCancel=(task:AssistantTask)=>['deciding','queued','running','unknown'].includes(task.status);
  return <div className="chat-assistant-tasks" aria-label="后台 Agent 任务">
    <div className="chat-assistant-task-latest" role="status"><span className={`assistant-task-state is-${last.status}`}>{pendingApprovals>0?<ShieldCheck size={13}/>:taskIcon(last)}{pendingApprovals>0?'等待确认':reviewing?'自动审查中':taskLabels[last.status]}</span><span className="assistant-task-label" title={`${last.hostName} · ${last.message}`}>{last.hostName} · 后台 Agent</span>{pendingApprovals>0&&<button type="button" onClick={()=>setExpanded(true)} className="assistant-task-approval-jump">确认 ({pendingApprovals})</button>}{canCancel(last)&&<button type="button" disabled={!!cancelling} onClick={()=>void cancel(last)} aria-label="取消后台 Agent 任务">{cancelling===last.id?<Loader2 size={12} className="spin"/>:<Square size={11}/>}取消</button>}</div>
    <details className="chat-assistant-task-details" open={expanded} onToggle={event=>setExpanded(event.currentTarget.open)}><summary>任务详情<ChevronDown size={12}/></summary><div>{tasks.slice(-8).reverse().map(task=>{
      const child=task.conversationId?children[task.conversationId]:undefined;
      return <section className="chat-assistant-task-entry" key={task.id}><p><strong>{visibleApprovals(child).length?'等待确认':child?.agent?.run?.approvalReview?.status==='inProgress'?'自动审查中':taskLabels[task.status]} · {task.hostName}</strong><span>{task.message||'后台 Agent 正在处理任务。'}</span>{task.projectDirectory&&<span>项目：{task.projectDirectory}</span>}{approvalReviewLabel(child?.agent?.run?.approvalReview)&&<span role="status">{approvalReviewLabel(child?.agent?.run?.approvalReview)}{child?.agent?.run?.approvalReview?.rationale&&<>：{child.agent.run.approvalReview.rationale}</>}</span>}</p>
        <div className="assistant-task-actions">{task.conversationId&&<a href={`/?chat=1&mode=codex&conversation=${encodeURIComponent(task.conversationId)}`}>查看 Agent<ArrowUpRight size={12}/></a>}{canCancel(task)&&task.id!==last.id&&<button type="button" disabled={!!cancelling} onClick={()=>void cancel(task)}>取消任务</button>}</div>
        {['queued','running'].includes(task.status)&&child&&visibleApprovals(child).map(approval=><div className="assistant-task-approval" key={approval.id}><strong><ShieldCheck size={13}/>Agent 等待确认</strong><p>{approval.description}</p>{approvalDecisions[approvalKey(child.id,approval.id)]==='uncertain'?<><p role="status">确认结果尚未收到，请先刷新审批状态；不会自动重复提交。</p><button type="button" disabled={!!approvalPending||!!approvalRefreshing} onClick={()=>void refreshApprovalState(child.id)}>{approvalRefreshing===child.id?'正在刷新…':'刷新审批状态'}</button></>:<div><button type="button" disabled={!!approvalPending||!!approvalRefreshing} onClick={()=>void approve(child,approval.id,'decline')}>拒绝</button><button type="button" disabled={!!approvalPending||!!approvalRefreshing} onClick={()=>void approve(child,approval.id,'accept')}>{approvalPending===approval.id?'正在提交…':'允许本次'}</button></div>}</div>)}
      </section>;
    })}</div></details>
    {error&&<p className="chat-assistant-note is-error" role="alert">{error}</p>}
    {approvalReadError&&<div className="assistant-task-actions" role="status"><span>{approvalReadError}</span><button type="button" disabled={!!approvalPending||!!approvalRefreshing} onClick={()=>void refreshApprovalState()}>{approvalRefreshing==='all'?'正在刷新…':'刷新审批状态'}</button></div>}
  </div>;
}
