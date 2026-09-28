import { useRef, useState } from 'react';
import { MessageCircle, Moon, Sun, X } from 'lucide-react';
import type { PetCommand } from './PetScene';
import CompanionScene from '../avatar/CompanionScene';
import { useCompanion } from '../avatar/preference';

export default function PetOverlay({ floating = false }: { floating?: boolean }) {
  const [kind] = useCompanion();
  const [ready, setReady] = useState(false);
  const [sleeping, setSleeping] = useState(false);
  const [command, setCommand] = useState<PetCommand>();
  const sequence = useRef(0);
  return <main className={`single-pet-overlay ${floating ? 'desktop-single-pet' : ''}`} data-ready={ready}>
    {floating && <><div className="single-pet-drag" title="拖动伙伴">•••</div><div className="single-pet-tools"><button aria-label="打开小伴" onClick={() => window.petpal?.showMain()}><MessageCircle size={15}/></button><button aria-label={sleeping ? '叫醒伙伴' : '让伙伴休息'} onClick={() => setCommand({ action: sleeping ? 'wake' : 'sleep', id: ++sequence.current })}>{sleeping ? <Sun size={15}/> : <Moon size={15}/>}</button><button aria-label="隐藏伙伴" onClick={() => window.petpal?.hidePet()}><X size={15}/></button></div></>}
    <CompanionScene key={kind} kind={kind} compact command={command} onReady={() => setReady(true)} onState={state => setSleeping(state.action === 'sleep')}/>
  </main>;
}
