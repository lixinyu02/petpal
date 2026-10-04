const layerSelector='[data-ui-layer],.chat-assistant-layer,.workspace-model-popup';
const focusSelector='button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex]:not([tabindex="-1"])';
const visible=node=>!!node?.isConnected&&!node.hidden&&node.getBoundingClientRect().width>0&&node.getBoundingClientRect().height>0;

/** Shared UI only: dismiss controls, focus boundaries and Android's cancelable back handoff. */
export function mountInteractionLayers({window:win=globalThis.window,document:doc=win?.document}={}) {
  if(!win||!doc?.body||typeof doc.querySelectorAll!=='function'||typeof win.MutationObserver!=='function')return()=>{};
  const previousFocus=new Map(),masked=new Set();
  let stopped=false,redirecting=false,lastFocus=doc.activeElement;
  const unmask=()=>{for(const node of masked)node.inert=false;masked.clear();};
  const top=()=>Array.from(doc.querySelectorAll(layerSelector)).filter(visible).at(-1);
  const managed=node=>!!node?.hasAttribute('data-ui-layer');
  const remember=(all,prior=lastFocus)=>{
    for(const node of all)if(!previousFocus.has(node)){
      const candidate=node.contains(doc.activeElement)?prior:doc.activeElement;
      previousFocus.set(node,candidate&&!node.contains(candidate)?candidate:null);
    }
  };
  const blocked=node=>{for(let branch=node;branch;branch=branch.parentElement)if(branch.inert)return true;return false;};
  const items=node=>Array.from(node.querySelectorAll(focusSelector)).filter(item=>visible(item)&&!blocked(item)&&item.getAttribute('aria-disabled')!=='true');
  const dismiss=node=>node?.querySelector('[data-ui-dismiss]')||(node?.dataset.uiLayer==='navigation'?doc.querySelector('[data-ui-dismiss="navigation"]'):null);
  const focusInside=node=>{
    const target=items(node)[0];
    if(target){redirecting=true;try{target.focus({preventScroll:true});}finally{redirecting=false;}}
  };
  const refresh=()=>{
    if(stopped)return;
    unmask();
    const all=Array.from(doc.querySelectorAll('[data-ui-layer]')).filter(visible);
    for(const [node,prior]of previousFocus)if(!all.includes(node)){
      previousFocus.delete(node);
      if(prior?.isConnected&&(!top()||top().contains(prior)))prior.focus({preventScroll:true});
    }
    remember(all);
    const current=top();
    // A model picker may be portalled outside its owning dialog. Keep that
    // dialog's background masked while its own keyboard handler owns focus.
    const owner=managed(current)?current:all.at(-1);
    if(!owner)return;
    // Mask siblings along the modal's ancestry, preserving pre-existing inert state.
    for(let branch=owner;branch&&branch!==doc.body;branch=branch.parentElement){
      for(const sibling of Array.from(branch.parentElement?.children||[])){
        if(sibling===branch||sibling===current||sibling.contains(current)||sibling.matches('script,style,link,[data-ui-dismiss="navigation"]')||sibling.inert)continue;
        sibling.inert=true;masked.add(sibling);
      }
    }
    if(managed(current)&&!current.contains(doc.activeElement))focusInside(current);
  };
  const keyDown=event=>{
    if(event.defaultPrevented||event.isComposing||event.keyCode===229)return;
    const current=top();if(!managed(current))return;
    if(event.key==='Escape'){
      const control=dismiss(current);
      if(control){event.preventDefault();if(!control.disabled)control.click();}
    }else if(event.key==='Tab'){
      const controls=items(current),index=controls.indexOf(doc.activeElement);
      if(!controls.length){event.preventDefault();return;}
      if(index<0||(!event.shiftKey&&index===controls.length-1)||(event.shiftKey&&index===0)){
        event.preventDefault();controls[event.shiftKey?controls.length-1:0].focus({preventScroll:true});
      }
    }
  };
  const focusIn=event=>{
    if(redirecting||stopped)return;
    // React autoFocus runs before the observer sees the newly mounted modal.
    remember(Array.from(doc.querySelectorAll('[data-ui-layer]')).filter(visible),event.relatedTarget||lastFocus);
    const current=top();
    if(managed(current)&&!current.contains(doc.activeElement))focusInside(current);
    lastFocus=doc.activeElement;
  };
  const nativeBack=event=>{
    if(event.defaultPrevented||doc.hidden)return;
    // Let existing nested selectors and Agent dialogs consume Escape first.
    const escape=new win.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true});
    (doc.activeElement||doc.body).dispatchEvent(escape);
    if(escape.defaultPrevented){event.preventDefault();return;}
    const current=top();
    const close=current?.querySelector('[data-ui-dismiss],.workspace-model-close,.chat-assistant-dialog-heading>button');
    if(close){event.preventDefault();if(!close.disabled)close.click();return;}
    const disclosure=Array.from(doc.querySelectorAll('.workspace-disclosure[open],.workspace-host-picker[open],.interaction-help[open]')).filter(visible).at(-1);
    if(disclosure){event.preventDefault();disclosure.open=false;disclosure.querySelector('summary')?.focus({preventScroll:true});return;}
    const workspace=new win.CustomEvent('petpal:workspace-back',{cancelable:true});
    win.dispatchEvent(workspace);if(workspace.defaultPrevented)event.preventDefault();
  };
  const observer=new win.MutationObserver(refresh);
  observer.observe(doc.body,{childList:true,subtree:true,attributes:true,attributeFilter:['data-ui-layer','hidden']});
  doc.addEventListener('keydown',keyDown);doc.addEventListener('focusin',focusIn);win.addEventListener('petpal:native-back',nativeBack);
  refresh();
  return()=>{stopped=true;observer.disconnect();doc.removeEventListener('keydown',keyDown);doc.removeEventListener('focusin',focusIn);win.removeEventListener('petpal:native-back',nativeBack);unmask();previousFocus.clear();};
}
