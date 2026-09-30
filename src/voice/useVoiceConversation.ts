import { useCallback, useEffect, useRef, useState } from 'react';
import { api, getConnection, getIdentity, getSessionEpoch, streamMessage, type AssistantTask, type ChatAssistantConfig, type Conversation } from '../api';
import { useSpeech } from '../avatar/useSpeech';
import type { PerformanceInput } from '../avatar/performance.mjs';
import { createDevicePreferences } from '../media/device-preferences.mjs';
import { createVoiceCapture } from './capture';
import { openAsrSession } from './api';
import { createVoiceConversation, type VoiceConversationState } from './conversation.mjs';
import {mergeAssistantTask} from '../chat-assistant-preferences.mjs';

export function useVoiceConversation(options:{allowed:boolean;scope:string;providerId:string;enabled?:boolean;assistantSnapshot?:()=>ChatAssistantConfig|undefined}) {
  const speech=useSpeech(options.allowed&&options.enabled!==false,options.scope);
  const refs=useRef({options,speech});refs.current={options,speech};
  const controller=useRef<ReturnType<typeof createVoiceConversation>|null>(null);
  const [state,setState]=useState<VoiceConversationState>({phase:'idle',active:false,transcript:'',reply:'',level:0,error:'',conversationId:'',hasUtterance:false});
  const [assistantTasks,setAssistantTasks]=useState<AssistantTask[]>([]);
  const taskConversationId=useRef('');
  useEffect(()=>{
    const epoch=getSessionEpoch();let mounted=true;
    const current=()=>mounted&&epoch===getSessionEpoch();
    const machine=createVoiceConversation({
      id:()=>crypto.randomUUID(),onState:next=>{if(current()){if(next.conversationId&&taskConversationId.current!==next.conversationId){taskConversationId.current=next.conversationId;setAssistantTasks([]);}setState(next);}},isCurrent:current,
      isAllowed:()=>refs.current.options.allowed&&refs.current.options.enabled!==false&&Boolean(getConnection().token&&getIdentity()&&refs.current.options.providerId),
      getProviderId:()=>refs.current.options.providerId,
      getDeviceId:()=>{let storage:Storage|undefined;try{storage=localStorage;}catch{}const preferences=createDevicePreferences(storage,options.scope);try{return preferences.read().microphoneId;}finally{preferences.dispose();}},
      createCapture:createVoiceCapture,
      unlock:()=>{const active=refs.current.speech;if(active.engine!=='cosyvoice'||!active.streamingEnabled||!active.supported)throw new Error('请先在“语音与设备”中选择 CosyVoice，并将语速设为 1.0 倍，再开始语音聊天。');return active.unlock();},
      verify:async signal=>{const config=await api<{configured:boolean}>('/voice/asr',{signal});if(!config.configured)throw new Error('尚未连接语音识别服务，请联系管理员在“语音与设备”中配置。');},
      stopSpeech:()=>refs.current.speech.stop(),openAsr:openAsrSession,
      createChat:async(providerId,signal)=>{const conversation=await api<Conversation>('/conversations',{method:'POST',body:JSON.stringify({mode:'chat',providerId}),signal});if(!conversation.id)throw new Error('未能创建语音聊天记录。');return conversation.id;},
      getChatRequest:()=>{
        // Capture before creating a conversation, so a slow connection cannot change the target.
        const assistant=refs.current.options.assistantSnapshot?.();
        return assistant?{assistant:{...assistant,permissions:{...assistant.permissions}},submissionId:crypto.randomUUID()}:undefined;
      },
      streamChat:(id,text,signal,onEvent,request)=>{
        return streamMessage(id,text,signal,event=>{
          if(!current()||signal.aborted)return;
          if(event.type==='task')setAssistantTasks(previous=>mergeAssistantTask(previous,event.data.task));
          if(event.type==='done'&&event.data.conversation)setAssistantTasks(previous=>(event.data.conversation.assistantTasks||[]).reduce(mergeAssistantTask,previous));
          onEvent(event);
        },[],request);
      },play:(text,id,signal)=>refs.current.speech.speakAsync(text,id,signal),
    });
    controller.current=machine;setState(machine.snapshot());setAssistantTasks([]);taskConversationId.current='';
    const stop=()=>machine.stop(),hidden=()=>{if(document.hidden)stop();};
    document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',stop);window.addEventListener('petpal:session-change',stop);
    window.addEventListener('petpal:voice-settings-change',stop);window.addEventListener('petpal:audio-output-change',stop);
    navigator.mediaDevices?.addEventListener('devicechange',stop);
    return()=>{mounted=false;machine.dispose();if(controller.current===machine)controller.current=null;document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',stop);window.removeEventListener('petpal:session-change',stop);window.removeEventListener('petpal:voice-settings-change',stop);window.removeEventListener('petpal:audio-output-change',stop);navigator.mediaDevices?.removeEventListener('devicechange',stop);};
  },[options.scope]);
  const start=useCallback(()=>controller.current?.start()??Promise.resolve(),[]);
  const stop=useCallback(()=>controller.current?.stop(),[]);
  const interrupt=useCallback(()=>controller.current?.interrupt()??Promise.resolve(),[]);
  const finishUtterance=useCallback(()=>controller.current?.finishUtterance()??Promise.resolve(false),[]);
  const updateAssistantTasks=useCallback((conversation:Conversation)=>{
    if(conversation.id!==taskConversationId.current)return;
    setAssistantTasks(previous=>(conversation.assistantTasks||[]).reduce(mergeAssistantTask,previous));
  },[]);
  useEffect(()=>{if(!options.allowed||options.enabled===false)stop();},[options.allowed,options.enabled,stop]);
  useEffect(()=>{stop();setAssistantTasks([]);taskConversationId.current='';},[options.providerId,stop]);
  const performanceInput:PerformanceInput=state.phase==='speaking'?{
    utteranceId:speech.utteranceId,text:speech.text,phase:'speaking',speech:{active:speech.active,charIndex:speech.charIndex,ended:speech.ended,audioLevel:speech.audioLevel},
  }:{utteranceId:'voice-conversation',text:state.transcript,phase:state.phase==='thinking'?'thinking':state.phase==='listening'||state.phase==='recognizing'?'listening':state.phase==='error'?'error':'idle'};
  return {...state,start,stop,interrupt,finishUtterance,performanceInput,speechState:speech,assistantTasks,updateAssistantTasks,listening:state.phase==='listening',recognizing:state.phase==='recognizing',thinking:state.phase==='thinking',speaking:state.phase==='speaking'};
}
