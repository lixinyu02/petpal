export type PerformancePhase = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';
export type AvatarExpression = 'neutral' | 'warm' | 'curious' | 'thoughtful' | 'surprised' | 'shy' | 'happy' | 'playful' | 'concerned';
export interface AvatarReaction { id: string; kind: 'pet' | 'greet' | 'wake' }
export type MouthShape = 'rest' | 'A' | 'E' | 'O' | 'M';
export interface PerformanceInput {
  utteranceId: string;
  text: string;
  phase: PerformancePhase;
  /** UTF-16 text position from optional playback boundary events; not an audio phoneme measurement. */
  speech?: { active: boolean; charIndex: number; ended?: boolean; /** PCM energy envelope, not phoneme recognition. */ audioLevel?:number };
}
export interface AvatarPerformanceSnapshot {
  expression: AvatarExpression;
  expressionAmount: number;
  /** Independently eased 0..1 facial channels; never drive mouth articulation. */
  warmAmount: number;
  curiousAmount: number;
  surpriseAmount: number;
  concernAmount: number;
  smileAmount: number;
  mouthOpen: number;
  mouthShape: MouthShape;
  /** 0 = open eyes; 1 = fully closed. */
  blinkLeft: number;
  blinkRight: number;
  browRaise: number;
  /** Signed -1..1 inner-brow tilt, distinct from overall brow height. */
  browTilt: number;
  blush: number;
  /** Normalized -1..1 pose cues; the renderer chooses angle/displacement amplitude. */
  headTilt: number;
  headNod: number;
  /** Signed -1..1 expression gaze offset; zero during reduced motion. */
  gazeOffsetX: number;
  gazeOffsetY: number;
  speaking: boolean;
}
export interface AvatarPerformance {
  setInput(input: PerformanceInput): void;
  /** React once per id without changing speech/input; false for duplicate or hidden events. */
  react(event: AvatarReaction): boolean;
  step(dt: number, options?: { reducedMotion?: boolean; hidden?: boolean }): AvatarPerformanceSnapshot;
  /** Clear pose/reactions/queued speech, retaining bounded message and reaction replay protection. */
  reset(): void;
}
export function createAvatarPerformance(): AvatarPerformance;
