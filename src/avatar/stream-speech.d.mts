import type { SpeechRequest, SpeechState } from './speech.mjs';
import type { SpeechEmotion } from './speech-emotion.mjs';

export type StreamingSpeechState = SpeechState & { audioLevel: number; buffering: boolean; streaming: boolean };
export type StreamingSpeechFormat = { format: 'pcm_s16le'; sampleRate: 24000; channels: 1; emotion?: SpeechEmotion | null };
export type StreamingSpeechHandlers = {
  onFormat(format: StreamingSpeechFormat): void | Promise<void>;
  onAudio(bytes: Uint8Array): void | Promise<void>;
};
export const STREAM_SPEECH_TEXT_LIMIT: number;
export function createStreamingSpeechController(options?: {
  keepAlive?: boolean;
  requestStream?: (text: string, signal: AbortSignal, handlers: StreamingSpeechHandlers) => Promise<void>;
  createContext?: () => AudioContext;
  getSpeakerId?: () => string;
  onState?: (state: StreamingSpeechState) => void;
  mediaDevices?: Pick<MediaDevices, 'addEventListener' | 'removeEventListener' | 'enumerateDevices'>;
  now?: () => number;
  schedule?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  unschedule?: (timer: ReturnType<typeof setTimeout>) => void;
}): { speak(request: SpeechRequest): boolean; unlock(): Promise<boolean>; stop(): void; snapshot(): StreamingSpeechState; dispose(): void };
