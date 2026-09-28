const kindOf = value => !value?.token ? 'none' : value.credentialKind === 'session' ? 'session' : 'pairing';
export function restoreTargetConnection(saved, native) {
  if (!saved || typeof saved.url !== 'string' || typeof saved.token !== 'string') return null;
  if (saved.target !== undefined && !['local','remote'].includes(saved.target)) return null;
  if (saved.credentialKind !== undefined && !['none','session','pairing'].includes(saved.credentialKind)) return null;
  if (saved.credentialKind === 'none' && saved.token) return null;
  if (saved.target === 'local') {
    try {
      const before = new URL(saved.url), current = new URL(native?.url);
      if (before.protocol !== 'http:' || current.protocol !== 'http:' || before.hostname !== current.hostname || !['127.0.0.1','localhost','[::1]'].includes(before.hostname) || before.username || before.password || before.search || before.hash || before.pathname !== '/') return null;
    } catch { return null; }
  }
  const local = Boolean(native && (saved.target === 'local' || (saved.target === undefined && saved.url === native.url)));
  const credentialKind=kindOf(saved);
  return {target:local?'local':'remote',credentialKind,connection:local ? {url:native.url,token:credentialKind==='pairing'?native.token:saved.token} : {url:saved.url,token:saved.token}};
}
