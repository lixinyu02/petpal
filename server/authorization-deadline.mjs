// Node timers overflow above 2^31 - 1 ms. Re-read authorization in bounded
// segments so a renewed session is not revoked at its original deadline.
export const AUTHORIZATION_CHECK_INTERVAL = 24 * 60 * 60 * 1000;

export function watchAuthorizationDeadline({ expiresAt, authorize, onExpire, clock = Date.now, schedule = setTimeout, cancel = clearTimeout }) {
  let active = true, timer;
  const stop = () => { active = false; if (timer !== undefined) cancel(timer); timer = undefined; };
  const arm = deadline => {
    if (!active || !Number.isFinite(deadline)) return;
    timer = schedule(check, Math.max(1, Math.min(AUTHORIZATION_CHECK_INTERVAL, deadline - clock())));
    timer?.unref?.();
  };
  const check = () => {
    timer = undefined;
    if (!active) return;
    let deadline;
    try { deadline = authorize(); } catch { stop(); onExpire(); return; }
    if (Number.isFinite(deadline) && deadline <= clock()) { stop(); onExpire(); return; }
    arm(deadline);
  };
  arm(expiresAt);
  return stop;
}
