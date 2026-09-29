export interface AnimeEmotionChannels {
  sadAmount?:number; downcastAmount?:number; excitedAmount?:number; shyAmount?:number;
  eyeSmile?:number; tearAmount?:number; voiceEnergy?:number;
  smugAmount?:number;poutAmount?:number;reliefAmount?:number;determinedAmount?:number;
  blinkLeft?:number; blinkRight?:number; smileAmount?:number; blush?:number;
}
export function animeMouthLayerMix(opacity:number,roundness:number):{talk:number;round:number};
export function animeEmotionMix(pose:AnimeEmotionChannels,options?:{sleeping?:boolean}):{
  sadness:number;downcast:number;blinkLeft:number;blinkRight:number;smile:number;
  smug:number;pout:number;relief:number;determined:number;
  eyeSquintLeft:number;eyeSquintRight:number;browLeftLift:number;browRightLift:number;browFocus:number;
  blush:number;shy:number;tears:number;sparkle:number;
};
