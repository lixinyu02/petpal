import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Cloud, Cpu, Download, Loader2, LockKeyhole, Monitor, RefreshCw, Search, X } from 'lucide-react';
import type { AgentHost, Provider } from './api';
import { canSelectExecutionHost, executionHostChoices, groupExecutionHosts, type ExecutionHostChoice } from './execution-host-picker.mjs';
import './workspace-controls.css';
import WorkspaceDisclosure from './WorkspaceDisclosure';

export { AgentOnboarding } from './AgentOnboarding';

type ModelPickerProps = {
  providers: Provider[];
  value: string;
  onChange(id: string): void;
  disabled?: boolean;
  label?: string;
  fallbackLabel?: string;
  fallbackOption?: { label: string; description?: string };
};
type ModelChoice = { id: string; name: string; description: string; protocol?: string; effort?: string; textOnly?: boolean; search: string };
const protocolLabel = (protocol: Provider['protocol']) => protocol === 'responses' ? 'Responses' : 'Chat Completions';
const effortLabel = (effort: Provider['reasoningEffort']) => effort ? `推理 ${effort}` : '默认推理';

export function ModelPicker({ providers, value, onChange, disabled = false, label = '当前模型', fallbackLabel = '选择模型', fallbackOption }: ModelPickerProps) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [activeIndex, setActiveIndex] = useState(0);
  const [placement, setPlacement] = useState({ left: 12, top: 60, width: 340, maxHeight: 400 });
  const trigger = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null), search = useRef<HTMLInputElement>(null);
  const triggerPointer = useRef(''), focusSearchOnOpen = useRef(true);
  const id = useId(), listId = `${id}-models`, searchId = `${id}-search`;
  const choices = useMemo<ModelChoice[]>(() => [
    ...(fallbackOption ? [{ id: '', name: fallbackOption.label, description: fallbackOption.description || '使用执行主机上的 Codex 配置', search: `${fallbackOption.label} ${fallbackOption.description || ''}`.toLocaleLowerCase() }] : []),
    ...providers.map(provider => ({ id: provider.id, name: provider.name, description: provider.model, protocol: protocolLabel(provider.protocol), effort: effortLabel(provider.reasoningEffort), textOnly: provider.supportsImages === false,
      search: `${provider.name} ${provider.model} ${protocolLabel(provider.protocol)} ${effortLabel(provider.reasoningEffort)}`.toLocaleLowerCase() })),
  ], [providers, fallbackOption?.label, fallbackOption?.description]);
  const filtered = useMemo(() => choices.filter(choice => choice.search.includes(query.trim().toLocaleLowerCase())), [choices, query]);
  const selected = choices.find(choice => choice.id === value), active = filtered[activeIndex];

  function close(restoreFocus = false) { setOpen(false); if (restoreFocus) trigger.current?.focus(); }
  function show(focusSearch = true) {
    if (disabled || !choices.length) return;
    focusSearchOnOpen.current = focusSearch;
    setQuery(''); setActiveIndex(Math.max(0, choices.findIndex(choice => choice.id === value))); setOpen(true);
    if (open && focusSearch) search.current?.focus({ preventScroll: true });
  }
  function choose(choice: ModelChoice) { close(true); if (choice.id !== value) onChange(choice.id); }
  function keyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
    else if (event.key === 'Tab') close(true);
    else if (event.target !== search.current) return;
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex(index => filtered.length ? (index + (event.key === 'ArrowDown' ? 1 : -1) + filtered.length) % filtered.length : 0);
    } else if (event.key === 'Enter' && active) { event.preventDefault(); choose(active); }
  }

  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => { setActiveIndex(index => Math.min(index, Math.max(0, filtered.length - 1))); }, [filtered.length]);
  useLayoutEffect(() => {
    if (!open) return;
    let frame = 0;
    const place = () => {
      const anchor = trigger.current?.getBoundingClientRect(); if (!anchor) return;
      const viewport = window.visualViewport, width = viewport?.width || window.innerWidth, height = viewport?.height || window.innerHeight;
      const offsetTop = viewport?.offsetTop || 0, offsetLeft = viewport?.offsetLeft || 0;
      const gutter = 12, gap = 8, menuWidth = Math.min(360, Math.max(1, width - gutter * 2));
      const below = height + offsetTop - anchor.bottom - gutter - gap, above = anchor.top - offsetTop - gutter - gap;
      const opensAbove = below < 220 && above > below, available = opensAbove ? above : below;
      const maxHeight = Math.max(1, Math.min(430, height - gutter * 2, available < 100 ? height - gutter * 2 : available));
      const top = Math.max(offsetTop + gutter, Math.min(opensAbove ? anchor.top - maxHeight - gap : anchor.bottom + gap, offsetTop + height - gutter - maxHeight));
      setPlacement({ left: Math.max(offsetLeft + gutter, Math.min(anchor.left, width + offsetLeft - menuWidth - gutter)), top, width: menuWidth, maxHeight });
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(place); };
    place(); if (focusSearchOnOpen.current) search.current?.focus({ preventScroll: true });
    window.addEventListener('resize', schedule); window.addEventListener('scroll', schedule, true); window.visualViewport?.addEventListener('resize', schedule); window.visualViewport?.addEventListener('scroll', schedule);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', schedule); window.removeEventListener('scroll', schedule, true); window.visualViewport?.removeEventListener('resize', schedule); window.visualViewport?.removeEventListener('scroll', schedule); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { const target = event.target as Node; if (!trigger.current?.contains(target) && !popup.current?.contains(target)) close(); };
    const focusOutside = (event: FocusEvent) => { const target = event.target as Node; if (!trigger.current?.contains(target) && !popup.current?.contains(target)) close(); };
    document.addEventListener('pointerdown', outside); document.addEventListener('focusin', focusOutside);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', focusOutside); };
  }, [open]);
  useEffect(() => { if (open && active) document.getElementById(`${id}-option-${activeIndex}`)?.scrollIntoView({ block: 'nearest' }); }, [open, activeIndex, active?.id, id]);

  return <div className="workspace-model-picker">
    <button ref={trigger} type="button" className="workspace-model-trigger" aria-label={`${label}：${selected?.name || fallbackLabel}`} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined} disabled={disabled || !choices.length}
      onPointerDown={event => { triggerPointer.current = event.pointerType; }} onPointerCancel={() => { triggerPointer.current = ''; }}
      onClick={event => {
        // Pointer taps show choices first; semantic clicks keep accessible search focus.
        const touchActivation = event.detail > 0 && (triggerPointer.current === 'touch' || triggerPointer.current === 'pen');
        triggerPointer.current = ''; open ? close() : show(!touchActivation);
      }} onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); triggerPointer.current = ''; show(); }
        else if (open && event.key === 'Escape') keyDown(event);
      }}>
      <Cpu size={17} aria-hidden="true"/><span className="workspace-model-current"><small>{label}</small><strong>{selected?.name || fallbackLabel}</strong></span><ChevronDown size={15} className={open ? 'is-open' : ''} aria-hidden="true"/>
    </button>
    {open && createPortal(<div ref={popup} className="workspace-model-popup" style={placement} onKeyDown={keyDown}>
      <div className="workspace-model-search"><Search size={17} aria-hidden="true"/><input ref={search} id={searchId} role="combobox" aria-label="搜索模型" aria-autocomplete="list" aria-expanded="true" aria-controls={listId} aria-activedescendant={active ? `${id}-option-${activeIndex}` : undefined}
        placeholder="搜索名称、模型或协议" value={query} onChange={event => { setQuery(event.target.value); setActiveIndex(0); }} autoComplete="off" autoCorrect="off" spellCheck={false}/>
        <button type="button" className="workspace-model-close" aria-label="关闭模型选择" onClick={() => close(true)}><X size={16}/></button>
      </div>
      <div className="workspace-model-list" role="listbox" id={listId} aria-label={label}>
        {filtered.map((choice, index) => <div role="option" aria-selected={choice.id === value} id={`${id}-option-${index}`} key={choice.id} className={`workspace-model-option${choice.id === value ? ' is-selected' : ''}${index === activeIndex ? ' is-focused' : ''}`}
          onPointerMove={() => setActiveIndex(index)} onMouseDown={event => event.preventDefault()} onClick={() => choose(choice)}>
          <span className="workspace-model-option-copy"><strong>{choice.name}</strong><span className="workspace-model-id">{choice.description}</span>{choice.protocol && <span className="workspace-model-meta">{choice.protocol}<span aria-hidden="true">·</span>{choice.effort}{choice.textOnly && <><span aria-hidden="true">·</span>仅文字</>}</span>}</span>
          <span className="workspace-model-selected">{choice.id === value ? <Check size={17} aria-label="已选中"/> : null}</span>
        </div>)}
      </div>
      {!filtered.length && <p className="workspace-model-empty" role="status">没有匹配的模型，试试其他关键词。</p>}
      <div className="workspace-model-footer"><span>{filtered.length} 个可用选项</span><span>↑ ↓ 选择 · Enter 确认</span></div>
    </div>, document.body)}
  </div>;
}

