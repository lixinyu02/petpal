import type { SpeechState } from './speech.mjs';
export type PlaybackState = Readonly<SpeechState & { audioLevel?: number; buffering?: boolean; streaming?: boolean }>;
export type SpeechProgressSource = Readonly<{
  snapshot(): PlaybackState;
  subscribe(listener: () => void): () => void;
}>;
export function samePlaybackSemantics(before: PlaybackState, after: PlaybackState): boolean;
export function createSpeechPresentation(initial: PlaybackState): {
  source: SpeechProgressSource;
  publish(next: PlaybackState): PlaybackState;
};
