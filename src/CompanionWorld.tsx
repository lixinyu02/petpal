import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, AudioLines, Check, Loader2, MessageCircle, Mic, Monitor, Settings2, Square, Terminal, X } from 'lucide-react';
import BrandMark from './BrandMark';
import CompanionScene from './avatar/CompanionScene';
import MessageMarkdown from './MessageMarkdown';
import { useCompanion, hydrateCompanion } from './avatar/preference';
import { getIdentity, getSessionEpoch, type CompanionKind, type NativeExecutorStatus, type State, type User } from './api';
import type { PetAction } from './pet/behavior';
import { useVoiceConversation } from './voice/useVoiceConversation';
import './voice-conversation.css';
import {ChatAssistantControls,ChatAssistantTasks,useChatAssistant} from './ChatAssistant';
import {useUiEntrance} from './platform/ui-motion.ts';
import {createVisiblePoll} from './platform/visible-poll.mjs';

const animeWords: Record<PetAction, string> = { idle: '今天也一起度过吧。', walk: '我就在这里，听你说。', pet: '嗯，感觉被温柔地照顾着。', eat: '谢谢你的点心。', sleep: '闭上眼睛，陪你安静一会儿。', jump: '嗨，我看到你啦。' };

export default function CompanionWorld() {
  const captionFrame=useRef<number|null>(null);
  const [name, setName] = useState('小伴');
  const [user, setUser] = useState<User>();
  const [session, setSession] = useState<State|null>(null);
  const [nativeExecutor,setNativeExecutor]=useState<NativeExecutorStatus|null>(null);
  const [providerId, setProviderId] = useState('');
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [kind] = useCompanion();
  const [startupError,setStartupError]=useState('');
  const [startupAttempt,setStartupAttempt]=useState(0);
  const [action, setAction] = useState<PetAction>('idle');
  const [readyKind, setReadyKind] = useState<CompanionKind|null>(null);
  const ready=readyKind===kind;
  const captions = useRef<HTMLDivElement>(null);
  const voiceIdentity=getIdentity();
  const voiceScope=session?.instanceId&&user?`${session.instanceId}:${user.id}`:voiceIdentity?`${voiceIdentity.instanceId}:${voiceIdentity.userId}`:'guest';
  const chatAssistant=useChatAssistant({scope:voiceScope,allowed:!!user?.canUseCodex,defaultHostId:session?.settings.chatAssistantHostId,onSettingsChanged:settings=>setSession(previous=>previous?{...previous,settings}:previous)});
  const localHostId=nativeExecutor?.state==='online'?nativeExecutor.hostId||'':'';
  useEffect(()=>{
    const executor=window.petpal?.executor,epoch=getSessionEpoch();
    setNativeExecutor(null);
    if(!executor||!user?.canUseCodex||!session?.instanceId)return;
    return createVisiblePoll({document,window,intervalMs:10000,isCurrent:()=>epoch===getSessionEpoch(),run:async signal=>{
      try{const status=await executor.status();if(!signal.aborted&&epoch===getSessionEpoch())setNativeExecutor(previous=>JSON.stringify(previous)===JSON.stringify(status)?previous:status);}catch{}
    }});
  },[voiceScope,user?.canUseCodex]);
  const voice = useVoiceConversation({allowed:!!user,scope:voiceScope,providerId,assistantSnapshot:chatAssistant.snapshot});
  const voiceLabels = {idle:'语音聊天',starting:'正在连接…',armed:'等待唤醒',listening:'正在聆听',recognizing:'正在识别…',thinking:'正在思考…',speaking:`${name}在回应`,error:'语音聊天已暂停'};
  const hasCaptions = Boolean(voice.transcript || voice.reply || voice.listening || voice.awaitingWake);
  useEffect(() => { if (action === 'sleep') voice.stop(); }, [action, voice.stop]);
  useEffect(() => { voice.stop();setAction('idle');setReadyKind(null); }, [kind]);
  const scrollCaptions=useCallback(()=>{
    if(document.hidden || captionFrame.current!==null)return;
    captionFrame.current=requestAnimationFrame(()=>{
      captionFrame.current=null;
      if(!document.hidden && captions.current)captions.current.scrollTop=captions.current.scrollHeight;
    });
  },[]);
  useEffect(()=>{if(voiceOpen)scrollCaptions();},[voiceOpen,voice.transcript,voice.reply,scrollCaptions]);
  useEffect(()=>{
    if(!voiceOpen)return;
    const clear=()=>{if(captionFrame.current!==null)cancelAnimationFrame(captionFrame.current);captionFrame.current=null;};
    const visibility=()=>{if(document.hidden)clear();else scrollCaptions();};
    document.addEventListener('visibilitychange',visibility);
    return()=>{clear();document.removeEventListener('visibilitychange',visibility);};
  },[voiceOpen,scrollCaptions]);
  useEffect(() => {
    let alive = true;
    const controller=new AbortController(),epoch=getSessionEpoch();setStartupError('');
    import('./api').then(async ({ initConnection, loadInitialState }) => {
      const connection = await initConnection();
      if(!alive||controller.signal.aborted||epoch!==getSessionEpoch())return;
      if (!connection.token) return;
      const state = await loadInitialState({signal:controller.signal});
      if (alive && !controller.signal.aborted && epoch===getSessionEpoch()) { setName(state.settings.petName); setUser(state.user); setSession(state); setProviderId(state.providers.some(provider => provider.id === state.settings.defaultProviderId) ? state.settings.defaultProviderId! : state.providers[0]?.id || ''); void hydrateCompanion(state.settings.companionKind || 'anime').catch(() => {}); }
    }).catch(error => {if(alive&&!controller.signal.aborted&&epoch===getSessionEpoch())setStartupError(error.message||'暂时无法加载个人设置。');});
    return () => { alive = false;controller.abort(); };
  }, [startupAttempt]);
  function beginVoice() { setVoiceOpen(true); if (action !== 'sleep') void voice.start(); }
  const introEntrance=useUiEntrance<HTMLDivElement>(`companion-intro:${kind}`,ready);
  const auraEntrance=useUiEntrance<HTMLDivElement>(`companion-aura:${kind}`,ready);
  const replyEntrance=useUiEntrance<HTMLDivElement>(`companion-reply:${kind}:${action}`,ready&&!voiceOpen);
  const voiceEntrance=useUiEntrance<HTMLElement>('companion-voice-panel',voiceOpen);
  return <main className={`companion-world companion-${kind}${voiceOpen ? ' companion-voice-open' : ''}`} data-ready={ready} data-companion-kind={kind} data-voice-phase={voice.phase}>
    <header className="companion-header">
      <a className="companion-brand" href="/" aria-label="小伴首页"><BrandMark size={32}/><span>小伴<small>PetPal</small></span></a>
      <nav aria-label="工作台入口">{user?.canUseCodex && <a className="companion-codex" aria-label="Agent 工作台" href="/?chat=1&mode=codex"><Terminal size={18} aria-hidden="true"/><span>Agent</span></a>}<a className="companion-settings" href="/?chat=1&settings=1" aria-label="连接与设置"><Settings2 size={18} aria-hidden="true"/></a><a className="companion-chat" href="/?chat=1"><MessageCircle size={18} aria-hidden="true"/>聊聊天<ArrowUpRight size={15} aria-hidden="true"/></a></nav>
    </header>
    <section className="companion-space" aria-label="伙伴陪伴空间" data-action={action}>
      <div ref={introEntrance} className="companion-intro"><span className="companion-presence"><i/>{action === 'sleep' ? '安心睡着，也在陪你' : '在你身边'}</span><h1>{name}</h1></div>
      <div className="companion-stage"><div ref={auraEntrance} className="companion-aura" aria-hidden="true"/><div className="companion-floor" aria-hidden="true"/><CompanionScene key={kind} kind={kind} performanceInput={voiceOpen ? voice.performanceInput : undefined} onReady={() => setReadyKind(kind)} onState={state => setAction(state.action)}/></div>
      {voiceOpen ? <section ref={voiceEntrance} className="companion-voice-panel" aria-label="伙伴语音聊天" aria-describedby="companion-voice-help">
        <div className="voice-conversation-heading"><span role="status">{voice.phase === 'starting' || voice.phase === 'recognizing' || voice.phase === 'thinking' ? <Loader2 size={15} className="spin" aria-hidden="true"/> : voice.speaking ? <AudioLines size={16} aria-hidden="true"/> : <Mic size={15} aria-hidden="true"/>} {voice.awaitingWake&&voice.phase==='recognizing'?'正在识别唤醒词…':voiceLabels[voice.phase]}</span><span className="ui-voice-bars" aria-hidden="true"><i/><i/><i/><i/><i/></span><button aria-label="关闭语音聊天" onClick={() => {voice.stop();setVoiceOpen(false);}}><X size={16} aria-hidden="true"/></button></div>
        <div className="voice-conversation-toolbar">
          <label className="voice-conversation-model"><span>模型</span><select aria-label="语音聊天模型" value={providerId} disabled={voice.active} onChange={event => setProviderId(event.target.value)}>{session?.providers.map(provider => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></label>
          {user?.canUseCodex&&<ChatAssistantControls assistant={chatAssistant} allowed={!!user?.canUseCodex} user={user} providers={session?.providers.filter(provider=>session.codex.eligibleProviderIds?.includes(provider.id))||[]} disabled={voice.recognizing||voice.thinking||voice.speaking} localHostId={localHostId} onDownload={()=>location.assign('/?chat=1&downloads=1')} compact/>}
        </div>
        <p id="companion-voice-help" className="voice-conversation-help">{voice.awaitingWake?`麦克风已开启，说“${voice.wake.phrases[0]}”唤醒；也可接着说问题。`:voice.wake?.enabled?`直接说话即可连续对话，回应时开口可打断；安静 ${voice.wake.idleTimeoutSeconds} 秒后回待机。`:'直接说话，停顿后发送；回应时再开口即可打断。后台任务会在空闲时汇报。'}</p>
        <div ref={captions} className="voice-conversation-captions" aria-label="语音对话字幕" hidden={!hasCaptions}>
          {voice.transcript && <p className="voice-caption-user"><span>你</span>{voice.transcript}</p>}
          {voice.reply && <div className="voice-caption-reply"><span className="voice-caption-author">{name}</span><MessageMarkdown content={voice.reply} compact/></div>}
          {!voice.transcript && !voice.reply && voice.listening && <p className="voice-caption-empty">直接说话，停顿后发送。</p>}
          {voice.awaitingWake && <p className="voice-caption-empty voice-wake-prompt">{voice.hasUtterance?'正在听唤醒词…':'等待唤醒'}{voice.wake.phrases.length>1&&<span> · {voice.wake.phrases.join(' / ')}</span>}</p>}
        </div>
        <ChatAssistantTasks conversationId={voice.conversationId} tasks={voice.assistantTasks} onUpdate={voice.updateAssistantTasks}/>
        {(voice.listening||voice.thinking||voice.speaking||voice.awaitingWake) && <meter className="voice-input-level" aria-label="语音聊天麦克风电平" min={0} max={1} value={voice.level}/>}
        {voice.error && <p className="voice-conversation-error" role="alert">{voice.error} <a href="/?chat=1&settings=1">检查语音设置</a></p>}
        <div className="voice-conversation-actions">{voice.active ? <>
          {voice.listening ? <button className="voice-primary" disabled={!voice.hasUtterance} onClick={() => void voice.finishUtterance()}><Check size={16} aria-hidden="true"/>说完了</button> : <button className="voice-primary" disabled={voice.phase === 'starting'} onClick={() => void voice.interrupt()}><Mic size={16} aria-hidden="true"/>{voice.awaitingWake?'直接开始聊天':'打断，我来说'}</button>}
          <button onClick={voice.stop}><Square size={13} aria-hidden="true"/>{voice.awaitingWake?'停止收音':'结束对话'}</button>
        </> : <button className="voice-primary" disabled={!user || !providerId || action === 'sleep'} onClick={beginVoice}><Mic size={16} aria-hidden="true"/>{voice.phase === 'error' ? '重新开始' : '开始语音聊天'}</button>}</div>
      </section> : <div ref={replyEntrance} className="companion-reply" role="status" aria-live="polite"><span>{animeWords[action]}</span></div>}
      {(!voiceOpen || startupError || action === 'sleep') && <p className="companion-hint" role={startupError?'alert':undefined}>{startupError || (action === 'sleep' ? '轻触唤醒。' : '轻触回应，长按休息。')}</p>}
      <details className="interaction-help"><summary>相处的小方式</summary><p>双击打个招呼；鼠标按住轻轻划过，像一次抚摸。<br/>也可以按 Tab 选中伙伴，用 Enter 或空格回应，长按休息，连按两次打招呼。</p></details>
    </section>
    {(!voiceOpen || window.petpal) && <footer className="companion-footer">{startupError&&<button onClick={()=>setStartupAttempt(value=>value+1)}>重试连接</button>}{!voiceOpen && <button className="companion-voice-entry" disabled={!user || !providerId} onClick={beginVoice}><Mic size={16} aria-hidden="true"/>语音聊天</button>}{window.petpal ? <button onClick={() => window.petpal?.showPet()}><Monitor size={16} aria-hidden="true"/>放到桌面<ArrowUpRight size={13} aria-hidden="true"/></button> : <a href="/?chat=1"><MessageCircle size={15} aria-hidden="true"/>说说今天<ArrowUpRight size={13} aria-hidden="true"/></a>}</footer>}
  </main>;
}
