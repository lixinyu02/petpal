/** IME composition is never a send gesture, including WebViews that report keyCode 229. */
export function composerKeyAction(event,{touch=false,composition}={}) {
  if(event.key!=='Enter'||event.isComposing||event.keyCode===229||event.defaultPrevented||composition?.blocks(event))return'none';
  if(event.shiftKey||event.altKey)return'newline';
  if(event.ctrlKey||event.metaKey)return'send';
  return touch?'newline':'send';
}

/** WebKit can report the committing Enter after compositionend with both native
 * IME flags cleared. Protect that event transaction, rather than delaying every
 * normal key for hundreds of milliseconds. Keyup, blur or one frame releases it. */
export function createCompositionGuard({schedule=callback=>requestAnimationFrame(callback),cancel=id=>cancelAnimationFrame(id)}={}) {
  let composing=false,committing=false,frame=null;
  const release=()=>{if(frame!==null)cancel(frame);frame=null;committing=false;};
  const reset=()=>{release();composing=false;};
  return {
    start(){release();composing=true;},
    end(){release();composing=false;committing=true;frame=schedule(()=>{frame=null;committing=false;});},
    blocks(event){return composing||event.isComposing===true||event.keyCode===229||committing&&event.key==='Enter';},
    keyUp(event){if(event.key==='Enter')release();},
    reset,
  };
}
