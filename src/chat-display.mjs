/** Batch presentation only. Protocol events and authoritative final state remain immediate. */
export function createChatDisplay({ onText, isCurrent = () => true, delayMs = 50,
  schedule = callback => setTimeout(callback, delayMs), cancel = clearTimeout } = {}) {
  let pending = '', timer = null, first = true, closed = false;
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
      pending += text;
      if (first) { first = false; flush(); }
      else if (timer === null) timer = schedule(flush);
    },
    flush,
    close() { closed = true; clear(); pending = ''; },
  };
}
