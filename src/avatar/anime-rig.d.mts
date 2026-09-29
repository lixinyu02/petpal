export interface AnimeHairWeights { left: number; right: number }
/** Normalized image coordinates, with (0,0) at the top-left. Invalid/outside points return zero. */
export function sampleAnimeHairWeights(x: number, y: number): AnimeHairWeights;
/** Local displacement in the same units as a 2 by 3 portrait plane. */
export interface AnimeHairPose { leftX: number; leftY: number; rightX: number; rightY: number }
export interface AnimeHairMotionOptions {
  reducedMotion?: boolean;
  /** Boolean sleep state or a normalized 0..1 resting transition. Fully resting is still. */
  resting?: boolean | number;
  /** Normalized -1..1 view/pose cues. */
  gazeX?: number;
  headTilt?: number;
}
export interface AnimeHairMotion {
  /** Seconds; invalid/non-positive deltas hold the pose, long deltas advance by at most 0.1 s. */
  step(dt: number, options?: AnimeHairMotionOptions): AnimeHairPose;
  reset(): void;
}
export function createAnimeHairMotion(): AnimeHairMotion;
