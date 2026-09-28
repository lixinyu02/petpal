import { useState } from 'react';
import { Check, ListOrdered, Loader2, Pause, Pencil, Play, Trash2, X } from 'lucide-react';
import { api, isSessionChanged, type AgentState, type AgentQueueEntry } from './api';
import './agent-controls.css';

const scopes = { 'read-only':'只读', 'workspace-write':'工作区', 'full-access':'完全访问' };
const approvals = { ask:'需确认', auto:'自动运行', review:'自动审查' };
export default function AgentQueue({ conversationId, state, refresh }: { conversationId:string; state:AgentState; refresh():Promise<unknown> }) {
  const [editing,setEditing]=useState<AgentQueueEntry|null>(null),[draft,setDraft]=useState('');
  const [pending,setPending]=useState(''),[error,setError]=useState('');
  const run = state.run, running = run?.status === 'running' || run?.status === 'stopping';
  const uncertain = state.submissions?.filter(item=>item.status==='uncertain') || [];
  async function action(path:string,method:string,body:object,label:string){
    if(pending)return;setPending(label);setError('');
    try{await api(`/conversations/${encodeURIComponent(conversationId)}/agent/${path}`,{method,body:JSON.stringify(body)});setEditing(null);await refresh();}
    catch(error){if(!isSessionChanged(error))setError((error as Error).message);}finally{setPending('');}
  }
  if(!state.queue.length&&!state.paused&&!run?.error&&!uncertain.length)return null;
  return <section className="agent-queue" aria-label="待执行消息">
    <div className="agent-queue-heading"><span><ListOrdered size={15}/>队列 <b>{state.queue.length}/5</b></span><span>{state.paused ? <><Pause size={13}/>已暂停</> : running ? '当前任务完成后依次执行' : '等待执行'}</span>{state.paused&&state.queue.length>0&&<button disabled={!!pending||running} onClick={()=>void action('queue/resume','POST',{},'resume')}><Play size={13}/>继续队列</button>}</div>
    {run?.error&&<p className="agent-queue-error" role="status">{run.error}</p>}
    {uncertain.map(item=><p className="agent-queue-error" role="status" key={item.submissionId}>这条指令是否送达尚不确定，请先检查当前任务，不要直接重复发送。{item.content&&<span>「{item.content.slice(0,120)}」</span>}</p>)}
    <ol>{state.queue.map((entry,index)=><li key={entry.id}>
      <span className="agent-queue-index">{index+1}</span><div className="agent-queue-content">{editing?.id===entry.id?<textarea aria-label="修改排队消息" maxLength={20000} value={draft} onChange={e=>setDraft(e.target.value)}/>:<p>{entry.content || '图片消息'}</p>}
      <small>{entry.model || 'Codex'} · {scopes[entry.permissions.access]} · {approvals[entry.permissions.approval]}{entry.attachmentIds.length>0?` · ${entry.attachmentIds.length} 张图片`:''}</small></div>
      <div className="agent-queue-actions">{editing?.id===entry.id?<><button aria-label="保存排队消息" disabled={!!pending||(!draft.trim()&&!entry.attachmentIds.length)} onClick={()=>void action(`queue/${encodeURIComponent(entry.id)}`,'PATCH',{revision:editing.revision,content:draft,attachmentIds:entry.attachmentIds},entry.id)}><Check size={15}/></button><button aria-label="取消修改" onClick={()=>setEditing(null)}><X size={15}/></button></>:<button aria-label={`修改第 ${index+1} 条排队消息`} disabled={!!pending} onClick={()=>{setEditing(entry);setDraft(entry.content);}}><Pencil size={14}/></button>}
      <button aria-label={`删除第 ${index+1} 条排队消息`} disabled={!!pending} onClick={()=>void action(`queue/${encodeURIComponent(entry.id)}`,'DELETE',{revision:entry.revision},entry.id)}>{pending===entry.id?<Loader2 size={14} className="spin"/>:<Trash2 size={14}/>}</button></div>
    </li>)}</ol>{error&&<p className="agent-queue-error" role="alert">{error}</p>}
  </section>;
}
