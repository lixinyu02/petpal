export type VisiblePollOptions<Timer = ReturnType<typeof globalThis.setTimeout>> = {
  document: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>;
  window: Pick<Window, 'addEventListener' | 'removeEventListener'> & { navigator?: Pick<Navigator, 'onLine'> };
  intervalMs: number;
  run(signal: AbortSignal): Promise<void>;
  isCurrent?(): boolean;
  setTimeoutFn?(callback: () => void, delayMs: number): Timer;
  clearTimeoutFn?(timer: Timer): void;
};

/** Only for non-task UI state. Does not schedule overlapping runs within this owner. */
export function createVisiblePoll<Timer = ReturnType<typeof globalThis.setTimeout>>(options: VisiblePollOptions<Timer>): () => void;
