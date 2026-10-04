/** A conversation has a finite entrance budget; long histories simply stay static. */
export const MESSAGE_MOTION_ID_LIMIT = 4096;

export function createMessageMotionTracker() {
  return { scope: null, seen: new Set(), saturated: false };
}

/**
 * Called after React commits. Initial history and suppressed arrivals still count
 * as seen, so streaming, delete/reinsert and visibility changes cannot replay them.
 */
export function advanceMessageMotion(tracker, scope, ids, animate) {
  const initial = tracker.scope !== scope;
  if (initial) {
    tracker.scope = scope;
    tracker.seen.clear();
    tracker.saturated = false;
  }
  if (tracker.saturated) return [];

  const counts = new Map();
  for (const id of ids) if (typeof id === 'string' && id) counts.set(id, (counts.get(id) || 0) + 1);
  const arrivals = [];
  for (const [id, count] of counts) {
    if (tracker.seen.has(id)) continue;
    if (tracker.seen.size >= MESSAGE_MOTION_ID_LIMIT) {
      // Fail closed instead of evicting an old ID that could animate again.
      tracker.saturated = true;
      tracker.seen.clear();
      return [];
    }
    tracker.seen.add(id);
    // App replaces these optimistic IDs when the server commits canonical IDs.
    // Waiting for that commit gives one entrance per logical message, not two.
    if (!initial && animate && count === 1 && !/^(?:user|pending)-\d+$/.test(id)) arrivals.push(id);
  }
  return arrivals;
}

export function canAnimateMessageMotion(document) {
  return document.visibilityState === 'visible' && document.documentElement.dataset.uiMotion === 'full';
}

/** One delegated lifecycle per mounted list; no timers, frames or observers. */
export function attachMessageMotion(list, document) {
  let disposed = false;
  const window = document.defaultView;
  const finishRow = row => {
    row.classList.remove('ui-message-enter');
    row.removeAttribute('data-ui-enter');
  };
  const clear = () => {
    for (const row of list.children) finishRow(row);
  };
  const finish = event => {
    const row = event.target;
    if (row?.parentElement === list && event.animationName === 'ui-message-enter') finishRow(row);
  };
  const policyChanged = () => {
    if (!canAnimateMessageMotion(document)) clear();
  };
  list.addEventListener('animationend', finish);
  list.addEventListener('animationcancel', finish);
  document.addEventListener('visibilitychange', policyChanged);
  window?.addEventListener('petpal:ui-motion-change', policyChanged);
  return {
    enter(ids) {
      if (disposed) return;
      if (!canAnimateMessageMotion(document)) { clear(); return; }
      if (!ids.length) return;
      const arrivals = new Set(ids);
      for (const row of list.children) if (arrivals.has(row.dataset.messageId)) {
        row.setAttribute('data-ui-enter', 'true');
        row.classList.add('ui-message-enter');
      }
    },
    clear,
    dispose() {
      if (disposed) return;
      disposed = true;
      list.removeEventListener('animationend', finish);
      list.removeEventListener('animationcancel', finish);
      document.removeEventListener('visibilitychange', policyChanged);
      window?.removeEventListener('petpal:ui-motion-change', policyChanged);
      clear();
    },
  };
}
