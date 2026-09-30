import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import './workspace-disclosure.css';

/** Small settings stay beside their summary without moving the conversation. */
export default function WorkspaceDisclosure({ label, summary, children, className = '' }: { label: string; summary: ReactNode; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<CSSProperties>();
  useEffect(() => {
    const outside = (event: PointerEvent | FocusEvent) => {
      if (ref.current?.open && !ref.current.contains(event.target as Node)) ref.current.open = false;
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); };
  }, []);
  useLayoutEffect(() => {
    if (!open) return;
    let frame = 0;
    const place = () => {
      const anchor = ref.current?.querySelector('summary')?.getBoundingClientRect(), content = contentRef.current;
      if (!anchor || !content) return;
      const viewport = window.visualViewport;
      const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
      const width = viewport?.width || window.innerWidth, height = viewport?.height || window.innerHeight;
      const gutter = 12, gap = 7;
      const preferredWidth = className.includes('agent-permissions') ? 350 : className.includes('speech-options') ? 310 : 320;
      const menuWidth = Math.min(preferredWidth, Math.max(1, width - gutter * 2));
      const below = top + height - anchor.bottom - gutter - gap, above = anchor.top - top - gutter - gap;
      const naturalHeight = Math.min(420, content.scrollHeight + 2);
      const prefersAbove = className.includes('agent-permissions') || className.includes('speech-options');
      const opensAbove = prefersAbove ? above >= naturalHeight || above > below : below < naturalHeight && above > below;
      const available = opensAbove ? above : below;
      // A very short keyboard viewport still gets a scrollable, reachable panel.
      const maxHeight = Math.max(1, Math.min(420, height - gutter * 2, available < 100 ? height - gutter * 2 : available));
      const renderedHeight = Math.min(naturalHeight, maxHeight);
      const menuTop = Math.max(top + gutter, Math.min(opensAbove ? anchor.top - renderedHeight - gap : anchor.bottom + gap, top + height - gutter - renderedHeight));
      const next: CSSProperties = { position: 'fixed', left: Math.max(left + gutter, Math.min(anchor.left, left + width - gutter - menuWidth)), top: menuTop, right: 'auto', bottom: 'auto', width: menuWidth, maxWidth: menuWidth, maxHeight };
      setPlacement(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(place); };
    place();
    const observer = new ResizeObserver(schedule);
    if (contentRef.current) observer.observe(contentRef.current);
    window.addEventListener('resize', schedule); window.addEventListener('scroll', schedule, true);
    window.visualViewport?.addEventListener('resize', schedule); window.visualViewport?.addEventListener('scroll', schedule);
    return () => {
      cancelAnimationFrame(frame); observer.disconnect();
      window.removeEventListener('resize', schedule); window.removeEventListener('scroll', schedule, true);
      window.visualViewport?.removeEventListener('resize', schedule); window.visualViewport?.removeEventListener('scroll', schedule);
    };
  }, [open, className]);
  return <details ref={ref} className={`workspace-disclosure ${className}`} onToggle={event => setOpen(event.currentTarget.open)} onKeyDown={event => {
    if (event.key === 'Escape' && ref.current?.open) {
      event.preventDefault(); event.stopPropagation(); ref.current.open = false;
      ref.current.querySelector('summary')?.focus();
    }
  }}>
    <summary aria-label={label}>{summary}<ChevronDown size={13} className="disclosure-chevron" aria-hidden="true"/></summary>
    <div ref={contentRef} className="workspace-disclosure-content" style={placement}>{children}</div>
  </details>;
}
