const EXPRESSIONS = Object.freeze({ neutral: 'neutral', happy: 'happy', sad: 'sad', angry: 'pout', gentle: 'tender' });
const INTENSITIES = new Set(['natural', 'strong']);
const SOURCES = new Set(['rules', 'choice', 'manual']);

/** Only authenticated upstream selection metadata may select a spoken expression. */
export function normalizeSpeechEmotion(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 3
    || !['emotion', 'intensity', 'source'].every(key => Object.hasOwn(value, key))
    || typeof value.emotion !== 'string' || !Object.hasOwn(EXPRESSIONS, value.emotion) || !INTENSITIES.has(value.intensity) || !SOURCES.has(value.source)
    || (['neutral', 'gentle'].includes(value.emotion) && value.intensity !== 'natural')) {
    throw new TypeError('朗读语气信息无效。');
  }
  return Object.freeze({ emotion: value.emotion, intensity: value.intensity, source: value.source });
}

/** null preserves legacy text expressions; neutral is an explicit override. */
export function emotionExpression(value) {
  const normalized = normalizeSpeechEmotion(value);
  return normalized ? EXPRESSIONS[normalized.emotion] : null;
}
