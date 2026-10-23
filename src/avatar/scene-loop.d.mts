export function createVisibleSceneLoop(frame: (now: number) => void, options?: {
  request?: (callback: (now: number) => void) => number;
  cancel?: (id: number) => void;
  maxFps?: number;
}): { setActive(active: boolean): void; dispose(): void };
export function updateSceneDataset(dataset: DOMStringMap, values: Record<string, string>): void;
export function createSceneDatasetPublisher(options?: { intervalMs?: number }): {
  publish(dataset: DOMStringMap, semantic: Record<string, string>, continuous: () => Record<string, string>, options: { now: number; frame: number }): boolean;
  invalidate(): void;
};
