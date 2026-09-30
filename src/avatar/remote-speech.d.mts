import type { SpeechRequest, SpeechState } from './speech.mjs';
import type { SpeechEmotion } from './speech-emotion.mjs';
export type SpeechAudio = { blob: Blob; emotion?: SpeechEmotion | null };

/** Each call must return a new element; cancelled elements remain permanently muted. */
export type RemoteSpeechAudio = Pick<HTMLAudioElement,
  'src' | 'preload' | 'muted' | 'paused' | 'currentTime' | 'duration' | 'play' | 'pause' |
  'onplaying' | 'onpause' | 'onwaiting' | 'onstalled' | 'onended' | 'onerror' | 'ontimeupdate' | 'onloadedmetadata'> & {
  setSinkId?: (speakerId: string) => Promise<void>;
  removeAttribute?: (name: string) => void;
  load?: () => void;
};
export const REMOTE_SPEECH_TEXT_LIMIT: number;
export function createRemoteSpeechController(options?: {
  requestAudio?: (text: string, signal: AbortSignal) => Promise<Blob | SpeechAudio>;
  createAudio?: () => RemoteSpeechAudio;
  createObjectURL?: (blob: Blob) => string;
  revokeObjectURL?: (url: string) => void;
  getSpeakerId?: () => string;
  onState?: (state: SpeechState) => void;
  schedule?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  unschedule?: (timer: ReturnType<typeof setTimeout>) => void;
}): { speak(request: SpeechRequest): boolean; stop(): void; snapshot(): SpeechState; dispose(): void };
