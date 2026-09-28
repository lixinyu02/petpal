import UpdatesSettings from './UpdatesSettings';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUp, Check, ChevronDown, CircleHelp, Code2, Coffee, Copy, Globe2, Heart, History, Link2, Loader2, Menu, MessageCircle, Monitor, Moon, MoreHorizontal, PawPrint, Pencil, Plug, Plus, Settings2, ShieldCheck, Square, Terminal, Trash2, Unplug, X } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { PetOverlay as Overlay, showPet } from './platform/overlay';
import { useCompanion, hydrateCompanion, readCompanion } from './avatar/preference';
import Cat from './CatV2';
import { useSpeech } from './avatar/useSpeech';
import type { PerformanceInput, PerformancePhase } from './avatar/performance.mjs';
import './avatar/speech.css';
import AccountsSettings from './AccountsSettings';
import VoiceSettings from './VoiceSettings';
import DesktopAssistantSettings from './DesktopAssistantSettings';
import { api, getConnection, getSessionEpoch, initConnection, connectWithToken, login, isSessionChanged, SessionChangedError, streamMessage, type Connection, type Conversation, type Message, type Provider, type State } from './api';

const emptyState: State = { settings: { petName: '小伴', companionKind: 'anime', persona: '你是用户温柔、机灵的个人 AI 伙伴。用自然简洁的中文回应，认真倾听；不知道的事情坦诚说明。' }, providers: [], conversations: [], codex: {} };
type Approval = { id: string; kind: string; description: string };

