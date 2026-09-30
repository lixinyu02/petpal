import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, AudioLines, Check, Loader2, MessageCircle, Mic, Monitor, Settings2, Square, Terminal, X } from 'lucide-react';
import BrandMark from './BrandMark';
import CompanionScene from './avatar/CompanionScene';
import MessageMarkdown from './MessageMarkdown';
import { useCompanion, useCompanionCatEnabled, chooseCompanion, hydrateCompanion } from './avatar/preference';
import { getSessionEpoch, type CompanionKind, type NativeExecutorStatus, type State, type User } from './api';
import type { PetAction } from './pet/behavior';
import { useVoiceConversation } from './voice/useVoiceConversation';
import './voice-conversation.css';
import {ChatAssistantControls,ChatAssistantTasks,useChatAssistant} from './ChatAssistant';

const words: Record<PetAction, string> = { idle: '我就在你旁边。', walk: '走两步，再回来陪你。', pet: '呼噜…这样就很舒服。', eat: '啊呜，谢谢你的零食。', sleep: '呼…陪你安静一会儿。', jump: '看到你，就有一点开心。' };
const animeWords: Record<PetAction, string> = { idle: '今天也一起度过吧。', walk: '我就在这里，听你说。', pet: '嗯，感觉被温柔地照顾着。', eat: '谢谢你的点心。', sleep: '闭上眼睛，陪你安静一会儿。', jump: '嗨，我看到你啦。' };

