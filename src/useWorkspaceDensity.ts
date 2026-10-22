import {useLayoutEffect, type RefObject} from 'react';

/** Width-based density without layout containment: host disclosure menus are
 * fixed descendants, so container-type on this node would change their origin. */
export function useWorkspaceDensity(ref:RefObject<HTMLDivElement|null>, active:boolean) {
  useLayoutEffect(()=>{
    const element=ref.current;
    if(!active||!element)return;
    let disposed=false,previous='';
    const update=(width:number)=>{
      if(disposed||!Number.isFinite(width))return;
      const density=width>=576?'wide':width>=480?'compact':width>=384?'narrow':width>=320?'small':'tiny';
      if(density===previous)return;
      previous=density;element.dataset.workspaceDensity=density;
    };
    const measure=()=>update(element.getBoundingClientRect().width);
    measure();
    const observer=typeof ResizeObserver==='function'?new ResizeObserver(entries=>{
      const entry=entries.find(value=>value.target===element);
      if(entry)update(entry.borderBoxSize?.[0]?.inlineSize??element.getBoundingClientRect().width);
    }):undefined;
    observer?.observe(element);
    const window=element.ownerDocument.defaultView;
    if(!observer)window?.addEventListener('resize',measure);
    return()=>{disposed=true;observer?.disconnect();if(!observer)window?.removeEventListener('resize',measure);element.removeAttribute('data-workspace-density');};
  },[ref,active]);
}
