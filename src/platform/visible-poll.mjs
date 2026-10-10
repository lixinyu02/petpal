/**
 * Owns non-task UI polling while the page is visible and online. Aborting a run
 * never frees its slot: resume waits for that exact promise to settle, even if
 * the consumer does not observe AbortSignal. Consumers still guard UI writes
 * with the supplied signal and their account/session generation.
 */
export function createVisiblePoll({
  document, window, intervalMs, run, isCurrent = () => true,
  setTimeoutFn = (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimeoutFn = timer => globalThis.clearTimeout(timer),
}) {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new TypeError('Polling interval must be positive.');
  if (typeof run !== 'function' || typeof isCurrent !== 'function' || typeof setTimeoutFn !== 'function' || typeof clearTimeoutFn !== 'function') throw new TypeError('Polling callbacks must be functions.');
  if (!document?.addEventListener || !document?.removeEventListener || !window?.addEventListener || !window?.removeEventListener) throw new TypeError('Polling requires document and window event targets.');

  let disposed = false, timer = null, active = null, ready = false, refreshRequested = false;
  let online = window.navigator?.onLine !== false;
  const current = () => {
    try { return !disposed && isCurrent(); } catch { return false; }
  };
  const eligible = () => current() && !document.hidden && online;
  const clearTimer = () => {
    if (timer !== null) { clearTimeoutFn(timer); timer = null; }
  };
  const pause = () => {
    ready = false; refreshRequested = false; clearTimer();
    active?.controller.abort();
  };
  const schedule = () => {
    if (!eligible()) { pause(); return; }
    clearTimer();
    timer = setTimeoutFn(() => {
      timer = null;
      if (!eligible()) { pause(); return; }
      start();
    }, intervalMs);
  };
  const start = () => {
    if (active || !eligible()) return;
    clearTimer(); refreshRequested = false;
    const owner = { controller: new AbortController() };
    active = owner;
    const settled = () => {
      if (active !== owner) return;
      active = null;
      if (!eligible()) { pause(); return; }
      if (refreshRequested) start(); else schedule();
    };
    // Assign ownership before invoking run: synchronous errors and lifecycle
    // events raised by the consumer must obey the same single-flight boundary.
    let result;
    try { result = run(owner.controller.signal); } catch (error) { result = Promise.reject(error); }
    Promise.resolve(result).then(settled, settled);
  };
  const reconcile = () => {
    if (!eligible()) { pause(); return; }
    // Repeated visible/online events do not steal a timer or request an extra
    // refresh when a healthy run is already in progress.
    if (ready) return;
    ready = true; refreshRequested = true; clearTimer(); start();
  };
  const onOnline = () => { online = true; reconcile(); };
  const onOffline = () => { online = false; reconcile(); };
  document.addEventListener('visibilitychange', reconcile);
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  reconcile();

  return () => {
    if (disposed) return;
    disposed = true; pause();
    document.removeEventListener('visibilitychange', reconcile);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
  };
}