export default function App() {
  const accountEpoch = useRef(getSessionEpoch()).current;
  const [companionKind] = useCompanion();
  const [state, setState] = useState<State>(emptyState);
  const [ready, setReady] = useState(false);
  const [connected, setConnected] = useState(false);
  const [view, setView] = useState<'chat' | 'settings'>(new URLSearchParams(location.search).has('settings') ? 'settings' : 'chat');
  const [settingsTab, setSettingsTab] = useState<'models'|'pet'|'desktop'|'accounts'|'voice'|'assistant'|'updates'>('models');
  const [mode, setMode] = useState<'chat' | 'codex'>(new URLSearchParams(location.search).get('mode') === 'codex' ? 'codex' : 'chat');
  const [selected, setSelected] = useState<string | null>(null);
  const [providerId, setProviderId] = useState('');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [mood, setMood] = useState('idle');
  const [petSay, setPetSay] = useState('我在这里，听你说。');
  const [mobileNav, setMobileNav] = useState(false);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [responsePerformance, setResponsePerformance] = useState<PerformanceInput>({ utteranceId: '', text: '', phase: 'idle' });
  const speech = useSpeech(companionKind === 'anime' && view === 'chat' && !connectionOpen && mood !== 'sleep');
  const awakeRef = useRef(mood !== 'sleep');
  awakeRef.current = mood !== 'sleep';
  const abortRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const activeRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const moodTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const responseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSequence = useRef(0);
  const petOnly = new URLSearchParams(location.search).get('pet') === '1';
  const conversation = state.conversations.find(c => c.id === selected);
  const provider = state.providers.find(p => p.id === (conversation?.providerId || providerId));
  const currentMode = conversation?.mode || mode;
  const lastReply = conversation?.messages.slice().reverse().find(message => message.role === 'assistant' && message.status === 'complete' && message.content.trim());
  const performanceInput: PerformanceInput = mood === 'sleep' ? { utteranceId: 'sleep', text: '', phase: 'idle' } : speech.playing
    ? { utteranceId: speech.utteranceId, text: speech.text, phase: 'speaking', speech: { active: speech.active, charIndex: speech.charIndex, ended: speech.ended } }
    : { ...responsePerformance, ...(speech.enabled ? { speech: { active: false, charIndex: 0, ended: true } } : {}) };

  function performancePhase(phase: PerformancePhase, text = '', utteranceId = '') {
    if (responseTimer.current) clearTimeout(responseTimer.current);
    responseTimer.current = null;
    setResponsePerformance({ utteranceId, text, phase: document.hidden || !awakeRef.current ? 'idle' : phase });
  }
  function stopPresentation() { speech.stop(); performancePhase('idle'); }
  function finishResponse(text: string, utteranceId: string, requestId: number) {
    // Keep newly arrived text observable when React batches delta + done in one SSE read.
    // The renderer consumes each character once; this bounded tail only drains that queue.
    performancePhase(text ? 'speaking' : 'idle', text, utteranceId);
    if (text) responseTimer.current = setTimeout(() => {
      if (requestSequence.current === requestId && getSessionEpoch() === accountEpoch) performancePhase('idle', text, utteranceId);
    }, Math.min(5200, Math.max(800, [...text].length * 190 + 500)));
  }

  async function refresh() {
    if (getSessionEpoch() !== accountEpoch) throw new SessionChangedError();
    const next = await api<State>('/state');
    if (getSessionEpoch() !== accountEpoch) throw new SessionChangedError();
    setState(next); setConnected(true); await hydrateCompanion(next.settings.companionKind || 'anime').catch(() => {});
    setProviderId(previous => next.providers.some(p => p.id === previous) ? previous : next.settings.defaultProviderId || next.providers[0]?.id || '');
    return next;
  }
  useEffect(() => {
    let alive = true;
    initConnection().then(async connection => {
      if (!connection.token) { if (alive) setConnected(false); return; }
      const next = await api<State>('/state');
      if (alive && getSessionEpoch() === accountEpoch) { setState(next); await hydrateCompanion(next.settings.companionKind || 'anime').catch(() => {}); setProviderId(next.settings.defaultProviderId || next.providers[0]?.id || ''); setConnected(true); if(!next.user?.canUseCodex)setMode('chat'); }
    }).catch(e => { if (alive) setError(e.message); }).finally(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, []);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: busy ? 'instant' : 'smooth' }); }, [conversation?.messages, busy, approvals]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 3800); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => {
    const hidden = () => { if (document.hidden) { if (responseTimer.current) clearTimeout(responseTimer.current); setResponsePerformance(previous => ({ ...previous, phase: 'idle' })); } };
    document.addEventListener('visibilitychange', hidden);
    return () => { requestSequence.current++; abortRef.current?.abort(); if (moodTimer.current) clearTimeout(moodTimer.current); if (responseTimer.current) clearTimeout(responseTimer.current); document.removeEventListener('visibilitychange', hidden); };
  }, []);
  useEffect(() => { if (view !== 'chat' || companionKind !== 'anime' || connectionOpen) { if (responseTimer.current) clearTimeout(responseTimer.current); setResponsePerformance({ utteranceId: '', text: '', phase: 'idle' }); } }, [view, companionKind, connectionOpen]);

  function interact(next: string) {
    if (moodTimer.current) clearTimeout(moodTimer.current);
    if (next === 'sleep') {
      const waking = mood === 'sleep';
      stopPresentation(); awakeRef.current = waking;
      setMood(waking ? 'idle' : 'sleep'); setPetSay(waking ? '睡饱啦，我在这里。' : '呼… 再点一下月亮就能叫醒我。');
      return;
    }
    setMood(next); setPetSay(next === 'happy' ? (companionKind === 'anime' ? '嗯，这样就很安心。' : '呼噜呼噜…喜欢这样。') : next === 'eat' ? '谢谢你的点心，元气补充完毕！' : '陪你慢下来，休息一小会。');
    moodTimer.current = setTimeout(() => { setMood('idle'); setPetSay('我在这里，听你说。'); }, 5500);
  }
  function newChat(nextMode = mode) {
    if (busyRef.current) { setNotice('先停止当前回复，再开启新对话。'); return; }
    stopPresentation();
    setSelected(null); setMode(nextMode === 'codex' && !state.user?.canUseCodex ? 'chat' : nextMode); setProviderId(state.settings.defaultProviderId || state.providers[0]?.id || ''); setView('chat'); setDraft(''); setError(''); setMobileNav(false); setApprovals([]);
  }
  function selectChat(c: Conversation) {
    if (busyRef.current) { setNotice('当前对话正在回复，请完成或停止后切换。'); return; }
    stopPresentation();
    setSelected(c.id); setMode(c.mode); setView('chat'); setError(''); setMobileNav(false); setApprovals([]);
  }
  async function send(event?: FormEvent) {
    event?.preventDefault(); const content = draft.trim();
    if (!content || busyRef.current) return;
    if (!connected) { setConnectionOpen(true); return; }
    if (currentMode === 'codex' && !state.user?.canUseCodex) { setNotice('Codex 电脑助手仅供主机管理员使用。'); return; }
    if (currentMode === 'chat' && !provider) { setView('settings'); setNotice('添加一个模型连接，就可以开始聊天了。'); return; }
    stopPresentation();
    busyRef.current = true; setBusy(true); setError(''); setApprovals([]); setStatus(currentMode === 'codex' ? '正在连接 Codex…' : '正在想怎么回答你…');
    const controller = new AbortController(); abortRef.current = controller;
    const requestId = ++requestSequence.current;
    let target = conversation;
    let assistantId = `pending-${Date.now()}`;
    let accepted = false;
    let responseText = '', finalReply: Message | undefined;
    let failed = false;
    performancePhase('thinking', '', assistantId);
    try {
      if (!target) {
        target = await api<Conversation>('/conversations', { method: 'POST', body: JSON.stringify({ mode: currentMode, ...(currentMode === 'chat' ? { providerId: provider!.id } : {}) }) });
        setSelected(target.id); setState(s => ({ ...s, conversations: [target!, ...s.conversations] }));
      }
      controller.signal.throwIfAborted();
      activeRef.current = target.id;
      const pending: Message[] = [...target.messages, { id: `user-${Date.now()}`, role: 'user', content }, { id: assistantId, role: 'assistant', content: '', status: 'streaming' }];
      setState(s => ({ ...s, conversations: s.conversations.map(c => c.id === target!.id ? { ...c, title: c.messages.length ? c.title : content.slice(0, 32), messages: pending } : c) }));
      setDraft('');
      await streamMessage(target.id, content, controller.signal, event => {
        if (controller.signal.aborted || requestSequence.current !== requestId || getSessionEpoch() !== accountEpoch) return;
        if (event.type === 'meta') accepted = true;
        if (event.type === 'delta') {
          accepted = true;
          setStatus('');
          const delta = typeof event.data.text === 'string' ? event.data.text : '';
          if (delta) {
            responseText += delta;
            performancePhase('speaking', responseText, assistantId);
            responseTimer.current = setTimeout(() => { if (!controller.signal.aborted && requestSequence.current === requestId && getSessionEpoch() === accountEpoch) performancePhase('thinking', responseText, assistantId); }, 650);
          }
          setState(s => ({ ...s, conversations: s.conversations.map(c => c.id === target!.id ? { ...c, messages: c.messages.map(m => m.id === assistantId ? { ...m, content: m.content + (event.data.text || '') } : m) } : c) }));
        }
        if (event.type === 'status') { performancePhase('thinking', responseText, assistantId); setStatus(event.data.message || event.data.text || event.data.status || '正在处理中…'); }
        if (event.type === 'approval') { performancePhase('thinking', responseText, assistantId); setApprovals(a => [...a.filter(item => item.id !== String(event.data.id)), { id: String(event.data.id), kind: event.data.kind || '操作请求', description: event.data.description || 'Codex 请求执行操作，请检查后决定。' }]); }
        if (event.type === 'error') { failed = true; performancePhase('error', responseText, assistantId); if (event.data.conversation?.messages?.at(-1)?.status !== 'cancelled') setError(event.data.message || '回复失败，请检查连接后重试。'); if (event.data.conversation) setState(s => ({ ...s, conversations: s.conversations.map(c => c.id === target!.id ? event.data.conversation : c) })); }
        if (event.type === 'done') {
          if (event.data.conversation) {
            finalReply = event.data.conversation.messages?.at(-1);
            setState(s => ({ ...s, conversations: s.conversations.map(c => c.id === target!.id ? event.data.conversation : c) }));
          }
          if (!failed) finishResponse(responseText || finalReply?.content || '', assistantId, requestId);
        }
      });
    } catch (e) {
      if (getSessionEpoch() !== accountEpoch || isSessionChanged(e)) return;
      failed = true;
      performancePhase((e as Error).name === 'AbortError' ? 'idle' : 'error', responseText, assistantId);
      if ((e as Error).name !== 'AbortError') { setError((e as Error).message); if (!accepted) setDraft(content); }
    } finally {
      if (requestSequence.current === requestId && getSessionEpoch() === accountEpoch) {
        if (failed || controller.signal.aborted) performancePhase(controller.signal.aborted ? 'idle' : 'error', responseText, assistantId);
        try { await refresh(); } catch { setError(previous => previous || '暂时无法刷新会话，请检查服务连接。'); }
        if (requestSequence.current === requestId && getSessionEpoch() === accountEpoch) {
          setBusy(false); busyRef.current = false; activeRef.current = null; abortRef.current = null; setApprovals([]); setStatus('');
          if (!failed && !controller.signal.aborted && finalReply?.role === 'assistant' && finalReply.status === 'complete') speech.speakIfEnabled(finalReply.content, `${finalReply.id}-auto-${requestId}`);
        }
      }
    }
  }
  async function stop() {
    stopPresentation();
    const active = activeRef.current;
    abortRef.current?.abort();
    if (!active) return;
    setStatus('正在停止…');
    try { await api(`/conversations/${encodeURIComponent(active)}/stop`, { method: 'POST' }); }
    catch (e) { setError((e as Error).message); }
  }
  async function approve(approval: Approval, decision: string) {
    try { await api(`/codex/approvals/${encodeURIComponent(approval.id)}`, { method: 'POST', body: JSON.stringify({ decision }) }); setApprovals(a => a.filter(item => item.id !== approval.id)); }
    catch (e) { setError((e as Error).message); }
  }
  async function deleteChat(id: string) {
    if (selected === id) stopPresentation();
    try { await api(`/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' }); if (selected === id) setSelected(null); await refresh(); setDeleting(null); }
    catch (e) { setError((e as Error).message); }
  }
  function chooseSuggestion(text: string) { setDraft(text); inputRef.current?.focus(); }

  if (petOnly) return <div className="floating-pet"><div className="pet-drag-handle" title="拖动小猫">•••</div><button className="floating-bubble" onClick={() => window.petpal?.showMain()}>{busy ? '我在认真工作…' : `${state.settings.petName}在这里，点我聊聊`}<MessageCircle size={15}/></button><button className="floating-cat" aria-label="抚摸小猫" onClick={() => interact('happy')} onDoubleClick={() => window.petpal?.showMain()}><Cat mood={mood}/></button><button className="floating-hide" aria-label="隐藏桌宠" onClick={() => window.petpal?.hidePet()}><X size={15}/></button></div>;

  return <div className="app-shell">
    {mobileNav && <button className="nav-scrim" aria-label="关闭导航" onClick={() => setMobileNav(false)}/>}
    <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
      <a className="brand" href="#" onClick={e => { e.preventDefault(); newChat('chat'); }}><span className="brand-mark"><PawPrint size={23}/></span><span>小伴<span className="brand-en">PetPal</span></span><span className="brand-dot"/></a>
      <button className="new-chat" onClick={() => newChat()}><Plus size={18}/>开启新对话<span>＋</span></button>
      <nav className="main-nav" aria-label="主导航">
        <button className={view === 'chat' && currentMode === 'chat' ? 'active' : ''} onClick={() => newChat('chat')}><MessageCircle size={19}/>陪伴空间</button>
        {state.user?.canUseCodex && <button className={view === 'chat' && currentMode === 'codex' ? 'active' : ''} onClick={() => newChat('codex')}><Code2 size={19}/>Codex 电脑助手<span className="nav-tag">CLI</span></button>}
      </nav>
      <div className="history-heading"><span>最近的对话</span><History size={14}/></div>
      <div className="history-list">{state.conversations.length === 0 ? <p className="history-empty">我们的故事，从一句你好开始。</p> : state.conversations.map(c => <div className={`history-row ${selected === c.id && view === 'chat' ? 'selected' : ''}`} key={c.id}><button className="history-item" title={c.title} onClick={() => selectChat(c)}>{c.mode === 'codex' ? <Terminal size={15}/> : <MessageCircle size={15}/>}<span>{c.title || '新对话'}</span></button><button disabled={busy} className="history-delete icon-button" aria-label={`删除对话 ${c.title}`} onClick={() => setDeleting(c.id)}><Trash2 size={13}/></button></div>)}</div>
      <div className="sidebar-bottom">
        <button className={`settings-link ${view === 'settings' ? 'active' : ''}`} onClick={() => { if (busy) { setNotice('请先完成或停止当前回复。'); return; } setView('settings'); setMobileNav(false); }}><Settings2 size={18}/>连接与设置</button>
        <button className="host-status" onClick={() => { stopPresentation(); setConnectionOpen(true); }}><span className={`status-light ${connected ? 'online' : ''}`}/><span>{connected ? state.user?.displayName || '个人服务已连接' : '登录你的个人服务'}<small>{window.petpal ? '桌面本地服务' : Capacitor.isNativePlatform() ? 'Android · 远程服务' : 'Web · 个人空间'}</small></span><ChevronDown size={14}/></button>
      </div>
    </aside>

    <main className="main-area">
      <header className="topbar"><div className="topbar-title"><button className="mobile-menu icon-button" aria-label="打开导航" onClick={() => setMobileNav(true)}><Menu size={21}/></button><span className="breadcrumb">我的空间</span><span className="breadcrumb-divider">/</span><strong>{view === 'settings' ? '连接与设置' : currentMode === 'codex' ? 'Codex 电脑助手' : '陪伴空间'}</strong></div><div className="topbar-actions"><span className="today">{new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' }).format(new Date())}</span><button className="avatar account-entry" aria-label="我的账号" onClick={() => { stopPresentation(); setSettingsTab('accounts'); setView('settings'); }}>{state.user?.displayName?.slice(0,1) || '我'}</button><a className="single-companion-return" href="/" aria-label="回到伙伴身边"><PawPrint size={20}/></a></div></header>
      {!ready ? <div className="loading-view"><Loader2 className="spin"/>正在准备你的小伴…</div> : view === 'settings' ? <SettingsView state={state} connected={connected} refresh={refresh} notice={setNotice} connect={() => setConnectionOpen(true)} initialTab={settingsTab} hasDraft={!!draft.trim()}/> : <div className="workspace">
        <section className="chat-area">
          <div className="chat-toolbar"><span className="mode-label"><span className={`status-light ${connected ? 'online' : ''}`}/>{currentMode === 'codex' ? '听你安排，帮你操作' : '随时听你说'}</span><div className="model-picker">{currentMode === 'chat' ? <><Plug size={13}/><select aria-label="当前模型连接" value={conversation?.providerId || providerId} disabled={busy || !!conversation} onChange={e => setProviderId(e.target.value)}>{!state.providers.length && <option value="">还未连接模型</option>}{state.providers.map(p => <option value={p.id} key={p.id}>{p.name} · {p.model}</option>)}</select><ChevronDown size={13}/></> : <><Terminal size={14}/><span>{state.codex.mode === 'api' ? 'Codex · Responses API' : 'Codex · 本机配置'}</span><button className="assistant-tool-settings" onClick={() => { stopPresentation(); setSettingsTab('assistant'); setView('settings'); }}>配置</button></>}</div></div>
          <div className="chat-scroll" ref={scrollRef} aria-live="polite" aria-busy={busy}>
            {!conversation?.messages.length ? <div className="welcome"><div className="welcome-symbol">{currentMode === 'codex' ? <Terminal size={28}/> : <span className="mini-sun">✳</span>}</div><span className="eyebrow">{currentMode === 'codex' ? 'YOUR DESKTOP ASSISTANT' : 'A LITTLE COMPANY, EVERY DAY'}</span><h1>{currentMode === 'codex' ? <>听听音乐，<br/>把电脑交给小伴。</> : <>今天，<br/>也一起过吧。</>}</h1><p>{currentMode === 'codex' ? '连接 Codex API 后，让小伴帮你控制音乐播放器，或在浏览器里打开音乐官网。' : `我是${state.settings.petName}。想聊的、想做的，慢慢告诉我。`}</p><div className="suggestions">{(currentMode === 'codex' ? [{ icon: Monitor, title: '看看音乐播放器', text: '请检查 QQ 音乐和网易云音乐的安装及媒体会话状态，暂不打开或播放。' }, { icon: Globe2, title: '连接音乐网页', text: '请检查 OpenCLI 和浏览器桥的状态，告诉我还需要完成哪些连接步骤。' }] : [{ icon: Coffee, title: '聊聊今天', text: '小伴，陪我聊聊今天吧。' }, { icon: Pencil, title: '把想法写下来', text: '我有一个还不成熟的想法，想和你一起梳理。' }]).map(item => <button key={item.title} onClick={() => chooseSuggestion(item.text)}><item.icon size={19}/><span>{item.title}</span><span className="suggestion-arrow">↗</span></button>)}</div>{!connected && <button className="inline-connect" onClick={() => setConnectionOpen(true)}><Link2 size={14}/>连接个人服务，开始第一段对话</button>}{connected && currentMode === 'chat' && !state.providers.length && <button className="inline-connect" onClick={() => setView('settings')}><Plus size={14}/>{state.user?.isOwner ? '添加模型连接，开始聊天' : '还没有可用模型，请联系管理员分配'}</button>}</div> : <div className="messages">{conversation.messages.map(message => <div key={message.id} className={`message message-${message.role}`}><span className={`message-avatar ${message.role === 'assistant' ? 'pet-avatar' : ''}`}>{message.role === 'assistant' ? <PawPrint size={16}/> : '我'}</span><div className="message-content"><div className="message-author">{message.role === 'assistant' ? state.settings.petName : '我'}{message.role === 'assistant' && <span>{currentMode === 'codex' ? 'Codex' : provider?.model || ''}</span>}</div><div className="message-text">{message.content || (busy && message.role === 'assistant' ? <span className="typing-dots"><i/><i/><i/></span> : <span className="muted">{message.status === 'cancelled' ? '已停止回复' : '未收到回复'}</span>)}</div>{message.status === 'error' && <small className="message-error">回复未完成</small>}{message.status === 'cancelled' && message.content && <small className="muted">已停止</small>}{message.role === 'assistant' && message.content && !busy && <button className="copy-message" aria-label="复制回复" onClick={() => navigator.clipboard.writeText(message.content).then(() => setNotice('已复制回复')).catch(() => setNotice('当前环境无法访问剪贴板'))}><Copy size={13}/></button>}</div></div>)}</div>}
            {approvals.map(approval => <div className="approval" key={approval.id}><ShieldCheck size={21}/><div><strong>Codex 请求你的确认</strong><p>{approval.description}</p><div className="button-row"><button className="secondary-button" onClick={() => approve(approval, 'decline')}>拒绝</button><button className="primary-button" onClick={() => approve(approval, 'accept')}>允许本次</button></div></div></div>)}
          </div>
          <div className="composer-area">{error && <div className="error-banner" role="alert"><span>{error}</span><button className="icon-button" aria-label="关闭错误提示" onClick={() => setError('')}><X size={15}/></button></div>}{busy && status && <div className="stream-status"><Loader2 size={12} className="spin"/>{status}</div>}<form className={`composer ${busy ? 'composer-busy' : ''}`} onSubmit={send}><textarea ref={inputRef} aria-label="消息" placeholder={currentMode === 'codex' ? '例如：帮我打开 QQ 音乐' : `和${state.settings.petName}说点什么…`} value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} rows={2} maxLength={20000} disabled={busy}/><div className="composer-bottom"><span className="composer-hint">{currentMode === 'codex' ? <><ShieldCheck size={13}/>{state.codex.mode === 'api' ? '受限工具 · 操作先确认' : '本机配置 · 操作需确认'}</> : <><PawPrint size={14}/>小伴，认真听着呢</>}</span>{busy ? <button className="send-button stop-button" type="button" aria-label="停止生成" onClick={stop}><Square size={16}/></button> : <button className="send-button" aria-label="发送消息" type="submit" disabled={!draft.trim()}><ArrowUp size={21}/></button>}</div></form>{companionKind === 'anime' && <div className="speech-controls">
            <div className="speech-controls-row"><label className="speech-toggle"><input type="checkbox" checked={speech.enabled} disabled={!speech.supported} onChange={e => speech.setEnabled(e.target.checked)}/><span>自动朗读回复</span><small>默认关闭</small></label><button type="button" disabled={busy || !lastReply || !speech.supported || mood === 'sleep'} onClick={() => { performancePhase('idle'); if (lastReply) speech.speak(lastReply.content, `${lastReply.id}-manual-${Date.now()}`); }}>朗读上一条</button>{speech.playing && <button type="button" className="speech-stop" onClick={stopPresentation}><Square size={11}/>停止朗读</button>}</div>
            <p className="speech-feedback" role="status">{speech.error || (mood === 'sleep' ? '小伴正在休息，唤醒后可继续朗读。' : !speech.supported ? '此环境不支持系统朗读，可继续文字聊天。' : !speech.hasChineseVoice ? '未检测到本地中文音色；可在系统中安装中文语音包。' : speech.playing ? (speech.active ? `正在朗读 · ${speech.voiceName}` : '正在准备本地语音…') : '使用本地系统音色；回复完成后分句朗读。')}{speech.playing && speech.progressBasis === 'estimated' && <span>口型按语句进度近似呈现</span>}</p>
          </div>}<p className="composer-footnote">{currentMode === 'codex' ? (state.codex.mode === 'api' ? '真实 Codex CLI · 独立 API 配置与具名工具' : '真实 Codex CLI · 使用主机已有登录与配置') : 'AI 也会有不确定的时候，重要的事情记得核实。'}<span>Enter 发送 · Shift Enter 换行</span></p></div>
        </section>
        <aside className="pet-panel"><div className="pet-panel-heading"><span>你的小伙伴</span><span className="live-tag"><span/>{speech.active ? '朗读中' : responsePerformance.phase === 'speaking' ? '回应中' : busy ? '思考中' : mood === 'sleep' ? '打盹中' : '在你身边'}</span></div><div className="pet-scene"><div className="scene-circle"/><svg className="scene-leaf" viewBox="0 0 90 120" aria-hidden="true"><path d="M42 118V44m0 50C3 85 8 54 42 75m0-9c33-6 40-31 8-28m-8 4C17 32 24 5 42 15" fill="#b7c8a5" stroke="#9bad8a" strokeWidth="2"/><path d="M26 100h34l-5 20H31z" fill="#d9cbb5" stroke="none"/></svg><button className="pet-touch" aria-label="抚摸小伴" onClick={() => interact('happy')}><Cat mood={mood === 'sleep' ? 'sleep' : busy ? 'thinking' : mood} performanceInput={performanceInput}/></button><div className="scene-floor"/></div><div className="pet-name"><h2>{state.settings.petName}</h2><span>{companionKind === 'anime' ? '温柔的二次元伙伴' : '一只喜欢陪着你的小猫'}</span></div><div className="pet-speech">{busy ? '让我想一想，马上就好…' : petSay}</div><div className="pet-actions"><button onClick={() => interact('happy')}><Heart size={18}/><span>摸摸头</span></button><button onClick={() => interact('eat')}><Coffee size={18}/><span>喂零食</span></button><button onClick={() => interact('sleep')}><Moon size={18}/><span>歇一会</span></button></div><a className="motion-preview-link" href="/">回到伙伴身边 <span>↗</span></a><div className="pet-panel-bottom"><div className="quiet-note"><span>✦</span><p>不用每一刻都很有生产力。<br/>有我陪着，发会儿呆也很好。</p></div>{window.petpal ? <button className="desktop-pet-button" onClick={() => window.petpal?.showPet()}><Monitor size={16}/>放到桌面上<span>↗</span></button> : Capacitor.isNativePlatform() ? <button className="desktop-pet-button" onClick={() => setView('settings')}><Monitor size={16}/>开启悬浮伙伴<span>↗</span></button> : <div className="platform-note"><Monitor size={14}/><span>桌面版支持透明悬浮伙伴</span></div>}</div></aside>
      </div>}
    </main>
    {notice && <div className="toast" role="status"><Check size={16}/>{notice}</div>}
    {connectionOpen && <ConnectionDialog close={() => setConnectionOpen(false)}/>}
    {deleting && <div className="modal-backdrop"><section className="modal small-modal" role="dialog" aria-modal="true" aria-labelledby="delete-title"><h2 id="delete-title">删除这段对话？</h2><p>这会删除个人服务中保存的聊天记录，无法恢复。</p><div className="button-row"><button className="secondary-button" onClick={() => setDeleting(null)}>保留</button><button className="danger-button" onClick={() => deleteChat(deleting)}>删除对话</button></div></section></div>}
  </div>;
}

function ConnectionDialog({ close }: { close(): void }) {
  const [form, setForm] = useState<Connection>({url:getConnection().url,token:''});
  const [method,setMethod]=useState<'password'|'token'>('password');
  const [username,setUsername]=useState(''),[password,setPassword]=useState('');
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  async function submit(event:FormEvent){event.preventDefault();setBusy(true);setError('');try{if(method==='password')await login(form.url,username,password);else await connectWithToken(form);}catch(e){if(!isSessionChanged(e))setError((e as Error).message);}finally{setBusy(false);setPassword('');}}
  async function localOwner(){setBusy(true);setError('');try{if(window.petpal)await connectWithToken(await window.petpal.connection());}catch(e){if(!isSessionChanged(e))setError((e as Error).message);}finally{setBusy(false);}}
  return <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="connection-title"><div className="modal-heading"><span className="dialog-icon"><Link2 size={23}/></span><button className="icon-button" aria-label="关闭连接窗口" onClick={close}><X size={20}/></button></div><h2 id="connection-title">登录你的个人服务</h2><p>管理员创建账号并分配模型；每个账号保留自己的聊天和伙伴设置。</p><div className="auth-modes"><button className={method==='password'?'active':''} onClick={()=>setMethod('password')}>账号密码</button><button className={method==='token'?'active':''} onClick={()=>setMethod('token')}>主机配对令牌</button></div><form onSubmit={submit}><label>服务地址<input placeholder="同站点留空，或 https://pet.example.com" value={form.url} onChange={e=>setForm({...form,url:e.target.value})} autoComplete="url" disabled={!!window.petpal}/></label>{method==='password'?<><label>账号名称<input value={username} onChange={e=>setUsername(e.target.value)} autoComplete="username" required maxLength={40}/></label><label>登录密码<input type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="current-password" required maxLength={256}/></label></>:<label>配对令牌<input type="password" value={form.token} onChange={e=>setForm({...form,token:e.target.value})} placeholder="仅供主机管理员使用" required autoComplete="off"/></label>}<p className="field-help">登录凭据只保留在当前会话中。手机连接需要可访问的 HTTPS 服务地址。</p>{error&&<div className="form-error" role="alert">{error}</div>}<button className="primary-button full-button" disabled={busy}>{busy?<Loader2 className="spin" size={17}/>:<Link2 size={17}/>}登录服务</button></form>{window.petpal&&<button className="secondary-button full-button auth-owner" disabled={busy} onClick={localOwner}>使用本机主账号</button>}</section></div>;
}

function SettingsView({ state, connected, refresh, notice, connect, initialTab, hasDraft }: { state: State; connected: boolean; refresh(): Promise<State>; notice(message: string): void; connect(): void; hasDraft:boolean; initialTab: 'models'|'pet'|'desktop'|'accounts'|'voice'|'assistant'|'updates' }) {
  const [tab, setTab] = useState(initialTab);
  useEffect(()=>setTab(initialTab),[initialTab]);
  const [defaultProviderId,setDefaultProviderId]=useState(state.settings.defaultProviderId || '');
  useEffect(()=>setDefaultProviderId(state.settings.defaultProviderId || ''),[state.settings.defaultProviderId]);
  async function saveDefault(){setBusy(true);setError('');try{await api('/settings',{method:'PATCH',body:JSON.stringify({defaultProviderId:defaultProviderId || null})});await refresh();notice('默认模型已保存，新对话将使用该模型。');}catch(e){if(!isSessionChanged(e))setError((e as Error).message);}finally{setBusy(false);}}
  const [editing, setEditing] = useState<Partial<Provider> & { apiKey?: string } | null>(null);
  const [petName, setPetName] = useState(state.settings.petName);
  const [persona, setPersona] = useState(state.settings.persona);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [testing, setTesting] = useState('');
  const [removeId, setRemoveId] = useState<string | null>(null); const [overlayRunning, setOverlayRunning] = useState(false);
  async function saveProvider(e: FormEvent) { e.preventDefault(); if (!editing) return; setBusy(true); setError(''); try { await api('/providers', { method: 'POST', body: JSON.stringify(editing) }); await refresh(); setEditing(null); notice('模型连接已保存'); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  async function testProvider(p: Provider) { setTesting(p.id); setError(''); try { const result = await api<{ ok: boolean; message: string }>(`/providers/${encodeURIComponent(p.id)}/test`, { method: 'POST' }); if (!result.ok) throw new Error(result.message); notice(result.message || '连接测试成功'); } catch (e) { setError((e as Error).message); } finally { setTesting(''); } }
  async function deleteProvider() { if (!removeId) return; setError(''); try { await api(`/providers/${encodeURIComponent(removeId)}`, { method: 'DELETE' }); await refresh(); setRemoveId(null); notice('连接已删除'); } catch (e) { setError((e as Error).message); setRemoveId(null); } }
  async function savePet(e: FormEvent) { e.preventDefault(); setBusy(true); setError(''); try { await api('/settings', { method: 'PATCH', body: JSON.stringify({ petName, persona }) }); await refresh(); notice('小伴的设置已保存'); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  async function overlay() { setError(''); try { const result = await Overlay.status(); if (!result.permission) { await Overlay.requestPermission(); notice('请允许悬浮窗权限，返回后再次点击开启。'); } else if (result.running) { await Overlay.stop(); setOverlayRunning(false); notice('悬浮伙伴已收起'); } else { await showPet({ companionKind: readCompanion() }); setOverlayRunning(true); notice('悬浮伙伴已开启'); } } catch (e) { setError((e as Error).message); } }
  return <div className="settings-page"><div className="settings-heading"><span className="eyebrow">MAKE IT YOURS</span><h1>让小伴，更懂你。</h1><p>连接你喜欢的模型，设定属于你们的相处方式。</p></div><div className="settings-tabs" role="tablist"><button role="tab" aria-selected={tab === 'models'} className={tab === 'models' ? 'active' : ''} onClick={() => setTab('models')}><Plug size={17}/>模型连接</button><button role="tab" aria-selected={tab === 'pet'} className={tab === 'pet' ? 'active' : ''} onClick={() => setTab('pet')}><PawPrint size={17}/>小伴个性</button><button role="tab" aria-selected={tab === 'desktop'} className={tab === 'desktop' ? 'active' : ''} onClick={() => setTab('desktop')}><Monitor size={17}/>设备连接</button>{state.user?.isOwner && <button role="tab" aria-selected={tab === 'assistant'} className={tab === 'assistant' ? 'active' : ''} onClick={() => setTab('assistant')}><Terminal size={17}/>电脑助手</button>}<button role="tab" aria-selected={tab === 'voice'} className={tab === 'voice' ? 'active' : ''} onClick={()=>setTab('voice')}>语音与设备</button><button role="tab" aria-selected={tab === 'accounts'} className={tab === 'accounts' ? 'active' : ''} onClick={()=>setTab('accounts')}>账号</button><button role="tab" aria-selected={tab === 'updates'} className={tab === 'updates' ? 'active' : ''} onClick={()=>setTab('updates')}>软件更新</button></div>{error && <div className="error-banner" role="alert"><span>{error}</span><button className="icon-button" aria-label="关闭设置错误" onClick={() => setError('')}><X size={15}/></button></div>}{!connected && <div className="setup-notice"><Unplug size={19}/><span>先连接个人服务，才能保存设置。</span><button className="secondary-button" onClick={connect}>连接服务</button></div>}
    {tab === 'updates' && <UpdatesSettings connected={connected} user={state.user} hasDraft={hasDraft}/>}
    {tab === 'assistant' && state.user?.isOwner && <DesktopAssistantSettings connected={connected} user={state.user} onConfigSaved={refresh}/>}
    {tab === 'voice' && <VoiceSettings connected={connected} scope={state.instanceId && state.user ? `${state.instanceId}:${state.user.id}` : `guest:${getConnection().url || location.origin}`}/>}
    {tab === 'accounts' && <AccountsSettings connected={connected} user={state.user} providers={state.providers} connect={connect}/>}
    {tab === 'models' && <div className="settings-section"><div className="section-title"><div><h2>我的模型</h2><p>支持 OpenAI 及兼容接口，API Key 仅由后端保存。</p></div>{state.user?.isOwner && <button className="primary-button" disabled={!connected} onClick={() => { setEditing({ name: '', protocol: 'responses', baseUrl: 'https://api.openai.com/v1', model: '', apiKey: '' }); setError(''); }}><Plus size={16}/>添加连接</button>}</div><div className="default-model-setting"><label>新对话默认模型<select aria-label="默认模型" value={defaultProviderId} disabled={!connected || busy} onChange={e=>setDefaultProviderId(e.target.value)}><option value="">使用第一个可用模型</option>{state.providers.map(p=><option value={p.id} key={p.id}>{p.name} · {p.model}</option>)}</select></label><button className="secondary-button" disabled={!connected || busy} onClick={saveDefault}>保存默认模型</button></div>{!state.providers.length ? <div className="empty-models"><span><Plug size={29}/></span><h3>给小伴连接一个大脑</h3><p>{state.user?.isOwner ? '准备服务地址、模型名称和 API Key，就可以开始对话。' : '请联系主机管理员为这个账号分配模型。'}</p><div className="protocol-labels"><code>Chat Completions</code><code>Responses</code></div></div> : <div className="provider-list">{state.providers.map(p => <div className="provider-row" key={p.id}><span className="provider-icon"><Plug size={19}/></span><div className="provider-details"><strong>{p.name}</strong><span>{p.model} <i>·</i> {p.protocol === 'responses' ? 'Responses' : 'Chat Completions'}</span><small title={p.baseUrl}>{p.baseUrl}</small></div><div className="provider-actions"><button className="secondary-button" disabled={!!testing || p.testable === false} onClick={() => testProvider(p)}>{testing === p.id ? <Loader2 size={14} className="spin"/> : <Link2 size={14}/>}测试</button>{p.editable && <><button className="icon-button" aria-label={`编辑 ${p.name}`} onClick={() => { setEditing({ ...p, apiKey: '' }); setError(''); }}><Pencil size={16}/></button><button className="icon-button" aria-label={`删除 ${p.name}`} onClick={() => setRemoveId(p.id)}><Trash2 size={16}/></button></>}</div></div>)}</div>}<div className="info-note"><ShieldCheck size={18}/><p>小伴不会把 API Key 发给聊天页面。连接测试会发出一条简短请求，可能产生少量模型费用。</p></div></div>}
    {tab === 'pet' && <form className="settings-section pet-settings" onSubmit={savePet}><div className="pet-settings-preview"><Cat/><span>独一无二的小伙伴</span></div><div className="pet-settings-form"><h2>认识你的小伴</h2><label>小猫的名字<input value={petName} maxLength={30} required onChange={e => setPetName(e.target.value)}/></label><label>性格与相处方式<textarea rows={7} value={persona} maxLength={4000} onChange={e => setPersona(e.target.value)}/></label><p className="field-help">作为陪伴聊天的系统提示词使用，下一条消息生效。</p><button className="primary-button" disabled={busy || !connected}><Check size={16}/>保存个性</button></div></form>}
    {tab === 'desktop' && <div className="settings-section">
      <div className="section-title"><div><h2>你的设备</h2><p>桌面应用运行本地服务，Web 与 Android 可远程连接。</p></div><span className="device-badge">{window.petpal ? '桌面应用' : Capacitor.isNativePlatform() ? 'Android' : 'Web 浏览器'}</span></div>
      <div className="device-row"><div><h3>桌面上的小猫</h3><p>{window.petpal ? '透明、置顶的小窗，拖动顶部即可移动，双击小猫返回聊天。' : Capacitor.isNativePlatform() ? '授权悬浮窗权限后，让小猫陪在其他应用旁。' : '使用 Windows 或 Ubuntu 桌面版，即可开启透明悬浮窗。'}</p></div>{window.petpal && <button className="secondary-button" onClick={() => window.petpal?.showPet()}>显示桌宠</button>}{Capacitor.isNativePlatform() && <button className="secondary-button" onClick={overlay}>{overlayRunning ? '收起悬浮伙伴' : '开启悬浮伙伴'}</button>}</div>
      {state.user?.isOwner && <div className="device-row"><div><h3>Codex 与音乐控制</h3><p>在电脑助手中配置 Responses API、检测播放器，并连接 OpenCLI 浏览器工具。</p></div><button className="secondary-button" onClick={()=>setTab('assistant')}><Terminal size={15}/>电脑助手设置</button></div>}
      <div className="about-app"><PawPrint size={20}/><strong>小伴 PetPal</strong><span>0.5.0 · Web / Windows / Ubuntu · Android 延续 0.4</span></div>
    </div>}
    {editing && <div className="modal-backdrop"><section className="modal provider-modal" role="dialog" aria-modal="true" aria-labelledby="provider-title"><div className="modal-heading"><h2 id="provider-title">{editing.id ? '编辑模型连接' : '添加模型连接'}</h2><button className="icon-button" aria-label="关闭模型窗口" onClick={() => setEditing(null)}><X size={20}/></button></div><form onSubmit={saveProvider}><label>连接名称<input autoFocus required maxLength={80} placeholder="例如：我的 OpenAI" value={editing.name || ''} onChange={e => setEditing({ ...editing, name: e.target.value })}/></label><label>接口协议<select value={editing.protocol} onChange={e => setEditing({ ...editing, protocol: e.target.value as Provider['protocol'] })}><option value="responses">Responses</option><option value="chat-completions">Chat Completions</option></select></label><label>API 地址<input required type="url" placeholder="https://api.openai.com/v1" value={editing.baseUrl || ''} onChange={e => setEditing({ ...editing, baseUrl: e.target.value })}/></label><label>模型名称<input required placeholder="填写服务商提供的模型 ID" value={editing.model || ''} onChange={e => setEditing({ ...editing, model: e.target.value })}/></label><label>API Key<input type="password" autoComplete="off" placeholder={editing.hasApiKey ? '已保存，留空则保留' : '输入密钥；无需认证的本地模型可留空'} value={editing.apiKey || ''} onChange={e => setEditing({ ...editing, apiKey: e.target.value })}/></label><p className="field-help">{editing.protocol === 'responses' ? '将请求 /responses，支持文本增量流。' : '将请求 /chat/completions，兼容本地与第三方模型。'}</p>{error && <div className="form-error" role="alert">{error}</div>}<button className="primary-button full-button" disabled={busy}>{busy ? <Loader2 className="spin" size={16}/> : <Check size={16}/>}保存连接</button></form></section></div>}
    {removeId && <div className="modal-backdrop"><section className="modal small-modal" role="dialog" aria-modal="true" aria-labelledby="remove-provider-title"><h2 id="remove-provider-title">删除这个模型连接？</h2><p>依赖此连接的对话将无法继续发送消息。</p><div className="button-row"><button className="secondary-button" onClick={() => setRemoveId(null)}>取消</button><button className="danger-button" onClick={deleteProvider}>删除连接</button></div></section></div>}
  </div>;
}
