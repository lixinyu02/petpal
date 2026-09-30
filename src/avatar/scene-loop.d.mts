export function createVisibleSceneLoop(frame: (now: number) => void, options?: {
  request?: (callback: (now: number) => void) => number;
  cancel?: (id: number) => void;
}): { setActive(active: boolean): void; dispose(): void };
export function updateSceneDataset(dataset: DOMStringMap, values: Record<string, string>): void;
