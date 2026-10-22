'use strict';

const path = require('node:path');
const nativeFs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');

const PREFERENCES = new Set(['day', 'night', 'auto']);
const COLORS = Object.freeze({ day: '#fafbf8', night: '#151515' });
const MAX_BYTES = 1024;
const missing = error => error?.code === 'ENOENT';
const failure = kind => Object.assign(new Error({
  invalid: '外观选项无效。',
  untrusted: '外观设置仅允许可信主窗口管理。',
  background: '请回到小伴主窗口后再保存外观设置。',
  closing: '小伴正在退出，请稍后重新打开。',
  unavailable: '外观设置暂时不可用，请重新打开小伴后重试。',
}[kind]), { code: `PETPAL_APPEARANCE_${kind.toUpperCase()}` });
function preference(value) {
  if (!PREFERENCES.has(value)) throw failure('invalid');
  return value;
}
function effectiveTheme(value, date = new Date()) {
  const selected = preference(value);
  return selected === 'auto' ? date.getHours() >= 7 && date.getHours() < 19 ? 'day' : 'night' : selected;
}
function publicSnapshot(value) {
  return Object.freeze({ preference: preference(value.preference), theme: value.theme === 'night' ? 'night' : 'day', saved: value.saved === true });
}
function appearanceArguments(value, sessionId) {
  const snapshot = publicSnapshot(value);
  const args = [`--petpal-appearance=${snapshot.preference}:${snapshot.theme}:${snapshot.saved ? '1' : '0'}`];
  if (typeof sessionId === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(sessionId)) args.push(`--petpal-appearance-session=${sessionId}`);
  return args;
}

