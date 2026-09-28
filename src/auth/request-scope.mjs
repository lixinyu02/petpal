export class SessionChangedError extends Error {
  constructor() { super('账号或服务已切换，旧请求已取消。'); this.name = 'SessionChangedError'; }
}
/** Requests keep immutable credentials and cannot deliver a result across an identity epoch. */
export function createRequestScope(initial = { url: '', token: '' }) {
  let connection = Object.freeze({ ...initial }), epoch = 0;
  const active = new Set(), listeners = new Set();
  return {
    connection: () => ({ ...connection }), epoch: () => epoch,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    replace(next) { epoch++; connection = Object.freeze({ ...next }); for (const controller of active) controller.abort(new SessionChangedError()); active.clear(); for (const listener of listeners) listener(); },
    begin(signal) {
      const capturedEpoch = epoch, capturedConnection = connection, controller = new AbortController();
      const abort = () => controller.abort(signal?.reason);
      if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
      active.add(controller);
      return { connection: capturedConnection, epoch: capturedEpoch, signal: controller.signal,
        assertCurrent() { if (capturedEpoch !== epoch) throw new SessionChangedError(); controller.signal.throwIfAborted(); },
        close() { active.delete(controller); signal?.removeEventListener('abort', abort); },
      };
    },
  };
}
