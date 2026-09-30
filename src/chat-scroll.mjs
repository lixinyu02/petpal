export const CHAT_BOTTOM_THRESHOLD = 80;
export function isNearChatBottom({ scrollHeight, scrollTop, clientHeight }, threshold = CHAT_BOTTOM_THRESHOLD) {
  return scrollHeight - scrollTop - clientHeight <= threshold;
}

/** Preserve reading intent while coalescing image, Markdown and stream layout changes. */
export function createChatScroll({ read, scrollBottom, onFollowing = () => {}, isCurrent = () => true,
  schedule = requestAnimationFrame, cancel = cancelAnimationFrame } = {}) {
  let following = true, frame = null, closed = false, lastTop = read().scrollTop;
  const change = next => { if (following !== next) { following = next; onFollowing(next); } };
  const follow = () => {
    if (closed || !following || frame !== null || !isCurrent()) return;
    frame = schedule(() => {
      frame = null;
      if (!closed && following && isCurrent()) {
        scrollBottom();
        // Read the clamped final position, rather than the requested scrollHeight.
        lastTop = read().scrollTop;
      }
    });
  };
  return {
    contentChanged: follow,
    userScrolled() {
      if (closed || !isCurrent()) return;
      const metrics = read(), nearBottom = isNearChatBottom(metrics);
      const movedUp = metrics.scrollTop < lastTop - 1;
      lastTop = metrics.scrollTop;
      // Content growth and anchoring can dispatch a scroll at the same (or a
      // larger) top before our frame runs. Distance alone is not reading intent.
      if (nearBottom) change(true);
      else if (following && movedUp) change(false);
    },
    latest() { if (closed) return; change(true); follow(); },
    close() { closed = true; if (frame !== null) cancel(frame); frame = null; },
  };
}
