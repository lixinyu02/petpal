import {memo,useMemo} from 'react';
import MessageMarkdown from '../MessageMarkdown';
import {OPENUI_MESSAGE_LIMIT,splitOpenUI} from '../openui/protocol.mjs';

/** Captions have no composer. Show prose and a link to the durable conversation,
 * never interactive controls or the UI program, including unfinished streams. */
export default memo(function VoiceReplyCaption({content,conversationId}:{content:string;conversationId?:string}) {
  const caption=useMemo(()=>{
    const fence=/^(?:`{3,}|~{3,})openui\s*$/m.exec(content);
    if(!fence)return {text:content,interactive:false};
    const parsed=splitOpenUI(content,{streaming:true});
    if(parsed.error)return {text:content.slice(0,Math.min(fence.index,OPENUI_MESSAGE_LIMIT)),interactive:true};
    return {text:parsed.parts.filter(part=>part.type==='markdown').map(part=>part.text).join('\n\n'),interactive:parsed.parts.some(part=>part.type==='openui')};
  },[content]);
  const href=conversationId?`/?chat=1&conversation=${encodeURIComponent(conversationId)}`:'/?chat=1';
  return <>{caption.text.trim()&&<MessageMarkdown content={caption.text} compact/>}{caption.interactive&&<a className="voice-openui-link" href={href}>在对话中查看交互内容</a>}</>;
});
