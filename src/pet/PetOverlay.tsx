import { useState } from 'react';
import { MessageCircle, X } from 'lucide-react';
import CompanionScene from '../avatar/CompanionScene';
import { useCompanion } from '../avatar/preference';

export default function PetOverlay({ floating = false }: { floating?: boolean }) {
  const [kind] = useCompanion();
  const [ready, setReady] = useState(false);
  return <main className={`single-pet-overlay ${floating ? 'desktop-single-pet' : ''}`} data-ready={ready}>
    {floating && <><div className="single-pet-drag" title="拖动伙伴">•••</div><div className="single-pet-tools"><button aria-label="打开小伴" onClick={() => window.petpal?.showMain()}><MessageCircle size={15}/></button><button aria-label="隐藏伙伴" onClick={() => window.petpal?.hidePet()}><X size={15}/></button></div></>}
    <CompanionScene key={kind} kind={kind} compact onReady={() => setReady(true)}/>
  </main>;
}
