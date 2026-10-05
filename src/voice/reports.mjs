import { markdownSpeechText } from './markdown-speech.mjs';

const cancelled=()=>Object.assign(new Error('语音播报会话已变化。'),{name:'AbortError'});
const reportMessage=message=>message?.role==='assistant'&&message.status==='complete'&&typeof message.id==='string'&&message.id&&typeof message.assistantTaskId==='string'&&message.assistantTaskId;

/** A spoken excerpt never changes the full message kept in the conversation. */
export function spokenReportText(content,maxChars=800){
  if(!Number.isInteger(maxChars)||maxChars<80||maxChars>1000)throw new Error('Invalid spoken report limit.');
  const text=markdownSpeechText(content).replace(/\s+/gu,' ').trim();
  if(text.length<=maxChars)return text;
  const suffix='。完整结果请在对话中查看。';let end=maxChars-suffix.length;
  if(/^[\uDC00-\uDFFF]$/u.test(text[end]||''))end--;
  return text.slice(0,end).trimEnd().replace(/[。！？!?；;，,：:]$/u,'')+suffix;
}

/** Seed history once per explicit voice session before posting its first turn. */
export function createVoiceReportTracker(options){
  let revision=0,active=false,conversationId='',seeded=false,baseline=null;
  const seen=new Set(),pending=new Map(),current=token=>active&&token===revision&&options.isCurrent();
  function reset(next){revision++;active=next;conversationId='';seeded=false;baseline=null;seen.clear();pending.clear();}
  async function seed(id,signal){
    signal.throwIfAborted();const token=revision;if(!current(token))throw cancelled();
    if(seeded&&conversationId===id)return null;
    if(baseline?.id===id&&!baseline.signal.aborted)return baseline.promise;
    const attempt={id,signal,promise:null};baseline=attempt;
    attempt.promise=(async()=>{
      try{
        const conversation=await options.load(id,signal);signal.throwIfAborted();
        if(!current(token)||baseline!==attempt)throw cancelled();
        if(conversation?.id!==id)throw new Error('语音聊天记录与播报基线不一致。');
        conversationId=id;seeded=true;seen.clear();
        for(const message of conversation.messages||[])if(reportMessage(message))seen.add(message.id);
        baseline=null;return conversation;
      }catch(error){if(baseline===attempt)baseline=null;throw error;}
    })();
    return attempt.promise;
  }
  function accept(conversation){
    if(!current(revision)||!seeded||conversation?.id!==conversationId)return;
    for(const message of conversation.messages||[]){
      if(!reportMessage(message)||seen.has(message.id)||pending.has(message.id))continue;
      const text=spokenReportText(message.content);
      if(!text)seen.add(message.id);
      // Server conversations have at most 500 ordinary messages plus bounded
      // task results. Keep only compact excerpts pending, with a hard ceiling.
      else if(pending.size<1024)pending.set(message.id,{id:message.id,text,plainText:true});
    }
    flush();
  }
  function flush(){
    if(!current(revision)||!seeded)return;
    for(const [id,report] of pending){
      if(!options.notify(report))break;
      seen.add(id);pending.delete(id);
    }
  }
  return{start:()=>reset(true),stop:()=>reset(false),seed,accept,flush};
}