type ExecutionHostPickerProps = {
  hosts: AgentHost[]; value: string; onChange(hostId: string): void; disabled?: boolean; loading?: boolean; error?: string; localHostId?: string;
  label?: string; lockReason?: string; onRefresh?(): void; onDownload?(): void;
};

/** Keep the popup inside its owning controls so dialog focus and ordinary Tab continue to work. */
export function ExecutionHostPicker({hosts,value,onChange,disabled=false,loading=false,error='',localHostId='',label='执行电脑',lockReason='',onRefresh,onDownload}:ExecutionHostPickerProps) {
  const id=useId(),[query,setQuery]=useState(''),container=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const wrapper=container.current;if(!wrapper)return;
    const opened=(event:Event)=>{const details=event.target;if(details instanceof HTMLDetailsElement&&details===wrapper.querySelector('details')&&details.open)setQuery('');};
    wrapper.addEventListener('toggle',opened,true);return()=>wrapper.removeEventListener('toggle',opened,true);
  },[]);
  const choices=useMemo(()=>executionHostChoices(hosts,value,localHostId),[hosts,value,localHostId]);
  const groups=useMemo(()=>groupExecutionHosts(choices,query),[choices,query]);
  const selected=choices.find(choice=>choice.id===value),hasDesktop=hosts.some(host=>host.kind==='desktop'&&host.online);
  const legacyDesktop=typeof window!=='undefined'&&!!window.petpal&&!window.petpal.executor;
  const unavailable=!!selected&&!selected.online;
  const selectionLabel=selected?`${selected.name}${selected.disambiguator?` · ${selected.disambiguator}`:''}${selected.isLocal?' · 此电脑':''}${selected.missing?' · 未连接':!selected.online?' · 离线':''}`:loading?'正在寻找执行电脑…':'选择执行电脑';
  function choose(choice:ExecutionHostChoice,event:MouseEvent<HTMLButtonElement>){
    if(!canSelectExecutionHost(choice,disabled)||!hosts.some(host=>host.id===choice.id&&host.online))return;
    const details=event.currentTarget.closest('details');if(details){details.open=false;details.querySelector('summary')?.focus({preventScroll:true});}
    if(choice.id!==value)onChange(choice.id);
  }
  return <div ref={container} className="workspace-execution-target" aria-busy={loading}>
    <WorkspaceDisclosure className="workspace-host-picker" label={`${label}：${selectionLabel}${disabled?'，暂时不能切换':''}`} summary={<>
      {selected?.kind==='central'?<Cloud size={18} aria-hidden="true"/>:<Monitor size={18} aria-hidden="true"/>}
      <span className="workspace-host-current"><small>{label}</small><strong title={selectionLabel}>{selectionLabel}</strong></span>
      {selected&&<span className={`workspace-host-connection${unavailable?' is-offline':''}`} aria-hidden="true"/>}
    </>}>
      <div className="workspace-host-menu-heading"><h3>选择执行电脑</h3>{onRefresh&&<button type="button" className="workspace-host-refresh" disabled={loading} aria-label={`刷新${label}`} onClick={onRefresh}>{loading?<Loader2 size={17} className="spin" aria-hidden="true"/>:<RefreshCw size={17} aria-hidden="true"/>}</button>}</div>
      <label className="workspace-host-search" htmlFor={`${id}-search`}><Search size={17} aria-hidden="true"/><input id={`${id}-search`} aria-label={`搜索${label}`} placeholder="搜索电脑名称或系统" value={query} onChange={event=>setQuery(event.target.value)} autoComplete="off" autoCorrect="off" spellCheck={false}/></label>
      {disabled&&<p className="workspace-host-lock" role="status"><LockKeyhole size={15} aria-hidden="true"/><span>{lockReason||'本次任务的执行电脑已固定，完成后可以切换。'}</span></p>}
      <div className="workspace-host-groups">
        {groups.map(group=><section className="workspace-host-group" key={group.id} aria-labelledby={`${id}-${group.id}`}><h4 id={`${id}-${group.id}`}>{group.label}<span>{group.choices.length}</span></h4>
          {group.choices.map(choice=><button type="button" className={`workspace-host-option${choice.id===value?' is-selected':''}`} key={choice.id} aria-pressed={choice.id===value} disabled={!canSelectExecutionHost(choice,disabled)} onClick={event=>choose(choice,event)}>
            <span className="workspace-host-option-icon">{choice.kind==='central'?<Cloud size={17} aria-hidden="true"/>:<Monitor size={17} aria-hidden="true"/>}</span>
            <span className="workspace-host-option-copy"><strong title={choice.name}>{choice.name}</strong><span>{choice.platformLabel}{choice.isLocal?' · 此电脑':''} · {choice.missing?'未连接':choice.online?'已连接':'离线'}{choice.disambiguator&&<> · {choice.disambiguator}</>}</span><small>{choice.note}</small></span>
            <span className="workspace-host-selected">{choice.id===value&&<Check size={17} aria-label="已选中"/>}</span>
          </button>)}
        </section>)}
        {!groups.length&&<p className="workspace-host-empty" role="status">{query.trim()?'没有匹配的电脑，试试名称或 Windows、Ubuntu。':loading?'正在寻找执行电脑…':'还没有可选的执行电脑。'}</p>}
      </div>
      {selected?.kind==='central'&&<p className="workspace-host-server-note">当前任务在服务器执行。操作 QQ 音乐等电脑软件时，请选择对应的桌面电脑。</p>}
      {!hasDesktop&&!loading&&<div className="workspace-host-guide"><strong>连接你的电脑</strong><p>{legacyDesktop?'此客户端还没有执行器，请更新桌面客户端后重新登录。':'在 Windows 或 Ubuntu 客户端登录同一账号，并保持客户端运行，即可在这里选择它。'}</p>{onDownload&&<button type="button" onClick={onDownload}><Download size={16} aria-hidden="true"/>下载客户端</button>}</div>}
      <p className="workspace-host-menu-footnote">切换执行电脑后，聊天记录保持不变。</p>
    </WorkspaceDisclosure>
    {unavailable&&<span className="workspace-target-host is-offline" role="status"><span className="workspace-target-dot"/>{selected?.missing?'此前选择的电脑尚未连接，选择会保留':'所选电脑已离线，请登录客户端后再发送'}</span>}
    {error&&<span className="workspace-target-error" role="alert">{error}</span>}
  </div>;
}

export function ExecutionTarget(props:ExecutionHostPickerProps){return <ExecutionHostPicker {...props}/>;}
