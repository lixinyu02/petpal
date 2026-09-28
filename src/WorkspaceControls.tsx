import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Cloud, Cpu, Loader2, Monitor, Search, X } from 'lucide-react';
import { getConnection, getExecutionTarget, getSessionEpoch, isSessionChanged, subscribeSession, switchExecutionTarget, type Provider } from './api';
import './workspace-controls.css';

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

export function ExecutionTarget({ disabled = false, onError }: { disabled?: boolean; onError?(message: string): void }) {
  useSyncExternalStore(subscribeSession, getSessionEpoch, getSessionEpoch);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), busyRef = useRef(false), mounted = useRef(true);
  const target = getExecutionTarget(), desktop = Boolean(window.petpal);
  let hostname = '当前服务器';
  try { hostname = new URL(getConnection().url || location.origin).hostname; } catch { /* Display no raw or malformed connection data. */ }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function select(next: 'local'|'remote') {
    if (busyRef.current || disabled || next === target) return;
    busyRef.current = true; setBusy(true); setError('');
    try { await switchExecutionTarget(next); }
    catch (error) { if (!isSessionChanged(error) && mounted.current) { const message = error instanceof Error ? error.message : '无法切换执行位置，请重试。'; if (onError) onError(message); else setError(message); } }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  }
  return <div className="workspace-execution-target" aria-busy={busy}>
    {desktop ? <div className="workspace-target-segments" role="group" aria-label="执行位置">
      <button type="button" aria-pressed={target === 'local'} disabled={disabled || busy} onClick={() => void select('local')}><Monitor size={14}/>此电脑</button>
      <button type="button" aria-pressed={target === 'remote'} disabled={disabled || busy} onClick={() => void select('remote')}><Cloud size={14}/>远程主机</button>
    </div> : <span className="workspace-target-label"><Cloud size={15}/>远程主机</span>}
    <span className="workspace-target-host" title={target === 'local' ? '任务在当前电脑执行' : `任务在 ${hostname} 对应的主机执行`}>
      {busy ? <Loader2 size={12} className="spin"/> : <span className="workspace-target-dot"/>}{target === 'local' ? '本机执行' : hostname}
    </span>
    {error && <span className="workspace-target-error" role="alert">{error}</span>}
  </div>;
}
