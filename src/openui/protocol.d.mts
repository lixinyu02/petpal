export type OutputRendering = 'markdown' | 'auto' | 'openui';
export type OpenUIPart = { type: 'markdown' | 'openui'; text: string; closed?: boolean };
export const OPENUI_MESSAGE_LIMIT: number;
export function isOpenUIMode(mode: unknown): boolean;
export function splitOpenUI(value: unknown, options?: { streaming?: boolean }): { parts: OpenUIPart[]; error?: string };
export function openUIActionText(event: unknown): string | null;
