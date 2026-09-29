import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, MessageCircle, Monitor, PawPrint, Settings2, Terminal } from 'lucide-react';
import CompanionScene from './avatar/CompanionScene';
import { useCompanion, chooseCompanion, hydrateCompanion } from './avatar/preference';
import { type CompanionKind, type State, type User } from './api';
import type { PetAction } from './pet/behavior';

const words: Record<PetAction, string> = { idle: '我就在你旁边。', walk: '走两步，再回来陪你。', pet: '呼噜…这样就很舒服。', eat: '啊呜，谢谢你的零食。', sleep: '呼…陪你安静一会儿。', jump: '看到你，就有一点开心。' };
const animeWords: Record<PetAction, string> = { idle: '今天也一起度过吧。', walk: '我就在这里，听你说。', pet: '嗯，感觉被温柔地照顾着。', eat: '谢谢你的点心。', sleep: '闭上眼睛，陪你安静一会儿。', jump: '嗨，我看到你啦。' };

export default function CompanionWorld() {
  const [name, setName] = useState('小伴');
  const [user, setUser] = useState<User>();
  const [kind] = useCompanion();
  const [syncNote, setSyncNote] = useState('');
  const selectionRevision = useRef(0);
  const [action, setAction] = useState<PetAction>('idle');
  const [ready, setReady] = useState(false);
  async function choose(next: CompanionKind) {
    if (kind === next) return;
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
      if (alive) { setName(state.settings.petName); setUser(state.user); await hydrateCompanion(state.settings.companionKind || 'anime'); }
    }).catch(() => {});
    return () => { alive = false; };
  }, []);
  return <main className={`companion-world companion-${kind}`} data-ready={ready} data-companion-kind={kind}>
    <header className="companion-header">
      <a className="companion-brand" href="/" aria-label="小伴首页"><PawPrint size={23}/><span>小伴<small>PetPal</small></span></a>
      <nav aria-label="工作台入口">{user?.canUseCodex && <a className="companion-codex" aria-label="Agent 工作台" href="/?chat=1&mode=codex"><Terminal size={17}/><span>Agent</span></a>}<a className="companion-settings" href="/?chat=1&settings=1" aria-label="连接与设置"><Settings2 size={18}/></a><a className="companion-chat" href="/?chat=1"><MessageCircle size={17}/>聊聊天<ArrowUpRight size={15}/></a></nav>
    </header>
    <section className="companion-space" aria-label="伙伴陪伴空间" data-action={action}>
      <div className="companion-intro"><span className="companion-presence"><i/>{action === 'sleep' ? '安心睡着，也在陪你' : '在你身边'}</span><h1>{name}</h1></div>
      <div className="companion-switch" role="group" aria-label="选择陪伴角色"><button aria-pressed={kind === 'anime'} onClick={() => choose('anime')}>二次元伙伴</button><button aria-pressed={kind === 'cat'} onClick={() => choose('cat')}>3D 小猫</button></div>
      <div className="companion-stage"><div className="companion-aura" aria-hidden="true"/><div className="companion-floor"/><CompanionScene key={kind} kind={kind} onReady={() => setReady(true)} onState={state => setAction(state.action)}/></div>
      <div className="companion-reply" role="status" aria-live="polite"><span>{(kind === 'anime' ? animeWords : words)[action]}</span></div>
      <p className="companion-hint">{syncNote || (action === 'sleep' ? '轻触一下，就会醒来。' : '轻触回应，长按休息。')}</p>
      <details className="interaction-help"><summary>相处的小方式</summary><p>双击打个招呼；鼠标按住轻轻划过，像一次抚摸。<br/>也可以按 Tab 选中伙伴，用 Enter 或空格回应，长按休息，连按两次打招呼。</p></details>
    </section>
    <footer className="companion-footer"><span>一起待着，也很好。</span>{window.petpal ? <button onClick={() => window.petpal?.showPet()}><Monitor size={16}/>放到桌面<ArrowUpRight size={13}/></button> : <a href="/?chat=1"><MessageCircle size={15}/>说说今天<ArrowUpRight size={13}/></a>}</footer>
  </main>;
}
