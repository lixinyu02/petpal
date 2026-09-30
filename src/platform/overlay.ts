import { registerPlugin } from '@capacitor/core';
import type { CompanionKind } from '../api';
import { readCompanion, readCompanionCatEnabled } from '../avatar/preference';
import { effectiveCompanionKind } from '../avatar/cat-capability.mjs';

export type OverlayOptions = { companionKind?: CompanionKind };
export type OverlayStatus = { permission: boolean; running: boolean; companionKind: CompanionKind };
export type OverlayStartResult = { running: boolean; companionKind: CompanionKind };
export interface PetOverlayPlugin {
  status(): Promise<OverlayStatus>;
  requestPermission(): Promise<{ permission: boolean }>;
  showPet(options?: OverlayOptions): Promise<OverlayStartResult>;
  start(options?: OverlayOptions): Promise<OverlayStartResult>;
  stop(): Promise<{ running: boolean }>;
}

export const PetOverlay = registerPlugin<PetOverlayPlugin>('PetOverlay');

/** Native side repeats this enum validation before constructing its local asset URL. */
export function showPet(options: OverlayOptions = {}) {
  return PetOverlay.showPet({ companionKind: effectiveCompanionKind(options.companionKind??readCompanion(),readCompanionCatEnabled()) });
}
