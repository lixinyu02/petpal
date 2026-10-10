const invalid = () => new Error('Cubism model resources must be finite, local files inside the model directory.');
const ownObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function cubismLocalUrl(path, base, { directory } = {}) {
  const root = new URL(base);
  if (!['https:', 'http:'].includes(root.protocol) || root.username || root.password) throw invalid();
  if (typeof path !== 'string' || !path || path.length > 512 || /[\\\x00-\x20?#%]/u.test(path) || path.startsWith('/') || path.includes(':') || path.split('/').some(part => !part || part === '.' || part === '..')) throw invalid();
  const url = new URL(path, root);
  const prefix = directory || new URL('.', root).pathname;
  if (url.origin !== root.origin || !url.pathname.startsWith(prefix) || url.username || url.password || url.search || url.hash) throw invalid();
  return url.href;
}

/** Strict built-in package references; does not enable user-selected remote models. */
export function validateCubismModel(manifest, modelUrl) {
  const root = new URL(modelUrl);
  if (!['http:', 'https:'].includes(root.protocol) || root.username || root.password || root.search || root.hash || !root.pathname.endsWith('.model3.json')) throw invalid();
  if (!ownObject(manifest) || manifest.Version !== 3 || !ownObject(manifest.FileReferences)) throw invalid();
  const refs = manifest.FileReferences, checked = path => cubismLocalUrl(path, root.href);
  if (typeof refs.Moc !== 'string' || !refs.Moc.endsWith('.moc3')) throw invalid();
  const moc = checked(refs.Moc);
  if (!Array.isArray(refs.Textures) || refs.Textures.length < 1 || refs.Textures.length > 8 || refs.Textures.some(path => typeof path !== 'string' || !/\.(?:png|webp)$/iu.test(path))) throw invalid();
  const textures = refs.Textures.map(checked);
  if (new Set(textures).size !== textures.length) throw invalid();
  const optional = {};
  for (const name of ['Physics', 'Pose', 'UserData']) if (refs[name] !== undefined) {
    if (typeof refs[name] !== 'string' || !refs[name].endsWith('.json')) throw invalid();
    optional[name] = checked(refs[name]);
  }
  const expressions = refs.Expressions ?? [];
  if (!Array.isArray(expressions) || expressions.length > 64) throw invalid();
  const expressionNames = new Set();
  const expressionFiles = expressions.map(item => {
    if (!ownObject(item) || typeof item.Name !== 'string' || !/^[\w-]{1,64}$/u.test(item.Name) || expressionNames.has(item.Name) || typeof item.File !== 'string' || !item.File.endsWith('.exp3.json')) throw invalid();
    expressionNames.add(item.Name); return { name: item.Name, url: checked(item.File) };
  });
  const motions = refs.Motions ?? {};
  if (!ownObject(motions) || Object.keys(motions).length > 16) throw invalid();
  let total = 0;
  const motionFiles = [];
  for (const [group, entries] of Object.entries(motions)) {
    if (!/^[\w-]{1,64}$/u.test(group) || !Array.isArray(entries) || entries.length > 32 || (total += entries.length) > 128) throw invalid();
    entries.forEach((item, index) => {
      if (!ownObject(item) || typeof item.File !== 'string' || !item.File.endsWith('.motion3.json')) throw invalid();
      const url = checked(item.File);
      if (item.Sound !== undefined) throw new Error('Built-in Cubism motions cannot play independent audio.');
      for (const name of ['FadeInTime', 'FadeOutTime']) if (item[name] !== undefined && (!Number.isFinite(item[name]) || item[name] < 0 || item[name] > 30)) throw invalid();
      motionFiles.push({ group, index, url });
    });
  }
  return { modelUrl: root.href, directory: new URL('.', root).href, moc, textures, optional, expressions: expressionFiles, motions: motionFiles };
}

export async function fetchCubismBytes(url, { fetcher = fetch, signal, maxBytes = 16 * 1024 * 1024 } = {}) {
  const response = await fetcher(url, { signal, credentials: 'same-origin', redirect: 'error' });
  if (!response.ok) throw new Error(`Cubism resource unavailable (${response.status}).`);
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > maxBytes)) throw new Error('Cubism resource is too large.');
  // Bound the read as well as Content-Length; servers may omit or understate it.
  if (!response.body) {
    const bytes = await response.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > maxBytes) throw new Error('Cubism resource size is invalid.');
    return bytes;
  }
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error('Cubism resource is too large.');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  if (!size) throw new Error('Cubism resource is empty.');
  const joined = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  return joined.buffer;
}

/** Own this canvas's reads; shared Core/Framework downloads live outside it. */
export function createCubismResourceLoader({ signal, fetchBytes = fetchCubismBytes } = {}) {
  const controller = new AbortController(), pending = new Set(), queue = [];
  let active = 0;
  const reason = () => controller.signal.reason || new DOMException('Aborted', 'AbortError');
  const cancel = error => { if (!controller.signal.aborted) controller.abort(error); };
  const parentCancelled = () => cancel(signal.reason);
  const pump = () => {
    if (controller.signal.aborted) {
      for (const entry of queue.splice(0)) entry.reject(reason());
      return;
    }
    while (active < 4 && queue.length) {
      const entry = queue.shift(); active++;
      Promise.resolve().then(() => {
        if (controller.signal.aborted) throw reason();
        return fetchBytes(entry.url, { signal: controller.signal, maxBytes: entry.maxBytes });
      }).then(bytes => {
        if (controller.signal.aborted) throw reason();
        if (!(bytes instanceof ArrayBuffer) || !bytes.byteLength || bytes.byteLength > entry.maxBytes) throw new Error('Cubism resource size is invalid.');
        entry.resolve(bytes);
      }).catch(error => { cancel(error); entry.reject(reason()); }).finally(() => { active--; pump(); });
    }
  };
  controller.signal.addEventListener('abort', pump);
  if (signal?.aborted) parentCancelled();
  else signal?.addEventListener('abort', parentCancelled, { once: true });
  return {
    signal: controller.signal,
    read(url, { maxBytes } = {}) {
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 24 * 1024 * 1024) return Promise.reject(new Error('Cubism resource limit is invalid.'));
      const task = new Promise((resolve, reject) => {
        if (controller.signal.aborted) { reject(reason()); return; }
        queue.push({ url, maxBytes, resolve, reject }); pump();
      });
      pending.add(task);
      // Observe early failures even when initialization is still waiting for
      // the shared Core. Do not detach ownership until the actual read settles.
      task.then(() => pending.delete(task), () => pending.delete(task));
      return task;
    },
    cancel,
    async drain() { while (pending.size) await Promise.allSettled([...pending]); },
    dispose() {
      signal?.removeEventListener('abort', parentCancelled);
      controller.signal.removeEventListener('abort', pump);
    },
  };
}
