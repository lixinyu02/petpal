/** Keep a single RAF pending only while the scene is visible. */
export function createVisibleSceneLoop(frame, {
  request = callback => requestAnimationFrame(callback),
  cancel = id => cancelAnimationFrame(id),
  maxFps,
} = {}) {
  const interval = Number.isFinite(maxFps) && maxFps > 0 ? 1000 / maxFps : 0;
  // RAF timestamps can land just below a frame boundary after floating-point
  // arithmetic. This tolerance is much smaller than a display refresh period.
  const epsilon = .001;
  let active = false, disposed = false, pending = null, revision = 0;
  let nextFrame = null;
  const schedule = () => {
    if (disposed || !active || pending !== null) return;
    const scheduledRevision = revision;
    pending = request(now => {
      // A cancelled callback may already have been delivered; it must not take
      // ownership of a newer visible scene's callback or restart the loop.
      if (disposed || !active || scheduledRevision !== revision) return;
      pending = null;
      try {
        if (interval && nextFrame !== null && now + epsilon < nextFrame) return;
        if (interval) {
          // Retain the cadence's remainder rather than starting a new interval
          // at every delivered RAF. A long gap draws once and skips old slots.
          nextFrame = nextFrame === null ? now + interval
            : nextFrame + (Math.floor(Math.max(0, now - nextFrame + epsilon) / interval) + 1) * interval;
        }
        frame(now);
      } finally { schedule(); }
    });
  };
  const stop = () => {
    revision++;
    if (pending !== null) cancel(pending);
    pending = null;
    nextFrame = null;
  };
  return {
    setActive(next) {
      if (disposed || active === Boolean(next)) return;
      active = Boolean(next);
      if (active) schedule(); else stop();
    },
    dispose() {
      if (disposed) return;
      disposed = true; active = false; stop();
    },
  };
}

/** Preserve diagnostic keys without mutating stable DOM attributes each frame. */
export function updateSceneDataset(dataset, values) {
  for (const [key, value] of Object.entries(values)) {
    if (dataset[key] !== value) dataset[key] = value;
  }
}
