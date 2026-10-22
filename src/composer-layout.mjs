const pixels=value=>{const n=Number.parseFloat(value);return Number.isFinite(n)?n:0;};

/** One measurement owner for typing, pasted drafts, width changes and the
 * software keyboard. No React state or timer polling belongs in this loop. */
export function createComposerLayout(input,{window=input.ownerDocument.defaultView,schedule=callback=>window.requestAnimationFrame(callback),cancel=id=>window.cancelAnimationFrame(id),ResizeObserver=window.ResizeObserver}={}) {
  const initial={height:input.style.height,overflowY:input.style.overflowY};
  const area=input.closest('.chat-area'),composer=input.closest('.composer-area');
  const controls=area?.querySelector('.workspace-controls');
  const fonts=input.ownerDocument.fonts,viewport=window.visualViewport;
  let frame=null,closed=false;
  const measure=()=>{
    frame=null;
    if(closed||!input.isConnected)return;
    const rect=input.getBoundingClientRect();
    if(rect.width<=0)return;
    const style=window.getComputedStyle(input),border=pixels(style.borderTopWidth)+pixels(style.borderBottomWidth);
    const padding=pixels(style.paddingTop)+pixels(style.paddingBottom);
    const min=Math.max(1,pixels(style.minHeight)||44),cssMax=pixels(style.maxHeight)||180;
    let maximum=Math.max(min,cssMax);
    if(area&&composer){
      const bounds=area.getBoundingClientRect(),height=viewport?.height||window.innerHeight;
      const top=viewport?.offsetTop||0;
      const available=Math.max(0,Math.min(bounds.bottom,top+height)-Math.max(bounds.top,top));
      const chrome=Math.max(0,composer.scrollHeight-rect.height);
      const readingReserve=Math.min(96,Math.max(44,available*.18));
      const controlHeight=controls?.getBoundingClientRect().height||0;
      maximum=Math.max(min,Math.min(maximum,available-controlHeight-chrome-readingReserve));
    }
    // Reset the explicit height before reading scrollHeight, so deletion and
    // clearing a sent draft can shrink as well as grow. Respect box sizing.
    input.style.height='0px';
    const natural=input.scrollHeight+(style.boxSizing==='border-box'?border:-padding);
    const target=Math.ceil(Math.max(min,Math.min(maximum,natural)));
    input.style.height=`${target}px`;
    input.style.overflowY=natural>target+1?'auto':'hidden';
  };
  const queue=()=>{if(!closed&&frame===null)frame=schedule(measure);};
  const sizes=new WeakMap();
  const observer=ResizeObserver?new ResizeObserver(entries=>{
    for(const entry of entries){
      const size=entry.contentRect,previous=sizes.get(entry.target);
      // Own height changes are an output, not another measurement trigger.
      const changed=!previous||Math.abs(previous.width-size.width)>.5||entry.target!==input&&Math.abs(previous.height-size.height)>.5;
      sizes.set(entry.target,{width:size.width,height:size.height});
      if(changed)queue();
    }
  }):null;
  for(const element of new Set([input,area,composer,controls].filter(Boolean)))observer?.observe(element);
  window.addEventListener('resize',queue);viewport?.addEventListener('resize',queue);viewport?.addEventListener('scroll',queue);
  fonts?.addEventListener?.('loadingdone',queue);
  measure();
  return {schedule:queue,measure,dispose(){
    if(closed)return;closed=true;
    if(frame!==null)cancel(frame);frame=null;
    observer?.disconnect();window.removeEventListener('resize',queue);
    viewport?.removeEventListener('resize',queue);viewport?.removeEventListener('scroll',queue);
    fonts?.removeEventListener?.('loadingdone',queue);
    input.style.height=initial.height;input.style.overflowY=initial.overflowY;
  }};
}
