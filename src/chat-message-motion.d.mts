export const MESSAGE_MOTION_ID_LIMIT: number;
export interface MessageMotionTracker {
  scope: string | null;
  seen: Set<string>;
  saturated: boolean;
}
export interface MessageMotionLifecycle {
  enter(ids: string[]): void;
  clear(): void;
  dispose(): void;
}
export function createMessageMotionTracker(): MessageMotionTracker;
export function advanceMessageMotion(tracker: MessageMotionTracker, scope: string, ids: Iterable<string>, animate: boolean): string[];
export function canAnimateMessageMotion(document: Document): boolean;
export function attachMessageMotion(list: HTMLElement, document: Document): MessageMotionLifecycle;
