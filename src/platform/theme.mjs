export const THEME_STORAGE_KEY = 'petpal.theme';
export const THEME_COLORS = Object.freeze({ day: '#fafbf8', night: '#181d1b' });
export const THEME_CHROME_COLORS = Object.freeze({ day: '#f6f7f2', night: '#181d1b' });
const preferences = new Set(['auto', 'day', 'night']);
export const normalizeThemePreference = value => preferences.has(value) ? value : 'auto';

export function effectiveTheme(preference, date = new Date()) {
  const selected = normalizeThemePreference(preference);
  if (selected !== 'auto') return selected;
  const hour = date.getHours();
  return hour >= 7 && hour < 19 ? 'day' : 'night';
}

export function nextThemeBoundary(date = new Date()) {
  const next = new Date(date.getTime()), hour = date.getHours();
  if (hour < 7) next.setHours(7, 0, 0, 0);
  else if (hour < 19) next.setHours(19, 0, 0, 0);
  else { next.setDate(next.getDate() + 1); next.setHours(7, 0, 0, 0); }
  return next;
}

/** Local appearance only: no identity, API calls, tasks, or native permissions. */
export function createThemeController(options = {}) {
  const win = options.window ?? globalThis.window, doc = options.document ?? win?.document;
  const now = options.now ?? (() => new Date());
  const schedule = options.setTimeout ?? ((callback, delay) => win.setTimeout(callback, delay));
  const cancel = options.clearTimeout ?? (id => win.clearTimeout(id));
  const storage = () => Object.hasOwn(options, 'storage') ? options.storage : win?.localStorage;
  const listeners = new Set();
  let mounts = 0, timer = null, ephemeral = false;
  let transparent = doc?.documentElement?.dataset?.petpalSurface === 'transparent';
  const read = () => {
    try { const source = storage(); return source ? { available: true, preference: normalizeThemePreference(source.getItem(THEME_STORAGE_KEY)) } : { available: false }; }
    catch { return { available: false }; }
  };
  const initial = read();
  let state = Object.freeze({ preference: initial.preference ?? 'auto', theme: effectiveTheme(initial.preference, now()), saved: initial.available });

  function apply() {
    const root = doc?.documentElement;
    if (!root) return;
    root.dataset.theme = state.theme; root.dataset.themePreference = state.preference;
    if (transparent) root.dataset.petpalSurface = 'transparent'; else delete root.dataset.petpalSurface;
    root.style.colorScheme = state.theme === 'night' ? 'dark' : 'light';
    root.style.backgroundColor = transparent ? 'transparent' : THEME_COLORS[state.theme];
    doc.querySelector?.('meta[name="theme-color"]')?.setAttribute('content', THEME_CHROME_COLORS[state.theme]);
  }

  function publish(preference = state.preference, saved = state.saved) {
    const theme = effectiveTheme(preference, now());
    const changed = preference !== state.preference || theme !== state.theme || saved !== state.saved;
    if (changed) state = Object.freeze({ preference, theme, saved });
    apply();
    if (changed) for (const listener of listeners) listener();
  }

  function reschedule() {
    if (timer !== null) { cancel(timer); timer = null; }
    if (!mounts || state.preference !== 'auto' || doc?.visibilityState === 'hidden') return;
    const date = now(), delay = Math.max(1, Math.min(60_000, nextThemeBoundary(date).getTime() - date.getTime()));
    // A bounded clock check also catches local clock/time-zone changes while open.
    timer = schedule(() => { timer = null; publish(); reschedule(); }, delay);
  }

  function refresh({ fromStorage = false } = {}) {
    if (fromStorage || !ephemeral) {
      const next = read();
      if (next.available) { ephemeral = false; publish(next.preference, true); }
      else publish(state.preference, false);
    } else publish();
    reschedule();
  }
  const visible = () => { if (doc?.visibilityState !== 'hidden') refresh(); else reschedule(); };
  const focus = () => refresh();
  const changed = event => {
    if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
    try { if (event.storageArea && event.storageArea !== storage()) return; } catch { return; }
    refresh({ fromStorage: true });
  };

  apply();
  return {
    snapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setPreference(preference) {
      if (!preferences.has(preference)) throw new TypeError('Unknown theme preference');
      let saved = false;
      try { const source = storage(); if (source) { source.setItem(THEME_STORAGE_KEY, preference); saved = source.getItem(THEME_STORAGE_KEY) === preference; } } catch {}
      ephemeral = !saved; publish(preference, saved); reschedule();
    },
    refresh,
    mount(surface = {}) {
      if (typeof surface.transparent === 'boolean') transparent = surface.transparent;
      if (++mounts === 1) {
        win?.addEventListener('storage', changed); win?.addEventListener('focus', focus);
        doc?.addEventListener('visibilitychange', visible);
      }
      refresh();
      let active = true;
      return () => {
        if (!active) return; active = false;
        if (--mounts) return;
        if (timer !== null) { cancel(timer); timer = null; }
        win?.removeEventListener('storage', changed); win?.removeEventListener('focus', focus);
        doc?.removeEventListener('visibilitychange', visible);
      };
    },
  };
}
