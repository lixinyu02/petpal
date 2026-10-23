import {foregroundAssistantMessage,mergeAssistantTask} from './chat-assistant-preferences.mjs';
import {mergeConversationOrganization} from './conversation-organization-sync.mjs';

/** randomUUID is secure-context-only, but text Chat also supports plain LAN HTTP. */
export function createChatRequestId(random=globalThis.crypto){
  if(typeof random?.randomUUID==='function')return random.randomUUID();
  const bytes=random.getRandomValues(new Uint8Array(16));
  bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const hex=Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

function chatSnapshot(value,id){
  return !!value&&value.id===id&&value.mode==='chat'&&Array.isArray(value.messages)&&value.messages.every(message=>message&&typeof message.id==='string'&&message.id&&['user','assistant'].includes(message.role)&&typeof message.content==='string');
}

/** A terminal frame without its completed foreground message still needs recovery. */
export function readChatTerminalSnapshot(value,conversationId,messageId){
  if(!chatSnapshot(value,conversationId))return null;
  const reply=foregroundAssistantMessage(value,messageId);
  return reply&&['complete','cancelled','error'].includes(reply.status)?{conversation:value,reply}:null;
}

/** The generation check belongs inside the React state updater, too. */
export function mergeChatCompletionSnapshot(previous,incoming,{conversationId,isCurrent,preserveOrganization=false,deletedIds=new Set()}){
  if(!isCurrent()||deletedIds.has(conversationId)||!chatSnapshot(incoming,conversationId))return previous;
  const before=previous.conversations.find(item=>item.id===conversationId);
  if(!before||before.mode!=='chat')return previous;
  const snapshot=mergeConversationOrganization(before,incoming,preserveOrganization);
  // A background task report may have arrived after this stream snapshot was
  // captured. Keep its durable completion and avoid regressing task statuses.
  const ids=new Set(snapshot.messages.map(message=>message.id));
  const reports=before.messages.filter(message=>message.role==='assistant'&&message.status==='complete'&&(message.assistantTaskId||message.assistantTaskReport)&&!ids.has(message.id));
  const tasks=(snapshot.assistantTasks||[]).reduce(mergeAssistantTask,before.assistantTasks||[]);
  const merged={...snapshot,...(reports.length?{messages:[...snapshot.messages,...reports]}:{}),...(before.assistantTasks||snapshot.assistantTasks?{assistantTasks:tasks}:{})};
  return {...previous,conversations:previous.conversations.map(item=>item.id===conversationId?merged:item)};
}

/** Completion never depends on an auxiliary state request and can run only once. */
export function createChatCompletion({isCurrent,release,speak}){
  let finished=false;
  return {finish(reply,shouldSpeak=false){
    if(finished)return false;
    finished=true;
    if(!isCurrent())return false;
    release();
    if(shouldSpeak&&isCurrent()&&reply?.role==='assistant'&&reply.status==='complete')speak(reply);
    return true;
  }};
}

/** Recover only this conversation; deadlines also cover transports ignoring abort. */
export function startChatRecovery({read,onConversation,onError=()=>{},isCurrent,timeoutMs=8000,schedule=setTimeout,cancelTimer=clearTimeout}){
  if(!Number.isFinite(timeoutMs)||timeoutMs<=0)throw new TypeError('Chat recovery needs a positive deadline.');
  const controller=new AbortController();let cancelled=false,settled=false,timer;
  const owned=()=>!cancelled&&isCurrent();
  const applicable=()=>owned()&&!controller.signal.aborted;
  let rejectControl;
  const control=new Promise((_resolve,reject)=>{rejectControl=reject;});
  const cancel=()=>{
    if(cancelled)return;
    cancelled=true;
    const reason=new DOMException('对话恢复已取消。','AbortError');
    controller.abort(reason);rejectControl(reason);
  };
  const finished=(async()=>{
    try{
      if(!owned())return;
      timer=schedule(()=>{
        const reason=new Error('同步这段对话超时，请稍后重新打开。');
        controller.abort(reason);rejectControl(reason);
      },timeoutMs);
      const incoming=await Promise.race([Promise.resolve().then(()=>{
        if(!applicable())throw controller.signal.reason||new DOMException('对话恢复已取消。','AbortError');
        return read(controller.signal);
      }),control]);
      if(applicable())onConversation(incoming,applicable);
    }catch(error){if(owned())onError(error,owned);}
    finally{settled=true;if(timer!==undefined)cancelTimer(timer);}
  })();
  // No dangling control rejection when cancellation follows successful recovery.
  void control.catch(()=>{});
  return {finished,cancel(){if(!settled)cancel();else{cancelled=true;controller.abort();}}};
}
