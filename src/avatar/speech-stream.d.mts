import type { SpeechEmotion } from './speech-emotion.mjs';
export type SpeechStreamFormat = { format:'pcm_s16le'; sampleRate:24000; channels:1; emotion?: SpeechEmotion | null };
export type SpeechStreamHandlers = {
  onFormat(format:SpeechStreamFormat):void|Promise<void>;
  onAudio(bytes:Uint8Array):void|Promise<void>;
};
export function readSpeechStream(response:Response, options:SpeechStreamHandlers & {
  signal?:AbortSignal; assertCurrent?:()=>void;
}):Promise<void>;
