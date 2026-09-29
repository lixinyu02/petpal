import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, CircleHelp, Cloud, Cpu, Loader2, Monitor, RefreshCw, Search, X } from 'lucide-react';
import type { AgentHost, Provider } from './api';
import { executionPlatform } from './execution-hosts.mjs';
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
  const id = useId(), listId = `${id}-models`, searchId = `${id}-search`;
  const choices = useMemo<ModelChoice[]>(() => [
    ...(fallbackOption ? [{ id: '', name: fallbackOption.label, description: fallbackOption.description || '使用执行主机上的 Codex 配置', search: `${fallbackOption.label} ${fallbackOption.description || ''}`.toLocaleLowerCase() }] : []),
    ...providers.map(provider => ({ id: provider.id, name: provider.name, description: provider.model, protocol: protocolLabel(provider.protocol), effort: effortLabel(provider.reasoningEffort), textOnly: provider.supportsImages === false,
      search: `${provider.name} ${provider.model} ${protocolLabel(provider.protocol)} ${effortLabel(provider.reasoningEffort)}`.toLocaleLowerCase() })),
  ], [providers, fallbackOption?.label, fallbackOption?.description]);
  const filtered = useMemo(() => choices.filter(choice => choice.search.includes(query.trim().toLocaleLowerCase())), [choices, query]);
  const selected = choices.find(choice => choice.id === value), active = filtered[activeIndex];

  function close(restoreFocus = false) { setOpen(false); if (restoreFocus) trigger.current?.focus(); }
  function show() {
    if (disabled || !choices.length) return;
    setQuery(''); setActiveIndex(Math.max(0, choices.findIndex(choice => choice.id === value))); setOpen(true);
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
    const place = () => {
      const anchor = trigger.current?.getBoundingClientRect(); if (!anchor) return;
      const viewport = window.visualViewport, width = viewport?.width || window.innerWidth, height = viewport?.height || window.innerHeight;
      const offsetTop = viewport?.offsetTop || 0, offsetLeft = viewport?.offsetLeft || 0;
      const menuWidth = Math.min(360, width - 24), below = height + offsetTop - anchor.bottom - 16, above = anchor.top - offsetTop - 16;
      const opensAbove = below < 220 && above > below, maxHeight = Math.max(150, Math.min(430, opensAbove ? above : below));
      setPlacement({ left: Math.max(offsetLeft + 12, Math.min(anchor.left, width + offsetLeft - menuWidth - 12)), top: opensAbove ? Math.max(offsetTop + 12, anchor.top - maxHeight - 8) : Math.max(offsetTop + 12, anchor.bottom + 8), width: menuWidth, maxHeight });
    };
    place(); search.current?.focus({ preventScroll: true });
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true); window.visualViewport?.addEventListener('resize', place);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); window.visualViewport?.removeEventListener('resize', place); };
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
      onClick={() => open ? close() : show()} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); show(); } }}>
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

export function ExecutionTarget({ hosts, value, onChange, disabled = false, loading = false, error = '', localHostId = '', onRefresh }: {
  hosts: AgentHost[]; value: string; onChange(hostId: string): void; disabled?: boolean; loading?: boolean; error?: string; localHostId?: string; onRefresh?(): void;
}) {
  const id = useId(), selected = hosts.find(host => host.id === value);
  const hasDesktop = hosts.some(host => host.kind === 'desktop' && host.online);
  const legacyDesktop = typeof window !== 'undefined' && window.petpal && !window.petpal.executor;
  return <div className="workspace-execution-target" aria-busy={loading}>
    <div className="workspace-host-control" title={disabled ? '本次任务的执行电脑已固定' : undefined}>
      {selected?.kind === 'central' ? <Cloud size={17} aria-hidden="true"/> : <Monitor size={17} aria-hidden="true"/>}
      <label htmlFor={id}><span>执行电脑</span><select id={id} aria-label="执行电脑" value={value} disabled={disabled || (loading && !hosts.length)} onChange={event => {
        if (hosts.some(host => host.id === event.target.value && host.online)) onChange(event.target.value);
      }}>
        {!selected && <option value={value} disabled>{value ? '此前选择的电脑 · 未连接' : loading ? '正在寻找执行电脑…' : '选择执行电脑'}</option>}
        {hosts.map(host => <option key={host.id} value={host.id} disabled={!host.online}>{host.name}{host.id === localHostId ? ' · 此电脑' : ''} · {host.kind === 'central' ? '服务器' : executionPlatform(host.platform)} · {host.online ? '在线' : '离线'}</option>)}
      </select></label>
      {onRefresh && <button type="button" className="workspace-host-refresh" disabled={loading} aria-label="刷新执行电脑" onClick={onRefresh}>{loading ? <Loader2 size={14} className="spin"/> : <RefreshCw size={14}/>}</button>}
      <WorkspaceDisclosure className="workspace-host-help" label="连接执行电脑帮助" summary={<CircleHelp size={15}/>}>
        <h3>选择执行电脑</h3>
        <p>{legacyDesktop ? '此客户端还没有执行器，请从「下载客户端」更新后重新登录。' : '在 Windows 或 Ubuntu 客户端登录同一账号，即可在这里选择它。客户端需要保持运行。'}</p>
        <p>{disabled ? '本次任务的执行电脑已固定，完成后可以切换。' : '切换电脑后，账号与聊天记录仍保留在个人服务。'}</p>
        {!hasDesktop && !loading && <p>目前没有已连接的桌面电脑。</p>}
      </WorkspaceDisclosure>
    </div>
    {selected && !selected.online && <span className="workspace-target-host is-offline" role="status"><span className="workspace-target-dot"/>电脑已离线，请登录客户端后再发送</span>}
    {error && <span className="workspace-target-error" role="alert">{error}</span>}
  </div>;
}
