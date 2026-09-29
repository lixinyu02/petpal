import { useEffect, useRef, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

/** Small settings stay beside their summary without moving the conversation. */
export default function WorkspaceDisclosure({ label, summary, children, className = '' }: { label: string; summary: ReactNode; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const outside = (event: PointerEvent | FocusEvent) => {
      if (ref.current?.open && !ref.current.contains(event.target as Node)) ref.current.open = false;
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); };
  }, []);
  return <details ref={ref} className={`workspace-disclosure ${className}`} onKeyDown={event => {
    if (event.key === 'Escape' && ref.current?.open) {
      event.preventDefault(); event.stopPropagation(); ref.current.open = false;
      ref.current.querySelector('summary')?.focus();
    }
  }}>
    <summary aria-label={label}>{summary}<ChevronDown size={13} className="disclosure-chevron" aria-hidden="true"/></summary>
    <div className="workspace-disclosure-content">{children}</div>
  </details>;
}
