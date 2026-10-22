import { sanitizeMemoryText } from './memory-service.mjs';

const identity = value => typeof value === 'string' && value.length > 0 && value.length <= 180 && !/[\u0000-\u001f]/.test(value);
const aborted = () => new DOMException('辅助记忆任务已取消。', 'AbortError');

// A separate lexical scope keeps queued guards from retaining the originating
// task, its bridge, request, or conversation closure. The two flags stay live.
export const replyMemoryPrivacyGuard = privacy => () => !privacy.sensitiveInput && !privacy.privateInputProtected;

/** Own auxiliary journal work separately from response/execution lifetimes. */
export function createReplyMemoryJobs({ memory, authorize = () => true, concurrency = 2, maxPending = 64, timeoutMs = 10000, closeGraceMs = 1000 } = {}) {
  for (const [value, maximum] of [[concurrency, 16], [maxPending, 1024], [timeoutMs, 60000], [closeGraceMs, 5000]]) {
    if (!Number.isInteger(value) || value < 1 || value > maximum) throw new TypeError('辅助记忆任务限制无效。');
  }
  if (typeof authorize !== 'function') throw new TypeError('辅助记忆授权检查无效。');
  const queue = [], active = new Set(), jobs = new Map(), recent = new Set(), idleWaiters = new Set();
  const counters = { accepted: 0, completed: 0, skipped: 0, failed: 0, cancelled: 0, timedOut: 0, duplicates: 0, rejected: 0, capacityRejected: 0, closedRejected: 0 };
  let accepting = true, closed = false, scheduled = false, closing;
  const status = () => ({ ...counters, accepting, closed, active: active.size, queued: queue.length, pending: jobs.size, concurrency, maxPending });
  const refuse = reason => { counters.rejected++; if (reason === 'capacity') counters.capacityRejected++; if (reason === 'closed') counters.closedRejected++; return { queued: false, reason }; };
  const rememberKey = key => { recent.add(key); if (recent.size > 512) recent.delete(recent.values().next().value); };
  const notify = () => { if (!jobs.size) { for (const resolve of idleWaiters) resolve(); idleWaiters.clear(); } };
  const cancel = (job, timeout = false) => {
    if (!job.controller.signal.aborted) { counters.cancelled++; if (timeout) counters.timedOut++; job.controller.abort(aborted()); }
    if (!active.has(job)) { const at = queue.indexOf(job); if (at >= 0) queue.splice(at, 1); jobs.delete(job.key); rememberKey(job.key); notify(); }
  };
  const schedule = () => { if (!scheduled && !closed) { scheduled = true; queueMicrotask(pump); } };
  async function guard(job) {
    job.controller.signal.throwIfAborted();
    if (await authorize(job.userId, job.input) === false) throw aborted();
    job.controller.signal.throwIfAborted();
    if (await job.authorize?.() === false) throw aborted();
    job.controller.signal.throwIfAborted();
  }
  function pump() {
    scheduled = false;
    while (!closed && queue.length && active.size < concurrency) {
      const job = queue.shift(); active.add(job);
      const timer = setTimeout(() => cancel(job, true), timeoutMs); timer.unref?.();
      // Every rejection has an owner. Non-cooperative work retains its slot,
      // so timeouts cannot silently create unbounded physical concurrency.
      job.promise = Promise.resolve().then(async () => {
        await guard(job);
        const result = await memory.remember(job.userId, job.input, { signal: job.controller.signal, authorize: () => guard(job) });
        job.controller.signal.throwIfAborted();
        if (result?.queued === false) counters.skipped++; else counters.completed++;
      }).catch(error => {
        if (job.controller.signal.aborted) return;
        if (error?.name === 'AbortError') { counters.cancelled++; job.controller.abort(aborted()); }
        else counters.failed++;
      }).finally(() => {
        clearTimeout(timer); active.delete(job); jobs.delete(job.key); rememberKey(job.key); notify(); schedule();
      });
    }
  }
  function enqueue(userId, input, { authorize: check } = {}) {
    if (!accepting || closed) return refuse('closed');
    if (!memory?.remember) return refuse('unavailable');
    if (!identity(userId) || !input || typeof input !== 'object' || !identity(input.id) || !identity(input.conversationId) || !['chat', 'agent', 'automation'].includes(input.source) || typeof input.userText !== 'string' || typeof input.assistantText !== 'string' || check !== undefined && typeof check !== 'function') return refuse('invalid');
    if (input.sensitive === true) { counters.skipped++; return { queued: false, reason: 'sensitive' }; }
    const key = JSON.stringify([userId, input.id]);
    if (jobs.has(key) || recent.has(key)) { counters.duplicates++; return { queued: false, reason: 'duplicate' }; }
    if (jobs.size >= maxPending) return refuse('capacity');
    // The payload holds bounded immutable strings, never live messages,
    // session tokens or history. Eligibility callbacks remain live guards.
    const frozen = Object.freeze({ id: input.id, conversationId: input.conversationId, source: input.source, userText: sanitizeMemoryText(input.userText), assistantText: sanitizeMemoryText(input.assistantText), sensitive: false });
    const job = { key, userId, input: frozen, authorize: check, controller: new AbortController() };
    jobs.set(key, job); queue.push(job); counters.accepted++; schedule(); return { queued: true };
  }
  const cancelMatching = predicate => { for (const job of [...jobs.values()]) if (predicate(job)) cancel(job); };
  const stopAccepting = () => { accepting = false; };
  const close = () => closing ??= (async () => {
    stopAccepting();
    let timer, resolveIdle;
    try {
      if (jobs.size) await Promise.race([
        new Promise(resolve => { resolveIdle = resolve; idleWaiters.add(resolve); }),
        new Promise(resolve => { timer = setTimeout(resolve, closeGraceMs); }),
      ]);
    } finally {
      clearTimeout(timer); idleWaiters.delete(resolveIdle); closed = true;
      cancelMatching(() => true);
    }
    return status();
  })();
  return { enqueue, status, stopAccepting, cancelUser: id => cancelMatching(job => job.userId === id), cancelConversation: id => cancelMatching(job => job.input.conversationId === id), close };
}
