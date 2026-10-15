import { useEffect, useId, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Check, ChevronDown, ListOrdered, Loader2, Pause, Pencil, Play, Trash2, X } from 'lucide-react';
import { api, getSessionEpoch, isSessionChanged, type AgentHost, type AgentState, type AgentQueueEntry } from './api';
import './agent-controls.css';

const scopes = { 'read-only':'只读', 'workspace-write':'工作区', 'full-access':'完全访问' };
const approvals = { ask:'需确认', auto:'自动运行', review:'自动审查' };
const recoverable = (state:AgentState,id:string) => !['running','stopping'].includes(state.run?.status||'')&&(state.run?.status==='unknown'&&state.run.id===id||state.submissions?.some(item=>item.status==='uncertain'&&item.entryId===id));
const contextBlockReason = (state:AgentState) => ['running','stopping'].includes(state.run?.status||'')?'请先停止或等待当前任务结束。':state.run?.status==='unknown'||state.submissions?.some(item=>item.status==='uncertain')?'请先处理未知执行状态。':state.queue.length?'请先处理或移除待执行队列。':'';
export default function AgentQueue({ conversationId, state, configChanged = false, hosts = [], refresh, onNewConversation }: { conversationId:string; state:AgentState; configChanged?:boolean; hosts?:AgentHost[]; refresh():Promise<unknown>; onNewConversation?():void }) {
  const [editing,setEditing]=useState<AgentQueueEntry|null>(null),[draft,setDraft]=useState('');
  const [pending,setPending]=useState(''),[error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [recovery,setRecovery]=useState<{runId:string;revision:number;confirmed:boolean;scope:object}|null>(null);
  const [repair,setRepair]=useState<{revision:number;confirmed:boolean;scope:object}|null>(null);
  const repairRef=useRef(repair);repairRef.current=repair;
  const recoveryRef=useRef(recovery),stateRef=useRef(state);recoveryRef.current=recovery;stateRef.current=state;
  const [expanded, setExpanded] = useState(false), listId = useId();
  const epoch = getSessionEpoch(), alive = useRef(true), lock = useRef<object|null>(null);
  const scopeRef = useRef({conversationId,epoch});
  if(scopeRef.current.conversationId!==conversationId||scopeRef.current.epoch!==epoch){scopeRef.current={conversationId,epoch};lock.current=null;}
  const scope = scopeRef.current;
  const current = () => alive.current&&scopeRef.current===scope&&getSessionEpoch()===scope.epoch;
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{setEditing(null);setDraft('');setPending('');setError('');setNotice('');setExpanded(false);setRecovery(null);setRepair(null);},[scope]);
  useEffect(()=>{setRecovery(null);},[scope,state.revision,state.run?.id,state.run?.status]);
  useEffect(()=>{setRepair(null);},[scope,state.revision,state.run?.id,state.run?.status,state.contextRepairNeeded,configChanged,contextBlockReason(state)]);
  const run = state.run, running = run?.status === 'running' || run?.status === 'stopping';
  const unknown = run?.status === 'unknown';
  const nextHost = state.queue[0] && hosts.find(host=>host.id===(state.queue[0].hostId||'central'));
  const uncertain = state.submissions?.filter(item=>item.status==='uncertain') || [];
  const separateUncertain = uncertain.filter(item=>!unknown||item.entryId!==run?.id);
  const activeRecovery = recovery?.scope===scope&&recovery.revision===state.revision&&recoverable(state,recovery.runId)?recovery:null;
  const repairReason=contextBlockReason(state),needsContextRepair=configChanged||state.contextRepairNeeded===true||run?.errorCode==='thread_context_missing';
  const shownNotice=notice||state.contextNotice;
  const activeRepair=repair?.scope===scope&&repair.revision===state.revision&&!repairReason?repair:null;
  const showQueue=Boolean(state.queue.length||state.paused||run?.error||uncertain.length||unknown||running);
  async function action(path:string,method:string,body:object,label:string,options:{successMessage?:string;conflictMessage?:string}={}){
    if(lock.current||!current())return;
    const operation={};lock.current=operation;setPending(label);setError('');setNotice('');repairRef.current=null;setRepair(null);
    let submitted=false;
    try{
      await api(`/conversations/${encodeURIComponent(conversationId)}/agent/${path}`,{method,body:JSON.stringify(body)});submitted=true;
      if(!current())return;
      if(options.successMessage)setNotice(options.successMessage);
      setEditing(null);await refresh();
    }catch(cause){
      if(!current()||isSessionChanged(cause))return;
      if(!submitted&&(cause as {status?:number}).status===409){
        try{await refresh();if(current())setError(options.conflictMessage||'队列已变化，已刷新当前顺序，请检查后重试。');}
        catch(refreshError){if(current()&&!isSessionChanged(refreshError))setError('队列已变化，暂时无法刷新；请刷新后再操作。');}
      }else if(current())setError(submitted?'操作已提交，但队列暂时无法刷新，请刷新后检查。':(cause as Error).message);
    }finally{if(lock.current===operation)lock.current=null;if(current())setPending('');}
  }
  function move(index:number,direction:-1|1){
    const destination=index+direction;
    if(editing||index<0||index>=state.queue.length||destination<0||destination>=state.queue.length)return;
    const entryIds=state.queue.map(entry=>entry.id);
    [entryIds[index],entryIds[destination]]=[entryIds[destination],entryIds[index]];
    void action('queue/reorder','POST',{queueRevision:state.queueRevision??0,entryIds},'reorder');
  }
  function beginRecovery(runId:string){
    if(lock.current||!current()||stateRef.current.revision!==state.revision||!recoverable(stateRef.current,runId))return;
    setError('');setNotice('');setRepair(null);setRecovery({runId,revision:state.revision,confirmed:false,scope});
  }
  function submitRecovery(){
    if(!activeRecovery?.confirmed||recoveryRef.current!==activeRecovery||lock.current||!current()||stateRef.current.revision!==activeRecovery.revision||!recoverable(stateRef.current,activeRecovery.runId))return;
    recoveryRef.current=null;setRecovery(null);
    void action('recover','POST',{runId:activeRecovery.runId,revision:activeRecovery.revision,confirmedStopped:true},'recover',{
      successMessage:'已解除所选任务的状态保护。队列仍暂停，检查后可另点「继续队列」；不会重新派发原任务。',
      conflictMessage:'任务状态已变化，已刷新。请重新检查原电脑后，再决定是否解除状态保护。',
    });
  }
  function recoveryControls(runId:string){
    return activeRecovery?.runId===runId?<div className="agent-recovery-confirm" role="group" aria-label="确认原任务已停止">
      <label><input type="checkbox" checked={activeRecovery.confirmed} disabled={!!pending} onChange={event=>{if(!lock.current&&current()&&recoveryRef.current===activeRecovery&&stateRef.current.revision===activeRecovery.revision)setRecovery({...activeRecovery,confirmed:event.target.checked});}}/><span>我已在原电脑检查，确认这个任务进程已停止。</span></label>
      <div className="agent-recovery-actions"><button type="button" disabled={!!pending} onClick={()=>{if(!lock.current&&current()){recoveryRef.current=null;setRecovery(null);}}}>取消</button><button type="button" aria-label={`确认解除任务 ${runId} 的状态保护`} disabled={!!pending||!activeRecovery.confirmed||running} onClick={submitRecovery}>确认解除状态</button></div>
    </div>:<button type="button" className="agent-recovery-open" aria-label={`处理任务 ${runId} 的未知执行状态`} disabled={!!pending||running} onClick={()=>beginRecovery(runId)}>检查后解除状态保护…</button>;
  }
  function beginRepair(){
    if(lock.current||!current()||stateRef.current.revision!==state.revision||contextBlockReason(stateRef.current))return;
    setError('');setNotice('');setRecovery(null);setRepair({revision:state.revision,confirmed:false,scope});
  }
  function submitRepair(){
    if(!activeRepair?.confirmed||repairRef.current!==activeRepair||lock.current||!current()||stateRef.current.revision!==activeRepair.revision||contextBlockReason(stateRef.current))return;
    repairRef.current=null;setRepair(null);
    void action('context/reset','POST',{revision:activeRepair.revision,confirmed:true},'context-reset',{
      successMessage:'CLI 记忆已重置，网页历史已保留；请主动发送任务，并补充需要的上下文。当前输入和图片不会自动发送。',
      conflictMessage:'会话状态已变化，已刷新。请检查当前任务后重新确认修复。',
    });
  }
  return <section className="agent-queue" aria-label="待执行消息">
    <div className="agent-queue-heading"><button type="button" className="agent-queue-toggle" aria-label={showQueue?`待执行消息：${state.queue.length} 条，${expanded ? '收起' : '展开'}队列`:`Agent 任务选项，${expanded?'收起':'展开'}`} aria-expanded={expanded} aria-controls={listId} onClick={()=>{setExpanded(value=>!value);if(expanded&&!needsContextRepair){repairRef.current=null;setRepair(null);}}}><ListOrdered size={15}/>{showQueue?<>队列 <b>{state.queue.length}/5</b></>:'任务选项'}<ChevronDown size={13}/></button>{showQueue&&<span className={state.paused ? 'queue-paused' : ''}>{state.paused ? <><Pause size={13}/>已暂停</> : running ? '完成后依次执行' : '等待执行'}</span>}{state.paused&&state.queue.length>0&&<button type="button" disabled={!!pending||running||unknown||uncertain.length>0||!nextHost?.online} onClick={()=>void action('queue/resume','POST',{},'resume')}><Play size={13}/>继续队列</button>}</div>
    {unknown&&<div className="agent-execution-unknown"><p className="agent-queue-error" role="alert"><strong>{run?.hostName||'执行电脑'}的任务状态未知。</strong>原任务可能仍在执行。请在原电脑退出小伴客户端，并确认任务进程已停止。队列已暂停，不会自动重试或转到别的电脑。</p><div className="agent-recovery-links">{recoveryControls(run.id)}{onNewConversation&&<button type="button" onClick={onNewConversation}>开启新对话</button>}</div></div>}
    {run?.error&&<p className="agent-queue-error" role="status">{run.error}</p>}
    {separateUncertain.map(item=><div className="agent-execution-uncertain" key={item.submissionId}><p className="agent-queue-error" role="status">这条指令是否送达尚不确定，请先检查原电脑，不要直接重复发送。{item.content&&<span>「{item.content.slice(0,120)}」</span>}</p>{recoveryControls(item.entryId)}</div>)}
    <ol id={listId} hidden={!expanded} aria-busy={!!pending}>{state.queue.map((entry,index)=><li key={entry.id}>
      <span className="agent-queue-index">{index+1}</span><div className="agent-queue-content">{editing?.id===entry.id?<textarea aria-label="修改排队消息" maxLength={20000} value={draft} onChange={e=>setDraft(e.target.value)}/>:<p>{entry.content || '图片消息'}</p>}
      <small>{entry.hostName||hosts.find(host=>host.id===(entry.hostId||'central'))?.name||(entry.hostId&&entry.hostId!=='central'?'已登记电脑':'中央服务器')} · {entry.model || 'Codex'} · {scopes[entry.permissions.access]} · {approvals[entry.permissions.approval]}{entry.attachmentIds.length>0?` · ${entry.attachmentIds.length} 张图片`:''}<span className="agent-queue-project">项目：{entry.projectDirectory||'默认工作区'}</span></small></div>
      <div className="agent-queue-actions">{!editing&&<><button type="button" aria-label={`上移第 ${index+1} 条排队消息：${entry.content.trim().replace(/\s+/g,' ').slice(0,32)||entry.id}`} disabled={!!pending||index===0} onClick={()=>move(index,-1)}><ArrowUp size={14}/></button><button type="button" aria-label={`下移第 ${index+1} 条排队消息：${entry.content.trim().replace(/\s+/g,' ').slice(0,32)||entry.id}`} disabled={!!pending||index===state.queue.length-1} onClick={()=>move(index,1)}><ArrowDown size={14}/></button></>}{editing?.id===entry.id?<><button aria-label="保存排队消息" disabled={!!pending||(!draft.trim()&&!entry.attachmentIds.length)} onClick={()=>void action(`queue/${encodeURIComponent(entry.id)}`,'PATCH',{revision:editing.revision,content:draft,attachmentIds:entry.attachmentIds},entry.id)}><Check size={15}/></button><button aria-label="取消修改" disabled={!!pending} onClick={()=>setEditing(null)}><X size={15}/></button></>:<button aria-label={`修改第 ${index+1} 条排队消息`} disabled={!!pending} onClick={()=>{if(lock.current||!current())return;setEditing(entry);setDraft(entry.content);}}><Pencil size={14}/></button>}
      <button aria-label={`删除第 ${index+1} 条排队消息`} disabled={!!pending} onClick={()=>void action(`queue/${encodeURIComponent(entry.id)}`,'DELETE',{revision:entry.revision},entry.id)}>{pending===entry.id?<Loader2 size={14} className="spin"/>:<Trash2 size={14}/>}</button></div>
    </li>)}</ol>{(needsContextRepair||expanded)&&<div className="agent-context-repair">
      {needsContextRepair&&<p role="status">{configChanged?'模型连接配置已更新，可以修复当前会话后继续。':'Agent 的 CLI 上下文已丢失，可以保留聊天记录并重建。'}</p>}
      {activeRepair?<div className="agent-recovery-confirm" role="group" aria-label="确认重建 CLI 上下文"><p>网页聊天记录、当前输入和图片会保留；CLI 记忆和旧会话绑定会清除。之后请主动发送任务，并补充需要的上下文，不会自动发送当前输入。</p><label><input type="checkbox" checked={activeRepair.confirmed} disabled={!!pending} onChange={event=>{if(!lock.current&&current()&&repairRef.current===activeRepair&&stateRef.current.revision===activeRepair.revision&&!contextBlockReason(stateRef.current))setRepair({...activeRepair,confirmed:event.target.checked});}}/><span>我确认清除 CLI 记忆，并保留网页聊天记录。</span></label><div className="agent-recovery-actions"><button type="button" disabled={!!pending} onClick={()=>{if(!lock.current&&current()){repairRef.current=null;setRepair(null);}}}>取消修复</button><button type="button" aria-label="确认重建当前会话的 CLI 上下文" disabled={!!pending||!activeRepair.confirmed||!!repairReason} onClick={submitRepair}>确认重建上下文</button></div></div>:<button type="button" className="agent-recovery-open" aria-label="重建当前会话的 CLI 上下文" aria-describedby={repairReason?`${listId}-context-blocked`:undefined} disabled={!!pending||!!repairReason} onClick={beginRepair}>{needsContextRepair?'修复会话…':'重建 CLI 上下文…'}</button>}
      {repairReason&&<p className="agent-context-blocked" id={`${listId}-context-blocked`}>{repairReason}</p>}
    </div>}{shownNotice&&<p className="agent-recovery-notice" role="status">{shownNotice}</p>}{error&&<p className="agent-queue-error" role="alert">{error}</p>}
  </section>;
}
