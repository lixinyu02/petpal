import { emotionAtSpeechBoundary } from './emotion.mjs';

const clamp=(value,min=0,max=1)=>Math.min(max,Math.max(min,value));
const smooth=value=>{const t=clamp(value);return t*t*(3-2*t);};
const rest=()=>({gesture:'none',gestureProgress:0,bodyLean:0,bodyLift:0,bodyTurn:0,headShake:0,headTilt:0,headNod:0,shoulderLift:0});
const durations={nod:1.1,shake:1.3,tilt:1.6,shy:1.8,bounce:1.15,recoil:1.25,settle:1.9,leanIn:1.9,shrug:1.6,bow:1.7,peek:1.8,sway:2.2,doze:2.4,wink:1.35};
const expressiveGestures={curious:'tilt',thoughtful:'tilt',shy:'shy',happy:'bounce',excited:'bounce',surprised:'recoil',warm:'nod',smug:'tilt',pout:'shake',relieved:'settle',determined:'nod',hesitant:'shrug',sleepy:'doze',expectant:'leanIn',aggrieved:'shrug',tender:'sway',playful:'wink'};
const explicitGestures={leanIn:/我在(?:认真)?听|我听着|靠近一点(?:听|看)|说给我听/gu,bow:/真的很感谢|十分感谢|谢谢你(?:帮|照顾)|鞠(?:个)?躬/gu,peek:/偷偷看|偷偷探|探头看|看一眼/gu,settle:/没关系|辛苦了|抱歉|\bsorry\b|it['’]s okay/giu};
function explicitGesture(text){
  for(const [kind,pattern]of Object.entries(explicitGestures))for(const match of text.matchAll(pattern)){
    if(!/(?:不(?:要|用|必|想|会)?|别|没(?:有)?)(?:再|很|太|去)?\s*$/u.test(text.slice(Math.max(0,match.index-16),match.index)))return kind;
  }
  return null;
}

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
  if(/^我在认真$/u.test(clause))return null; // Wait for the verb before choosing listening vs determination.
  let gesture=explicitGesture(clause)??expressiveGestures[emotionAtSpeechBoundary(text,at)]??null;
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
      case 'leanIn':output.bodyLean=.7*amount;output.bodyLift=.04*amount;output.headNod=-.05*amount;output.shoulderLift=.05*amount;break;
      case 'shrug':output.shoulderLift=.72*amount;output.bodyLift=.12*amount;output.bodyLean=-.06*amount;output.headTilt=-.14*amount;break;
      case 'bow':output.headNod=.65*amount;output.bodyLean=.45*amount;output.bodyLift=-.08*amount;break;
      case 'peek':output.bodyTurn=.58*amount;output.headTilt=.22*amount;output.bodyLean=.18*amount;output.headShake=.14*amount;break;
      case 'sway':output.bodyTurn=.5*amount*Math.sin(progress*2*Math.PI);output.headTilt=.14*amount*Math.sin(progress*2*Math.PI);output.bodyLift=.05*amount;break;
      case 'doze':output.bodyLean=.25*amount;output.headNod=.65*amount;output.bodyLift=-.12*amount;output.shoulderLift=.18*amount;break;
      // The native Wink motion owns its right-eye closure. Do not also start
      // the short performance wink used by a deliberate greeting.
      case 'wink':output.headTilt=-.16*amount;output.bodyTurn=.12*amount;break;
    }
    return output;
  }
  function reset(){cancel();cooldown=0;}
  return {trigger,step,cancel,reset};
}
