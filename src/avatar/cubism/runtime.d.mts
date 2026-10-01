import type { AvatarPerformanceSnapshot } from '../performance.mjs';
import type { AvatarPresencePose } from '../presence.mjs';
export const CUBISM_RUNTIME_ROOT: string;
export const CUBISM_CORE_URL: string;
export interface CubismAvatar {
  mocVersion: number; coreVersion: number; supportedParameters: string[];
  readonly motionGroup: string;
  update(dt: number, pose: AvatarPerformanceSnapshot, follow: AvatarPresencePose, options?: { sleeping?: boolean; hidden?: boolean; reducedMotion?: boolean }): void;
  react(kind: 'pet' | 'greet' | 'wake'): void;
  render(): void;
  release(): void;
}
export function createCubismAvatar(options: { canvas: HTMLCanvasElement; modelUrl?: string; signal?: AbortSignal; compact?: boolean }): Promise<CubismAvatar>;
