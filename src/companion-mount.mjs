/** Narrow layouts always show the companion; once mounted, retain its state. */
export function watchCompanionBreakpoint(media, onMount) {
  let mounted = false, disposed = false;
  const change = () => {
    if (disposed || mounted || !media.matches) return;
    mounted = true; onMount();
  };
  media.addEventListener('change', change);
  change();
  return () => { disposed = true; media.removeEventListener('change', change); };
}
