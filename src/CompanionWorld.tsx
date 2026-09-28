import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Coffee, Heart, MessageCircle, Monitor, Moon, PawPrint, Settings2, Sun, Terminal, Volume2, Square } from 'lucide-react';
import type { PetCommand } from './pet/PetScene';
import CompanionScene from './avatar/CompanionScene';
import { useCompanion, chooseCompanion, hydrateCompanion } from './avatar/preference';
import type { CompanionKind, State, User } from './api';
import type { PetAction, PetInteraction } from './pet/behavior';
import { useSpeech } from './avatar/useSpeech';
import type { PerformanceInput } from './avatar/performance.mjs';

const words: Record<PetAction, string> = { idle: '我就在你旁边。', walk: '踱两步，再回来陪你。', pet: '呼噜呼噜… 再摸一下。', eat: '啊呜，谢谢你的零食。', sleep: '呼… 让我眯一会儿。', jump: '嘿，接住今天的小开心！' };
const animeWords: Record<PetAction, string> = { idle: '今天也一起度过吧。', walk: '我就在这里，听你说。', pet: '嗯，这样就很安心。', eat: '谢谢你的点心，一起休息一下吧。', sleep: '闭上眼睛，陪你安静一会儿。', jump: '嗨，看到你真好。' };
const responses = {
  warm: { label: '温柔回应', text: '谢谢你，今天也很开心。慢慢来，我会陪着你。' },
  curious: { label: '好奇一下', text: '为什么会这样呢？你愿意再多告诉我一点吗？' },
  thoughtful: { label: '认真想想', text: '让我想一想……嗯，我们可以一步一步试试看。' },
  surprised: { label: '小小惊喜', text: '哇！真是惊喜！原来你已经做到了，好棒呀。' },
  shy: { label: '有点害羞', text: '有点不好意思，脸红了。谢谢你这样温柔地对我。' },
};

