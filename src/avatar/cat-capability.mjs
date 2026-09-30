import {overlayCompanion} from './preference-store.mjs';

export const COMPANION_DISPLAY_KEY='petpal.displayCompanion';
export const companionCatStorageKey=scope=>`petpal.companionCatEnabled:${encodeURIComponent(scope||'')}`;

/** Raw shape preferences remain untouched; a separate local opt-in controls use. */
export function effectiveCompanionKind(kind,enabled=false){
  return kind==='cat'&&enabled===true?'cat':'anime';
}

export function companionDisplayRecord(kind,enabled=false){
  return JSON.stringify({version:2,kind:effectiveCompanionKind(kind,enabled),catEnabled:enabled===true});
}

export function readCompanionDisplay(raw){
  try{
    if(typeof raw!=='string'||raw.length>256)return{kind:'anime',catEnabled:false};
    const value=JSON.parse(raw);
    if(value?.version!==2||typeof value.catEnabled!=='boolean'||!['anime','cat'].includes(value.kind))return{kind:'anime',catEnabled:false};
    return{kind:effectiveCompanionKind(value.kind,value.catEnabled),catEnabled:value.catEnabled};
  }catch{return{kind:'anime',catEnabled:false};}
}

/** This bridge-free URL is constructed only by Android's existing asset policy.
 * An ordinary web/desktop query is never proof of a local opt-in.
 */
export function isExplicitNativeCatOverlay(href){
  try{return new URL(href).href==='https://appassets.androidplatform.net/assets/public/index.html?overlay=1&avatar=cat';}
  catch{return false;}
}

export function resolveCompanionDisplay({kind='anime',catEnabled=false,search='',floating=false,displayRaw,href=''}={}){
  const specified=overlayCompanion(search);
  if(specified==='cat'&&isExplicitNativeCatOverlay(href))return'cat';
  if(floating||new URLSearchParams(search).has('overlay')){
    const display=readCompanionDisplay(displayRaw);
    // Old URLs cannot resurrect a cat after the main window has disabled it.
    return specified?effectiveCompanionKind(specified,display.kind==='cat'&&display.catEnabled):display.kind;
  }
  return effectiveCompanionKind(kind,catEnabled);
}

/** No legacy-key migration: every account/server scope starts explicitly off. */
export function createCompanionCatCapability({storage,scope=''}={}){
  const key=companionCatStorageKey(scope),listeners=new Set();
  let disposed=false;
  const read=()=>{
    if(!storage)return undefined;
    try{
      const raw=storage?.getItem(key);
      if(!raw)return false;
      if(raw.length>256)return false;
      try{const value=JSON.parse(raw);return !!value&&!Array.isArray(value)&&value.enabled===true;}
      catch{return false;}
    }catch{return undefined;}
  };
  let enabled=read()??false;
  const notify=()=>{for(const listener of listeners)listener();};
  const refresh=()=>{
    if(disposed)return;
    const next=read();
    // Denied storage keeps this page's explicit choice usable in memory.
    if(next!==undefined&&next!==enabled){enabled=next;notify();}
  };
  return{
    snapshot:()=>enabled,
    subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},
    setEnabled:next=>{
      if(typeof next!=='boolean')throw new TypeError('Cat capability must be a boolean.');
      if(disposed)return;
      const changed=enabled!==next;enabled=next;
      try{storage?.setItem(key,JSON.stringify({enabled}));}catch{}
      if(changed)notify();
    },
    refresh,
    storageChanged:eventKey=>{if(eventKey===null||eventKey===key)refresh();},
    dispose:()=>{disposed=true;listeners.clear();},
  };
}
