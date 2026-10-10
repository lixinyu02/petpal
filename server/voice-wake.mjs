// Pure shared module: kept under server/ so native backend packages include it.
const invalid = message => Object.assign(new Error(message), {status:400});
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const canonical = text => text.normalize('NFKC').toLowerCase().replace(/[\p{P}\s]/gu, '');
const graphemes = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined,{granularity:'grapheme'}) : null;

export function defaultWakeSettings() {
  return {enabled:false, phrases:['你好小伴'], idleTimeoutSeconds:45};
}

/** Shared by the account API and the microphone job snapshot. Never mutate input. */
export function normalizeWakeSettings(value) {
  if (value === undefined) return defaultWakeSettings();
  if (!record(value)) throw invalid('唤醒配置必须是对象。');
  const defaults = defaultWakeSettings();
  const enabled = Object.hasOwn(value,'enabled') ? value.enabled : defaults.enabled;
  const input = Object.hasOwn(value,'phrases') ? value.phrases : defaults.phrases;
  const idleTimeoutSeconds = Object.hasOwn(value,'idleTimeoutSeconds') ? value.idleTimeoutSeconds : defaults.idleTimeoutSeconds;
  if (typeof enabled !== 'boolean') throw invalid('唤醒开关必须是布尔值。');
  if (!Array.isArray(input) || input.length > 5) throw invalid('请填写最多 5 个唤醒词。');
  const phrases = [], seen = new Set();
  for (const phrase of input) {
    if (typeof phrase !== 'string' || phrase.length > 80 || /[\u0000-\u001f\u007f]/u.test(phrase)) throw invalid('唤醒词必须是有效文字。');
    const text = phrase.normalize('NFKC').trim(), key = canonical(text), length = [...key].length;
    if (text.length > 40 || length < 2 || length > 40 || !/^[\p{L}\p{N}]+$/u.test(key)) throw invalid('每个唤醒词须含 2–40 个字母、汉字或数字。');
    if (!seen.has(key)) { seen.add(key); phrases.push(text); }
  }
  if (enabled && !phrases.length) throw invalid('启用关键词唤醒前，请至少填写一个唤醒词。');
  if (!Number.isInteger(idleTimeoutSeconds) || idleTimeoutSeconds < 15 || idleTimeoutSeconds > 300) throw invalid('回待机时间须为 15–300 秒的整数。');
  return {enabled, phrases, idleTimeoutSeconds};
}

/** Final ASR only: sentence prefix, longest alias first, preserving the original question. */
export function matchWakePhrase(text, phrases) {
  if (typeof text !== 'string' || text.length > 12000) return null;
  const points = [];
  // Keep a source offset for each normalized code point (including ligatures and accents).
  const parts = graphemes ? graphemes.segment(text) : [...text.matchAll(/\P{M}\p{M}*|\p{M}+/gu)].map(part=>({segment:part[0],index:part.index}));
  for (const part of parts) {
    for (const char of canonical(part.segment)) points.push({char, end:part.index + part.segment.length});
  }
  const normalized = points.map(point=>point.char).join('');
  const candidates = phrases.map(phrase=>({phrase,key:canonical(phrase)})).sort((a,b)=>b.key.length-a.key.length);
  for (const {phrase,key} of candidates) {
    if (!key || !normalized.startsWith(key)) continue;
    const count = [...key].length, end = points[count-1]?.end;
    if (end === undefined || points[count]?.end === end) continue;
    // English aliases must not wake on a longer word, e.g. "cat" in "catch".
    if (/[\p{Script=Latin}\p{N}]$/u.test(key) && /^[\p{Script=Latin}\p{N}\p{M}]/u.test(text.slice(end).normalize('NFKC'))) continue;
    return {phrase, text:text.slice(end).replace(/^[\p{P}\s]+/u,'').trim()};
  }
  return null;
}
