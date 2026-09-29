const clamp=value=>Math.max(0,Math.min(1,value));
const smooth=value=>{const x=clamp(value);return x*x*(3-2*x);};
const INITIAL_WAIT=8.5,intervals=[11,13,10.5],kinds=['glance','softBlink','softSmile'];
const durations={glance:2,softBlink:1.1,softSmile:2.4};
const rest=()=>({microExpression:'none',microProgress:0,gazeOffsetX:0,blink:0,smileAmount:0,warmAmount:0});

/** Low-priority idle cues; interruption starts a fresh quiet interval, never a queue. */
export function createAvatarMicroacting(){
  let remaining=INITIAL_WAIT,active=null,sequence=0;
  function cancel(){active=null;remaining=INITIAL_WAIT;}
  function step(seconds,{enabled=true}={}){
    const elapsed=Number.isFinite(seconds)&&seconds>0?seconds:0;
    if(!enabled){cancel();return rest();}
    if(active){
      active.age+=elapsed;
      if(active.age>=active.duration){active=null;remaining=intervals[(sequence-1)%intervals.length];return rest();}
    }else{
      remaining-=elapsed;
      if(remaining>0)return rest();
      const kind=kinds[sequence%kinds.length],duration=durations[kind],age=-remaining;
      const direction=sequence%2===0?1:-1;
      sequence++;
      // Covered windows can skip a whole cue. Consume it rather than showing a
      // late animation or looping through the missed timeline on return.
      if(age>=duration){remaining=intervals[(sequence-1)%intervals.length];return rest();}
      active={kind,duration,age,direction};
    }
    const progress=active.age/active.duration;
    const amount=smooth(progress/.24)*(1-smooth((progress-.55)/.45));
    const output={...rest(),microExpression:active.kind,microProgress:clamp(progress)};
    if(active.kind==='glance')output.gazeOffsetX=.34*amount*active.direction;
    else if(active.kind==='softBlink')output.blink=amount;
    else{output.smileAmount=.22*amount;output.warmAmount=.12*amount;}
    return output;
  }
  function reset(){cancel();sequence=0;}
  return {step,cancel,reset};
}
