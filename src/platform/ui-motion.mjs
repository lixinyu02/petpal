/** UI decoration only. No render loop, polling, storage or service access. */
export function createUiMotionController(options = {}) {
  const win = options.window ?? globalThis.window, doc = options.document ?? win?.document;
  let media;
  try { media = win?.matchMedia?.('(prefers-reduced-motion: reduce)'); } catch {}
  const subscribers = new Set();
  let mounts = 0, suppressed = 0, suspended = false, previousAttribute;
  const read = () => {
    if (!doc?.documentElement || !media || typeof media.matches !== 'boolean' || suppressed || suspended || doc.visibilityState === 'hidden') return 'off';
    return media.matches ? 'reduced' : 'full';
  };
  let state = read();
  function refresh() {
    const next = read(), changed = next !== state;
    state = next;
    if (mounts && doc?.documentElement) doc.documentElement.setAttribute('data-ui-motion', state);
    if (!changed) return;
    for (const listener of [...subscribers]) listener();
    try {
      const Event = win?.Event ?? globalThis.Event;
      if (typeof Event === 'function') win?.dispatchEvent?.(new Event('petpal:ui-motion-change'));
    } catch { /* Decoration never prevents a usable interface. */ }
  }
  const hide = () => { suspended = true; refresh(); };
  const show = () => { suspended = false; refresh(); };
  return {
    snapshot: () => state,
    allows: () => read() === 'full',
    subscribe(listener) { subscribers.add(listener); return () => subscribers.delete(listener); },
    mount({ disabled = false } = {}) {
      let closed = false;
      if (!mounts++) {
        previousAttribute = doc?.documentElement?.getAttribute('data-ui-motion');
        doc?.addEventListener?.('visibilitychange', refresh);
        win?.addEventListener?.('pagehide', hide);
        win?.addEventListener?.('pageshow', show);
        if (typeof media?.addEventListener === 'function') media.addEventListener('change', refresh);
        else media?.addListener?.(refresh);
      }
      if (disabled) suppressed++;
      refresh();
      return () => {
        if (closed) return; closed = true;
        if (disabled) suppressed--;
        if (--mounts) { refresh(); return; }
        doc?.removeEventListener?.('visibilitychange', refresh);
        win?.removeEventListener?.('pagehide', hide);
        win?.removeEventListener?.('pageshow', show);
        if (typeof media?.removeEventListener === 'function') media.removeEventListener('change', refresh);
        else media?.removeListener?.(refresh);
        const root = doc?.documentElement;
        if (root) {
          if (previousAttribute == null) root.removeAttribute('data-ui-motion');
          else root.setAttribute('data-ui-motion', previousAttribute);
        }
        suspended = false; state = read();
      };
    },
  };
}

/** One committed entrance. Cancelling it consumes it; visibility cannot replay it. */
export function beginUiEntrance(node, controller) {
  if (!node || node.isConnected === false || !controller.allows()) return () => {};
  let finished = false, unsubscribe = () => {};
  const finish = () => {
    if (finished) return; finished = true;
    node.removeAttribute('data-ui-enter');
    node.removeEventListener('animationend', ended);
    node.removeEventListener('animationcancel', ended);
    unsubscribe();
  };
  const ended = event => { if (event.target === node) finish(); };
  node.setAttribute('data-ui-enter', 'true');
  node.addEventListener('animationend', ended);
  node.addEventListener('animationcancel', ended);
  unsubscribe = controller.subscribe(() => { if (!controller.allows()) finish(); });
  return finish;
}
