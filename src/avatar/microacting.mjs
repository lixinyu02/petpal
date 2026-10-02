const clamp=value=>Math.max(0,Math.min(1,value));
const smooth=value=>{const x=clamp(value);return x*x*(3-2*x);};
const INITIAL_WAIT=8.5,intervals=[11,13,10.5],kinds=['glance','softBlink','softSmile','doubleBlink','headTilt','breathPause'];
const durations={glance:2,softBlink:1.1,softSmile:2.4,doubleBlink:1.15,headTilt:2.6,breathPause:2.8};
const rest=()=>({microExpression:'none',microProgress:0,gazeOffsetX:0,blink:0,smileAmount:0,warmAmount:0,headTilt:0,headNod:0,bodyLean:0,bodyLift:0});
const blinkPulse=(progress,start,end)=>progress>start&&progress<end?Math.sin((progress-start)/(end-start)*Math.PI):0;

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
    else if(active.kind==='softSmile'){output.smileAmount=.22*amount;output.warmAmount=.12*amount;}
    else if(active.kind==='doubleBlink')output.blink=Math.max(blinkPulse(progress,.12,.32),blinkPulse(progress,.47,.69));
    else if(active.kind==='headTilt'){output.headTilt=.075*amount*active.direction;output.gazeOffsetX=.045*amount*active.direction;}
    else if(active.kind==='breathPause'){output.headNod=.035*amount;output.bodyLean=.025*amount;output.bodyLift=-.03*amount;}
    return output;
  }
  function reset(){cancel();sequence=0;}
  return {step,cancel,reset};
}
