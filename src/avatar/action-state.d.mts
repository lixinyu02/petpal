import type { PetAction, PetInteraction } from '../pet/behavior.mjs';
export type CompanionActionState = {
  snapshot(): { action: PetAction; revision: number };
  transition(next: PetInteraction): { action: PetAction; revision: number } | null;
  consumeCommand(id: number): boolean;
};
export function createCompanionActionState(): CompanionActionState;
