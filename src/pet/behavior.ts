// TypeScript entry point; the single implementation is also directly testable by Node.
export { createPetBehavior, createSeededRandom, MAX_STEP_SECONDS, PET_ACTIONS } from './behavior.mjs';
export type { PetAction, PetInteraction, PetBehaviorOptions, PetBehaviorState, PetBehavior } from './behavior.mjs';
