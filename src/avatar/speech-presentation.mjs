const progressKeys = new Set(['charIndex', 'audioLevel', 'emotion']);
const sameEmotion = (before, after) => before === after || !!before && !!after
  && Object.keys(before).length === Object.keys(after).length
  && Object.keys(before).every(key => Object.is(before[key], after[key]));
function samePlayback(before, after, ignoreProgress) {
  const keys = Object.keys(before).filter(key => !ignoreProgress || !progressKeys.has(key));
  const otherKeys = Object.keys(after).filter(key => !ignoreProgress || !progressKeys.has(key));
  return keys.length === otherKeys.length && keys.every(key => Object.hasOwn(after, key)
    && (key === 'emotion' ? sameEmotion(before[key], after[key]) : Object.is(before[key], after[key])));
}

/** Only these three fields may advance without changing the workspace controls. */
export function samePlaybackSemantics(before, after) {
  return samePlayback(before, after, true);
}

/** Instance-private, cached snapshots for React's useSyncExternalStore contract. */
export function createSpeechPresentation(initial) {
  const freeze = next => Object.freeze({ ...next,
    ...(next.emotion && typeof next.emotion === 'object' ? { emotion: Object.freeze({ ...next.emotion }) } : {}),
  });
  let value = freeze(initial);
  const listeners = new Set();
  const source = Object.freeze({
    snapshot: () => value,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  });
  return {
    source,
    publish(next) {
      if (samePlayback(value, next, false)) return value;
      value = freeze(next);
      for (const listener of [...listeners]) listener();
      return value;
    },
  };
}
