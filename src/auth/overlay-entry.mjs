/** The Android overlay is a separate, bridge-free AssetLoader WebView. */
export function isPassiveNativeOverlay(href, native = false) {
  let url; try { url = new URL(href); } catch { return false; }
  if (!url.searchParams.has('overlay') && !url.searchParams.has('pet')) return false;
  if (native) return true;
  return url.origin === 'https://appassets.androidplatform.net' && url.pathname === '/assets/public/index.html'
    && url.searchParams.get('overlay') === '1' && !url.searchParams.has('pet')
    && ['anime', 'cat'].includes(url.searchParams.get('avatar'));
}
