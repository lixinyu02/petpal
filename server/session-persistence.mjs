import { rememberedSessionPatch, sessionIsActive } from './auth.mjs';

const renewalFields = ['rememberDevice', 'absoluteExpiresAt', 'expiresAt', 'renewedAt', 'lastSeenAt'];
const invalid = () => Object.assign(new Error('登录凭据已过期或已撤销。'), { status: 401, code: 'session_invalid' });

/** Renewal is staged in the store queue and published only after atomic save. */
export function createSessionPersistence(store, { clock = Date.now } = {}) {
  let durable = new Map(store.state.sessions.map(session => [session.tokenHash, structuredClone(session)]));
  const prepared = new WeakMap();
  const current = action => {
    action.authorize?.();
    if (!store.state.sessions.includes(action.session) || !sessionIsActive(action.session, clock())) throw invalid();
  };
  return {
    prepare(snapshot, action) {
      const captured = new Map(snapshot.sessions.map(session => [session.tokenHash, session]));
      // A queued old snapshot cannot drop a newer durable login, undo a renewal,
      // or reintroduce a token that logout/revocation removed from live state.
      snapshot.sessions = store.state.sessions.flatMap(live => {
        const saved = durable.get(live.tokenHash), value = captured.get(live.tokenHash) ?? saved;
        if (!value || value.userId !== live.userId) return [];
        const merged = structuredClone(value);
        if (saved?.rememberDevice === true) for (const key of renewalFields) merged[key] = saved[key];
        return [merged];
      });
      if (action === undefined) return;
      if (!action || !action.session || typeof action.authorize !== 'function') throw new Error('登录续期持久化操作无效。');
      current(action);
      const target = snapshot.sessions.find(session => session.tokenHash === action.session.tokenHash && session.userId === action.session.userId);
      if (!target) throw invalid();
      const patch = rememberedSessionPatch(action.session, clock());
      if (patch) Object.assign(target, patch);
      prepared.set(snapshot, { action, patch });
    },
    beforeCommit(snapshot) {
      const staged = prepared.get(snapshot);
      if (staged) current(staged.action);
      const live = new Map(store.state.sessions.map(session => [session.tokenHash, session]));
      if (snapshot.sessions.some(session => live.get(session.tokenHash)?.userId !== session.userId)) {
        // Never commit a captured token after a concurrent revocation. Its
        // ordinary revocation save will follow in the same durable queue.
        throw Object.assign(new Error('登录状态在保存期间发生变化，请重试。'), { status: 401 });
      }
    },
    commit(snapshot) {
      durable = new Map(snapshot.sessions.map(session => [session.tokenHash, structuredClone(session)]));
      const staged = prepared.get(snapshot);
      if (staged?.patch && store.state.sessions.includes(staged.action.session)) Object.assign(staged.action.session, staged.patch);
      prepared.delete(snapshot);
    },
  };
}
