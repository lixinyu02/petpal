export type PerformancePhase = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';
export type AvatarExpression = 'neutral' | 'warm' | 'curious' | 'thoughtful' | 'surprised' | 'shy';
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
  mouthOpen: number;
  mouthShape: MouthShape;
  /** 0 = open eyes; 1 = fully closed. */
  blinkLeft: number;
  blinkRight: number;
  browRaise: number;
  blush: number;
  /** Normalized -1..1 pose cues; the renderer chooses angle/displacement amplitude. */
  headTilt: number;
  headNod: number;
  speaking: boolean;
}
export interface AvatarPerformance {
  setInput(input: PerformanceInput): void;
  step(dt: number, options?: { reducedMotion?: boolean; hidden?: boolean }): AvatarPerformanceSnapshot;
  /** Stop all motion/queued speech while retaining bounded consumed-message replay protection. */
  reset(): void;
}
export function createAvatarPerformance(): AvatarPerformance;
