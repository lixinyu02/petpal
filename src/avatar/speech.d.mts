export type SpeechProgressBasis = 'none' | 'boundary' | 'estimated';
export type SpeechState = { utteranceId: string; text: string; active: boolean; pending: boolean; charIndex: number; ended: boolean; progressBasis: SpeechProgressBasis; voiceName: string; error: string };
export type SpeechRequest = { utteranceId: string; text: string; language?: string };
export const SPEECH_SEGMENT_LIMIT: number;
export function speechLanguage(text: string, preferred?: string): string;
export function selectSpeechVoice(voices: readonly SpeechSynthesisVoice[], language: string): SpeechSynthesisVoice | null;
export function splitSpeechText(text: string): { text: string; start: number; end: number }[];
export function createSpeechController(options?: {
  synthesis?: Pick<SpeechSynthesis, 'getVoices' | 'speak' | 'cancel' | 'speaking' | 'paused'>;
  createUtterance?: (text: string) => SpeechSynthesisUtterance;
  onState?: (state: SpeechState) => void;
  now?: () => number;
  schedule?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  unschedule?: (timer: ReturnType<typeof setTimeout>) => void;
}): { speak(request: SpeechRequest): boolean; stop(): void; snapshot(): SpeechState; dispose(): void };
