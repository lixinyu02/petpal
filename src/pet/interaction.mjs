/** One gesture policy for both renderers. No DOM dependency; clocks are injectable. */
export function createCompanionGestures({ emit, getAction, onFeedback = () => {}, now = () => performance.now(), schedule = setTimeout, unschedule = clearTimeout }) {
  let press = null, holdTimer, tapTimer, lastTap = null, blocked = false, hoverPoint = null, hoverTimer, regionReactionAt = -Infinity;
  const pointers = new Set();
  const clearHold = () => { unschedule(holdTimer); holdTimer = undefined; };
  const clearTap = () => { unschedule(tapTimer); tapTimer = undefined; lastTap = null; };
  const clearHover = () => { unschedule(hoverTimer); hoverTimer = undefined; hoverPoint = null; };
  const feedback = (phase, point) => { if (point?.pointerType !== 'keyboard') onFeedback({ ...point, phase }); };
  const release = () => { clearHold(); if (press) feedback('cancel', press); press = null; };
  const cancel = () => { release(); clearTap(); clearHover(); pointers.clear(); blocked = false; };
  const respond = (action, point, source = 'tap') => {
    const region = point?.region;
    if (action === 'pet' && region) {
      if (source === 'hover' && getAction() === 'sleep') return false;
      if (now() - regionReactionAt < (source === 'hover' ? 1600 : 900)) return false;
      regionReactionAt = now();
    }
    emit(action === 'pet' && getAction() === 'sleep' ? 'wake' : action,
      region ? { region, source } : undefined);
    return true;
  };
  // Region metadata is opt-in. Existing 3D/portrait renderers retain their
  // original gestures, while Cubism can react to a quiet pointer dwell.
  function hover(point) {
    if (blocked || pointers.size || point.buttons > 0 || point.isPrimary === false || !point.hit || point.pointerType !== 'mouse' || !['head','hand'].includes(point.region) || getAction() === 'sleep') { clearHover(); return false; }
    if (!hoverPoint || hoverPoint.region !== point.region || hoverPoint.id !== point.id) {
      clearHover(); hoverPoint = { ...point, reacted: false, anchorX: point.x, anchorY: point.y };
      const dwell = () => {
        hoverTimer = undefined;
        if (!hoverPoint || press || blocked) return;
        if (getAction() === 'sleep') { clearHover(); return; }
        const remaining = 1600 - (now() - regionReactionAt);
        if (remaining > 0) { hoverTimer = schedule(dwell, remaining); return; }
        const current = hoverPoint;
        if (respond('pet', current, 'hover')) {
          current.reacted = true; current.anchorX = current.x; current.anchorY = current.y;
          feedback('stroke', current);
        }
      };
      hoverTimer = schedule(dwell, point.region === 'head' ? 650 : 900);
      return false;
    }
    Object.assign(hoverPoint, point);
    if (point.region === 'head' && hoverPoint.reacted && Math.hypot(point.x - hoverPoint.anchorX, point.y - hoverPoint.anchorY) >= 12 && respond('pet', point, 'hover')) {
      hoverPoint.anchorX = point.x; hoverPoint.anchorY = point.y; feedback('stroke', point); return true;
    }
    return false;
  }
  function tap(point) {
    if (getAction() === 'sleep') { clearTap(); respond('wake', point); return; }
    const stamp = now();
    if (lastTap && stamp - lastTap.time <= 300 && Math.hypot(point.x - lastTap.x, point.y - lastTap.y) <= 28 && point.pointerType === lastTap.pointerType && point.region === lastTap.region) {
      clearTap(); respond('jump', point); return;
    }
    if (lastTap) { const previous = lastTap; clearTap(); respond('pet', previous); }
    lastTap = { ...point, time: stamp };
    tapTimer = schedule(() => { tapTimer = undefined; lastTap = null; respond('pet', point, point.pointerType === 'keyboard' ? 'keyboard' : 'tap'); }, 300);
  }
  function down(point) {
    if (point.button !== undefined && point.button !== 0) return false;
    clearHover();
    pointers.add(point.id);
    if (pointers.size > 1 || point.isPrimary === false) { release(); clearTap(); blocked = true; return false; }
    if (blocked || !point.hit) { clearTap(); return false; }
    release();
    press = { ...point, time: now(), moved: false, held: false, strokeAt: -Infinity };
    feedback('press', point);
    holdTimer = schedule(() => {
      holdTimer = undefined;
      if (!press || press.moved || blocked) return;
      clearTap(); press.held = true;
      feedback('cancel', press);
      respond(getAction() === 'sleep' ? 'wake' : 'sleep', press, 'hold');
    }, 700);
    return true;
  }
  function move(point) {
    if (!press) return hover(point);
    if (point.id !== press.id || blocked) return false;
    const dx = point.x - press.x, dy = point.y - press.y;
    if (!point.hit || point.region !== press.region) { release(); clearTap(); clearHover(); return false; }
    // Let vertical touch movement become a normal browser scroll. A cancelled
    // pointer never becomes a tap or a delayed long press.
    if (press.pointerType === 'touch' && Math.abs(dy) > 10) { release(); clearTap(); return false; }
    if (press.held) return true;
    if (Math.hypot(dx, dy) <= 9 && !press.moved) { feedback('press', point); return true; }
    press.moved = true; clearHold(); clearTap();
    feedback('stroke', point);
    if (now() - press.strokeAt >= 800) { press.strokeAt = now(); respond('pet', point, 'stroke'); }
    return true;
  }
  function up(point) {
    pointers.delete(point.id);
    const current = press;
    if (current?.id === point.id) {
      clearHold(); press = null;
      if (!current.held) feedback(point.hit ? 'release' : 'cancel', point);
    }
    if (blocked) { if (!pointers.size) blocked = false; return; }
    if (!current || current.id !== point.id || current.moved || current.held || !point.hit || point.region !== current.region) return;
    if (Math.hypot(point.x - current.x, point.y - current.y) > 9) { clearTap(); return; }
    tap(point);
  }
  const keyboardPoint = { id: 'keyboard', x: 0, y: 0, pointerType: 'keyboard', hit: true, button: 0 };
  return {
    down, move, up, cancel,
    leave() { release(); clearHover(); },
    keyDown(key, repeat = false) { if ((key === 'Enter' || key === ' ') && !repeat) return down(keyboardPoint); return false; },
    keyUp(key) { if (key === 'Enter' || key === ' ') up(keyboardPoint); },
    activate() { if (!press) { clearTap(); respond('pet'); } },
  };
}

