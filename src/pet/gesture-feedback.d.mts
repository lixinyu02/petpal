import type { CompanionFeedback, CompanionRectReader } from './interaction.mjs';
export function createCompanionFeedback(container: HTMLElement, options?: {
  motionQuery?: Pick<MediaQueryList, 'matches' | 'addEventListener' | 'removeEventListener'>;
  schedule?: typeof setTimeout; unschedule?: typeof clearTimeout;
}): { update(feedback: CompanionFeedback, surface: HTMLElement, readRect?: CompanionRectReader): boolean; dispose(): void };
