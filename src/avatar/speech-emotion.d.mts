export type SpeechEmotion = Readonly<{
  emotion: 'neutral' | 'happy' | 'sad' | 'angry' | 'gentle';
  intensity: 'natural' | 'strong';
  source: 'rules' | 'choice' | 'manual';
}>;
export function normalizeSpeechEmotion(value: unknown): SpeechEmotion | null;
export function emotionExpression(value: unknown): 'neutral' | 'happy' | 'sad' | 'pout' | 'tender' | null;
