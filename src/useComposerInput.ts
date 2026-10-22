import {useLayoutEffect,useRef,type RefObject} from 'react';
import {createCompositionGuard} from './composer-keyboard.mjs';
import {createComposerLayout,type ComposerLayout} from './composer-layout.mjs';

export function useInputComposition(scope:unknown) {
  const guard=useRef<ReturnType<typeof createCompositionGuard>|null>(null);
  if(!guard.current)guard.current=createCompositionGuard({schedule:callback=>requestAnimationFrame(callback),cancel:id=>cancelAnimationFrame(id)});
  const composition=guard.current;
  useLayoutEffect(()=>{composition.reset();return()=>composition.reset();},[composition,scope]);
  return composition;
}

export function useComposerInput(ref:RefObject<HTMLTextAreaElement|null>,value:string,scope:unknown,active=true) {
  const layout=useRef<ComposerLayout|null>(null);
  const composition=useInputComposition(scope);
  useLayoutEffect(()=>{
    if(!active||!ref.current)return;
    const mounted=createComposerLayout(ref.current);layout.current=mounted;
    return()=>{mounted.dispose();if(layout.current===mounted)layout.current=null;};
  },[ref,scope,active]);
  useLayoutEffect(()=>{layout.current?.schedule();},[value]);
  return composition;
}
