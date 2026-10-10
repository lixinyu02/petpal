export const COMPANION_DISPLAY_KEY='petpal.displayCompanion';
// Retained solely to recognize older callers and scoped storage keys.
export const COMPANION_CAT_VERSION=2;
export const companionCatStorageKey=scope=>`petpal.companionCatEnabled:${encodeURIComponent(scope||'')}`;

/** Legacy wire/storage values remain readable without enabling a retired model. */
export function effectiveCompanionKind(_kind,_enabled=false){return'anime';}
export function companionDisplayRecord(_kind,_enabled=false){
  return JSON.stringify({version:3,kind:'anime',catEnabled:false});
}
export function readCompanionDisplay(_raw){return{kind:'anime',catEnabled:false};}
export function isExplicitNativeCatOverlay(_href){return false;}
export function resolveCompanionDisplay(_options={}){return'anime';}

/** Inert compatibility facade: never reads/writes another account's old opt-in. */
export function createCompanionCatCapability(_options={}){
  let disposed=false;
  const listeners=new Set();
  return{
    snapshot:()=>false,
    subscribe:listener=>{if(!disposed)listeners.add(listener);return()=>listeners.delete(listener);},
    setEnabled:next=>{if(typeof next!=='boolean')throw new TypeError('Cat capability must be a boolean.');},
    refresh:()=>{},
    storageChanged:()=>{},
    dispose:()=>{disposed=true;listeners.clear();},
  };
}
