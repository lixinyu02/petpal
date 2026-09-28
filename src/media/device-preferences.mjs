const KEY_PREFIX = 'petpal.mediaDevices:';
const FIELDS = ['microphoneId', 'cameraId', 'speakerId'];
const KINDS = { microphoneId: 'audioinput', cameraId: 'videoinput', speakerId: 'audiooutput' };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const deviceId = value => typeof value === 'string' && value.length <= 1024 && !/[\u0000-\u001f\u007f]/u.test(value) ? value : '';

/** Only opaque device IDs are retained; labels, credentials and account data are excluded. */
export function normalizeDevicePreferences(value) {
  const source = object(value) ? value : {};
  return Object.fromEntries(FIELDS.map(field => [field, Object.hasOwn(source, field) ? deviceId(source[field]) : '']));
}

/** A controller belongs to one account on this browser. It never performs remote writes. */
export function createDevicePreferences(storage, scope) {
  if (typeof scope !== 'string' || !scope.trim() || scope.length > 2048 || /[\u0000-\u001f\u007f]/u.test(scope)) {
    throw new TypeError('Device preferences require an explicit account scope.');
  }
  const key = `${KEY_PREFIX}${encodeURIComponent(scope)}`;
  let preferences = normalizeDevicePreferences(null), disposed = false;
  try {
    const raw = storage?.getItem(key);
    if (raw && raw.length <= 8192) preferences = normalizeDevicePreferences(JSON.parse(raw));
  } catch {} // Storage may be denied, full, or contain an incomplete old value.
  const read = () => ({ ...preferences });
  const write = patch => {
    if (disposed) return read();
    const next = { ...preferences };
    if (object(patch)) for (const field of FIELDS) {
      if (Object.hasOwn(patch, field)) next[field] = deviceId(patch[field]);
    }
    preferences = next;
    try { storage?.setItem(key, JSON.stringify(preferences)); } catch {}
    return read();
  };
  return {
    read,
    write,
    clear() {
      if (disposed) return;
      preferences = normalizeDevicePreferences(null);
      try { storage?.removeItem(key); } catch {}
    },
    dispose() { disposed = true; preferences = normalizeDevicePreferences(null); },
  };
}

/** Permission-limited enumeration must not erase choices from an earlier authorized session. */
export function reconcileDevicePreferences(value, devices, { labelsAvailable } = {}) {
  const preferences = normalizeDevicePreferences(value), missing = [];
  if (labelsAvailable === false || !Array.isArray(devices)) return { preferences, missing };
  for (const field of FIELDS) {
    if (!preferences[field]) continue;
    const matching = devices.filter(device => object(device) && device.kind === KINDS[field] && deviceId(device.deviceId));
    if (!matching.some(device => typeof device.label === 'string' && device.label.trim())) continue;
    if (!matching.some(device => device.deviceId === preferences[field])) {
      missing.push(field); preferences[field] = '';
    }
  }
  return { preferences, missing };
}