/** Binds gestures without suppressing browser scrolling or synthetic native clicks. */
export function bindCompanionGestures(surface, { hitTest, regionAt, emit, getAction, onPointer = () => {}, onLeave = () => {}, onFeedback, enabled = () => true }) {
  const originalCursor = surface.style.cursor;
  let lastPoint = null, disposed = false;
  const feedback = value => {
    if (value.phase !== 'cancel' && !enabled()) value = { phase: 'cancel' };
    if (value.phase === 'cancel') lastPoint = null;
    else lastPoint = value;
    const visible = onFeedback?.(value) === true;
    surface.style.cursor = value.phase !== 'cancel' && value.hit && value.pointerType === 'mouse' ? visible ? 'none' : 'pointer' : 'default';
  };
  const gestures = createCompanionGestures({ emit: (action, context) => { if (enabled()) emit(action, context); }, getAction, onFeedback: feedback });
  const point = event => ({ id: event.pointerId, x: event.clientX, y: event.clientY, pointerType: event.pointerType, button: event.button, buttons: event.buttons, isPrimary: event.isPrimary, hit: enabled() && hitTest(event.clientX, event.clientY), ...(regionAt ? { region: regionAt(event.clientX, event.clientY) || undefined } : {}) });
  const down = event => { if (enabled()) gestures.down(point(event)); };
  const move = event => {
    if (!enabled()) return;
    onPointer(event.clientX, event.clientY);
    const next = point(event), active = gestures.move(next);
    if (!active && next.pointerType === 'mouse') feedback({ ...next, phase: next.hit ? 'hover' : 'cancel' });
  };
  const up = event => { if (enabled()) gestures.up(point(event)); };
  const cancel = () => { gestures.cancel(); feedback({ phase: 'cancel' }); onLeave(); };
  const leave = event => {
    // Touch/pen pointerleave follows pointerup even when contact ended over the
    // character. Preserve that brief release fade; active gestures still cancel.
    const releasedContact = lastPoint?.phase === 'release' && lastPoint.pointerType !== 'mouse' && lastPoint.id === event.pointerId && enabled();
    gestures.leave();
    if (!releasedContact) feedback({ phase: 'cancel' });
    onLeave();
  };
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
  const unbind = () => {
    if (disposed) return;
    disposed = true;
    cancel();
    surface.removeEventListener('pointerdown', down); surface.removeEventListener('pointermove', move); surface.removeEventListener('pointerleave', leave);
    surface.removeEventListener('keydown', keyDown); surface.removeEventListener('keyup', keyUp); surface.removeEventListener('click', click); surface.removeEventListener('contextmenu', contextMenu); surface.removeEventListener('blur', cancel);
    window.removeEventListener('pointerdown', outsideDown); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel); window.removeEventListener('blur', cancel);
    document.removeEventListener('visibilitychange', hidden);
    surface.style.cursor = originalCursor;
  };
  // Renderers call this after moving the character or swapping WebGL/fallback.
  // A stationary mouse must not retain an invisible hand over empty stage space.
  unbind.refresh = () => {
    if (disposed || !lastPoint) return;
    if (!enabled() || !hitTest(lastPoint.x, lastPoint.y) || regionAt && regionAt(lastPoint.x, lastPoint.y) !== lastPoint.region) cancel();
    else if (lastPoint.pointerType === 'mouse') feedback(lastPoint);
  };
  return unbind;
}

/** Same portrait-space coordinates for the orthographic mesh and DOM fallback. */
export function portraitCoordinates(rect, x, y) {
  const width = Math.max(1, rect.width), height = Math.max(1, rect.height);
  const portraitWidth = height / Math.max(1.64, 1.04 / (width / height));
  return { x: (x - rect.left - width / 2) / portraitWidth + .5, y: (y - rect.top - height / 2) / (portraitWidth * 1.5) + .5 };
}

/** Inverse of Cubism's orthographic contain fit for this 1024 × 1536 portrait.
 * Use the canvas DOM rect, which already incorporates the small CSS lift/scale.
 * The legacy portrait/3D fit above intentionally remains unchanged.
 */
export function cubismPortraitCoordinates(rect, x, y) {
  const width = Math.max(1, rect.width), height = Math.max(1, rect.height);
  const portraitWidth = Math.min(width * .92, height / 1.5 * .96);
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

/** Reference portrait hotspots; the hand zone follows the already joined hands. */
export function portraitRegion(point, mask) {
  if (!portraitContains(point, mask)) return null;
  if (point.y <= .4) return 'head';
  if (Math.hypot((point.x - .5) / .17, (point.y - .889) / .076) <= 1) return 'hand';
  return 'body';
}
