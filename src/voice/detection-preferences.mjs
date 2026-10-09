export const DEFAULT_VOICE_SENSITIVITY = 'noise-reduced';
const fallbackByStorage = new WeakMap(), unavailableStorage = new Map();
function fallbackFor(storage) {
  if (!storage || typeof storage !== 'object') return unavailableStorage;
  let cache=fallbackByStorage.get(storage);
  if(!cache){cache=new Map();fallbackByStorage.set(storage,cache);}
  return cache;
}
const profiles = {
  'noise-reduced': { listening: { threshold:.028,minSpeechMs:360,noiseRatio:2 }, interruption: { threshold:.04,minSpeechMs:500,noiseRatio:2.4 } },
  balanced: { listening: { threshold:.02,minSpeechMs:280,noiseRatio:1.9 }, interruption: { threshold:.034,minSpeechMs:500,noiseRatio:2.3 } },
  sensitive: { listening: { threshold:.014,minSpeechMs:200,noiseRatio:1.8 }, interruption: { threshold:.028,minSpeechMs:400,noiseRatio:2.2 } },
};
export function normalizeVoiceSensitivity(value) {
  return typeof value === 'string' && Object.hasOwn(profiles,value) ? value : DEFAULT_VOICE_SENSITIVITY;
}
export function voiceGateProfile(value) {
  const profile = profiles[normalizeVoiceSensitivity(value)];
  return { listening:{...profile.listening}, interruption:{...profile.interruption} };
}

/** Acoustic settings belong to this account on this device, not the shared ASR service. */
export function createVoiceDetectionPreferences(storage,scope) {
  if (typeof scope !== 'string' || !scope.trim() || scope.length > 2048 || /[\u0000-\u001f\u007f]/u.test(scope)) throw new TypeError('Voice detection preferences require an explicit account scope.');
  const key = `petpal.voiceDetection:${encodeURIComponent(scope)}`;
  const fallback = fallbackFor(storage);
  let sensitivity = DEFAULT_VOICE_SENSITIVITY,disposed = false;
  if(fallback.has(key))sensitivity=fallback.get(key);
  else try { sensitivity = normalizeVoiceSensitivity(storage?.getItem(key)); } catch {}
  return {
    read:()=>sensitivity,
    write(value) {
      if (disposed) return sensitivity;
      sensitivity = normalizeVoiceSensitivity(value);
      try {
        if(!storage)throw new Error('Storage unavailable');
        storage.setItem(key,sensitivity);fallback.delete(key);
      } catch {
        // A new controller in the voice hook must see the same session choice
        // even if browser storage is blocked, full, or contains an older value.
        fallback.delete(key);fallback.set(key,sensitivity);
        if(fallback.size>64)fallback.delete(fallback.keys().next().value);
      }
      return sensitivity;
    },
    dispose() { disposed = true; sensitivity = DEFAULT_VOICE_SENSITIVITY; },
  };
}
