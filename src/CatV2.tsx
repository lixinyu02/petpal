import { useEffect, useRef, useState } from 'react';
import type { PetCommand } from './pet/PetScene';
import CompanionScene from './avatar/CompanionScene';
import { useCompanion } from './avatar/preference';
import type { PetInteraction, PetBehaviorState } from './pet/behavior';
import type { PerformanceInput } from './avatar/performance.mjs';
export default function Cat({ mood, small = false, speaking = false, performanceInput, onState, onInteract, interactive = true }: { mood?: string; small?: boolean; speaking?: boolean; performanceInput?: PerformanceInput; onState?: (state: PetBehaviorState) => void; onInteract?: (action: PetInteraction) => void; interactive?: boolean }) {
  const [kind] = useCompanion();
  const [command, setCommand] = useState<PetCommand>();
  const sequence = useRef(0);
  useEffect(() => {
    if (mood === undefined) return;
    const action: PetInteraction = ({ happy: 'pet', eat: 'eat', sleep: 'sleep', jump: 'jump' } as Record<string, PetInteraction>)[mood] || 'wake';
    setCommand({ action, id: ++sequence.current });
  }, [mood]);
  return <span className={`cat-three-wrapper ${small ? 'cat-small' : ''}`}><CompanionScene key={kind} kind={kind} compact command={command} speaking={speaking} performanceInput={performanceInput} onState={onState} onInteract={onInteract} interactive={interactive}/></span>;
}
