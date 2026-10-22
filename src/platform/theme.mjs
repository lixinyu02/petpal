export const THEME_STORAGE_KEY = 'petpal.theme';
export const THEME_NATIVE_SESSION_KEY = 'petpal.theme.native-session';
export const THEME_COLORS = Object.freeze({ day: '#fafbf8', night: '#1f1e1b' });
export const THEME_CHROME_COLORS = Object.freeze({ day: '#f6f7f2', night: '#1f1e1b' });
const preferences = new Set(['auto', 'day', 'night']);
export const normalizeThemePreference = value => preferences.has(value) ? value : 'day';

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
  const appearance = Object.hasOwn(options, 'appearance') ? options.appearance : win?.petpal?.appearance;
  const native = appearance && typeof appearance.setPreference === 'function' ? appearance : null;
  const validSnapshot = value => !!value && preferences.has(value.preference) && typeof value.saved === 'boolean';
  let seed = null;
  try { if (validSnapshot(native?.initial)) seed = native.initial; } catch {}
  const listeners = new Set();
  let mounts = 0, timer = null, ephemeral = false;
  let revision = 0, nativeRequest = 0, attempted = '', lifecycle = 0, hydrating = false;
  let nativeReady = !native?.status, nativeSavedPreference = seed?.saved ? seed.preference : null;
  let transparent = doc?.documentElement?.dataset?.petpalSurface === 'transparent';
  if (transparent) { seed = null; nativeSavedPreference = null; }
  const read = () => {
    try { const source = storage(), raw = source?.getItem(THEME_STORAGE_KEY); return source ? { available: true, valid: preferences.has(raw), preference: normalizeThemePreference(raw) } : { available: false }; }
    catch { return { available: false }; }
  };
  const initial = read();
  let preference = initial.preference ?? 'day', sameNativeSession = false;
  if (seed?.sessionId) try { sameNativeSession = storage()?.getItem(THEME_NATIVE_SESSION_KEY) === seed.sessionId; } catch {}
  if (seed?.saved && (!initial.valid || seed.sessionId && !sameNativeSession)) preference = seed.preference;
  if (native && seed?.sessionId) {
    try { const source = storage(); source?.setItem(THEME_STORAGE_KEY, preference); source?.setItem(THEME_NATIVE_SESSION_KEY, seed.sessionId); ephemeral = source?.getItem(THEME_STORAGE_KEY) !== preference; } catch { ephemeral = true; }
  }
  let state = Object.freeze({ preference, theme: effectiveTheme(preference, now()), saved: native ? nativeSavedPreference === preference : initial.available });

  const savedFor = (selected, localSaved) => native ? nativeSavedPreference === selected : localSaved;
  function syncNative() {
    if (!native || !nativeReady || !mounts || transparent || doc?.visibilityState === 'hidden') return;
    const selected = state.preference, key = `${selected}/${state.theme}`;
    if (attempted === key) return;
    attempted = key;
    const request = ++nativeRequest, generation = lifecycle;
    Promise.resolve().then(() => native.setPreference(selected)).then(result => {
      if (!mounts || generation !== lifecycle || request !== nativeRequest || selected !== state.preference) return;
      nativeSavedPreference = validSnapshot(result) && result.saved && result.preference === selected ? selected : null;
      publish(selected, savedFor(selected, false));
    }).catch(() => {
      if (!mounts || generation !== lifecycle || request !== nativeRequest || selected !== state.preference) return;
      publish(selected, false);
    });
  }
  function hydrateNative() {
    if (!native || nativeReady || hydrating || !mounts || transparent) return;
    hydrating = true;
    const atRevision = revision, generation = lifecycle;
    Promise.resolve().then(() => native.status()).then(result => {
      if (!mounts || generation !== lifecycle) return;
      hydrating = false; nativeReady = true;
      if (validSnapshot(result) && result.saved) {
        nativeSavedPreference = result.preference;
        if (revision === atRevision) {
          let localSaved = false;
          try { const source = storage(); source?.setItem(THEME_STORAGE_KEY, result.preference); localSaved = source?.getItem(THEME_STORAGE_KEY) === result.preference; } catch {}
          ephemeral = !localSaved;
          publish(result.preference, true);
        }
      }
      syncNative();
    }).catch(() => {
      if (!mounts || generation !== lifecycle) return;
      hydrating = false; nativeReady = true; syncNative();
    });
  }

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
    syncNative();
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
      if (next.available) { ephemeral = false; publish(next.preference, savedFor(next.preference, true)); }
      else publish(state.preference, savedFor(state.preference, false));
    } else publish();
    reschedule();
  }
  const visible = () => { if (doc?.visibilityState !== 'hidden') refresh(); else reschedule(); };
  const focus = () => { attempted = ''; refresh(); };
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
      ++revision; ++nativeRequest; attempted = '';
      let saved = false;
      try { const source = storage(); if (source) { source.setItem(THEME_STORAGE_KEY, preference); saved = source.getItem(THEME_STORAGE_KEY) === preference; } } catch {}
      ephemeral = !saved; publish(preference, savedFor(preference, saved)); reschedule();
    },
    refresh,
    mount(surface = {}) {
      if (typeof surface.transparent === 'boolean') transparent = surface.transparent;
      if (++mounts === 1) {
        ++lifecycle; hydrating = false;
        win?.addEventListener('storage', changed); win?.addEventListener('focus', focus);
        doc?.addEventListener('visibilitychange', visible);
      }
      refresh();
      hydrateNative();
      let active = true;
      return () => {
        if (!active) return; active = false;
        if (--mounts) return;
        ++lifecycle; hydrating = false;
        if (timer !== null) { cancel(timer); timer = null; }
        win?.removeEventListener('storage', changed); win?.removeEventListener('focus', focus);
        doc?.removeEventListener('visibilitychange', visible);
      };
    },
  };
}
