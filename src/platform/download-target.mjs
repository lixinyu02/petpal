const unknown = platform => ({ platform:platform || null, arch:null, source:'unknown' });
const platformNames = new Map([['win32','windows'],['Windows','windows'],['linux','ubuntu'],['Linux','ubuntu'],['android','android'],['Android','android']]);
const platformName = value => platformNames.get(value) || null;

/** Runtime metadata describes the installed client, rather than claiming to
 * identify hardware behind emulation. Legacy Win64/x64 UA tokens are reduced
 * on ARM devices and deliberately never select an architecture. */
export async function detectDownloadTarget({ runtime, navigator:navigation, timeoutMs=1500 } = {}) {
  const nativePlatform = platformName(runtime?.platform);
  if (nativePlatform && ['x64','arm64'].includes(runtime?.arch)) return { platform:nativePlatform,
    arch:nativePlatform === 'android' ? 'universal' : runtime.arch, source:'native' };
  let data, fallbackPlatform;
  try {
    data = navigation?.userAgentData;
    fallbackPlatform = platformName(data?.platform) || (/Android\b/.test(navigation?.userAgent || '') ? 'android' : null);
    if (fallbackPlatform === 'android') return { platform:'android', arch:'universal', source:'ua-ch' };
    if (typeof data?.getHighEntropyValues !== 'function') return unknown(fallbackPlatform);
  } catch { return unknown(); }
  let timer;
  try {
    const values = await Promise.race([
      Promise.resolve().then(() => data.getHighEntropyValues(['architecture','bitness','platform'])),
      new Promise(resolve => { timer = setTimeout(() => resolve(null), Number.isFinite(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 10000 ? timeoutMs : 1500); }),
    ]);
    const platform = platformName(values?.platform) || fallbackPlatform;
    if (platform === 'android') return { platform, arch:'universal', source:'ua-ch' };
    if (!platform || !values || values.bitness !== '64') return unknown(platform);
    const arch = values.architecture === 'arm' ? 'arm64' : values.architecture === 'x86' ? 'x64' : null;
    return arch ? { platform, arch, source:'ua-ch' } : unknown(platform);
  } catch { return unknown(fallbackPlatform); }
  finally { if (timer !== undefined) clearTimeout(timer); }
}
