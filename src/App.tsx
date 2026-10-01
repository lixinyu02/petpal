import DownloadsView from './DownloadsView';
import BrandMark from './BrandMark';
import CompanionOptions from './CompanionOptions';
import ChatMessages from './ChatMessages';
import ConversationHistory from './ConversationHistory';
import {watchCompanionBreakpoint} from './companion-mount.mjs';
import {createChatDisplay,type ChatDisplay} from './chat-display.mjs';
import {useChatScroll} from './useChatScroll';
import { ModelPicker, ExecutionTarget, AgentOnboarding } from './WorkspaceControls';
import AgentPermissions, { defaultAgentPermissions } from './AgentPermissions';
import AgentQueue from './AgentQueue';
import ProjectDirectory, {useProjectDirectory} from './ProjectDirectory';
import {executionProjectDirectory,projectDirectoryIssue} from './project-directory-preferences.mjs';
import {ChatAssistantControls,ChatAssistantTasks,useChatAssistant} from './ChatAssistant';
import {mergeAssistantTask,mergeChatAssistantConversation} from './chat-assistant-preferences.mjs';
import { executionHostLock, readExecutionHost, resolveExecutionHostId, saveExecutionHost } from './execution-hosts.mjs';
import { useAttachments, AttachmentInput, AttachmentDrafts, MessageImages } from './Attachments';
import './workspace.css';
import { ConnectionDialog } from './auth/LoginGate';
import UpdatesSettings from './UpdatesSettings';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { ArrowDown, ArrowRight, ArrowUp, ArrowUpRight, AudioLines, Download, ListOrdered, CornerDownRight, Check, ChevronDown, CircleHelp, Code2, Coffee, Globe2, History, Link2, Loader2, Menu, MessageCircle, Monitor, MoreHorizontal, PawPrint, Pencil, Plug, Plus, RefreshCw, Settings2, ShieldCheck, Sparkles, Square, Sun, Terminal, Trash2, Unplug, UserRound, Volume2, X } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { PetOverlay as Overlay, showPet } from './platform/overlay';
import { useCompanion, hydrateCompanion, readCompanion } from './avatar/preference';
import Cat from './CatV2';
import type { PetBehaviorState, PetInteraction } from './pet/behavior';
import './natural-companion.css';
import './companion-mobile.css';
import { useSpeech } from './avatar/useSpeech';
import type { PerformanceInput, PerformancePhase } from './avatar/performance.mjs';
import './avatar/speech.css';
import WorkspaceDisclosure from './WorkspaceDisclosure';
import './workspace-density.css';
import './workspace-room.css';
import './workspace-smoothness.css';
import './workspace-polish.css';
import AccountsSettings from './AccountsSettings';
import VoiceSettings from './VoiceSettings';
import DesktopAssistantSettings from './DesktopAssistantSettings';
import MusicMcpSettings from './MusicMcpSettings';
import ComputerUseSettings from './ComputerUseSettings';
import OpenCliSettings from './OpenCliSettings';
import {nativeComputerUse} from './platform/computer-use';
import { nativeMusicMcp } from './platform/music-mcp';
import { taskNotificationSession } from './platform/task-notification-session';
import { reasoningEfforts } from './desktop-settings.mjs';
import { api, getConnection, getIdentity, getSessionEpoch, initConnection, connectWithToken, login, isSessionChanged, SessionChangedError, streamMessage, type AgentHost, type AgentPermissions as Permissions, type AgentSubmission, type Connection, type Conversation, type Message, type NativeExecutorStatus, type Provider, type ReasoningEffort, type State } from './api';

const emptyState: State = { settings: { petName: '小伴', companionKind: 'anime', persona: '你是用户温柔、机灵的个人 AI 伙伴。用自然简洁的中文回应，认真倾听；不知道的事情坦诚说明。' }, providers: [], conversations: [], codex: {} };
type Approval = { id: string; kind: string; description: string };
const dateFormatter=new Intl.DateTimeFormat('zh-CN',{month:'long',day:'numeric'});

