/** IME composition is never a send gesture, including WebViews that report keyCode 229. */
export function composerKeyAction(event,{touch=false}={}) {
  if(event.key!=='Enter'||event.isComposing||event.keyCode===229||event.defaultPrevented)return'none';
  if(event.shiftKey||event.altKey)return'newline';
  if(event.ctrlKey||event.metaKey)return'send';
  return touch?'newline':'send';
}
