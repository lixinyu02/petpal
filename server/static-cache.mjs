import path from 'node:path';

/** Only Vite content-addressed output is immutable. URLs for mutable assets revalidate. */
export function staticCacheControl(root, filename) {
  const relative=path.relative(root,filename).replaceAll('\\','/');
  if(/^assets\/[^/]+-[A-Za-z0-9_-]{8,}\.(?:js|css)$/.test(relative))return 'public, max-age=31536000, immutable';
  if(/^(?:avatars|sprites|live2d|vendor)\//.test(relative)||relative==='favicon.svg')return 'public, max-age=0, must-revalidate';
  return 'no-store';
}
