import type { PetAction, PetInteraction } from './behavior.mjs';
type Point = { id: string | number; x: number; y: number; pointerType: string; hit: boolean; button?: number; isPrimary?: boolean };
export type CompanionFeedback = Partial<Point> & { phase: 'hover' | 'press' | 'stroke' | 'release' | 'cancel' };
export function createCompanionGestures(options: {
  emit: (action: PetInteraction) => void; getAction: () => PetAction;
  onFeedback?: (feedback: CompanionFeedback) => void;
  now?: () => number; schedule?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>; unschedule?: (timer: ReturnType<typeof setTimeout> | undefined) => void;
}): { down(point: Point): boolean; move(point: Point): boolean; up(point: Point): void; cancel(): void; leave(): void; keyDown(key: string, repeat?: boolean): boolean; keyUp(key: string): void; activate(): void };
export function bindCompanionGestures(surface: HTMLElement, options: {
  hitTest: (x: number, y: number) => boolean; emit: (action: PetInteraction) => void; getAction: () => PetAction;
  onPointer?: (x: number, y: number) => void; onLeave?: () => void; enabled?: () => boolean;
  onFeedback?: (feedback: CompanionFeedback) => boolean;
}): (() => void) & { refresh(): void };
export function portraitCoordinates(rect: {left: number; top: number; width: number; height: number}, x: number, y: number): { x: number; y: number };
export function portraitContains(point: {x: number; y: number}, mask?: {width: number; height: number; data: Uint8ClampedArray}): boolean;