export default function CompanionWorld() {
  const [name, setName] = useState('小伴');
  const [user, setUser] = useState<User>();
  const [kind] = useCompanion();
  const [syncNote, setSyncNote] = useState('');
  const selectionRevision = useRef(0);
  const [action, setAction] = useState<PetAction>('idle');
  const [ready, setReady] = useState(false);
  const [command, setCommand] = useState<PetCommand>();
  const [response, setResponse] = useState<keyof typeof responses>('warm');
  const [preview, setPreview] = useState<PerformanceInput>();
  const speech = useSpeech(kind === 'anime' && action !== 'sleep');
  const count = useRef(0);
  const send = (next: PetInteraction) => { speech.stop(); setPreview(undefined); setCommand({ action: next, id: ++count.current }); };
  const saySomething = () => {
    const text = responses[response].text, utteranceId = `preview-${++count.current}`;
    setCommand({action:'wake',id:++count.current});
    speech.stop();
    const started = speech.speakIfEnabled(text,utteranceId);
    setPreview({ text, utteranceId: started ? utteranceId : `${utteranceId}-text`, phase: 'speaking' });
  };
  const stopTalking = () => { speech.stop(); setPreview(previous => previous ? {...previous,phase:'idle'} : previous); };
  const displayPerformance: PerformanceInput | undefined = speech.playing ? {
    utteranceId: speech.utteranceId, text: speech.text, phase: speech.active ? 'speaking' : 'idle',
    speech: { active:speech.active,charIndex:speech.charIndex,ended:speech.ended },
  } : preview;
  useEffect(() => {
    if (speech.ended && speech.utteranceId) setPreview(previous => previous?.utteranceId === speech.utteranceId ? {...previous,phase:'idle'} : previous);
  }, [speech.ended,speech.utteranceId]);
  async function choose(next: CompanionKind) {
    if (kind === next) return;
    const revision = ++selectionRevision.current; speech.stop(); setPreview(undefined); setAction('idle'); setCommand(undefined); setReady(false); setSyncNote('');
    try { await chooseCompanion(next); }
    catch { if (revision === selectionRevision.current) setSyncNote('已在此设备切换；下次连接时将同步到个人服务。'); }
  }
  useEffect(() => {
    let alive = true;
    import('./api').then(async ({ initConnection, api }) => {
      const connection = await initConnection();
      if (!connection.token) return;
      const state = await api<State>('/state');
      if (alive) { setName(state.settings.petName); setUser(state.user); await hydrateCompanion(state.settings.companionKind || 'anime'); }
    }).catch(() => {});
    return () => { alive = false; };
  }, []);
  return <main className={`companion-world companion-${kind}`} data-ready={ready} data-companion-kind={kind}>
    <header className="companion-header">
      <a className="companion-brand" href="/" aria-label="小伴首页"><PawPrint size={23}/><span>小伴<small>PetPal</small></span></a>
      <nav aria-label="工作台入口">{user?.canUseCodex && <a className="companion-codex" aria-label="Codex 工作台" href="/?chat=1&mode=codex"><Terminal size={17}/><span>Codex</span></a>}<a className="companion-settings" href="/?chat=1&settings=1" aria-label="连接与设置"><Settings2 size={18}/></a><a className="companion-chat" href="/?chat=1"><MessageCircle size={17}/>聊聊天<ArrowUpRight size={15}/></a></nav>
    </header>
    <section className="companion-space" aria-label="伙伴陪伴空间">
      <div className="companion-intro"><span className="companion-presence"><i/>{action === 'sleep' ? '在你身边，安心睡着' : '在你身边'}</span><h1>{name}</h1></div>
      <div className="companion-switch" role="group" aria-label="选择陪伴角色"><button aria-pressed={kind === 'anime'} onClick={() => choose('anime')}>二次元伙伴</button><button aria-pressed={kind === 'cat'} onClick={() => choose('cat')}>3D 小猫</button></div>
      <div className="companion-stage"><div className="companion-floor"/><CompanionScene key={kind} kind={kind} command={command} performanceInput={displayPerformance} onReady={() => setReady(true)} onState={state => setAction(state.action)}/></div>
      <div className="companion-reply" role="status" aria-live="polite"><span>{kind === 'anime' && preview ? preview.text : (kind === 'anime' ? animeWords : words)[action]}</span></div>
      <div className="companion-controls" aria-label="和伙伴互动">
        <button onClick={() => send('pet')} disabled={action === 'sleep'}><Heart size={20}/><span>摸摸头</span></button><span className="control-divider"/>
        <button onClick={() => send('eat')} disabled={action === 'sleep'}><Coffee size={20}/><span>{kind === 'anime' ? '分享点心' : '喂零食'}</span></button><span className="control-divider"/>
        <button onClick={() => send(action === 'sleep' ? 'wake' : 'sleep')} aria-pressed={action === 'sleep'}>{action === 'sleep' ? <Sun size={20}/> : <Moon size={20}/>}<span>{action === 'sleep' ? '轻轻叫醒' : '睡一会'}</span></button>
      </div>
      {kind === 'anime' && <div className="companion-voice">
        <div className="companion-response-row"><select aria-label="回应心情" value={response} onChange={event => {stopTalking();setResponse(event.target.value as keyof typeof responses);}}>{Object.entries(responses).map(([value,item])=><option key={value} value={value}>{item.label}</option>)}</select><button onClick={saySomething} disabled={action === 'sleep'}><MessageCircle size={15}/>说句话</button><button onClick={stopTalking} aria-label="停止说话" disabled={!speech.playing && preview?.phase !== 'speaking'}><Square size={13}/></button></div>
        <label className="voice-toggle"><input type="checkbox" checked={speech.enabled} disabled={!speech.supported || !speech.hasChineseVoice} onChange={event=>speech.setEnabled(event.target.checked)}/><Volume2 size={14}/>语音朗读</label>
        <span className="voice-caption" role="status">{speech.error || (!speech.supported ? '此设备不支持系统朗读，可体验无声表情。' : !speech.hasChineseVoice ? '未发现本地中文音色，当前使用无声口型。' : speech.active ? `${speech.voiceName} · ${speech.progressBasis === 'boundary' ? '跟随朗读进度' : '按句子节奏估算口型'}` : '开启后，点“说句话”听她回应。')}</span>
      </div>}
      <p className="companion-hint">{syncNote || (kind === 'anime' ? '她会跟随你的视线，双击和她打个招呼。' : '摸摸它的脑袋，或双击让它跳一下。')}</p>
    </section>
    <footer className="companion-footer"><span>不用急着做什么，一起待着也很好。</span>{window.petpal ? <button onClick={() => window.petpal?.showPet()}><Monitor size={16}/>放到桌面<ArrowUpRight size={13}/></button> : <a href="/?chat=1&settings=1">连接个人服务<ArrowUpRight size={13}/></a>}</footer>
  </main>;
}
