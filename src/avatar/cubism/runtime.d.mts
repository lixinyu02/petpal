import type { AvatarPerformanceSnapshot } from '../performance.mjs';
import type { AvatarPresencePose } from '../presence.mjs';
import type { CubismDeformationProfile, CubismParameterBridge, CubismParameterModel } from './parameters.mjs';
export const CUBISM_RUNTIME_ROOT: string;
export const CUBISM_CORE_URL: string;
export type CubismFrameOptions = {
  sleeping?: boolean; hidden?: boolean; reducedMotion?: boolean;
  utteranceId?: string; phase?: string; speechActive?: boolean;
};
export interface CubismFrameController {
  readonly motionGroup: string;
  update(dt: number, pose: Partial<AvatarPerformanceSnapshot>, follow: Partial<AvatarPresencePose>, options?: CubismFrameOptions): void;
  react(kind: 'pet' | 'greet' | 'wake'): void;
}
type CubismMotionRecord = { motion: object; parameters: Set<string> };
interface CubismQueue {
  isFinished(): boolean;
  stopAllMotions(): void;
  updateMotion(model: CubismParameterModel, dt: number): boolean | void;
  getCubismMotionQueueEntries?(): { getCubismMotion(): object }[];
}
export function createCubismFrameController(options: {
  model: CubismParameterModel & { saveParameters(): void; loadParameters(): void; update(): void };
  avatar: {
    _motionManager: CubismQueue & { startMotionPriority(motion: object, autoDelete: boolean, priority: number): unknown };
    _expressionManager: CubismQueue & { startMotion(motion: object, autoDelete: boolean): unknown };
    _physics?: { evaluate(model: CubismParameterModel, dt: number): void };
    _pose?: { updateParameters(model: CubismParameterModel, dt: number): void };
  };
  bridge: CubismParameterBridge;
  motions?: Map<string, CubismMotionRecord>;
  expressions?: Map<string, CubismMotionRecord>;
  deformationProfile?: CubismDeformationProfile;
}): CubismFrameController;
export interface CubismAvatar {
  mocVersion: number; coreVersion: number; supportedParameters: string[];
  readonly motionGroup: string;
  update(dt: number, pose: AvatarPerformanceSnapshot, follow: AvatarPresencePose, options?: CubismFrameOptions): void;
  react(kind: 'pet' | 'greet' | 'wake'): void;
  render(): void;
  release(): void;
}
export function createCubismAvatar(options: { canvas: HTMLCanvasElement; modelUrl?: string; signal?: AbortSignal; compact?: boolean }): Promise<CubismAvatar>;
