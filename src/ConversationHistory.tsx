import {memo} from 'react';
import {MessageCircle,Terminal,Trash2} from 'lucide-react';
import type {Conversation} from './api';

type HistoryItem=Pick<Conversation,'id'|'title'|'mode'>;
type Props={conversations:HistoryItem[];selectedId:string|null;active:boolean;busy:boolean;onSelect(id:string):void;onDelete(id:string):void};

export const ConversationHistoryRow=memo(function ConversationHistoryRow({id,title,mode,selected,busy,onSelect,onDelete}:HistoryItem&{selected:boolean;busy:boolean;onSelect(id:string):void;onDelete(id:string):void}) {
  return <div className={`history-row${selected?' selected':''}`}>
    <button className="history-item" title={title} aria-current={selected?'page':undefined} onClick={()=>onSelect(id)}>{mode==='codex'?<Terminal size={15} aria-hidden="true"/>:<MessageCircle size={15} aria-hidden="true"/>}<span>{title||'新对话'}</span></button>
    <button disabled={busy} className="history-delete icon-button" aria-label={`删除对话 ${title}`} onClick={()=>onDelete(id)}><Trash2 size={13} aria-hidden="true"/></button>
  </div>;
});

/** Message content and Agent receipts do not change the navigation labels. */
export function sameConversationHistory(before:Props,after:Props) {
  return before.selectedId===after.selectedId&&before.active===after.active&&before.busy===after.busy&&before.onSelect===after.onSelect&&before.onDelete===after.onDelete
    &&(before.conversations===after.conversations||before.conversations.length===after.conversations.length&&before.conversations.every((item,index)=>{
      const next=after.conversations[index];return item.id===next.id&&item.title===next.title&&item.mode===next.mode;
    }));
}

export default memo(function ConversationHistory({conversations,selectedId,active,busy,onSelect,onDelete}:Props) {
  return <div className="history-list">{conversations.length===0?<p className="history-empty">我们的故事，从一句你好开始。</p>:conversations.map(item=><ConversationHistoryRow key={item.id} id={item.id} title={item.title} mode={item.mode} selected={active&&selectedId===item.id} busy={busy} onSelect={onSelect} onDelete={onDelete}/>)}</div>;
},sameConversationHistory);
