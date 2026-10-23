(() => {
  if (window !== window.top || location.origin !== 'https://localhost') return;
  let current = null, raf = 0, commits = 0, renderers = 0;
  const supported = PerformanceObserver.supportedEntryTypes || [];
  const longTasks = [], longFrames = [];
  const consume = (entries, target) => { if (!current) return; for (const entry of entries) if (entry.startTime >= current.start) target.push({ start: entry.startTime - current.start, duration: entry.duration }); };
  let taskObserver, frameObserver;
  if (supported.includes('longtask')) { taskObserver = new PerformanceObserver(list => consume(list.getEntries(), longTasks)); taskObserver.observe({ type: 'longtask', buffered: true }); }
  if (supported.includes('long-animation-frame')) { frameObserver = new PerformanceObserver(list => consume(list.getEntries(), longFrames)); frameObserver.observe({ type: 'long-animation-frame', buffered: true }); }
  if (!window.__REACT_DEVTOOLS_GLOBAL_HOOK__) window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true, isDisabled: false, renderers: new Map(), checkDCE() {},
    inject(renderer) { const id = ++renderers; this.renderers.set(id, renderer); return id; },
    onCommitFiberRoot() { commits++; }, onCommitFiberUnmount() {},
  };
  const heap = () => performance.memory ? { used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize } : null;
  const tick = now => { if (!current) return; if (current.last) current.frames.push(now - current.last); current.last = now; raf = requestAnimationFrame(tick); };
  const visible = () => { if (current && document.hidden) current.hidden = true; };
  document.addEventListener('visibilitychange', visible);
  window.addEventListener('pagehide', () => { if (current) current.hidden = true; });
  window.__petpalFluidity = {
    begin(name, stream = false) {
      if (current) throw Error('Measurement already active');
      longTasks.length = longFrames.length = 0;
      current = { name, start: performance.now(), last: 0, frames: [], hidden: document.hidden, firstTextMs: null, mutationBatches: 0, commits, heap: heap(), nodeCount: document.getElementsByTagName('*').length, scrollEvents: 0 };
      const element = document.querySelector('.chat-scroll');
      if (element) { current.scrollElement = element; current.minTop = current.maxTop = element.scrollTop; current.scroll = () => { if (!current) return; current.scrollEvents++; current.minTop = Math.min(current.minTop, element.scrollTop); current.maxTop = Math.max(current.maxTop, element.scrollTop); }; element.addEventListener('scroll', current.scroll, { passive: true }); }
      if (stream) {
        const root = document.querySelector('.messages') || document.querySelector('.chat-scroll');
        current.observer = new MutationObserver(() => { if (!current) return; current.mutationBatches++; if (current.firstTextMs === null) { const text = document.querySelector('.message-assistant .message-text')?.textContent || ''; if (text.trim()) current.firstTextMs = performance.now() - current.start; } });
        if (root) current.observer.observe(root, { subtree: true, childList: true, characterData: true });
      }
      raf = requestAnimationFrame(tick); return true;
    },
    end() {
      if (!current) throw Error('No active measurement');
      if (taskObserver) consume(taskObserver.takeRecords(), longTasks);
      if (frameObserver) consume(frameObserver.takeRecords(), longFrames);
      cancelAnimationFrame(raf);
      const value = current; current = null; value.observer?.disconnect();
      if (value.scrollElement) value.scrollElement.removeEventListener('scroll', value.scroll);
      return { name: value.name, durationMs: performance.now() - value.start, valid: !value.hidden && !document.hidden, hiddenObserved: value.hidden, visibility: document.visibilityState,
        rafIntervalsMs: value.frames, longTaskSupported: supported.includes('longtask'), longTasks: [...longTasks], longAnimationFrameSupported: supported.includes('long-animation-frame'), longAnimationFrames: [...longFrames],
        reactCommitCountSupported: renderers > 0, reactCommits: renderers > 0 ? commits - value.commits : null, reactCommitDurationsSupported: false,
        firstTextMs: value.firstTextMs, mutationBatches: value.mutationBatches, nodesBefore: value.nodeCount, nodesAfter: document.getElementsByTagName('*').length,
        scrollEvents: value.scrollEvents, scrollRange: value.scrollElement ? value.maxTop - value.minTop : 0, heapBefore: value.heap, heapAfter: heap(),
        paint: performance.getEntriesByType('paint').map(entry => ({ name: entry.name, startTime: entry.startTime })) };
    },
    active() { return Boolean(current); },
  };
})();
