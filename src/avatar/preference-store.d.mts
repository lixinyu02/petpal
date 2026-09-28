import type { CompanionKind } from '../api';
export interface CompanionPreferenceOptions {
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  scope?: string;
  allowLegacy?: boolean;
  connected?: () => boolean;
  persist?: (kind: CompanionKind) => Promise<void>;
}
export interface CompanionPreference {
  snapshot(): { kind: CompanionKind; dirty: boolean; revision: number };
  subscribe(listener: () => void): () => void;
  refresh(): void;
  remember(kind: CompanionKind): void;
  choose(kind: CompanionKind): Promise<void>;
  hydrate(kind: CompanionKind): Promise<void>;
  dispose(): void;
}
export function overlayCompanion(search: string): CompanionKind | null;
export function createCompanionPreference(options?: CompanionPreferenceOptions): CompanionPreference;
