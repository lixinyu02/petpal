import path from 'node:path';

/** Only content-addressed output is immutable. URLs for mutable assets revalidate. */
export function staticCacheControl(root, filename) {
  const relative=path.relative(root,filename).replaceAll('\\','/');
  if(/^assets\/[^/]+-[A-Za-z0-9_-]{8,}\.(?:js|css)$/.test(relative))return 'public, max-age=31536000, immutable';
  if(/^(?:avatars\/akari\/preview-|avatars\/akari-cubism-v12\/akari\.2048\/texture_00-)[a-f0-9]{12}\.webp$/.test(relative))return 'public, max-age=31536000, immutable';
  if(/^(?:avatars|sprites|live2d|vendor)\//.test(relative)||relative==='favicon.svg')return 'public, max-age=0, must-revalidate';
  return 'no-store';
}
