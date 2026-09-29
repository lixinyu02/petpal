import { emotionAtSpeechBoundary } from './emotion.mjs';

const clamp=(value,min=0,max=1)=>Math.min(max,Math.max(min,value));
const smooth=value=>{const t=clamp(value);return t*t*(3-2*t);};
const rest=()=>({gesture:'none',gestureProgress:0,bodyLean:0,bodyLift:0,bodyTurn:0,headShake:0,headTilt:0,headNod:0});
const durations={nod:1.1,shake:1.3,tilt:1.6,shy:1.8,bounce:1.15,recoil:1.25,settle:1.9};
const expressiveGestures={curious:'tilt',thoughtful:'tilt',shy:'shy',happy:'bounce',excited:'bounce',surprised:'recoil',warm:'nod',smug:'tilt',pout:'shake',relieved:'settle',determined:'nod'};

/** Select only the current clause. The absolute sentence offset is stable as text grows. */
export function gestureAtSpeechBoundary(text,index) {
  if(typeof text!=='string'||!Number.isFinite(index)||index<0||index>=text.length)return null;
  const at=Math.floor(index);
  let sentenceStart=0,clauseStart=0,end=text.length;
  if(at>0)for(const separator of '。！？.!?\n')sentenceStart=Math.max(sentenceStart,text.lastIndexOf(separator,at-1)+1);
  clauseStart=sentenceStart;
  if(at>0)for(const separator of '，,；;')clauseStart=Math.max(clauseStart,text.lastIndexOf(separator,at-1)+1);
  for(const separator of '。！？.!?\n，,；;'){
    const position=text.indexOf(separator,at);
    if(position>=0)end=Math.min(end,position+1);
  }
  const clause=text.slice(Math.max(clauseStart,at-256),Math.min(end,at+256)).trim();
  // Descriptions and lists should not act out the movements they mention.
  if(/(?:表情|动作|词语|词汇|这个词|什么意思|是什么意思|列举|枚举|expression|gesture|means?)/iu.test(clause))return null;
  let gesture=expressiveGestures[emotionAtSpeechBoundary(text,at)]??null;
  if(!gesture)for(const part of text.slice(sentenceStart,end).split(/[，,；;]/u)){
    const fragment=part.trim();
    if(/^(?:嗯[、\s]*)?(?:好的|好呀|好啊|好哦|是的|没错|对的|当然|可以|明白了|我明白了|收到|我同意|你说得对)|^(?:yes|okay|agreed|of course|that['’]s right)\b/iu.test(fragment))gesture='nod';
    else if(/^(?:不行|不可以|不对|不是这样的|不能这样|我不同意|我拒绝|不要这样)|^(?:no(?:[.!\s]|$)|I disagree\b|I refuse\b)/iu.test(fragment))gesture='shake';
    else if(/^(?:不过|但是|然而|接下来|换个话题)|\b(?:but|however|anyway)\b/iu.test(fragment))gesture=null;
  }
  return gesture?{gesture,sentenceStart}:null;
}

/** One bounded movement, with no pending queue or catch-up after interruption. */
export function createAvatarGestures() {
  const seen=new Set();
  let active=null,cooldown=0;
  function trigger(id,gesture,enabled=true) {
    if(typeof id!=='string'||!id||!Object.hasOwn(durations,gesture)||seen.has(id))return false;
    seen.add(id);
    while(seen.size>256)seen.delete(seen.values().next().value);
    // Even suppressed cues are consumed: a setting change cannot replay them.
    if(!enabled||active||cooldown>0)return false;
    active={gesture,age:0,duration:durations[gesture]};
    cooldown=durations[gesture]+.55;
    return true;
  }
  function cancel(){active=null;}
  function step(deltaSeconds,{blocked=false}={}) {
    // RAF may be throttled when a window is covered. Semantic durations use
    // wall time, never the capped integration step used by local springs.
    const elapsed=Number.isFinite(deltaSeconds)&&deltaSeconds>0?deltaSeconds:0;
    cooldown=Math.max(0,cooldown-elapsed);
    if(blocked){cancel();return rest();}
    if(!active)return rest();
    active.age+=elapsed;
    if(active.age>=active.duration){cancel();return rest();}
    const progress=active.age/active.duration;
    // Smooth rise, a readable hold, then a longer return to the resting pose.
    const amount=smooth(progress/.24)*(1-smooth((progress-.52)/.48));
    const output={...rest(),gesture:active.gesture,gestureProgress:clamp(progress)};
    switch(active.gesture){
      case 'nod':output.bodyLean=.16*amount;output.headNod=.5*amount;break;
      case 'shake':output.bodyTurn=.08*amount*Math.sin(progress*3*Math.PI);output.headShake=.55*amount*Math.sin(progress*3*Math.PI);break;
      case 'tilt':output.bodyTurn=.16*amount;output.headTilt=.36*amount;break;
      case 'shy':output.bodyLean=.13*amount;output.bodyTurn=-.48*amount;output.headTilt=-.2*amount;output.headNod=.2*amount;break;
      case 'bounce':output.bodyLift=.55*amount;output.bodyLean=.1*amount;output.headNod=-.12*amount;break;
      case 'recoil':output.bodyLean=-.52*amount;output.bodyLift=.1*amount;output.headNod=-.24*amount;break;
      case 'settle':output.bodyLean=.18*amount;output.bodyLift=-.22*amount;output.headNod=.15*amount;break;
    }
    return output;
  }
  function reset(){cancel();cooldown=0;}
  return {trigger,step,cancel,reset};
}
