import type { PetAction, PetInteraction } from './behavior.mjs';
export type CompanionRegion = 'head' | 'hand' | 'body';
export type CompanionGestureContext = { region: CompanionRegion; source: 'tap' | 'stroke' | 'hover' | 'hold' | 'keyboard' };
type Point = { id: string | number; x: number; y: number; pointerType: string; hit: boolean; button?: number; buttons?: number; isPrimary?: boolean; region?: CompanionRegion };
export type CompanionFeedback = Partial<Point> & { phase: 'hover' | 'press' | 'stroke' | 'release' | 'cancel' };
export function createCompanionGestures(options: {
  emit: (action: PetInteraction, context?: CompanionGestureContext) => void; getAction: () => PetAction;
  onFeedback?: (feedback: CompanionFeedback) => void;
  now?: () => number; schedule?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>; unschedule?: (timer: ReturnType<typeof setTimeout> | undefined) => void;
}): { down(point: Point): boolean; move(point: Point): boolean; up(point: Point): void; cancel(): void; leave(): void; keyDown(key: string, repeat?: boolean): boolean; keyUp(key: string): void; activate(): void };
export function bindCompanionGestures(surface: HTMLElement, options: {
  hitTest: (x: number, y: number) => boolean; regionAt?: (x: number, y: number) => CompanionRegion | null;
  emit: (action: PetInteraction, context?: CompanionGestureContext) => void; getAction: () => PetAction;
  onPointer?: (x: number, y: number) => void; onLeave?: () => void; enabled?: () => boolean;
  onFeedback?: (feedback: CompanionFeedback) => boolean;
}): (() => void) & { refresh(): void };
export function portraitCoordinates(rect: {left: number; top: number; width: number; height: number}, x: number, y: number): { x: number; y: number };
export function cubismPortraitCoordinates(rect: {left: number; top: number; width: number; height: number}, x: number, y: number): { x: number; y: number };
export function portraitContains(point: {x: number; y: number}, mask?: {width: number; height: number; data: Uint8ClampedArray}): boolean;
export function portraitRegion(point: {x: number; y: number}, mask?: {width: number; height: number; data: Uint8ClampedArray}): CompanionRegion | null;
