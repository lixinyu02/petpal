import type { CompanionFeedback } from './interaction.mjs';
export function createCompanionFeedback(container: HTMLElement, options?: {
  motionQuery?: Pick<MediaQueryList, 'matches' | 'addEventListener' | 'removeEventListener'>;
  schedule?: typeof setTimeout; unschedule?: typeof clearTimeout;
}): { update(feedback: CompanionFeedback, surface: HTMLElement): boolean; dispose(): void };
