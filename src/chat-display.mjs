/** Batch presentation only. Protocol events and authoritative final state remain immediate. */
export function createChatDisplay({ onText, isCurrent = () => true, delayMs,
  schedule = (callback, delay) => setTimeout(callback, delay), cancel = clearTimeout } = {}) {
  let pending = '', timer = null, first = true, closed = false, length = 0;
  const clear = () => { if (timer !== null) cancel(timer); timer = null; };
  const flush = () => {
    clear();
    if (closed || !isCurrent()) { pending = ''; return; }
    const text = pending; pending = '';
    if (text) onText(text);
  };
  return {
    push(text) {
      if (closed || !isCurrent() || !text) return;
      if (typeof text !== 'string') throw new TypeError('Chat display text must be a string.');
      pending += text; length += text.length;
      if (first) { first = false; flush(); }
      // Long Markdown reparses the accumulated document. Lower its update
      // frequency without delaying the first text or authoritative flushes.
      else if (timer === null) timer = schedule(flush, delayMs ?? (length >= 8000 ? 120 : length >= 4000 ? 100 : 50));
    },
    flush,
    close() { closed = true; clear(); pending = ''; },
  };
}
