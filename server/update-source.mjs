const failure = (status, message) => Object.assign(new Error(message), { status });
const invalid = () => failure(400, '服务器更新地址必须使用无凭据、查询或片段的 HTTPS 安全路径。');
const segment = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;

// Inspect the original spelling before URL can discard dot segments or rewrite
// backslashes. The same ASCII path contract is used by the Android updater.
function safePath(value, absolute = true) {
  const parts = (absolute ? value.slice(1) : value).split('/');
  if (!parts.length || parts.some(part => !segment.test(part))) throw invalid();
  return parts;
}

function absoluteUrl(value) {
  if (typeof value !== 'string' || !value || value.length > 8192 || /[^\x21-\x7e]|[%\\?#]/.test(value)) throw invalid();
  const spelling = /^https:\/\/([^/]+)(\/.*)?$/i.exec(value);
  if (!spelling || spelling[1].includes('@') || !spelling[2]) throw invalid();
  const parts = safePath(spelling[2]);
  let url;
  try { url = new URL(value); } catch { throw invalid(); }
  if (url.protocol !== 'https:' || !url.hostname || url.port === '0' || url.username || url.password || url.search || url.hash) throw invalid();
  return { url, parts };
}

export function validateServerManifestUrl(value) {
  const { url, parts } = absoluteUrl(value);
  if (parts.at(-1) !== 'petpal-update.json') throw invalid();
  return url.href;
}

export function validateServerAssetUrl(value, manifestUrl) {
  const manifest = absoluteUrl(validateServerManifestUrl(manifestUrl)), asset = absoluteUrl(value);
  const directory = manifest.parts.slice(0, -1);
  if (asset.url.origin !== manifest.url.origin || asset.parts.length <= directory.length || directory.some((part, index) => asset.parts[index] !== part)) throw failure(400, '服务器更新资产必须位于清单同源的目录内。');
  return asset.url.href;
}

/** Pass the raw Location value here, before resolving it with new URL. */
export function validateServerRedirect(from, to, manifestUrl) {
  try {
    const source = validateServerAssetUrl(from, manifestUrl);
    if (typeof to !== 'string' || !to || to.length > 8192 || /[^\x21-\x7e]|[%\\?#]/.test(to)) throw invalid();
    if (/^https:\/\//i.test(to)) absoluteUrl(to);
    else safePath(to, to.startsWith('/'));
    return validateServerAssetUrl(new URL(to, source).href, manifestUrl);
  } catch { throw failure(502, '服务器更新源返回不允许的重定向。'); }
}