/** A visual preference shared across the desktop's changing loopback origins. */
function createAppearance({ app, nativeTheme, fs = nativeFs, now = () => new Date(),
  setTimeout: schedule = globalThis.setTimeout, clearTimeout: cancel = globalThis.clearTimeout, onChanged = () => {},
} = {}) {
  const directory = app.getPath('userData'), file = path.join(directory, 'appearance.json');
  let value = publicSnapshot({ preference: 'day', theme: 'day', saved: false });
  let queue = Promise.resolve(), timer = null, closing = false, blocked = false, appliedTheme = null;
  const assertOpen = () => { if (closing) throw failure('closing'); };
  const enqueue = action => {
    const operation = queue.then(action);
    queue = operation.catch(() => {});
    return operation;
  };
  function apply(nextPreference = value.preference, saved = value.saved) {
    const next = publicSnapshot({ preference: nextPreference, theme: effectiveTheme(nextPreference, now()), saved });
    const changed = next.preference !== value.preference || next.theme !== value.theme || next.saved !== value.saved;
    value = next;
    if (appliedTheme !== next.theme) {
      // "auto" means the existing 07:00-19:00 schedule, never the OS theme.
      nativeTheme.themeSource = next.theme === 'night' ? 'dark' : 'light';
      appliedTheme = next.theme;
    }
    if (changed) onChanged(next);
    return next;
  }
  function reschedule() {
    if (timer !== null) { cancel(timer); timer = null; }
    if (closing || value.preference !== 'auto') return;
    const date = now(), boundary = new Date(date.getTime());
    if (date.getHours() < 7) boundary.setHours(7, 0, 0, 0);
    else if (date.getHours() < 19) boundary.setHours(19, 0, 0, 0);
    else { boundary.setDate(boundary.getDate() + 1); boundary.setHours(7, 0, 0, 0); }
    timer = schedule(() => {
      timer = null;
      if (!closing) { apply(); reschedule(); }
    }, Math.max(1, Math.min(60000, boundary.getTime() - date.getTime())));
    timer?.unref?.();
  }
  async function checkFile() {
    try {
      const info = await fs.lstat(file);
      if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_BYTES) throw new Error('Invalid appearance file');
      return true;
    } catch (error) { if (missing(error)) return false; throw error; }
  }
  async function read() {
    if (!await checkFile()) return null;
    let handle;
    try {
      handle = await fs.open(file, 'r');
      const info = await handle.stat();
      if (!info.isFile() || info.size > MAX_BYTES) throw new Error('Invalid appearance file');
      const bytes = Buffer.alloc(MAX_BYTES + 1), result = await handle.read(bytes, 0, bytes.length, 0);
      if (result.bytesRead > MAX_BYTES) throw new Error('Oversized appearance file');
      const stored = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, result.bytesRead)));
      if (!stored || Array.isArray(stored) || Object.keys(stored).length !== 2 || stored.version !== 1 || !Object.hasOwn(stored, 'preference')) throw new Error('Invalid appearance record');
      return preference(stored.preference);
    } finally { await handle?.close(); }
  }
  async function persist(selected, authorize) {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const info = await fs.lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Invalid appearance directory');
    await checkFile();
    const temporary = path.join(directory, `.appearance-${randomUUID()}.tmp`);
    let handle, renamed = false;
    try {
      handle = await fs.open(temporary, 'wx', 0o600);
      await handle.writeFile(`${JSON.stringify({ version: 1, preference: selected })}\n`);
      await handle.sync(); await handle.close(); handle = null;
      assertOpen(); await authorize(); assertOpen();
      await checkFile();
      assertOpen(); await authorize(); assertOpen();
      await fs.rename(temporary, file); renamed = true;
    } finally {
      await handle?.close().catch(() => {});
      if (!renamed) await fs.unlink(temporary).catch(() => {});
    }
  }
  return {
    current: () => value,
    load: () => enqueue(async () => {
      assertOpen();
      let selected = null;
      try { selected = await read(); blocked = false; }
      catch { blocked = true; }
      assertOpen(); apply(selected || 'day', selected !== null && !blocked); reschedule();
      return value;
    }),
    refresh() { if (!closing) { apply(); reschedule(); } return value; },
    setPreference(selected, { authorize = () => {} } = {}) {
      preference(selected);
      return enqueue(async () => {
        assertOpen(); await authorize(); assertOpen();
        let saved = false;
        if (!blocked) {
          try { await persist(selected, authorize); saved = true; }
          catch (error) {
            if (/^PETPAL_APPEARANCE_(?:UNTRUSTED|BACKGROUND|CLOSING)$/.test(error?.code || '')) throw error;
            // Keep a damaged or inaccessible file intact; this session can still
            // choose an appearance without reporting that it was persisted.
          }
        }
        assertOpen(); await authorize(); assertOpen();
        apply(selected, saved); reschedule();
        return value;
      });
    },
    close() {
      closing = true;
      if (timer !== null) { cancel(timer); timer = null; }
      return queue;
    },
  };
}

function createAppearanceHandlers(appearance, { isAllowed, isForeground }) {
  const sanitize = error => {
    if (/^PETPAL_APPEARANCE_(?:INVALID|UNTRUSTED|BACKGROUND|CLOSING)$/.test(error?.code || '')) return error;
    return failure('unavailable');
  };
  const authorize = (event, mutation = false) => {
    let allowed = false;
    try { allowed = isAllowed(event); } catch {}
    if (!allowed) throw failure('untrusted');
    if (mutation) {
      let foreground = false;
      try { foreground = isForeground(event); } catch {}
      if (!foreground) throw failure('background');
    }
  };
  return {
    'petpal:appearance:status': async event => {
      authorize(event);
      try { return publicSnapshot(appearance.refresh()); } catch (error) { throw sanitize(error); }
    },
    'petpal:appearance:set-preference': async (event, selected) => {
      authorize(event, true); preference(selected);
      try {
        const result = await appearance.setPreference(selected, { authorize: () => authorize(event, true) });
        authorize(event, true);
        return publicSnapshot(result);
      } catch (error) { throw sanitize(error); }
    },
  };
}

module.exports = { createAppearance, createAppearanceHandlers, appearanceArguments, effectiveTheme, COLORS };
