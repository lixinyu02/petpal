import type { Library } from '@openuidev/react-lang';
export const openUILibrary: Library;
export const openUIPrompt: string;
export const openUIExample: string;
export const openUICardExample: string;
export const openUIOhmExample: string;
export function normalizeOpenUITableRows(columns: unknown, rows: unknown): (string | number | boolean | null)[][] | null;
export const OPENUI_LIMITS: Record<string, number>;
