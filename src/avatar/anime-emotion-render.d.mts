export interface AnimeEmotionChannels {
  sadAmount?:number; downcastAmount?:number; excitedAmount?:number; shyAmount?:number;
  eyeSmile?:number; tearAmount?:number; voiceEnergy?:number;
  blinkLeft?:number; blinkRight?:number; smileAmount?:number; blush?:number;
}
export function animeEmotionMix(pose:AnimeEmotionChannels,options?:{sleeping?:boolean}):{
  sadness:number;downcast:number;blinkLeft:number;blinkRight:number;smile:number;
  blush:number;shy:number;tears:number;sparkle:number;
};
