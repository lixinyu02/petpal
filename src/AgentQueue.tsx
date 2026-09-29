import { useId, useState } from 'react';
import { Check, ChevronDown, ListOrdered, Loader2, Pause, Pencil, Play, Trash2, X } from 'lucide-react';
import { api, isSessionChanged, type AgentHost, type AgentState, type AgentQueueEntry } from './api';
import './agent-controls.css';

const scopes = { 'read-only':'只读', 'workspace-write':'工作区', 'full-access':'完全访问' };
const approvals = { ask:'需确认', auto:'自动运行', review:'自动审查' };
export default function AgentQueue({ conversationId, state, hosts = [], refresh, onNewConversation }: { conversationId:string; state:AgentState; hosts?:AgentHost[]; refresh():Promise<unknown>; onNewConversation?():void }) {
  const [editing,setEditing]=useState<AgentQueueEntry|null>(null),[draft,setDraft]=useState('');
  const [pending,setPending]=useState(''),[error,setError]=useState('');
  const [expanded, setExpanded] = useState(false), listId = useId();
  const run = state.run, running = run?.status === 'running' || run?.status === 'stopping';
  const unknown = run?.status === 'unknown';
  const nextHost = state.queue[0] && hosts.find(host=>host.id===(state.queue[0].hostId||'central'));
  const uncertain = state.submissions?.filter(item=>item.status==='uncertain') || [];
  async function action(path:string,method:string,body:object,label:string){
    if(pending)return;setPending(label);setError('');
    try{await api(`/conversations/${encodeURIComponent(conversationId)}/agent/${path}`,{method,body:JSON.stringify(body)});setEditing(null);await refresh();}
    catch(error){if(!isSessionChanged(error))setError((error as Error).message);}finally{setPending('');}
  }
  if(!state.queue.length&&!state.paused&&!run?.error&&!uncertain.length&&!unknown)return null;
  return <section className="agent-queue" aria-label="待执行消息">
    <div className="agent-queue-heading"><button type="button" className="agent-queue-toggle" aria-label={`待执行消息：${state.queue.length} 条，${expanded ? '收起' : '展开'}队列`} aria-expanded={expanded} aria-controls={listId} onClick={()=>setExpanded(value=>!value)}><ListOrdered size={15}/>队列 <b>{state.queue.length}/5</b><ChevronDown size={13}/></button><span className={state.paused ? 'queue-paused' : ''}>{state.paused ? <><Pause size={13}/>已暂停</> : running ? '完成后依次执行' : '等待执行'}</span>{state.paused&&state.queue.length>0&&<button type="button" disabled={!!pending||running||unknown||!nextHost?.online} onClick={()=>void action('queue/resume','POST',{},'resume')}><Play size={13}/>继续队列</button>}</div>
    {unknown&&<div className="agent-queue-error agent-execution-unknown" role="alert"><p><strong>{run?.hostName||'执行电脑'}的任务状态未知。</strong>原任务可能仍在执行。请在原电脑退出小伴客户端，并确认任务进程已停止。队列已暂停，不会自动重试或转到别的电脑。</p><p>你可以开启新对话处理其他任务，原对话和记录会保留。</p>{onNewConversation&&<button type="button" onClick={onNewConversation}>开启新对话</button>}</div>}
    {run?.error&&<p className="agent-queue-error" role="status">{run.error}</p>}
    {uncertain.map(item=><p className="agent-queue-error" role="status" key={item.submissionId}>这条指令是否送达尚不确定，请先检查当前任务，不要直接重复发送。{item.content&&<span>「{item.content.slice(0,120)}」</span>}</p>)}
    <ol id={listId} hidden={!expanded}>{state.queue.map((entry,index)=><li key={entry.id}>
      <span className="agent-queue-index">{index+1}</span><div className="agent-queue-content">{editing?.id===entry.id?<textarea aria-label="修改排队消息" maxLength={20000} value={draft} onChange={e=>setDraft(e.target.value)}/>:<p>{entry.content || '图片消息'}</p>}
      <small>{entry.hostName||hosts.find(host=>host.id===(entry.hostId||'central'))?.name||(entry.hostId&&entry.hostId!=='central'?'已登记电脑':'中央服务器')} · {entry.model || 'Codex'} · {scopes[entry.permissions.access]} · {approvals[entry.permissions.approval]}{entry.attachmentIds.length>0?` · ${entry.attachmentIds.length} 张图片`:''}</small></div>
      <div className="agent-queue-actions">{editing?.id===entry.id?<><button aria-label="保存排队消息" disabled={!!pending||(!draft.trim()&&!entry.attachmentIds.length)} onClick={()=>void action(`queue/${encodeURIComponent(entry.id)}`,'PATCH',{revision:editing.revision,content:draft,attachmentIds:entry.attachmentIds},entry.id)}><Check size={15}/></button><button aria-label="取消修改" onClick={()=>setEditing(null)}><X size={15}/></button></>:<button aria-label={`修改第 ${index+1} 条排队消息`} disabled={!!pending} onClick={()=>{setEditing(entry);setDraft(entry.content);}}><Pencil size={14}/></button>}
      <button aria-label={`删除第 ${index+1} 条排队消息`} disabled={!!pending} onClick={()=>void action(`queue/${encodeURIComponent(entry.id)}`,'DELETE',{revision:entry.revision},entry.id)}>{pending===entry.id?<Loader2 size={14} className="spin"/>:<Trash2 size={14}/>}</button></div>
    </li>)}</ol>{error&&<p className="agent-queue-error" role="alert">{error}</p>}
  </section>;
}