export default function App() {
  const accountEpoch = useRef(getSessionEpoch()).current;
  const taskNotifications=useSyncExternalStore(taskNotificationSession.subscribe,taskNotificationSession.snapshot,taskNotificationSession.snapshot);
  const [companionKind] = useCompanion();
  const [state, setState] = useState<State>(emptyState);
  const [ready, setReady] = useState(false);
  const [connected, setConnected] = useState(false);
  const [view, setView] = useState<'chat' | 'settings' | 'downloads'>(new URLSearchParams(location.search).has('downloads') ? 'downloads' : new URLSearchParams(location.search).has('settings') ? 'settings' : 'chat');
  const [settingsTab, setSettingsTab] = useState<'models'|'pet'|'desktop'|'accounts'|'voice'|'assistant'|'updates'>('models');
  const [mode, setMode] = useState<'chat' | 'codex'>(new URLSearchParams(location.search).get('mode') === 'codex' ? 'codex' : 'chat');
  const [selected, setSelected] = useState<string | null>(()=>new URLSearchParams(location.search).get('conversation'));
  const [providerId, setProviderId] = useState('');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [agentProviderId,setAgentProviderId]=useState('');
  const [agentHosts,setAgentHosts]=useState<AgentHost[]>([]);
  const [agentHostId,setAgentHostId]=useState('');
  const [defaultHostId,setDefaultHostId]=useState('');
  const [hostsLoading,setHostsLoading]=useState(false);
  const [hostsError,setHostsError]=useState('');
  const [hostRefresh,setHostRefresh]=useState(0);
  const [nativeExecutor,setNativeExecutor]=useState<NativeExecutorStatus|null>(null);
  const [permissions,setPermissions]=useState<Permissions>({...defaultAgentPermissions});
  const [agentSubmitting,setAgentSubmitting]=useState(false);
  const [sendChoice,setSendChoice]=useState<'steer'|'submit'>('steer');
  const agentSendLock=useRef(false);
  const agentSubmissionRef=useRef<{id:string;conversationId:string;kind:'submit'|'steer';payload:{content:string;attachmentIds:string[];permissions:Permissions;providerId:string|null;hostId:string;projectDirectory?:string;expectedTurnId?:string|null}}|null>(null);
  const [unconfirmed,setUnconfirmed]=useState(false);
  const draftRef=useRef(draft);draftRef.current=draft;
  const attachments=useAttachments();
  const attachmentsRef=useRef(attachments);attachmentsRef.current=attachments;
  const [switchingModel, setSwitchingModel] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [mood, setMood] = useState('idle');
  const [petSay, setPetSay] = useState('我在这里，听你说。');
  const [mobileNav, setMobileNav] = useState(false);
  const [companionPanelOpen, setCompanionPanelOpen] = useState(() => window.matchMedia('(min-width: 1400px)').matches);
  const [companionPanelMounted,setCompanionPanelMounted]=useState(()=>companionPanelOpen||window.matchMedia('(max-width: 960px)').matches);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [responsePerformance, setResponsePerformance] = useState<PerformanceInput>({ utteranceId: '', text: '', phase: 'idle' });
  const voiceScope = state.instanceId && state.user ? `${state.instanceId}:${state.user.id}` : `guest:${getConnection().url || location.origin}`;
  const speech = useSpeech(view === 'chat' && !connectionOpen && mood !== 'sleep', voiceScope);
  const speechRef=useRef(speech);speechRef.current=speech;
  const awakeRef = useRef(mood !== 'sleep');
  awakeRef.current = mood !== 'sleep';
  const abortRef = useRef<AbortController | null>(null);
  const displayRef=useRef<ChatDisplay|null>(null);
  const busyRef = useRef(false);
  const switchingModelRef = useRef(false);
  const activeRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const responseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSequence = useRef(0);
  const petOnly = new URLSearchParams(location.search).get('pet') === '1';
  const conversation = useMemo(()=>state.conversations.find(c => c.id === selected),[state.conversations,selected]);
  const historyConversations = useMemo(()=>state.conversations.filter(c => !c.backgroundParentId),[state.conversations]);
  const provider = state.providers.find(p => p.id === (conversation?.providerId || providerId));
  const currentMode = conversation?.mode || mode;
  const agentRunning = currentMode==='codex' && (conversation?.agent?.run?.status==='running'||conversation?.agent?.run?.status==='stopping');
  const agentUnknown = currentMode==='codex' && conversation?.agent?.run?.status==='unknown';
  const working = busy || agentRunning;
  const agentProviders=useMemo(()=>state.providers.filter(item=>state.codex.eligibleProviderIds?.includes(item.id)),[state.providers,state.codex.eligibleProviderIds]);
  const activePermissions=agentRunning?conversation!.agent!.run!.permissions:permissions;
  const activeProviderId=agentRunning?conversation!.agent!.run!.providerId||'':agentProviderId;
  const hostScope=state.instanceId&&state.user?`${state.instanceId}:${state.user.id}`:'';
  const chatAssistant=useChatAssistant({scope:hostScope,allowed:connected&&!!state.user?.canUseCodex,hostState:{hosts:agentHosts,loading:hostsLoading,error:hostsError,refresh:()=>setHostRefresh(value=>value+1)}});
  const localHostId=nativeExecutor?.state==='online'?nativeExecutor.hostId||'':'';
  const lockedHostId=executionHostLock(conversation?.agent,agentSubmissionRef.current);
  const selectedHostId=resolveExecutionHostId({requestedId:agentHostId,lockedId:lockedHostId,localHostId,defaultHostId});
  const selectedHost=agentHosts.find(host=>host.id===selectedHostId);
  const hostBusy=agentRunning||agentUnknown||!!conversation?.agent?.queue.length;
  const conversationProjectHostId=conversation?.agentHostId||conversation?.threadHostId||'central';
  const projectDirectory=useProjectDirectory({scope:hostScope,hostId:selectedHostId,conversationId:conversation?.mode==='codex'?conversation.id:'',conversationValue:conversation?.mode==='codex'&&conversationProjectHostId===selectedHostId&&(conversation.messages.length||conversation.agent?.run||conversation.threadHostId)?(conversation.agentProjectDirectory??conversation.threadProjectDirectory??''):undefined});
  const activeProjectDirectory=executionProjectDirectory(conversation?.agent,agentSubmissionRef.current)??projectDirectory.value;
  const projectIssue=projectDirectoryIssue(activeProjectDirectory,selectedHost);
  const selectedCodex=useMemo(()=>selectedHost?.kind==='desktop'?{...state.codex,...selectedHost.codex}:state.codex,[state.codex,selectedHost?.kind,selectedHost?.codex]);
  const activeAgentProvider=state.providers.find(item=>item.id===activeProviderId);
  const agentSupportsImages=activeAgentProvider?.supportsImages!==false;
  const canSendAgent=!!selectedHost?.online&&!!selectedCodex.available&&!hostsError&&!agentUnknown&&!projectIssue;
  const shownApprovals=currentMode==='codex'?conversation?.agent?.approvals||[]:approvals;
  const chatScroll=useChatScroll({scrollRef,conversationId:conversation?.id||'',active:ready&&view==='chat'&&!petOnly,messages:conversation?.messages,approvalKey:shownApprovals.map(item=>item.id).join(',')});
  const lastReply = useMemo(()=>{
    const messages=conversation?.messages;if(!messages)return;
    for(let index=messages.length-1;index>=0;index--){const message=messages[index];if(message.role==='assistant'&&message.status==='complete'&&message.content.trim())return message;}
  },[conversation?.messages]);
  const todayKey=new Date().toDateString();
  const todayLabel=useMemo(()=>dateFormatter.format(new Date()),[todayKey]);
  const performanceInput: PerformanceInput = mood === 'sleep' ? { utteranceId: 'sleep', text: '', phase: 'idle' } : speech.playing
    ? { utteranceId: speech.utteranceId, text: speech.text, phase: 'speaking', speech: { active: speech.active, charIndex: speech.charIndex, ended: speech.ended, audioLevel:speech.audioLevel, emotion:speech.emotion } }
    : { ...responsePerformance, ...(speech.enabled ? { speech: { active: false, charIndex: 0, ended: true } } : {}) };

  const updateChatTasks=useCallback((updated:Conversation)=>{
    setState(previous=>({...previous,conversations:previous.conversations.map(before=>{
      if(before.id!==updated.id)return before;
      return mergeChatAssistantConversation(before,updated,activeRef.current,busyRef.current);
    })}));
  },[]);

  const performancePhase=useCallback((phase: PerformancePhase, text = '', utteranceId = '') => {
    if (responseTimer.current) clearTimeout(responseTimer.current);
    responseTimer.current = null;
    setResponsePerformance({ utteranceId, text, phase: document.hidden || !awakeRef.current ? 'idle' : phase });
  },[]);
  const stopPresentation=useCallback(()=>{speech.stop();performancePhase('idle');},[speech.stop,performancePhase]);
  const readReply=useCallback((message:Message)=>{
    performancePhase('idle');
    speech.speak(message.content, `${message.id}-manual-${Date.now()}`);
  },[performancePhase,speech.speak]);
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
      if (alive && getSessionEpoch() === accountEpoch) { setState(next); await hydrateCompanion(next.settings.companionKind || 'anime').catch(() => {}); setProviderId(next.settings.defaultProviderId || next.providers[0]?.id || ''); setConnected(true); if(!next.user?.canUseCodex)setMode('chat'); if(!next.user?.isOwner)setAgentProviderId(next.codex.eligibleProviderIds?.[0]||'');
        const linked=next.conversations.find(item=>item.id===new URLSearchParams(location.search).get('conversation'));
        if(linked&&(linked.mode!=='codex'||next.user?.canUseCodex)){setSelected(linked.id);setMode(linked.mode);if(linked.mode==='codex'){setAgentHostId(linked.agent?.run?.hostId||linked.agentHostId||linked.threadHostId||'central');setAgentProviderId(linked.agent?.run?.providerId||(next.user?.isOwner?'':next.codex.eligibleProviderIds?.[0]||''));setPermissions(linked.agent?.run?.permissions||{...defaultAgentPermissions});}}
        else setSelected(null);
      }
    }).catch(e => { if (alive) setError(e.message); }).finally(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, []);
  useEffect(()=>{
    setAgentHostId(conversation?.mode==='codex'?(conversation.agent?.run?.hostId||conversation.agentHostId||conversation.threadHostId||'central'):readExecutionHost(localStorage,hostScope));
    setAgentHosts([]);setDefaultHostId('');setNativeExecutor(null);setHostsError('');
  },[hostScope]);
  useEffect(()=>{
    // Once a default has been presented, retain it if that computer disconnects.
    if(!agentHostId&&!lockedHostId&&selectedHostId&&agentHosts.some(host=>host.id===selectedHostId))setAgentHostId(selectedHostId);
  },[agentHostId,lockedHostId,selectedHostId,agentHosts]);
  useEffect(()=>{
    if(!connected||!state.user?.canUseCodex||!hostScope||petOnly)return;
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined,nativePending=false;
    const poll=async()=>{
      setHostsLoading(true);
      try{
        if(window.petpal?.executor&&!nativePending){
          nativePending=true;
          void window.petpal.executor.status().then(native=>{
            if(!controller.signal.aborted&&getSessionEpoch()===accountEpoch)setNativeExecutor(native);
          }).catch(()=>{}).finally(()=>{nativePending=false;});
        }
        const result=await api<{hosts:AgentHost[]}>('/agent/hosts',{signal:controller.signal});
        if(controller.signal.aborted||getSessionEpoch()!==accountEpoch)return;
        setAgentHosts(result.hosts);
        setDefaultHostId(result.hosts.find(host=>host.kind==='central')?.id||'');
        setHostsError('');
      }catch(error){if(!controller.signal.aborted&&!isSessionChanged(error))setHostsError((error as Error).message||'暂时无法刷新执行电脑。');}
      finally{if(!controller.signal.aborted&&getSessionEpoch()===accountEpoch){setHostsLoading(false);timer=setTimeout(()=>void poll(),currentMode==='codex'?5000:15000);}}
    };
    void poll();return()=>{controller.abort();if(timer)clearTimeout(timer);};
  },[connected,state.user?.canUseCodex,hostScope,hostRefresh,currentMode]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 3800); return () => clearTimeout(timer); }, [notice]);
  useEffect(()=>{
    const target=taskNotifications.navigation,identity=getIdentity();
    if(!ready||!target||target.epoch!==accountEpoch||getSessionEpoch()!==accountEpoch||target.instanceId!==identity?.instanceId||target.userId!==identity?.userId)return;
    if(busy||agentRunning||agentSubmitting||unconfirmed||switchingModel){setNotice('收到任务结果，当前回复结束后打开。');return;}
    taskNotificationSession.takeNavigation();
    setState({...target.state,conversations:target.state.conversations.map(item=>item.id===target.conversation.id?target.conversation:item)});
    historySelection.current.select(target.conversation);setView('chat');setMobileNav(false);setNotice('已打开任务结果。');
  },[taskNotifications.navigation,accountEpoch,ready,busy,agentRunning,agentSubmitting,unconfirmed,switchingModel]);
  useEffect(()=>{if(companionPanelOpen)setCompanionPanelMounted(true);},[companionPanelOpen]);
  useEffect(()=>watchCompanionBreakpoint(window.matchMedia('(max-width: 960px)'),()=>setCompanionPanelMounted(true)),[]);
  useEffect(() => {
    const hidden = () => { if (document.hidden) { if (responseTimer.current) clearTimeout(responseTimer.current); setResponsePerformance(previous => ({ ...previous, phase: 'idle' })); } };
    document.addEventListener('visibilitychange', hidden);
    return () => { requestSequence.current++; displayRef.current?.close(); abortRef.current?.abort(); if (responseTimer.current) clearTimeout(responseTimer.current); document.removeEventListener('visibilitychange', hidden); };
  }, []);
  useEffect(() => { if (view !== 'chat' || companionKind !== 'anime' || connectionOpen) { if (responseTimer.current) clearTimeout(responseTimer.current); setResponsePerformance({ utteranceId: '', text: '', phase: 'idle' }); } }, [view, companionKind, connectionOpen]);

  function companionState(next: PetBehaviorState) {
    awakeRef.current = next.action !== 'sleep';
    setMood(next.action);
    const replies = { idle: '我在这里，听你说。', walk: '走两步，再回来陪你。', pet: companionKind === 'anime' ? '嗯，这样就很安心。' : '呼噜…喜欢这样。', eat: '谢谢你的点心。', jump: '嗨，我看到你啦。', sleep: '陪你安静一会儿。' };
    setPetSay(replies[next.action]);
  }
  function companionInteract(next: PetInteraction) {
    if (next === 'sleep') { awakeRef.current = false; stopPresentation(); }
  }
  function newChat(nextMode = mode) {
    if (switchingModelRef.current) { setNotice('正在切换模型，请稍候。'); return; }
    if (busyRef.current||agentRunning||agentSendLock.current||unconfirmed) { setNotice('先停止当前回复，再开启新对话。'); return; }
    stopPresentation();
    attachments.clear();setPermissions({...defaultAgentPermissions});setAgentProviderId(state.user?.isOwner?'':state.codex.eligibleProviderIds?.[0]||'');agentSubmissionRef.current=null;
    setSelected(null); setMode(nextMode === 'codex' && !state.user?.canUseCodex ? 'chat' : nextMode); setProviderId(state.settings.defaultProviderId || state.providers[0]?.id || ''); setView('chat'); setDraft(''); setError(''); setMobileNav(false); setApprovals([]);
  }
  function selectChat(c: Conversation) {
    if(c.id===selected){setView('chat');setMobileNav(false);return;}
    if (switchingModelRef.current) { setNotice('正在切换模型，请稍候。'); return; }
    if (busyRef.current||agentRunning||agentSendLock.current||unconfirmed) { setNotice('当前对话正在回复，请完成或停止后切换。'); return; }
    stopPresentation();
    attachments.clear();setDraft('');agentSubmissionRef.current=null;setAgentProviderId(c.agent?.run?.providerId || (state.user?.isOwner?'':state.codex.eligibleProviderIds?.[0]||''));setPermissions(c.agent?.run?.permissions||{...defaultAgentPermissions});
    if(c.mode==='codex')setAgentHostId(c.agent?.run?.hostId||c.agentHostId||c.threadHostId||'central');
    setSelected(c.id); setMode(c.mode); setView('chat'); setError(''); setMobileNav(false); setApprovals([]);
  }
  // Memoized navigation always selects the current conversation and observes
  // current busy/submission guards, without subscribing to every voice tick.
  const historySelection=useRef({conversations:state.conversations,select:selectChat});
  historySelection.current={conversations:state.conversations,select:selectChat};
  const selectHistory=useCallback((id:string)=>{const current=historySelection.current;const item=current.conversations.find(c=>c.id===id);if(item)current.select(item);},[]);
  const deleteHistory=useCallback((id:string)=>setDeleting(id),[]);
  function openMode(next:'chat'|'codex') {
    if(next===currentMode){setView('chat');setMobileNav(false);return;}
    newChat(next);
  }
  async function send(event?: FormEvent) {
    event?.preventDefault();
    if(currentMode==='codex'){await sendAgent();return;}
    const content = draft.trim(),images=[...attachments.items];
    if ((!content&&!images.length) || attachments.uploading || busyRef.current || switchingModelRef.current) return;
    if (!connected) { setConnectionOpen(true); return; }

    if (currentMode === 'chat' && !provider) { setView('settings'); setNotice('添加一个模型连接，就可以开始聊天了。'); return; }
    if(images.length&&provider?.supportsImages===false){setError('这个模型仅支持文字，请移除图片或切换模型。');return;}
    let assistantSnapshot;
    try{assistantSnapshot=chatAssistant.snapshot();}catch(cause){setError((cause as Error).message);return;}
    const assistantRequest=assistantSnapshot?{assistant:assistantSnapshot,submissionId:crypto.randomUUID()}:undefined;
    chatScroll.latest();
    stopPresentation();
    busyRef.current = true; setBusy(true); setError(''); setApprovals([]); setStatus('正在想怎么回答你…');
    speech.prepare();
    const controller = new AbortController(); abortRef.current = controller;
    const requestId = ++requestSequence.current;
    let target = conversation;
    let assistantId = `pending-${Date.now()}`;
    let accepted = false;
    let responseText = '', finalReply: Message | undefined;
    let failed = false, display:ChatDisplay|undefined;
    performancePhase('thinking', '', assistantId);
    try {
      if (!target) {
        target = await api<Conversation>('/conversations', { method: 'POST', body: JSON.stringify({ mode: currentMode, ...(currentMode === 'chat' ? { providerId: provider!.id } : {}) }) });
        setSelected(target.id); setState(s => ({ ...s, conversations: [target!, ...s.conversations] }));
      }
      controller.signal.throwIfAborted();
      activeRef.current = target.id;
      const pending: Message[] = [...target.messages, { id: `user-${Date.now()}`, role: 'user', content,attachments:images }, { id: assistantId, role: 'assistant', content: '', status: 'streaming' }];
      setState(s => ({ ...s, conversations: s.conversations.map(c => c.id === target!.id ? { ...c, title: c.messages.length ? c.title : content.slice(0, 32), messages: pending } : c) }));
      setDraft('');
      display=createChatDisplay({isCurrent:()=>!controller.signal.aborted&&requestSequence.current===requestId&&getSessionEpoch()===accountEpoch,onText:delta=>{
        setStatus('');
        performancePhase('speaking',responseText,assistantId);
        responseTimer.current=setTimeout(()=>{if(!controller.signal.aborted&&requestSequence.current===requestId&&getSessionEpoch()===accountEpoch)performancePhase('thinking',responseText,assistantId);},650);
        setState(s=>({...s,conversations:s.conversations.map(c=>c.id===target!.id?{...c,messages:c.messages.map(m=>m.id===assistantId?{...m,content:m.content+delta}:m)}:c)}));
      }});
      displayRef.current=display;
      await streamMessage(target.id, content, controller.signal, event => {
        if (controller.signal.aborted || requestSequence.current !== requestId || getSessionEpoch() !== accountEpoch) return;
        if(event.type!=='delta')display?.flush();
        if(event.type==='done'||event.type==='error')display?.close();
        if (event.type === 'meta') {accepted = true;attachments.clear();}
        if (event.type === 'delta') {
          accepted = true;
          const delta = typeof event.data.text === 'string' ? event.data.text : '';
          if(delta){responseText+=delta;display?.push(delta);}
        }
        if (event.type === 'status') { performancePhase('thinking', responseText, assistantId); setStatus(event.data.message || event.data.text || event.data.status || '正在处理中…'); }
        if (event.type === 'task') { setState(s=>({...s,conversations:s.conversations.map(c=>c.id===target!.id?{...c,assistantTasks:mergeAssistantTask(c.assistantTasks||[],event.data.task)}:c)})); }
        if (event.type === 'approval') { performancePhase('thinking', responseText, assistantId); setApprovals(a => [...a.filter(item => item.id !== String(event.data.id)), { id: String(event.data.id), kind: event.data.kind || '操作请求', description: event.data.description || 'Codex 请求执行操作，请检查后决定。' }]); }
        if (event.type === 'error') { failed = true; performancePhase('error', responseText, assistantId); if (event.data.conversation?.messages?.at(-1)?.status !== 'cancelled') setError(event.data.message || '回复失败，请检查连接后重试。'); if (event.data.conversation) setState(s => ({ ...s, conversations: s.conversations.map(c => c.id === target!.id ? event.data.conversation : c) })); }
        if (event.type === 'done') {
          if (event.data.conversation) {
            finalReply = event.data.conversation.messages?.at(-1);
            setState(s => ({ ...s, conversations: s.conversations.map(c => c.id === target!.id ? event.data.conversation : c) }));
          }
          if (!failed) finishResponse(responseText || finalReply?.content || '', assistantId, requestId);
        }
      },images.map(item=>item.id),assistantRequest);
    } catch (e) {
      if (getSessionEpoch() !== accountEpoch || isSessionChanged(e)) return;
      display?.flush();
      failed = true;
      performancePhase((e as Error).name === 'AbortError' ? 'idle' : 'error', responseText, assistantId);
      if ((e as Error).name !== 'AbortError') { setError((e as Error).message); if (!accepted) setDraft(content); }
    } finally {
      display?.close();if(displayRef.current===display)displayRef.current=null;
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
    const active = currentMode==='codex'?conversation?.id:activeRef.current;
    displayRef.current?.close();
    abortRef.current?.abort();
    if (!active) return;
    setStatus('正在停止…');
    try { await api(`/conversations/${encodeURIComponent(active)}/stop`, { method: 'POST' }); if(currentMode==='codex')await refreshConversation(active); }
    catch (e) { setError((e as Error).message); }
  }
  async function approve(approval: Approval, decision: string) {
    try { await api(`/codex/approvals/${encodeURIComponent(approval.id)}`, { method: 'POST', body: JSON.stringify({ decision }) }); setApprovals(a => a.filter(item => item.id !== approval.id)); if(currentMode==='codex'&&conversation)await refreshConversation(conversation.id); }
    catch (e) { setError((e as Error).message); }
  }
  async function deleteChat(id: string) {
    if (selected === id) stopPresentation();
    try { await api(`/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' }); if (selected === id) setSelected(null); await refresh(); setDeleting(null); }
    catch (e) { setError((e as Error).message); }
  }
  function chooseSuggestion(text: string) { setDraft(text); inputRef.current?.focus(); }
  async function refreshConversation(id:string,signal?:AbortSignal) {
    const updated=await api<Conversation>(`/conversations/${encodeURIComponent(id)}`,{signal});
    if(getSessionEpoch()!==accountEpoch)throw new SessionChangedError();
    setState(previous=>{
      const before=previous.conversations.find(item=>item.id===id);
      if(before?.agent&&updated.agent&&before.agent.revision>updated.agent.revision)return previous;
      if(before&&JSON.stringify(before)===JSON.stringify(updated))return previous;
      return {...previous,conversations:before?previous.conversations.map(item=>item.id===id?updated:item):[updated,...previous.conversations]};
    });
    return updated;
  }
  useEffect(()=>{
    if(!selected||currentMode!=='codex')return;
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined,initialized=false,lastText='';
    const complete=new Set<string>();
    const poll=async()=>{
      let running=false;
      try {
        const next=await refreshConversation(selected,controller.signal);
        if(controller.signal.aborted)return;
        const receipt=next.agent?.submissions?.find(item=>item.submissionId===agentSubmissionRef.current?.id);
        if(receipt&&['queued','running','completed','cancelled','error','steered','uncertain'].includes(receipt.status))resolveSubmission(receipt);
        running=next.agent?.run?.status==='running'||next.agent?.run?.status==='stopping';
        const last=next.messages.filter(item=>item.role==='assistant').at(-1);
        if(last?.status==='complete'&&!complete.has(last.id)){
          complete.add(last.id);
          if(initialized)speechRef.current.speakIfEnabled(last.content,`${last.id}-auto-agent`);
        }
        if(last&&(last.content!==lastText||!running)){lastText=last.content;performancePhase(running?(last.content?'speaking':'thinking'):'idle',last.content,last.id);}
        initialized=true;
      }catch(error){if(!controller.signal.aborted&&!isSessionChanged(error))setError((error as Error).message);}
      if(!controller.signal.aborted)timer=setTimeout(()=>void poll(),running?800:2500);
    };
    void poll();return()=>{controller.abort();if(timer)clearTimeout(timer);};
  },[selected,currentMode]);
  function resolveSubmission(submission:AgentSubmission) {
    const pending=agentSubmissionRef.current;if(!pending||pending.id!==submission.submissionId)return;
    agentSubmissionRef.current=null;setUnconfirmed(false);
    if(draftRef.current.trim()===pending.payload.content){setDraft('');attachmentsRef.current.clear();}
    if(submission.status==='uncertain')setError('指令可能已送达，但没有收到确认。请先检查当前任务，不要重复发送。');
    else if(['error','cancelled'].includes(submission.status))setError('这条任务没有继续执行，请检查队列状态。');
    else {setError('');setNotice(submission.status==='steered'?'指令已追加到当前任务。':'任务已确认，可以在会话中查看进度。');}
  }
  async function sendAgent() {
    const content=draft.trim(),images=[...attachments.items];
    if((!agentSubmissionRef.current&&!content&&!images.length)||attachments.uploading||agentSendLock.current||switchingModelRef.current)return;
    if(!state.user?.canUseCodex){setError('请联系管理员开通 Agent。');return;}
    if(!state.user.isOwner&&!agentProviderId){setError('当前主机没有分配给你的 Agent 模型，请联系管理员。');return;}
    if(!agentSubmissionRef.current&&images.length&&!agentSupportsImages){setError('这个 Agent 模型仅支持文字，请移除图片或切换模型。');return;}
    if(!agentSubmissionRef.current&&!canSendAgent){setError(projectIssue|| (agentUnknown?'这台电脑的执行状态尚未确认，请先检查原任务。':hostsError||(!selectedHost?.online?'所选电脑未在线，请在该电脑登录同一账号后重试。':'所选电脑的 Codex 尚未就绪，请检查客户端。')));return;}
    const submissionHostId=selectedHostId;
    chatScroll.latest();
    agentSendLock.current=true;setAgentSubmitting(true);setError('');stopPresentation();speech.prepare();
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),40000);
    try{
      let target=conversation;
      if(!target){target=await api<Conversation>('/conversations',{method:'POST',body:JSON.stringify({mode:'codex'}),signal:controller.signal});setSelected(target.id);setState(previous=>({...previous,conversations:[target!,...previous.conversations]}));}
      if(!agentSubmissionRef.current){
        const run=target.agent?.run,isRunning=run?.status==='running'||run?.status==='stopping';
        const kind=isRunning&&sendChoice==='steer'?'steer':'submit';
        if(kind==='steer'&&!run?.turnId)throw new Error('Agent 正在准备这轮任务，请稍候，或选择排队。');
        const directory=isRunning?run.projectDirectory||'':activeProjectDirectory;
        const payload={content,attachmentIds:images.map(item=>item.id),permissions:isRunning?run.permissions:permissions,providerId:isRunning?run.providerId:agentProviderId||null,hostId:isRunning?run.hostId||defaultHostId:submissionHostId,...(directory?{projectDirectory:directory}:{}),...(kind==='steer'?{expectedTurnId:run!.turnId}:{})};
        agentSubmissionRef.current={id:crypto.randomUUID(),conversationId:target.id,kind,payload};
      }
      const pending=agentSubmissionRef.current;
      const result=await api<{conversation:Conversation;submission:AgentSubmission}>(`/conversations/${encodeURIComponent(pending.conversationId)}/agent/${pending.kind}`,{method:'POST',body:JSON.stringify({...pending.payload,submissionId:pending.id}),signal:controller.signal});
      setState(previous=>({...previous,conversations:previous.conversations.map(item=>item.id===result.conversation.id&&(!item.agent||!result.conversation.agent||item.agent.revision<=result.conversation.agent.revision)?result.conversation:item)}));
      resolveSubmission(result.submission);
      await refreshConversation(target.id);
    }catch(error){if(!isSessionChanged(error)&&getSessionEpoch()===accountEpoch){
      const status=(error as {status?:number}).status;
      if(status&&status>=400&&status<500)agentSubmissionRef.current=null;
      setUnconfirmed(!!agentSubmissionRef.current);
      setError(agentSubmissionRef.current?'尚未确认这条提交。先查看任务状态，或点击确认上次提交；会复用原来的指令、权限和提交编号，不创建重复任务。':(error as Error).message);
    }}
    finally{clearTimeout(timer);agentSendLock.current=false;if(getSessionEpoch()===accountEpoch)setAgentSubmitting(false);}
  }
  async function changeModel(nextId: string) {
    if (busyRef.current || agentRunning || agentUnknown || agentSendLock.current || switchingModelRef.current) return;
    if(currentMode==='codex'){if(nextId&&!agentProviders.some(item=>item.id===nextId))return;setAgentProviderId(nextId);return;}
    if(!state.providers.some(p => p.id === nextId))return;
    if (!conversation) { setProviderId(nextId); return; }
    if (conversation.mode !== 'chat' || conversation.providerId === nextId) return;
    switchingModelRef.current = true; setSwitchingModel(true); setError('');
    try {
      const updated = await api<Conversation>(`/conversations/${encodeURIComponent(conversation.id)}`, { method: 'PATCH', body: JSON.stringify({ providerId: nextId }) });
      setState(previous => ({ ...previous, conversations: previous.conversations.map(item => item.id === updated.id ? updated : item) }));
      setProviderId(nextId); setNotice('模型已切换，将沿用当前对话内容。');
    } catch (error) { if (!isSessionChanged(error)) setError((error as Error).message); }
    finally { switchingModelRef.current = false; if (getSessionEpoch() === accountEpoch) setSwitchingModel(false); }
  }
  function changeHost(nextId:string){
    if(agentSendLock.current||hostBusy||unconfirmed||busyRef.current||!agentHosts.some(host=>host.id===nextId&&host.online))return;
    setAgentHostId(nextId);saveExecutionHost(localStorage,hostScope,nextId);setError('');
    const host=agentHosts.find(item=>item.id===nextId);
    setNotice(`下一条任务将在${host?.name||'所选电脑'}执行，聊天记录会保留。`);
  }

  if (petOnly) return <div className="floating-pet"><div className="pet-drag-handle" title="拖动小猫">•••</div><button className="floating-bubble" onClick={() => window.petpal?.showMain()}>{busy ? '我在认真工作…' : `${state.settings.petName}在这里，点我聊聊`}<MessageCircle size={15} aria-hidden="true"/></button><div className="floating-cat"><Cat onState={companionState} onInteract={companionInteract}/></div><button className="floating-hide" aria-label="隐藏桌宠" onClick={() => window.petpal?.hidePet()}><X size={15} aria-hidden="true"/></button></div>;

  return <div className="app-shell">
    {mobileNav && <button className="nav-scrim" aria-label="关闭导航" onClick={() => setMobileNav(false)}/>}
    <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
      <a className="brand" href="#" onClick={e => { e.preventDefault(); newChat('chat'); }}><span className="brand-mark"><BrandMark size={38}/></span><span>小伴<span className="brand-en">PetPal</span></span><span className="brand-dot"/></a>
      <button className="new-chat" onClick={() => newChat()}><Plus size={18} aria-hidden="true"/>开启新对话</button>
      <nav className="main-nav" aria-label="主导航">
        <button className={view === 'chat' ? 'active' : ''} onClick={() => openMode(currentMode)}><MessageCircle size={18} aria-hidden="true"/>对话</button>
      </nav>
      <div className="history-heading"><span>最近的对话</span><History size={14} aria-hidden="true"/></div>
      <ConversationHistory conversations={historyConversations} selectedId={selected} active={view==='chat'} busy={busy} onSelect={selectHistory} onDelete={deleteHistory}/>
      <div className="sidebar-bottom"><button className={`settings-link ${view==='downloads'?'active':''}`} onClick={()=>{setView('downloads');setMobileNav(false);}}><Download size={18} aria-hidden="true"/>下载客户端</button>
        <button className={`settings-link ${view === 'settings' ? 'active' : ''}`} onClick={() => { if (busy) { setNotice('请先完成或停止当前回复。'); return; } setView('settings'); setMobileNav(false); }}><Settings2 size={18} aria-hidden="true"/>连接与设置</button>
        <button className="host-status" onClick={() => { stopPresentation(); setConnectionOpen(true); }}><span className={`status-light ${connected ? 'online' : ''}`}/><span>{connected ? state.user?.displayName || '个人服务已连接' : '登录你的个人服务'}<small>{window.petpal ? '桌面 · 账号与执行电脑' : Capacitor.isNativePlatform() ? 'Android · 远程服务' : 'Web · 个人空间'}</small></span><ChevronDown size={14} aria-hidden="true"/></button>
      </div>
    </aside>

    <main className="main-area">
      <header className="topbar"><div className="topbar-title"><button className="mobile-menu icon-button" aria-label="打开导航" onClick={() => setMobileNav(true)}><Menu size={21} aria-hidden="true"/></button><span className="breadcrumb">我的空间</span><span className="breadcrumb-divider">/</span><strong>{view === 'settings' ? '连接与设置' : view==='downloads'?'下载客户端':currentMode === 'codex' ? 'Agent · 执行任务' : 'Chat · 聊天'}</strong></div><div className="topbar-actions">{view === 'chat' && <button type="button" className="companion-panel-toggle" aria-label={companionPanelOpen ? '收起伙伴栏' : '展开伙伴栏'} aria-expanded={companionPanelOpen} aria-controls="workspace-companion-panel" onClick={() => setCompanionPanelOpen(value => !value)}><PawPrint size={16} aria-hidden="true"/><span>{companionPanelOpen ? '收起伙伴' : '伙伴'}</span></button>}<span className="today">{todayLabel}</span><button className="avatar account-entry" aria-label="我的账号" onClick={() => { stopPresentation(); setSettingsTab('accounts'); setView('settings'); }}>{state.user?.displayName?.slice(0,1) || '我'}</button><a className="single-companion-return" href="/" aria-label="回到伙伴身边"><PawPrint size={20} aria-hidden="true"/></a></div></header>
      {!ready ? <div className="loading-view"><Loader2 className="spin" aria-hidden="true"/>正在准备你的小伴…</div> : view==='downloads'?<DownloadsView/>:view === 'settings' ? <SettingsView state={state} connected={connected} refresh={refresh} notice={setNotice} connect={() => setConnectionOpen(true)} initialTab={settingsTab} hasDraft={!!draft.trim()||!!attachments.items.length||working}/> : <div className={`workspace${companionPanelOpen ? ' workspace-companion-visible' : ''}`}>
        <section className="chat-area">
          <div className={`workspace-controls is-${currentMode==='chat'?'chat':'agent'}`}>
            <div className="workspace-mode-row">
              <div className="mode-switch" role="group" aria-label="对话模式">
                <button aria-label="Chat 聊天" aria-pressed={currentMode==='chat'} onClick={()=>currentMode!=='chat'&&newChat('chat')}><MessageCircle size={16} aria-hidden="true"/>Chat<span>聊天</span></button>
                <button aria-label="Agent 执行任务" aria-pressed={currentMode==='codex'} disabled={!state.user?.canUseCodex} title={!state.user?.canUseCodex?'请联系管理员开通 Agent':undefined} onClick={()=>currentMode!=='codex'&&newChat('codex')}><Terminal size={16} aria-hidden="true"/>Agent<span>执行任务</span></button>
              </div>
              {currentMode==='chat'&&<ModelPicker providers={state.providers} value={conversation?.providerId||providerId} onChange={id=>void changeModel(id)} disabled={working||switchingModel||unconfirmed} label="Chat 模型" fallbackLabel="选择模型"/>}
              {currentMode==='chat'&&state.user?.canUseCodex&&<ChatAssistantControls assistant={chatAssistant} allowed={connected&&!!state.user?.canUseCodex} user={state.user} providers={agentProviders} disabled={busy||switchingModel} localHostId={localHostId} onDownload={()=>setView('downloads')}/>}
              {currentMode==='codex'&&<AgentOnboarding codex={selectedCodex} user={state.user} host={selectedHost} hostLoading={hostsLoading} localHostId={localHostId} onConfigure={()=>{setSettingsTab('assistant');setView('settings');}}/>}
            </div>
            {currentMode==='codex'&&<div className="workspace-context-row has-execution-target">
              <ModelPicker providers={agentProviders} value={activeProviderId} onChange={id=>void changeModel(id)} disabled={working||agentUnknown||agentSubmitting||switchingModel||unconfirmed} label="Agent 模型" fallbackLabel={(agentRunning?conversation?.agent?.run?.model:state.codex.model)||'Codex 主机配置'} fallbackOption={state.user?.isOwner?{label:(agentRunning?conversation?.agent?.run?.model:state.codex.model)||'Codex 主机配置',description:'使用主机默认模型与推理强度'}:undefined}/>
              <ExecutionTarget hosts={agentHosts} value={selectedHostId} onChange={changeHost} disabled={busy||agentSubmitting||hostBusy||unconfirmed} loading={hostsLoading} error={hostsError} localHostId={localHostId} lockReason={unconfirmed?'上次任务提交正在等待确认，执行电脑保持不变。':hostBusy?'正在执行或排队的任务已固定电脑，结束后可以切换。':'当前提交或回复完成后，可以切换执行电脑。'} onRefresh={()=>setHostRefresh(value=>value+1)} onDownload={()=>setView('downloads')}/>
            </div>}
            {currentMode==='codex'&&<ProjectDirectory value={activeProjectDirectory} host={selectedHost} user={state.user} disabled={busy||agentSubmitting||hostBusy||unconfirmed} lockReason={unconfirmed?'上次提交仍在等待确认，目录保持不变。':'正在执行、排队或状态待确认，目录保持不变。'} onChange={value=>{if(!busyRef.current&&!agentSendLock.current&&!hostBusy&&!unconfirmed){projectDirectory.change(value);setError('');setNotice(value?'下一条任务会在指定项目目录执行。':'下一条任务会使用默认工作区。');}}}/>}
            {currentMode==='codex' && nativeExecutor?.state==='reconnecting' && <p className="execution-reconnect" role="status"><Loader2 size={13} className="spin" aria-hidden="true"/>此电脑连接中断，正在重连。原任务保持暂停。</p>}
          </div>
          <div className="chat-reading-area"><div className="chat-scroll" ref={scrollRef} onScroll={chatScroll.onScroll} tabIndex={0} role="region" aria-label="对话消息" aria-live="polite" aria-busy={working}><div className="chat-scroll-content" ref={chatScroll.contentRef}>
            {!conversation?.messages.length ? <div className="welcome"><div className="welcome-symbol">{currentMode === 'codex' ? <Terminal size={28} aria-hidden="true"/> : <Sun size={28} aria-hidden="true"/>}</div><h1>{currentMode === 'codex' ? '交给我一个任务' : '今天想聊些什么？'}</h1><p>{currentMode === 'codex' ? '选择执行电脑与权限，再告诉我需要做什么。' : `我是${state.settings.petName}，在这里陪你。`}</p><div className="suggestions">{(currentMode === 'codex' ? [{ icon: Monitor, title: '看看音乐播放器', text: '请检查 QQ 音乐和网易云音乐的安装及媒体会话状态，暂不打开或播放。' }, { icon: Globe2, title: '查询网站信息', text: '请通过内置 OpenCLI 查询网站清单，并查询 V2EX 最新热门话题。' }] : [{ icon: Coffee, title: '聊聊今天', text: '小伴，陪我聊聊今天吧。' }, { icon: Pencil, title: '把想法写下来', text: '我有一个还不成熟的想法，想和你一起梳理。' }]).map(item => <button key={item.title} onClick={() => chooseSuggestion(item.text)}><item.icon size={18} aria-hidden="true"/><span>{item.title}</span><span className="suggestion-arrow"><ArrowRight size={16} aria-hidden="true"/></span></button>)}</div>{!connected && <button className="inline-connect" onClick={() => setConnectionOpen(true)}><Link2 size={14} aria-hidden="true"/>连接个人服务，开始第一段对话</button>}{connected && currentMode === 'chat' && !state.providers.length && <button className="inline-connect" onClick={() => setView('settings')}><Plus size={14} aria-hidden="true"/>{state.user?.isOwner ? '添加模型连接，开始聊天' : '还没有可用模型，请联系管理员分配'}</button>}</div> : <ChatMessages messages={conversation.messages} petName={state.settings.petName} mode={currentMode} working={working} busy={busy} sleeping={mood==='sleep'} speechId={speech.utteranceId} speechPlaying={speech.playing} speechPending={speech.pending} speechSupported={speech.supported} speechFeedback={speech.feedback} speechError={speech.error} onRead={readReply} onStop={stopPresentation} onNotice={setNotice}/>}
            {shownApprovals.map(approval => <div className="approval" key={approval.id} tabIndex={-1}><ShieldCheck size={21} aria-hidden="true"/><div><strong>Codex 请求你的确认</strong><p>{approval.description}</p><div className="button-row"><button className="secondary-button" onClick={() => approve(approval, 'decline')}>拒绝</button><button className="primary-button" onClick={() => approve(approval, 'accept')}>允许本次</button></div></div></div>)}
          </div></div>
          {chatScroll.showLatest&&<button type="button" className="chat-latest-button" aria-label="回到最新消息" onClick={chatScroll.latest}><ArrowDown size={14} aria-hidden="true"/><span>回到最新</span></button>}
          </div>
          <div className="composer-area">{currentMode==='chat'&&<ChatAssistantTasks conversationId={conversation?.id} tasks={conversation?.assistantTasks} onUpdate={updateChatTasks}/>} {error&&<div className="error-banner" role="alert"><span>{error}</span><button className="icon-button" aria-label="关闭错误提示" onClick={()=>setError('')}><X size={15} aria-hidden="true"/></button></div>}{currentMode==='codex'&&conversation?.agent&&<AgentQueue key={conversation.id} conversationId={conversation.id} state={conversation.agent} hosts={agentHosts} refresh={()=>refreshConversation(conversation.id)} onNewConversation={()=>newChat('codex')}/>}<div className="composer-runtime">{currentMode==='codex'?<AgentPermissions value={activePermissions} onChange={setPermissions} user={state.user} disabled={agentRunning||agentUnknown||agentSubmitting||unconfirmed}/>:null}{working&&<div className="stream-status"><Loader2 size={12} className="spin" aria-hidden="true"/>{currentMode==='codex'?(conversation?.agent?.run?.status==='stopping'?'正在停止…':shownApprovals.length?'等待你的确认':'Agent 正在执行'):status||'正在回复…'}{shownApprovals.length>0&&<button type="button" className="approval-jump" onClick={()=>{const target=scrollRef.current?.querySelector<HTMLElement>('.approval');target?.scrollIntoView({block:'nearest'});target?.focus({preventScroll:true});}}>查看请求 ({shownApprovals.length})</button>}</div>}</div><form className={`composer ${working?'composer-busy':''}`} onSubmit={send}>{unconfirmed&&<div className="unconfirmed-submission" role="status"><span>上次提交正在等待确认</span><button type="button" disabled={agentSubmitting} onClick={()=>void sendAgent()}>确认上次提交</button></div>}<AttachmentDrafts value={attachments}/><textarea ref={inputRef} aria-label="消息" placeholder={currentMode==='codex'?(agentRunning?'补充当前任务，或加入下一条任务…':'例如：帮我打开 QQ 音乐'):`和${state.settings.petName}说点什么…`} value={draft} onChange={e=>setDraft(e.target.value)} onPaste={e=>{const files=Array.from(e.clipboardData.files).filter(file=>file.type.startsWith('image/'));if(files.length){e.preventDefault();if(currentMode==='codex'&&!agentSupportsImages){setError('这个 Agent 模型仅支持文字，请切换模型后再添加图片。');return;}void attachments.upload(files);}}} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send();}}} rows={2} maxLength={20000} disabled={busy||agentSubmitting||unconfirmed}/><div className="composer-bottom"><div className="composer-tools"><AttachmentInput value={attachments} disabled={busy||agentSubmitting||unconfirmed||(currentMode==='chat'?provider?.supportsImages===false:!agentSupportsImages)}/>{agentRunning&&<label className="agent-send-choice"><select aria-label="Agent 发送方式" value={sendChoice} onChange={e=>setSendChoice(e.target.value as 'steer'|'submit')}><option value="steer">追加到当前任务</option><option value="submit">排队，稍后执行</option></select></label>}</div><div className="composer-send-actions">{working&&<button className="send-button stop-button" type="button" aria-label="停止生成" onClick={()=>void stop()}><Square size={14} aria-hidden="true"/></button>}{!busy&&<button className="send-button" aria-label={agentRunning?(sendChoice==='steer'?'追加指令':'加入队列'):'发送消息'} type="submit" disabled={(!draft.trim()&&!attachments.items.length)||switchingModel||agentSubmitting||unconfirmed||attachments.uploading||(currentMode==='codex'&&(!canSendAgent||(!state.user?.isOwner&&!agentProviderId)))||!!(agentRunning&&sendChoice==='steer'&&!conversation?.agent?.run?.turnId)}>{agentSubmitting?<Loader2 size={18} className="spin" aria-hidden="true"/>:agentRunning?sendChoice==='steer'?<CornerDownRight size={18} aria-hidden="true"/>:<ListOrdered size={18} aria-hidden="true"/>:<ArrowUp size={21} aria-hidden="true"/>}</button>}</div></div></form>
            <div className="composer-footer">
              <div className="speech-controls">
                <WorkspaceDisclosure className="speech-options" label="语音朗读选项" summary={<><Volume2 size={14} aria-hidden="true"/><span>{speech.enabled ? '语音 · 自动朗读开' : '语音'}</span></>}>
                  <h3>回复朗读</h3>
                  <div className="speech-controls-row"><label className="speech-toggle"><input type="checkbox" checked={speech.enabled} disabled={!speech.supported} onChange={e => speech.setEnabled(e.target.checked)}/><span>自动朗读回复</span></label><button type="button" disabled={working || !lastReply || !speech.supported || mood === 'sleep'} onClick={() => { if (lastReply) readReply(lastReply); }}>朗读上一条</button></div>
                  <p className="speech-feedback">{mood === 'sleep' ? '小伴正在休息，唤醒后可继续朗读。' : speech.feedback}{speech.engine === 'system' && speech.playing && speech.progressBasis === 'estimated' && <span>口型按语句进度近似呈现</span>}</p>
                </WorkspaceDisclosure>
                {speech.playing && <button type="button" className="speech-stop" onClick={stopPresentation}>{speech.pending ? <Loader2 size={12} className="spin" aria-hidden="true"/> : <Square size={11} aria-hidden="true"/>}<span>{speech.pending ? '准备语音中 · 停止' : '正在朗读 · 停止'}</span></button>}
              </div>
              <p className="composer-footnote">{currentMode === 'codex' ? '刷新后任务继续保留' : '重要信息请核实'}<span>Enter 发送 · Shift Enter 换行</span></p>
            </div>
            {speech.error && <p className="speech-feedback speech-error" role="status">{speech.error}</p>}
          </div>

        </section>
        <aside className="pet-panel" id="workspace-companion-panel"><div className="pet-panel-heading"><span>你的小伙伴</span><span className="live-tag"><span/>{mood === 'sleep' ? '打盹中' : speech.active ? '朗读中' : responsePerformance.phase === 'speaking' ? '回应中' : working ? '思考中' : '在你身边'}</span></div><div className="pet-scene"><div className="scene-circle"/><svg className="scene-leaf" viewBox="0 0 90 120" aria-hidden="true"><path d="M42 118V44m0 50C3 85 8 54 42 75m0-9c33-6 40-31 8-28m-8 4C17 32 24 5 42 15" fill="#b7c8a5" stroke="#9bad8a" strokeWidth="2"/><path d="M26 100h34l-5 20H31z" fill="#d9cbb5" stroke="none"/></svg><div className="pet-touch">{companionPanelMounted&&<Cat performanceInput={performanceInput} onState={companionState} onInteract={companionInteract}/>}</div><div className="scene-floor"/></div><div className="pet-name"><h2>{state.settings.petName}</h2><span>{companionKind === 'anime' ? '温柔的二次元伙伴' : '一只喜欢陪着你的小猫'}</span></div><div className="pet-speech">{mood !== 'sleep' && working ? '让我想一想，马上就好…' : petSay}</div><p className="pet-interaction-hint">轻触回应 · 长按休息</p><a className="motion-preview-link" href="/">回到伙伴身边 <ArrowUpRight size={16} aria-hidden="true"/></a><div className="pet-panel-bottom"><div className="quiet-note"><Sparkles size={16} aria-hidden="true"/><p>不用每一刻都很有生产力。<br/>有我陪着，发会儿呆也很好。</p></div>{window.petpal ? <button className="desktop-pet-button" onClick={() => window.petpal?.showPet()}><Monitor size={16} aria-hidden="true"/>放到桌面上<ArrowUpRight size={16} aria-hidden="true"/></button> : Capacitor.isNativePlatform() ? <button className="desktop-pet-button" onClick={() => setView('settings')}><Monitor size={16} aria-hidden="true"/>开启悬浮伙伴<ArrowUpRight size={16} aria-hidden="true"/></button> : <div className="platform-note"><Monitor size={14} aria-hidden="true"/><span>桌面版支持透明悬浮伙伴</span></div>}</div></aside>
      </div>}
    </main>
    {notice && <div className="toast" role="status"><Check size={16} aria-hidden="true"/>{notice}</div>}
    {connectionOpen && <ConnectionDialog close={() => setConnectionOpen(false)}/>}
    {deleting && <div className="modal-backdrop"><section className="modal small-modal" role="dialog" aria-modal="true" aria-labelledby="delete-title"><h2 id="delete-title">删除这段对话？</h2><p>这会删除个人服务中保存的聊天记录，无法恢复。</p><div className="button-row"><button className="secondary-button" onClick={() => setDeleting(null)}>保留</button><button className="danger-button" onClick={() => deleteChat(deleting)}>删除对话</button></div></section></div>}
  </div>;
}

function SettingsView({ state, connected, refresh, notice, connect, initialTab, hasDraft }: { state: State; connected: boolean; refresh(): Promise<State>; notice(message: string): void; connect(): void; hasDraft:boolean; initialTab: 'models'|'pet'|'desktop'|'accounts'|'voice'|'assistant'|'updates' }) {
  const canManageMusicMcp = !!state.user?.isOwner || ((!!nativeMusicMcp()||!!nativeComputerUse()) && !!state.user?.canUseCodex && state.user.agentAccess === 'full');
  const voiceScope=state.instanceId&&state.user?`${state.instanceId}:${state.user.id}`:`guest:${getConnection().url||location.origin}`;
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
  return <div className="settings-page"><div className="settings-heading"><span className="eyebrow">MAKE IT YOURS</span><h1>让小伴，更懂你。</h1><p>连接你喜欢的模型，设定属于你们的相处方式。</p></div><div className="settings-tabs" role="tablist"><button role="tab" aria-selected={tab === 'models'} className={tab === 'models' ? 'active' : ''} onClick={() => setTab('models')}><Plug size={18} aria-hidden="true"/>模型连接</button><button role="tab" aria-selected={tab === 'pet'} className={tab === 'pet' ? 'active' : ''} onClick={() => setTab('pet')}><PawPrint size={18} aria-hidden="true"/>小伴个性</button><button role="tab" aria-selected={tab === 'desktop'} className={tab === 'desktop' ? 'active' : ''} onClick={() => setTab('desktop')}><Monitor size={18} aria-hidden="true"/>设备连接</button>{canManageMusicMcp && <button role="tab" aria-selected={tab === 'assistant'} className={tab === 'assistant' ? 'active' : ''} onClick={() => setTab('assistant')}><Terminal size={18} aria-hidden="true"/>电脑助手</button>}<button role="tab" aria-selected={tab === 'voice'} className={tab === 'voice' ? 'active' : ''} onClick={()=>setTab('voice')}><AudioLines size={18} aria-hidden="true"/>语音与设备</button><button role="tab" aria-selected={tab === 'accounts'} className={tab === 'accounts' ? 'active' : ''} onClick={()=>setTab('accounts')}><UserRound size={18} aria-hidden="true"/>账号</button><button role="tab" aria-selected={tab === 'updates'} className={tab === 'updates' ? 'active' : ''} onClick={()=>setTab('updates')}><RefreshCw size={18} aria-hidden="true"/>软件更新</button></div>{error && <div className="error-banner" role="alert"><span>{error}</span><button className="icon-button" aria-label="关闭设置错误" onClick={() => setError('')}><X size={15} aria-hidden="true"/></button></div>}{!connected && <div className="setup-notice"><Unplug size={19} aria-hidden="true"/><span>先连接个人服务，才能保存设置。</span><button className="secondary-button" onClick={connect}>连接服务</button></div>}
    {tab === 'updates' && <UpdatesSettings connected={connected} user={state.user} hasDraft={hasDraft}/>}
    {tab === 'assistant' && state.user?.isOwner && <DesktopAssistantSettings connected={connected} user={state.user} onConfigSaved={refresh}/>}
    {tab === 'assistant' && canManageMusicMcp && <div className="settings-section desktop-assistant"><MusicMcpSettings connected={connected} user={state.user}/><ComputerUseSettings connected={connected} user={state.user}/><OpenCliSettings connected={connected} user={state.user}/></div>}
    {tab === 'voice' && <VoiceSettings key={`${getSessionEpoch()}:${voiceScope}`} connected={connected} scope={voiceScope}/>}
    {tab === 'accounts' && <AccountsSettings connected={connected} user={state.user} providers={state.providers} connect={connect}/>}
    {tab === 'models' && <div className="settings-section"><div className="section-title"><div><h2>我的模型</h2><p>支持 OpenAI 及兼容接口，API Key 仅由后端保存。</p></div>{state.user?.isOwner && <button className="primary-button" disabled={!connected} onClick={() => { setEditing({ name: '', protocol: 'responses', baseUrl: 'https://api.openai.com/v1', model: '', reasoningEffort: '', apiKey: '' }); setError(''); }}><Plus size={16} aria-hidden="true"/>添加连接</button>}</div><div className="default-model-setting"><label>新对话默认模型<select aria-label="默认模型" value={defaultProviderId} disabled={!connected || busy} onChange={e=>setDefaultProviderId(e.target.value)}><option value="">使用第一个可用模型</option>{state.providers.map(p=><option value={p.id} key={p.id}>{p.name} · {p.model}</option>)}</select></label><button className="secondary-button" disabled={!connected || busy} onClick={saveDefault}>保存默认模型</button></div>{!state.providers.length ? <div className="empty-models"><span><Plug size={29} aria-hidden="true"/></span><h3>给小伴连接一个大脑</h3><p>{state.user?.isOwner ? '准备服务地址、模型名称和 API Key，就可以开始对话。' : '请联系主机管理员为这个账号分配模型。'}</p><div className="protocol-labels"><code>Chat Completions</code><code>Responses</code></div></div> : <div className="provider-list">{state.providers.map(p => <div className="provider-row" key={p.id}><span className="provider-icon"><Plug size={19} aria-hidden="true"/></span><div className="provider-details"><strong>{p.name}</strong><span>{p.model} <i>·</i> {p.protocol === 'responses' ? 'Responses' : 'Chat Completions'} <i>·</i> 推理 {p.reasoningEffort || '服务默认'}</span><small title={p.baseUrl}>{p.baseUrl}</small></div><div className="provider-actions"><button className="secondary-button" disabled={!!testing || p.testable === false} onClick={() => testProvider(p)}>{testing === p.id ? <Loader2 size={14} className="spin" aria-hidden="true"/> : <Link2 size={14} aria-hidden="true"/>}测试</button>{p.editable && <><button className="icon-button" aria-label={`编辑 ${p.name}`} onClick={() => { setEditing({ ...p, reasoningEffort: p.reasoningEffort ?? '', apiKey: '' }); setError(''); }}><Pencil size={16} aria-hidden="true"/></button><button className="icon-button" aria-label={`删除 ${p.name}`} onClick={() => setRemoveId(p.id)}><Trash2 size={16} aria-hidden="true"/></button></>}</div></div>)}</div>}<div className="info-note"><ShieldCheck size={18} aria-hidden="true"/><p>小伴不会把 API Key 发给聊天页面。连接测试会发出一条简短请求，可能产生少量模型费用。</p></div></div>}
    {tab === 'pet' && <form className="settings-section pet-settings" onSubmit={savePet}><div className="pet-settings-preview"><Cat interactive={false}/><span>独一无二的小伙伴</span></div><div className="pet-settings-form"><h2>认识你的小伴</h2><CompanionOptions/><label>伙伴的名字<input value={petName} maxLength={30} required onChange={e => setPetName(e.target.value)}/></label><label>性格与相处方式<textarea rows={7} value={persona} maxLength={4000} onChange={e => setPersona(e.target.value)}/></label><p className="field-help">作为陪伴聊天的系统提示词使用，下一条消息生效。</p><button className="primary-button" disabled={busy || !connected}><Check size={16} aria-hidden="true"/>保存个性</button></div></form>}
    {tab === 'desktop' && <div className="settings-section">
      <div className="section-title"><div><h2>你的设备</h2><p>电脑客户端登录同一账号后，可由 Web、Android 或其他电脑选择执行任务。</p></div><span className="device-badge">{window.petpal ? '桌面应用' : Capacitor.isNativePlatform() ? 'Android' : 'Web 浏览器'}</span></div>
      <div className="device-row"><div><h3>悬浮伙伴</h3><p>{window.petpal ? '透明、置顶的小窗，拖动顶部即可移动，双击伙伴返回聊天。' : Capacitor.isNativePlatform() ? '授权悬浮窗权限后，让伙伴陪在其他应用旁。' : '使用 Windows 或 Ubuntu 桌面版，即可开启透明悬浮窗。'}</p></div>{window.petpal && <button className="secondary-button" onClick={() => window.petpal?.showPet()}>显示桌宠</button>}{Capacitor.isNativePlatform() && <button className="secondary-button" onClick={overlay}>{overlayRunning ? '收起悬浮伙伴' : '开启悬浮伙伴'}</button>}</div>
      {state.user?.isOwner && <div className="device-row"><div><h3>Codex 与音乐控制</h3><p>在电脑助手中配置 Responses API、检测播放器，并连接 OpenCLI 浏览器工具。</p></div><button className="secondary-button" onClick={()=>setTab('assistant')}><Terminal size={15} aria-hidden="true"/>电脑助手设置</button></div>}
      <div className="about-app"><PawPrint size={20} aria-hidden="true"/><strong>小伴 PetPal</strong><span>Web / Android / Windows / Ubuntu</span></div>
    </div>}
    {editing && <div className="modal-backdrop"><section className="modal provider-modal" role="dialog" aria-modal="true" aria-labelledby="provider-title"><div className="modal-heading"><h2 id="provider-title">{editing.id ? '编辑模型连接' : '添加模型连接'}</h2><button className="icon-button" aria-label="关闭模型窗口" onClick={() => setEditing(null)}><X size={20} aria-hidden="true"/></button></div><form onSubmit={saveProvider}><label>连接名称<input autoFocus required maxLength={80} placeholder="例如：我的 OpenAI" value={editing.name || ''} onChange={e => setEditing({ ...editing, name: e.target.value })}/></label><label>接口协议<select value={editing.protocol} onChange={e => setEditing({ ...editing, protocol: e.target.value as Provider['protocol'] })}><option value="responses">Responses</option><option value="chat-completions">Chat Completions</option></select></label><label>API 地址<input required type="url" placeholder="https://api.openai.com/v1" value={editing.baseUrl || ''} onChange={e => setEditing({ ...editing, baseUrl: e.target.value })}/></label><label>模型名称<input required placeholder="填写服务商提供的模型 ID" value={editing.model || ''} onChange={e => setEditing({ ...editing, model: e.target.value })}/></label><label>推理强度<select aria-label="模型推理强度" value={editing.reasoningEffort ?? ''} onChange={e=>setEditing({...editing,reasoningEffort:e.target.value as ReasoningEffort})}>{reasoningEfforts.map(effort=><option key={effort} value={effort}>{effort || '服务默认'}</option>)}</select></label><label>API Key<input type="password" autoComplete="off" placeholder={editing.hasApiKey ? '已保存，留空则保留' : '输入密钥；无需认证的本地模型可留空'} value={editing.apiKey || ''} onChange={e => setEditing({ ...editing, apiKey: e.target.value })}/></label><p className="field-help">{editing.protocol === 'responses' ? '将请求 /responses，支持文本增量流。' : '将请求 /chat/completions，兼容本地与第三方模型。'}</p>{error && <div className="form-error" role="alert">{error}</div>}<button className="primary-button full-button" disabled={busy}>{busy ? <Loader2 className="spin" size={16} aria-hidden="true"/> : <Check size={16} aria-hidden="true"/>}保存连接</button></form></section></div>}
    {removeId && <div className="modal-backdrop"><section className="modal small-modal" role="dialog" aria-modal="true" aria-labelledby="remove-provider-title"><h2 id="remove-provider-title">删除这个模型连接？</h2><p>依赖此连接的对话将无法继续发送消息。</p><div className="button-row"><button className="secondary-button" onClick={() => setRemoveId(null)}>取消</button><button className="danger-button" onClick={deleteProvider}>删除连接</button></div></section></div>}
  </div>;
}
