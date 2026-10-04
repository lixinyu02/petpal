export type UiMotionMode = 'full' | 'reduced' | 'off';
export type UiMotionController = {
  snapshot(): UiMotionMode;
  allows(): boolean;
  subscribe(listener: () => void): () => void;
  mount(options?: { disabled?: boolean }): () => void;
};
export function createUiMotionController(options?: { window?: Window; document?: Document }): UiMotionController;
export function beginUiEntrance(node: HTMLElement | null, controller: UiMotionController): () => void;
