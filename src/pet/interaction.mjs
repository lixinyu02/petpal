/** One gesture policy for both renderers. No DOM dependency; clocks are injectable. */
export function createCompanionGestures({ emit, getAction, now = () => performance.now(), schedule = setTimeout, unschedule = clearTimeout }) {
  let press = null, holdTimer, tapTimer, lastTap = null, blocked = false;
  const pointers = new Set();
  const clearHold = () => { unschedule(holdTimer); holdTimer = undefined; };
  const clearTap = () => { unschedule(tapTimer); tapTimer = undefined; lastTap = null; };
  const release = () => { clearHold(); press = null; };
  const cancel = () => { release(); clearTap(); pointers.clear(); blocked = false; };
  const respond = action => emit(action === 'pet' && getAction() === 'sleep' ? 'wake' : action);
  function tap(point) {
    if (getAction() === 'sleep') { clearTap(); respond('wake'); return; }
    const stamp = now();
    if (lastTap && stamp - lastTap.time <= 300 && Math.hypot(point.x - lastTap.x, point.y - lastTap.y) <= 28 && point.pointerType === lastTap.pointerType) {
      clearTap(); respond('jump'); return;
    }
    if (lastTap) { clearTap(); respond('pet'); }
    lastTap = { ...point, time: stamp };
    tapTimer = schedule(() => { tapTimer = undefined; lastTap = null; respond('pet'); }, 300);
  }
  function down(point) {
    if (point.button !== undefined && point.button !== 0) return false;
    pointers.add(point.id);
    if (pointers.size > 1 || point.isPrimary === false) { release(); clearTap(); blocked = true; return false; }
    if (blocked || !point.hit) { clearTap(); return false; }
    release();
    press = { ...point, time: now(), moved: false, held: false, strokeAt: -Infinity };
    holdTimer = schedule(() => {
      holdTimer = undefined;
      if (!press || press.moved || blocked) return;
      clearTap(); press.held = true;
      respond(getAction() === 'sleep' ? 'wake' : 'sleep');
    }, 700);
    return true;
  }
  function move(point) {
    if (!press || point.id !== press.id || blocked) return;
    const dx = point.x - press.x, dy = point.y - press.y;
    if (!point.hit) { release(); clearTap(); return; }
    // Let vertical touch movement become a normal browser scroll. A cancelled
    // pointer never becomes a tap or a delayed long press.
    if (press.pointerType === 'touch' && Math.abs(dy) > 10) { release(); clearTap(); return; }
    if (Math.hypot(dx, dy) <= 9 || press.held) return;
    press.moved = true; clearHold(); clearTap();
    if (now() - press.strokeAt >= 800) { press.strokeAt = now(); respond('pet'); }
  }
  function up(point) {
    pointers.delete(point.id);
    const current = press;
    if (current?.id === point.id) release();
    if (blocked) { if (!pointers.size) blocked = false; return; }
    if (!current || current.id !== point.id || current.moved || current.held || !point.hit) return;
    if (Math.hypot(point.x - current.x, point.y - current.y) > 9) { clearTap(); return; }
    tap(point);
  }
  const keyboardPoint = { id: 'keyboard', x: 0, y: 0, pointerType: 'keyboard', hit: true, button: 0 };
  return {
    down, move, up, cancel,
    leave() { release(); },
    keyDown(key, repeat = false) { if ((key === 'Enter' || key === ' ') && !repeat) return down(keyboardPoint); return false; },
    keyUp(key) { if (key === 'Enter' || key === ' ') up(keyboardPoint); },
    activate() { if (!press) { clearTap(); respond('pet'); } },
  };
}

/** Binds gestures without suppressing browser scrolling or synthetic native clicks. */
export function bindCompanionGestures(surface, { hitTest, emit, getAction, onPointer = () => {}, onLeave = () => {}, enabled = () => true }) {
  const gestures = createCompanionGestures({ emit: action => { if (enabled()) emit(action); }, getAction });
  const point = event => ({ id: event.pointerId, x: event.clientX, y: event.clientY, pointerType: event.pointerType, button: event.button, isPrimary: event.isPrimary, hit: enabled() && hitTest(event.clientX, event.clientY) });
  const down = event => { if (enabled()) gestures.down(point(event)); };
  const move = event => {
    if (!enabled()) return;
    onPointer(event.clientX, event.clientY);
    const next = point(event); surface.style.cursor = next.hit ? 'pointer' : 'default'; gestures.move(next);
  };
  const up = event => { if (enabled()) gestures.up(point(event)); };
  const cancel = () => { gestures.cancel(); onLeave(); surface.style.cursor = 'default'; };
  const leave = () => { gestures.leave(); onLeave(); surface.style.cursor = 'default'; };
  const hidden = () => { if (document.hidden) cancel(); };
  const outsideDown = event => { if (enabled() && !surface.contains(event.target)) cancel(); };
  const keyDown = event => { if (enabled() && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); gestures.keyDown(event.key, event.repeat); } };
  const keyUp = event => { if (enabled() && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); gestures.keyUp(event.key); } };
  const click = event => { if (enabled() && event.detail === 0) gestures.activate(); };
  const contextMenu = event => { if (enabled() && hitTest(event.clientX,event.clientY)) event.preventDefault(); };
  surface.addEventListener('pointerdown', down); surface.addEventListener('pointermove', move); surface.addEventListener('pointerleave', leave);
  surface.addEventListener('keydown', keyDown); surface.addEventListener('keyup', keyUp); surface.addEventListener('click', click); surface.addEventListener('contextmenu', contextMenu); surface.addEventListener('blur', cancel);
  window.addEventListener('pointerdown', outsideDown); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel); window.addEventListener('blur', cancel);
  document.addEventListener('visibilitychange', hidden);
  return () => {
    cancel();
    surface.removeEventListener('pointerdown', down); surface.removeEventListener('pointermove', move); surface.removeEventListener('pointerleave', leave);
    surface.removeEventListener('keydown', keyDown); surface.removeEventListener('keyup', keyUp); surface.removeEventListener('click', click); surface.removeEventListener('contextmenu', contextMenu); surface.removeEventListener('blur', cancel);
    window.removeEventListener('pointerdown', outsideDown); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel); window.removeEventListener('blur', cancel);
    document.removeEventListener('visibilitychange', hidden);
  };
}

/** Same portrait-space coordinates for the orthographic mesh and DOM fallback. */
export function portraitCoordinates(rect, x, y) {
  const width = Math.max(1, rect.width), height = Math.max(1, rect.height);
  const portraitWidth = height / Math.max(1.64, 1.04 / (width / height));
  return { x: (x - rect.left - width / 2) / portraitWidth + .5, y: (y - rect.top - height / 2) / (portraitWidth * 1.5) + .5 };
}

export function portraitContains(point, mask) {
  const { x, y } = point;
  if (x < 0 || x > 1 || y < 0 || y > 1) return false;
  // Ignore the source's soft alpha halo, including on devices without Canvas2D.
  const outline = [[.48,.008],[.69,.03],[.81,.15],[.86,.34],[.84,.43],[.92,.54],[.97,.81],[.91,.9],[.86,1],[.16,1],[.1,.91],[.045,.85],[.06,.72],[.1,.57],[.16,.45],[.19,.36],[.18,.18],[.26,.06]];
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const [xi, yi] = outline[i], [xj, yj] = outline[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  if (!inside || !mask) return inside;
  const px = Math.min(mask.width - 1, Math.floor(x * mask.width)), py = Math.min(mask.height - 1, Math.floor(y * mask.height));
  return mask.data[(py * mask.width + px) * 4 + 3] >= 80;
}
