import type { PetInteraction } from './behavior';

/** Shared interaction command for the Cubism character and recovery portrait. */
export type PetCommand = { action: PetInteraction; id: number };
