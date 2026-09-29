export const avatarImageUrl = name => `/avatars/akari/${name}.png`;

/** Load the visible body first. Expressions are optional and never hold it hostage. */
export async function loadAvatarImages({ load, onBase, onVariant, onIssue, isStopped = () => false }) {
  let baseName;
  for (const name of ['idle', 'warm']) {
    try {
      const image = await load(name);
      if (isStopped()) return;
      baseName = name;
      onBase(image, name);
      break;
    } catch {
      if (isStopped()) return;
      onIssue(name);
    }
  }
  if (!baseName) return;
  // Serial decoding keeps the extra emotion texture from competing with the
  // body/eyes/lips needed for the first visible frame and ordinary conversation.
  for (const name of ['blink', 'talk', 'round', 'curious', 'warm', 'sad']) {
    if (isStopped()) return;
    if (name === baseName) continue;
    try {
      const image = await load(name);
      if (isStopped()) return;
      onVariant(image, name);
    } catch {
      if (isStopped()) return;
      onIssue(name);
    }
  }
}

export function loadAvatarImage(name, { signal, timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    let settled = false;
    let timer;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      image.onload = image.onerror = null;
      if (error) { image.removeAttribute('src'); reject(error); }
      else resolve(image);
    };
    const abort = () => finish(new DOMException('Avatar load cancelled', 'AbortError'));
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    image.onload = () => finish(image.naturalWidth && image.naturalHeight ? undefined : new Error('Empty avatar image'));
    image.onerror = () => finish(new Error('Avatar image unavailable'));
    timer = setTimeout(() => finish(new Error('Avatar image timed out')), timeoutMs);
    image.src = avatarImageUrl(name);
  });
}
