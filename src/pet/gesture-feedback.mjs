// Decorative DOM feedback shared by WebGL and the lightweight portrait.
// The gesture policy owns hit testing, scrolling and activation; this layer
// never captures a pointer, intercepts input or starts a companion action.
const hand = `<svg class="companion-hand-drawing" viewBox="0 0 40 44" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M18 40c-2.4-4-5.3-7.6-7.8-11.3L2.7 17.6c-1-1.6-.4-3.3.9-3.9 1.4-.7 2.6 0 3.7 1.3l3.2 4.3L4.9 6.8c-.7-1.8 0-3.4 1.5-3.8 1.5-.4 2.7.3 3.4 1.9l5.7 12.3-3.1-11c-.5-1.8.3-3.1 1.8-3.4 1.5-.3 2.7.6 3.2 2.1l3.2 11.6-1-8.1c-.2-1.7.7-2.9 2.1-3 1.6-.1 2.5.9 2.8 2.6l1.2 10.2 1.3-5.4c.4-1.6 1.6-2.4 3-2 1.4.4 2 1.7 1.6 3.2l-1.8 8.6c-.4 2-.2 4 .5 5.9l2.6 7.1L18 40Z" fill="#fff7e9" stroke="#8c705a" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="m12.2 25 3.7 4.8m5-6.6c-2.9-.7-5.4 1-5.5 3.8" stroke="#d5ad92" stroke-width="1.2" stroke-linecap="round"/>
  <path d="m16.8 38 16.7-5.2 2.6 6.6L20 43l-3.2-5Z" fill="#c9d6bc" stroke="#8c9b7c" stroke-width="1.2" stroke-linejoin="round"/>
</svg>`;

export function createCompanionFeedback(container, { motionQuery = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)'), schedule = setTimeout, unschedule = clearTimeout } = {}) {
  const document = container.ownerDocument;
  const element = document.createElement('div');
  element.className = 'companion-hand-feedback';
  element.setAttribute('aria-hidden', 'true');
  element.setAttribute('role', 'presentation');
  element.hidden = true;
  element.innerHTML = `<span class="companion-hand-contact"></span>${hand}`;
  container.appendChild(element);
  let owner = null, previous = null, timer, disposed = false, reduced = Boolean(motionQuery?.matches);
  const clearTimer = () => { unschedule(timer); timer = undefined; };
  const hide = () => { clearTimer(); element.hidden = true; element.dataset.phase = 'idle'; delete element.dataset.region; owner = null; previous = null; };
  const reduce = () => {
    reduced = Boolean(motionQuery?.matches); element.dataset.reducedMotion = String(reduced);
    if (reduced && element.dataset.phase === 'release') hide();
    else if (reduced && element.dataset.phase === 'stroke') { clearTimer(); element.dataset.phase = 'press'; }
  };
  reduce(); motionQuery?.addEventListener?.('change', reduce);
  function update(value, surface) {
    if (disposed) return false;
    if (value.phase === 'cancel') { if (!owner || owner === surface) hide(); return false; }
    if (!value.hit || !Number.isFinite(value.x) || !Number.isFinite(value.y) || document.hidden || !['mouse', 'touch', 'pen'].includes(value.pointerType)) {
      if (!owner || owner === surface) hide();
      return false;
    }
    if (value.phase === 'hover' && value.pointerType !== 'mouse') return false;
    if (value.phase === 'release' && value.pointerType !== 'mouse' && (owner !== surface || element.hidden)) return false;
    const rect = container.getBoundingClientRect();
    const x = value.x - rect.left, y = value.y - rect.top;
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) { if (!owner || owner === surface) hide(); return false; }
    // Rendering refreshes repeat the last pointer input. Only a new phase,
    // pointer or actual coordinate change should restart the movement timer.
    const changed = owner !== surface || !previous || ['phase','x','y','id','pointerType','region'].some(key => previous[key] !== value[key]);
    if (changed) clearTimer();
    owner = surface; previous = { phase:value.phase, x:value.x, y:value.y, id:value.id, pointerType:value.pointerType, region:value.region };
    // Keep the palm above and beside the contact point instead of covering eyes.
    // Mirror away from the right edge; near the top, extend below the contact.
    element.dataset.side = x > rect.width - 44 ? 'left' : 'right';
    element.dataset.vertical = y < 48 ? 'below' : 'above';
    element.dataset.pointerType = value.pointerType;
    element.dataset.region = ['head','hand','body'].includes(value.region) ? value.region : 'default';
    element.style.transform = `translate3d(${x}px,${y}px,0)`;
    element.hidden = false;
    if (changed) {
      element.dataset.phase = value.phase === 'release' && value.pointerType === 'mouse' ? 'hover' : value.phase;
      if (value.phase === 'stroke') {
        if (reduced) element.dataset.phase = 'press';
        else timer = schedule(() => { timer = undefined; if (!disposed && !element.hidden) element.dataset.phase = 'press'; }, 220);
      }
      if (value.phase === 'release' && value.pointerType !== 'mouse') {
        if (reduced) hide();
        else timer = schedule(hide, 190);
      }
    }
    return !element.hidden && element.isConnected !== false;
  }
  return {
    update,
    dispose() {
      if (disposed) return;
      disposed = true; hide(); motionQuery?.removeEventListener?.('change', reduce); element.remove();
    },
  };
}
