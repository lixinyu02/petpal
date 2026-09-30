/** Keep a single RAF pending only while the scene is visible. */
export function createVisibleSceneLoop(frame, {
  request = callback => requestAnimationFrame(callback),
  cancel = id => cancelAnimationFrame(id),
} = {}) {
  let active = false, disposed = false, pending = null, revision = 0;
  const schedule = () => {
    if (disposed || !active || pending !== null) return;
    const scheduledRevision = revision;
    pending = request(now => {
      // A cancelled callback may already have been delivered; it must not take
      // ownership of a newer visible scene's callback or restart the loop.
      if (disposed || !active || scheduledRevision !== revision) return;
      pending = null;
      try { frame(now); } finally { schedule(); }
    });
  };
  const stop = () => {
    revision++;
    if (pending !== null) cancel(pending);
    pending = null;
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
