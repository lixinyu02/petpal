export interface AvatarPresenceOptions {
  gazeX?: number;
  gazeY?: number;
  headTilt?: number;
  headNod?: number;
  voiceEnergy?: number;
  phase?: 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';
  reducedMotion?: boolean;
  sleeping?: boolean;
  hidden?: boolean;
}

export interface AvatarPresencePose {
  /** -1..1 world axes: y is up, tilt is counter-clockwise; eyes lead the head. */
  gazeX: number;
  gazeY: number;
  headX: number;
  headY: number;
  headTilt: number;
  /** Small additive CSS offsets: y is down, rotation clockwise. */
  bodyXPercent: number;
  bodyYPercent: number;
  bodyRotationDegrees: number;
  breath: number;
  /** Breathing amplitude multiplier, not the portrait's overall scale. */
  breathScale: number;
}

export function createAvatarPresence(): {
  step(deltaSeconds: number, options?: AvatarPresenceOptions): AvatarPresencePose;
  reset(): void;
};
