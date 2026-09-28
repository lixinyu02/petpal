const RECORD_KEY = 'petpal.companionPreference';
const LEGACY_KEY = 'petpal.companionKind';
const valid = value => value === 'anime' || value === 'cat';
const assertKind = value => { if (!valid(value)) throw new TypeError('Companion kind must be anime or cat.'); };

export function overlayCompanion(search) {
  const params = new URLSearchParams(search);
  const value = params.get('avatar');
  return (params.has('overlay') || params.has('pet')) && valid(value) ? value : null;
}

/** Local-first preference with one serialized remote-write queue; no browser or React dependency. */
export function createCompanionPreference({ storage, scope, allowLegacy = false, connected = () => false, persist = async () => {} } = {}) {
  const recordKey = scope ? `${RECORD_KEY}:${encodeURIComponent(scope)}` : RECORD_KEY;
  let disposed = false;
  const read = () => {
    try {
      const raw = storage?.getItem(recordKey);
      if (raw) {
        try { const value = JSON.parse(raw); if (valid(value.kind) && typeof value.dirty === 'boolean') return value; } catch {}
      }
      const legacy = !scope || allowLegacy ? storage?.getItem(LEGACY_KEY) : null;
      return valid(legacy) ? { kind: legacy, dirty: false } : null;
    } catch { return null; }
  };
  let { kind, dirty } = read() ?? { kind: 'anime', dirty: false };
  let revision = 0, queue = Promise.resolve();
  const listeners = new Set();
  const notify = () => { for (const listener of listeners) listener(); };
  const write = () => {
    // The single record preserves kind + pending status together across reloads.
    if (disposed) return;
    try { storage?.setItem(recordKey, JSON.stringify({ kind, dirty })); }
    catch { return; } // Keep the in-memory value usable when storage is denied/full.
    if (!scope) try { storage?.setItem(LEGACY_KEY, kind); } catch {}
  };
  const refresh = () => {
    if (disposed) return;
    const stored = read();
    if (stored && (stored.kind !== kind || stored.dirty !== dirty)) {
      kind = stored.kind; dirty = stored.dirty; ++revision; notify();
    }
  };
  const sync = () => {
    const task = queue.then(async () => {
      while (!disposed && dirty && connected()) {
        const sentKind = kind, sentRevision = revision;
        await persist(sentKind);
        // A newer local choice must never be acknowledged by an older HTTP response.
        if (!disposed && revision === sentRevision && kind === sentKind) { dirty = false; write(); notify(); }
      }
    });
    queue = task.catch(() => {}); // A failed request must not poison later retries.
    return task;
  };
  const remember = next => {
    assertKind(next);
    if (disposed || dirty) return;
    kind = next; ++revision; write(); notify();
  };
  return {
    snapshot: () => ({ kind, dirty, revision }),
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    refresh,
    remember,
    choose: next => { assertKind(next); if(disposed)return Promise.reject(new Error('Preference scope has been disposed.')); kind = next; dirty = true; ++revision; write(); notify(); return sync(); },
    hydrate: serverKind => { assertKind(serverKind); if(disposed)return Promise.resolve(); if (dirty) return sync(); remember(serverKind); return Promise.resolve(); },
    dispose: () => { disposed = true; ++revision; listeners.clear(); },
  };
}
