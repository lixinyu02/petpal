import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, AudioLines, Check, Loader2, MessageCircle, Mic, Monitor, PawPrint, Settings2, Square, Terminal, X } from 'lucide-react';
import CompanionScene from './avatar/CompanionScene';
import { useCompanion, chooseCompanion, hydrateCompanion } from './avatar/preference';
import { type CompanionKind, type State, type User } from './api';
import type { PetAction } from './pet/behavior';
import { useVoiceConversation } from './voice/useVoiceConversation';
import './voice-conversation.css';

const words: Record<PetAction, string> = { idle: '我就在你旁边。', walk: '走两步，再回来陪你。', pet: '呼噜…这样就很舒服。', eat: '啊呜，谢谢你的零食。', sleep: '呼…陪你安静一会儿。', jump: '看到你，就有一点开心。' };
const animeWords: Record<PetAction, string> = { idle: '今天也一起度过吧。', walk: '我就在这里，听你说。', pet: '嗯，感觉被温柔地照顾着。', eat: '谢谢你的点心。', sleep: '闭上眼睛，陪你安静一会儿。', jump: '嗨，我看到你啦。' };

export default function CompanionWorld() {
  const [name, setName] = useState('小伴');
  const [user, setUser] = useState<User>();
  const [session, setSession] = useState<State|null>(null);
  const [providerId, setProviderId] = useState('');
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [kind] = useCompanion();
  const [syncNote, setSyncNote] = useState('');
  const selectionRevision = useRef(0);
  const [action, setAction] = useState<PetAction>('idle');
  const [ready, setReady] = useState(false);
  const captions = useRef<HTMLDivElement>(null);
  const voice = useVoiceConversation({allowed:!!user,scope:session?.instanceId && user ? `${session.instanceId}:${user.id}` : 'guest',providerId});
  const voiceLabels = {idle:'准备好就开始吧',starting:'正在连接声音…',listening:'我在听，说说你的想法',recognizing:'正在听懂这句话…',thinking:'让我想一想…',speaking:'小伴正在回应',error:'语音聊天已暂停'};
  useEffect(() => { if (action === 'sleep') voice.stop(); }, [action, voice.stop]);
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
      <a className="companion-brand" href="/" aria-label="小伴首页"><PawPrint size={23}/><span>小伴<small>PetPal</small></span></a>
      <nav aria-label="工作台入口">{user?.canUseCodex && <a className="companion-codex" aria-label="Agent 工作台" href="/?chat=1&mode=codex"><Terminal size={17}/><span>Agent</span></a>}<a className="companion-settings" href="/?chat=1&settings=1" aria-label="连接与设置"><Settings2 size={18}/></a><a className="companion-chat" href="/?chat=1"><MessageCircle size={17}/>聊聊天<ArrowUpRight size={15}/></a></nav>
    </header>
    <section className="companion-space" aria-label="伙伴陪伴空间" data-action={action}>
      <div className="companion-intro"><span className="companion-presence"><i/>{action === 'sleep' ? '安心睡着，也在陪你' : '在你身边'}</span><h1>{name}</h1></div>
      <div className="companion-switch" role="group" aria-label="选择陪伴角色"><button aria-pressed={kind === 'anime'} onClick={() => choose('anime')}>二次元伙伴</button><button aria-pressed={kind === 'cat'} onClick={() => choose('cat')}>3D 小猫</button></div>
      <div className="companion-stage"><div className="companion-aura" aria-hidden="true"/><div className="companion-floor"/><CompanionScene key={kind} kind={kind} performanceInput={voiceOpen ? voice.performanceInput : undefined} onReady={() => setReady(true)} onState={state => setAction(state.action)}/></div>
      {voiceOpen ? <section className="companion-voice-panel" aria-label="伙伴语音聊天">
        <div className="voice-conversation-heading"><span role="status">{voice.phase === 'starting' || voice.phase === 'recognizing' || voice.phase === 'thinking' ? <Loader2 size={15} className="spin"/> : voice.speaking ? <AudioLines size={16}/> : <Mic size={15}/>} {voiceLabels[voice.phase]}</span><button aria-label="关闭语音聊天" onClick={() => {voice.stop();setVoiceOpen(false);}}><X size={16}/></button></div>
        <label className="voice-conversation-model">聊天模型<select aria-label="语音聊天模型" value={providerId} disabled={voice.active} onChange={event => setProviderId(event.target.value)}>{session?.providers.map(provider => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></label>
        <div ref={captions} className="voice-conversation-captions" aria-label="语音对话字幕">
          {voice.transcript && <p className="voice-caption-user"><span>你</span>{voice.transcript}</p>}
          {voice.reply && <p className="voice-caption-reply"><span>{name}</span>{voice.reply}</p>}
          {!voice.transcript && !voice.reply && <p className="voice-caption-empty">自然说话，停顿后会自动发送。回应时可打断继续说。</p>}
        </div>
        {voice.listening && <meter className="voice-input-level" aria-label="语音聊天麦克风电平" min={0} max={1} value={voice.level}/>}
        {voice.error && <p className="voice-conversation-error" role="alert">{voice.error} <a href="/?chat=1&settings=1">检查语音设置</a></p>}
        <div className="voice-conversation-actions">{voice.active ? <>
          {voice.listening ? <button className="voice-primary" disabled={!voice.hasUtterance} onClick={() => void voice.finishUtterance()}><Check size={16}/>说完了</button> : <button className="voice-primary" disabled={voice.phase === 'starting'} onClick={() => void voice.interrupt()}><Mic size={16}/>打断，我来说</button>}
          <button onClick={voice.stop}><Square size={13}/>结束对话</button>
        </> : <button className="voice-primary" disabled={!user || !providerId || action === 'sleep'} onClick={beginVoice}><Mic size={16}/>{voice.phase === 'error' ? '重新开始' : '开始语音聊天'}</button>}</div>
        {!voice.active && <p className="voice-conversation-note">使用已选麦克风与扬声器。聊天记录会保存在当前账号。</p>}
      </section> : <div className="companion-reply" role="status" aria-live="polite"><span>{(kind === 'anime' ? animeWords : words)[action]}</span></div>}
      <p className="companion-hint">{syncNote || (action === 'sleep' ? '轻触一下，就会醒来。' : '轻触回应，长按休息。')}</p>
      <details className="interaction-help"><summary>相处的小方式</summary><p>双击打个招呼；鼠标按住轻轻划过，像一次抚摸。<br/>也可以按 Tab 选中伙伴，用 Enter 或空格回应，长按休息，连按两次打招呼。</p></details>
    </section>
    <footer className="companion-footer">{voiceOpen ? <span>{voice.active ? '正在语音聊天' : '一起待着，也很好。'}</span> : <button className="companion-voice-entry" disabled={!user || !providerId} onClick={beginVoice}><Mic size={16}/>语音聊天</button>}{window.petpal ? <button onClick={() => window.petpal?.showPet()}><Monitor size={16}/>放到桌面<ArrowUpRight size={13}/></button> : <a href="/?chat=1"><MessageCircle size={15}/>说说今天<ArrowUpRight size={13}/></a>}</footer>
  </main>;
}
