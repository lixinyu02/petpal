const emotions={
  sad:/伤心|心碎|悲伤|难受得想哭|想哭|\bheartbroken\b|\bgrief\b|\bsad\b|[😢😭💔]/giu,
  downcast:/难过|失落|沮丧|低落|提不起精神|没精神|没心情|\bdowncast\b|\bdisappointed\b|\bdejected\b|[😔😞]/giu,
  excited:/兴奋|激动|迫不及待|好期待|\bexcited\b|\bthrilled\b|\bcan(?:not|'t) wait\b|[🤩🎉🥳]/giu,
  shy:/不好意思|害羞|脸红|嘿嘿|\bembarrass(?:ed)?\b|\bblush(?:ing)?\b|\bshy\b|[😳🙈]/giu,
  happy:/太好了|真棒|好耶|哈哈|开心|高兴|快乐|\bhappy\b|\bhooray\b|\bjoyful\b|[😄🥰]/giu,
  smug:/得意|小骄傲|我厉害吧|夸夸我|\bsmug\b|\bproud of myself\b/giu,
  pout:/鼓腮|气鼓鼓|撅嘴|闹别扭|有点生气|不理你了|哼(?=[，,！!。])|\bpout(?:ing)?\b/giu,
  relieved:/松了(?:一口)?气|松(?:一口|口)气|安心|放心了|如释重负|\brelieved\b|\bwhat a relief\b/giu,
  determined:/认真|下定决心|我会努力|交给我吧|打起精神|一定要(?:努力|做好|完成)|\bdetermined\b|\bfocused\b/giu,
};
const negated=prefix=>/(?:(?:不是不|并非不|不|不是|并非|没(?:有)?|从未|无须|别|勿|莫)(?:再|太|很|怎么|那么|这么|会|想|觉得|感到|特别|真的|有点){0,3}|not(?:\s+(?:really|very|feeling)){0,3}|never|no\s+longer|(?:don|doesn|didn|isn|wasn|weren|aren)['’]t(?:\s+feel(?:ing)?)?)\s*$/iu.test(prefix);
function affirmed(text,expression) {
  const matcher=new RegExp(expression.source,expression.flags.includes('g')?expression.flags:`${expression.flags}g`);
  for(const match of text.matchAll(matcher))if(!negated(text.slice(Math.max(0,match.index-24),match.index)))return true;
  return false;
}
function enumeratesEmotions(text) {
  const count=Object.values(emotions).filter(expression=>new RegExp(expression.source,'iu').test(text)).length;
  return count>=3||count>0&&/(?:表情|情绪|词语|词汇|这个词|什么意思|是什么意思|分别是|包括|列举|枚举|切换|emotion|expression|means?)/iu.test(text)&&!/(?:我(?:现在|今天|此刻)?(?:感到|觉得|有点|很|特别)|i(?:'m| am| feel))/iu.test(text);
}
function clearsInheritedEmotion(text) {
  // A mentioned but rejected emotion is an explicit denial/metalinguistic cue,
  // not an invitation to carry the previous expression into this clause.
  if(Object.values(emotions).some(expression=>new RegExp(expression.source,'iu').test(text)))return true;
  return /(?:不过|但是|然而|但(?=现在|我|已经|这|接下来)|言归正传|换个话题|说回|回到正题|接下来|不再这样|没有这种感觉|没有这种情绪|不是这样|平静下来|恢复平静|已经平静|现在很平静|冷静下来|已经没事|没事了|中性说明|普通说明)|\b(?:but|however|instead|anyway|moving on|back to|calm now|fine now|okay now)\b/iu.test(text);
}

/** Conservative dialogue cues, not psychological inference or audio sentiment. */
export function detectAvatarEmotion(value) {
  if(typeof value!=='string'||!value.trim())return null;
  const text=value.slice(-512);
  if(enumeratesEmotions(text))return null;
  if(/(?:别|不要|不用|不必)(?:再|太|那么|这么)?(?:难过|伤心|担心|紧张|着急|害怕|自责)|没关系|辛苦了|抱歉|\bsorry\b|don['’]t (?:be |feel )?(?:sad|worry)|it['’]s okay/iu.test(text))return 'concerned';
  if(/(?:不是|并非|没有)不(?:开心|高兴|快乐|happy)/iu.test(text))return null;
  if(/(?:不(?:太|怎么)?|不是很|没(?:有)?(?:那么|这么)?)(?:开心|高兴|快乐)|\b(?:not(?: really| very| feeling)? happy|unhappy)\b/iu.test(text))return 'downcast';
  if(affirmed(text,emotions.sad))return 'sad';
  if(affirmed(text,emotions.downcast))return 'downcast';
  if(affirmed(text,/担心|着急|自责|害怕|\bworr(?:y|ied)\b/giu))return 'concerned';
  if(affirmed(text,emotions.pout))return 'pout';
  if(affirmed(text,emotions.relieved))return 'relieved';
  if(affirmed(text,emotions.determined))return 'determined';
  if(affirmed(text,emotions.smug))return 'smug';
  if(affirmed(text,emotions.excited))return 'excited';
  if(affirmed(text,/开个玩笑|逗你|调皮|眨眨眼|\bwink\b|\bplayful\b|[😉😋]/giu))return 'playful';
  if(affirmed(text,emotions.shy))return 'shy';
  // Warm gratitude remains gentle even when the sentence also mentions joy.
  if(affirmed(text,/谢谢|感谢|\bthanks?\b/giu))return 'warm';
  if(affirmed(text,emotions.happy))return 'happy';
  if(affirmed(text,/[!！]{2}|哇|天哪|惊喜|没想到|\bwow\b/giu))return 'surprised';
  if(affirmed(text,/喜欢|陪你|抱抱|爱你|\blove\b|[❤♥😊]/giu))return 'warm';
  if(/让我想|思考|也许|或许|想一想|\bhmm\b|\bperhaps\b/iu.test(text))return 'thoughtful';
  if(/[?？]|为什么|怎么|好奇|\bwonder\b/iu.test(text))return 'curious';
  return null;
}

/** UTF-16 playback progress selects only the current sentence/clause. */
export function emotionAtSpeechBoundary(text,index) {
  if(typeof text!=='string'||!Number.isFinite(index)||index<0||index>=text.length)return null;
  // An enumeration can use commas, so inspect its containing sentence before
  // selecting a spoken clause. Independent later sentences are not considered.
  let sentenceStart=Math.max(0,index-256),sentenceEnd=Math.min(text.length,index+256);
  for(let cursor=Math.floor(index)-1;cursor>=sentenceStart;cursor--)if(/[。！？.!?\n]/u.test(text[cursor])){sentenceStart=cursor+1;break;}
  for(let cursor=Math.floor(index);cursor<sentenceEnd;cursor++)if(/[。！？.!?\n]/u.test(text[cursor])){sentenceEnd=cursor+1;break;}
  if(enumeratesEmotions(text.slice(sentenceStart,sentenceEnd)))return null;
  const at=Math.floor(index),boundary=/[。！？.!?\n，,；;]/u;
  let end=Math.min(text.length,at+256);
  for(let cursor=at;cursor<end;cursor++)if(boundary.test(text[cursor])){end=cursor+1;break;}
  let inherited=null;
  // Evaluate only clauses at or before the current playback position. A plain
  // continuation inherits the most recent cue in this sentence; an explicit
  // denial or neutral transition clears it for this and following clauses.
  for(const clause of text.slice(sentenceStart,end).split(/[，,；;]/u)) {
    const selected=detectAvatarEmotion(clause);
    if(selected!==null)inherited=selected;
    else if(clearsInheritedEmotion(clause))inherited=null;
  }
  return inherited;
}