export default function CompanionWorld() {
  const [name, setName] = useState('小伴');
  const [user, setUser] = useState<User>();
  const [session, setSession] = useState<State|null>(null);
  const [nativeExecutor,setNativeExecutor]=useState<NativeExecutorStatus|null>(null);
  const [providerId, setProviderId] = useState('');
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [kind] = useCompanion();
  const [catEnabled] = useCompanionCatEnabled();
  const [syncNote, setSyncNote] = useState('');
  const selectionRevision = useRef(0);
  const [action, setAction] = useState<PetAction>('idle');
  const [ready, setReady] = useState(false);
  const captions = useRef<HTMLDivElement>(null);
  const voiceScope=session?.instanceId&&user?`${session.instanceId}:${user.id}`:'guest';
  const chatAssistant=useChatAssistant({scope:voiceScope,allowed:!!user?.canUseCodex});
  const localHostId=nativeExecutor?.state==='online'?nativeExecutor.hostId||'':'';
  useEffect(()=>{
    const executor=window.petpal?.executor,epoch=getSessionEpoch();let alive=true,timer:ReturnType<typeof setTimeout>|undefined;
    setNativeExecutor(null);
    if(!executor||!user?.canUseCodex||!session?.instanceId)return;
    const poll=async()=>{
      try{const status=await executor.status();if(alive&&epoch===getSessionEpoch())setNativeExecutor(status);}catch{}
      finally{if(alive&&epoch===getSessionEpoch())timer=setTimeout(()=>void poll(),10000);}
    };
    void poll();return()=>{alive=false;if(timer)clearTimeout(timer);};
  },[voiceScope,user?.canUseCodex]);
  const voice = useVoiceConversation({allowed:!!user,scope:voiceScope,providerId,assistantSnapshot:chatAssistant.snapshot});
  const voiceLabels = {idle:'语音聊天',starting:'正在连接…',listening:'正在聆听',recognizing:'正在识别…',thinking:'正在思考…',speaking:`${name}在回应`,error:'语音聊天已暂停'};
  const hasCaptions = Boolean(voice.transcript || voice.reply || voice.listening);
  useEffect(() => { if (action === 'sleep') voice.stop(); }, [action, voice.stop]);
  useEffect(() => { voice.stop();setAction('idle');setReady(false); }, [kind]);
  useEffect(() => { if (captions.current) captions.current.scrollTop = captions.current.scrollHeight; }, [voice.transcript, voice.reply]);
  async function choose(next: CompanionKind) {
    if (kind === next) return;
    voice.stop();
    const revision = ++selectionRevision.current;
    setAction('idle'); setReady(false); setSyncNote('');
    try { await chooseCompanion(next); }
    catch { if (revision === selectionRevision.current) setSyncNote('已在此设备切换；下次连接时将同步。'); }
  }
  useEffect(() => {
    let alive = true;
    import('./api').then(async ({ initConnection, api }) => {
      const connection = await initConnection();
      if (!connection.token) return;
      const state = await api<State>('/state');
      if (alive) { setName(state.settings.petName); setUser(state.user); setSession(state); setProviderId(state.providers.some(provider => provider.id === state.settings.defaultProviderId) ? state.settings.defaultProviderId! : state.providers[0]?.id || ''); await hydrateCompanion(state.settings.companionKind || 'anime'); }
    }).catch(() => {});
    return () => { alive = false; };
  }, []);
  function beginVoice() { setVoiceOpen(true); if (action !== 'sleep') void voice.start(); }
  return <main className={`companion-world companion-${kind}${voiceOpen ? ' companion-voice-open' : ''}`} data-ready={ready} data-companion-kind={kind} data-voice-phase={voice.phase}>
    <header className="companion-header">
      <a className="companion-brand" href="/" aria-label="小伴首页"><BrandMark size={32}/><span>小伴<small>PetPal</small></span></a>
      <nav aria-label="工作台入口">{user?.canUseCodex && <a className="companion-codex" aria-label="Agent 工作台" href="/?chat=1&mode=codex"><Terminal size={18} aria-hidden="true"/><span>Agent</span></a>}<a className="companion-settings" href="/?chat=1&settings=1" aria-label="连接与设置"><Settings2 size={18} aria-hidden="true"/></a><a className="companion-chat" href="/?chat=1"><MessageCircle size={18} aria-hidden="true"/>聊聊天<ArrowUpRight size={15} aria-hidden="true"/></a></nav>
    </header>
    <section className="companion-space" aria-label="伙伴陪伴空间" data-action={action}>
      <div className="companion-intro"><span className="companion-presence"><i/>{action === 'sleep' ? '安心睡着，也在陪你' : '在你身边'}</span><h1>{name}</h1></div>
      {catEnabled&&<div className="companion-switch" role="group" aria-label="选择陪伴角色"><button aria-pressed={kind === 'anime'} onClick={() => choose('anime')}>二次元伙伴</button><button aria-pressed={kind === 'cat'} onClick={() => choose('cat')}>3D 小猫</button></div>}
      <div className="companion-stage"><div className="companion-aura" aria-hidden="true"/><div className="companion-floor"/><CompanionScene key={kind} kind={kind} performanceInput={voiceOpen ? voice.performanceInput : undefined} onReady={() => setReady(true)} onState={state => setAction(state.action)}/></div>
      {voiceOpen ? <section className="companion-voice-panel" aria-label="伙伴语音聊天" aria-describedby="companion-voice-help">
        <div className="voice-conversation-heading"><span role="status">{voice.phase === 'starting' || voice.phase === 'recognizing' || voice.phase === 'thinking' ? <Loader2 size={15} className="spin" aria-hidden="true"/> : voice.speaking ? <AudioLines size={16} aria-hidden="true"/> : <Mic size={15} aria-hidden="true"/>} {voiceLabels[voice.phase]}</span><button aria-label="关闭语音聊天" onClick={() => {voice.stop();setVoiceOpen(false);}}><X size={16} aria-hidden="true"/></button></div>
        <div className="voice-conversation-toolbar">
          <label className="voice-conversation-model"><span>模型</span><select aria-label="语音聊天模型" value={providerId} disabled={voice.active} onChange={event => setProviderId(event.target.value)}>{session?.providers.map(provider => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></label>
          {user?.canUseCodex&&<ChatAssistantControls assistant={chatAssistant} allowed={!!user?.canUseCodex} user={user} providers={session?.providers.filter(provider=>session.codex.eligibleProviderIds?.includes(provider.id))||[]} disabled={voice.recognizing||voice.thinking||voice.speaking} localHostId={localHostId} onDownload={()=>location.assign('/?chat=1&downloads=1')} compact/>}
        </div>
        <p id="companion-voice-help" hidden>直接说话，停顿后自动发送。回应时可以打断。使用已选麦克风与扬声器，记录保存在当前账号。</p>
        <div ref={captions} className="voice-conversation-captions" aria-label="语音对话字幕" hidden={!hasCaptions}>
          {voice.transcript && <p className="voice-caption-user"><span>你</span>{voice.transcript}</p>}
          {voice.reply && <div className="voice-caption-reply"><span className="voice-caption-author">{name}</span><MessageMarkdown content={voice.reply} compact/></div>}
          {!voice.transcript && !voice.reply && voice.listening && <p className="voice-caption-empty">直接说话，停顿后发送。</p>}
        </div>
        <ChatAssistantTasks conversationId={voice.conversationId} tasks={voice.assistantTasks} onUpdate={voice.updateAssistantTasks}/>
        {voice.listening && <meter className="voice-input-level" aria-label="语音聊天麦克风电平" min={0} max={1} value={voice.level}/>}
        {voice.error && <p className="voice-conversation-error" role="alert">{voice.error} <a href="/?chat=1&settings=1">检查语音设置</a></p>}
        <div className="voice-conversation-actions">{voice.active ? <>
          {voice.listening ? <button className="voice-primary" disabled={!voice.hasUtterance} onClick={() => void voice.finishUtterance()}><Check size={16} aria-hidden="true"/>说完了</button> : <button className="voice-primary" disabled={voice.phase === 'starting'} onClick={() => void voice.interrupt()}><Mic size={16} aria-hidden="true"/>打断，我来说</button>}
          <button onClick={voice.stop}><Square size={13} aria-hidden="true"/>结束对话</button>
        </> : <button className="voice-primary" disabled={!user || !providerId || action === 'sleep'} onClick={beginVoice}><Mic size={16} aria-hidden="true"/>{voice.phase === 'error' ? '重新开始' : '开始语音聊天'}</button>}</div>
      </section> : <div className="companion-reply" role="status" aria-live="polite"><span>{(kind === 'anime' ? animeWords : words)[action]}</span></div>}
      {(!voiceOpen || syncNote || action === 'sleep') && <p className="companion-hint">{syncNote || (action === 'sleep' ? '轻触唤醒。' : '轻触回应，长按休息。')}</p>}
      <details className="interaction-help"><summary>相处的小方式</summary><p>双击打个招呼；鼠标按住轻轻划过，像一次抚摸。<br/>也可以按 Tab 选中伙伴，用 Enter 或空格回应，长按休息，连按两次打招呼。</p></details>
    </section>
    {(!voiceOpen || window.petpal) && <footer className="companion-footer">{!voiceOpen && <button className="companion-voice-entry" disabled={!user || !providerId} onClick={beginVoice}><Mic size={16} aria-hidden="true"/>语音聊天</button>}{window.petpal ? <button onClick={() => window.petpal?.showPet()}><Monitor size={16} aria-hidden="true"/>放到桌面<ArrowUpRight size={13} aria-hidden="true"/></button> : <a href="/?chat=1"><MessageCircle size={15} aria-hidden="true"/>说说今天<ArrowUpRight size={13} aria-hidden="true"/></a>}</footer>}
  </main>;
}
