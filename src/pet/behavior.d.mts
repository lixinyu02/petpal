export type PetAction = 'idle' | 'walk' | 'pet' | 'eat' | 'sleep' | 'jump';
export type PetInteraction = 'pet' | 'eat' | 'sleep' | 'jump' | 'wake';
export interface PetBehaviorOptions {
  seed?: number;
  random?: () => number;
  bounds?: readonly [number, number];
  initialX?: number;
  facing?: -1 | 1;
  walkSpeed?: number;
  reducedMotion?: boolean;
  visible?: boolean;
}
export interface PetBehaviorState {
  action: PetAction;
  x: number;
  facing: -1 | 1;
  lookX: number;
  lookY: number;
  actionTime: number;
  actionProgress: number;
  /** Normalized 0..1 arc; renderer chooses the height in scene units. */
  jumpHeight: number;
  /** Normalized gait speed 0..1; actual x motion uses walkSpeed scene units/second. */
  speed: number;
  autonomous: boolean;
  /** True only when hidden; the complete behavior clock is frozen. */
  paused: boolean;
  /** Hidden or reduced-motion: the autonomous schedule is frozen. */
  autonomyPaused: boolean;
}
export interface PetBehavior {
  step(deltaSeconds: number): PetBehaviorState;
  interact(action: PetInteraction): PetBehaviorState;
  wake(): PetBehaviorState;
  snapshot(): PetBehaviorState;
  setPointer(x: number, y: number): void;
  clearPointer(): void;
  setVisible(visible: boolean): void;
  setReducedMotion(reducedMotion: boolean): void;
}
export const MAX_STEP_SECONDS: number;
export const PET_ACTIONS: readonly PetAction[];
export function createSeededRandom(seed?: number): () => number;
export function createPetBehavior(options?: PetBehaviorOptions): PetBehavior;
