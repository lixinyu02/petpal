/** One user's action intent survives switching between native and fallback scenes. */
export function createCompanionActionState() {
  let action = 'idle', revision = 0, commandId;
  const snapshot = () => ({ action, revision });
  return {
    snapshot,
    transition(next) {
      if (action === 'sleep' && next !== 'wake' && next !== 'sleep') return null;
      action = next === 'wake' ? 'idle' : next; revision++;
      return snapshot();
    },
    consumeCommand(id) {
      if (id === commandId) return false;
      commandId = id;
      return true;
    },
  };
}
