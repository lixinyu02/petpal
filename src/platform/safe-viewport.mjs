const insetCache = new WeakMap();
const sides = ['top', 'right', 'bottom', 'left'];
const positive = (value, fallback = 0) => Number.isFinite(value) ? Math.max(0, value) : fallback;
const pixels = value => /^\s*(?:\d+(?:\.\d+)?|\.\d+)(?:px)?\s*$/.test(value || '') ? Number.parseFloat(value) : undefined;

/** Pure geometry: retain visualViewport offsets and zoom; only reserve unsafe edges. */
export function safeViewportRect(viewport, insets = {}, gutter = 0) {
  const width = Math.max(1, positive(viewport.width, 1)), height = Math.max(1, positive(viewport.height, 1));
  const leftInset = Math.min(positive(insets.left), width - 1), rightInset = Math.min(positive(insets.right), width - leftInset - 1);
  const topInset = Math.min(positive(insets.top), height - 1), bottomInset = Math.min(positive(insets.bottom), height - topInset - 1);
  const horizontal = Math.min(positive(gutter), (width - leftInset - rightInset - 1) / 2);
  const vertical = Math.min(positive(gutter), (height - topInset - bottomInset - 1) / 2);
  const originLeft = Number.isFinite(viewport.left) ? viewport.left : 0, originTop = Number.isFinite(viewport.top) ? viewport.top : 0;
  const left = originLeft + leftInset + horizontal, top = originTop + topInset + vertical;
  const right = originLeft + width - rightInset - horizontal, bottom = originTop + height - bottomInset - vertical;
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function readInsets(window, document, viewport) {
  const root = document?.documentElement;
  // Android has already inset the WebView; reserving system bars again would
  // shrink every nested menu. The CSS flag is also an explicit native fallback.
  if (!root || root.dataset?.nativeInsets === 'true' || typeof window.getComputedStyle !== 'function') return {};
  const key = [viewport.width, viewport.height, viewport.scale, window.innerWidth, window.innerHeight,
    ...sides.map(side => root.style?.getPropertyValue?.(`--app-safe-${side}`) || '')].join('|');
  const cached = insetCache.get(document);
  if (cached?.root === root && cached.key === key) return cached.insets;
  const insets = {};
  let probe;
  try {
    const style = window.getComputedStyle(root);
    const values = sides.map(side => pixels(style.getPropertyValue(`--app-safe-${side}`)));
    if (values.every(value => value !== undefined)) {
      sides.forEach((side, index) => { insets[side] = values[index]; });
    } else {
      // A custom property's computed value can retain env()/calc(). Resolve it
      // through padding once per viewport shape, outside React render. The
      // zero-sized contained probe never participates in the popup's layout.
      probe = document.createElement('div');
      probe.setAttribute('aria-hidden', 'true');
      probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;left:0;top:0;width:0;height:0;contain:strict;box-sizing:content-box;border:0;margin:0;';
      for (const side of sides) probe.style.setProperty(`padding-${side}`, `var(--app-safe-${side},env(safe-area-inset-${side},0px))`);
      root.appendChild(probe);
      const resolved = window.getComputedStyle(probe);
      for (const side of sides) insets[side] = pixels(resolved.getPropertyValue(`padding-${side}`)) || 0;
    }
  } catch {
    // Failure to read optional cutout CSS must not disable keyboard menus.
    for (const side of sides) insets[side] = 0;
  } finally {
    probe?.remove();
  }
  insetCache.set(document, { root, key, insets });
  return insets;
}

/** Call from an effect/resize callback, never during render. No listeners or
 * persistent DOM nodes are owned here; all three popup families share the cache. */
export function readSafeViewport(window, document, gutter = 0) {
  const visual = window.visualViewport;
  const viewport = {
    left: Number.isFinite(visual?.offsetLeft) ? visual.offsetLeft : 0,
    top: Number.isFinite(visual?.offsetTop) ? visual.offsetTop : 0,
    width: positive(visual?.width) || positive(window.innerWidth, 1),
    height: positive(visual?.height) || positive(window.innerHeight, 1),
    scale: positive(visual?.scale) || 1,
  };
  return { ...safeViewportRect(viewport, readInsets(window, document, viewport), gutter), viewport };
}
