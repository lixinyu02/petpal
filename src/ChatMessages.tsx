import {memo,useLayoutEffect,useRef} from 'react';
import {Copy,CornerDownRight,Loader2,PawPrint,Square,Volume2} from 'lucide-react';
import {MessageImages} from './Attachments';
import MessageMarkdown from './MessageMarkdown';
import type {Message} from './api';
import {advanceMessageMotion,attachMessageMotion,canAnimateMessageMotion,createMessageMotionTracker} from './chat-message-motion.mjs';
import type {MessageMotionLifecycle,MessageMotionTracker} from './chat-message-motion.mjs';

type RowProps={message:Message;petName:string;mode:'chat'|'codex';working:boolean;busy:boolean;sleeping:boolean;supported:boolean;feedback:string;reading:boolean;pending:boolean;error:string;onRead(message:Message):void;onStop():void;onNotice(notice:string):void};
export const ChatMessageRow=memo(function ChatMessageRow({message,petName,mode,working,busy,sleeping,supported,feedback,reading,pending,error,onRead,onStop,onNotice}:RowProps) {
  const canRead=message.role==='assistant'&&message.status==='complete'&&!!message.content.trim();
  return <div data-message-id={message.id} className={`message message-${message.role}`}>
    <span className={`message-avatar ${message.role==='assistant'?'pet-avatar':''}`}>{message.role==='assistant'?<PawPrint size={16}/>:'我'}</span>
    <div className="message-content">
      <div className="message-author">{message.role==='assistant'?petName:'我'}{message.role==='assistant'&&<span>{mode==='codex'?'Codex':message.model||''}</span>}</div>
      <MessageImages items={message.attachments}/>{message.steered&&<small className="steered-label"><CornerDownRight size={12}/>已追加到当前任务</small>}<div className="message-text">{(message.content?message.role==='assistant'?<MessageMarkdown content={message.content}/>:message.content:null)||(working&&message.role==='assistant'?<span className="typing-dots"><i/><i/><i/></span>:<span className="muted">{message.attachments?.length?'图片消息':message.status==='cancelled'?'已停止回复':'未收到回复'}</span>)}</div>
      {message.status==='error'&&<small className="message-error">回复未完成</small>}
      {message.status==='cancelled'&&message.content&&<small className="muted">已停止</small>}
      {message.role==='assistant'&&message.content&&<div className="message-actions">
        <button type="button" className="copy-message" aria-label="复制回复" title="复制回复" disabled={busy} onClick={()=>navigator.clipboard.writeText(message.content).then(()=>onNotice('已复制回复')).catch(()=>onNotice('当前环境无法访问剪贴板'))}><Copy size={13}/></button>
        {canRead&&<button type="button" className={`message-read ${reading?'message-read-active':''}`} aria-label={reading?'停止朗读这条回复':'朗读这条回复'} aria-pressed={reading} disabled={!reading&&(working||!supported||sleeping)} title={sleeping?'唤醒小伴后可继续朗读':!supported?feedback:reading?'停止这条回复的语音':'朗读这条回复'} onClick={()=>reading?onStop():onRead(message)}>
          {reading?pending?<Loader2 size={14} className="spin"/>:<Square size={12}/>:<Volume2 size={14}/>}<span>{reading?pending?'准备语音中 · 停止':'播放中 · 停止':'朗读'}</span>
        </button>}
      </div>}
      {error&&<p className="message-speech-error" role="status">{error}</p>}
    </div>
  </div>;
});

type Props={conversationId?:string;messages:Message[];petName:string;mode:'chat'|'codex';working:boolean;busy:boolean;sleeping:boolean;speechId:string;speechPlaying:boolean;speechPending:boolean;speechSupported:boolean;speechFeedback:string;speechError:string;onRead(message:Message):void;onStop():void;onNotice(notice:string):void};
/** Audio level and character boundaries belong to the portrait, not the message list. */
export default memo(function ChatMessages({conversationId='new',messages,petName,mode,working,busy,sleeping,speechId,speechPlaying,speechPending,speechSupported,speechFeedback,speechError,onRead,onStop,onNotice}:Props) {
  const list=useRef<HTMLDivElement>(null),tracker=useRef<MessageMotionTracker|null>(null),motion=useRef<MessageMotionLifecycle|null>(null),scope=useRef<string|null>(null);
  useLayoutEffect(()=>{
    const element=list.current;if(!element)return;
    const lifecycle=attachMessageMotion(element,element.ownerDocument);motion.current=lifecycle;
    return()=>{lifecycle.dispose();motion.current=null;};
  },[]);
  useLayoutEffect(()=>{
    const element=list.current;if(!element)return;
    if(!tracker.current)tracker.current=createMessageMotionTracker();
    if(scope.current!==conversationId){motion.current?.clear();scope.current=conversationId;}
    const arrivals=advanceMessageMotion(tracker.current,conversationId,messages.map(message=>message.id),canAnimateMessageMotion(element.ownerDocument));
    motion.current?.enter(arrivals);
  },[messages,conversationId]);
  return <div ref={list} className="messages">{messages.map(message=>{
    const owns=speechId.startsWith(message.id+'-manual-')||speechId.startsWith(message.id+'-auto-');
    return <ChatMessageRow key={message.id} message={message} petName={petName} mode={mode} working={working} busy={busy} sleeping={sleeping} supported={speechSupported} feedback={speechFeedback} reading={owns&&speechPlaying} pending={owns&&speechPending} error={owns?speechError:''} onRead={onRead} onStop={onStop} onNotice={onNotice}/>;
  })}</div>;
});
