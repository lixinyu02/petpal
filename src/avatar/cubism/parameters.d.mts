import type { AvatarPerformanceSnapshot } from '../performance.mjs';
import type { AvatarPresencePose } from '../presence.mjs';
export type CubismTargets = Record<string, number>;
export function cubismParameterTargets(pose?: Partial<AvatarPerformanceSnapshot>, follow?: Partial<AvatarPresencePose>, options?: { sleeping?: boolean; hidden?: boolean; reducedMotion?: boolean; nativeMotion?: string; nativeParameters?: Iterable<string>; supportedParameters?: string[] }): CubismTargets;
export interface CubismParameterModel {
  getParameterCount(): number;
  getParameterIndex(id: unknown): number;
  getParameterMinimumValue(index: number): number;
  getParameterMaximumValue(index: number): number;
  getParameterValueByIndex(index: number): number;
  setParameterValueByIndex(index: number, value: number): void;
}
export interface CubismParameterBridge {
  supported: string[];
  read(name: string): number | undefined;
  apply(targets: CubismTargets, options?: { mouthOnly?: boolean; additive?: string[]; multiply?: string[]; dominant?: string[]; preserve?: string[] }): void;
}
export function createCubismParameterBridge(model: CubismParameterModel, manager: { getId(name: string): unknown }): CubismParameterBridge;
