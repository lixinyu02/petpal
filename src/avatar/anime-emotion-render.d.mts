export interface AnimeEmotionChannels {
  sadAmount?:number; downcastAmount?:number; excitedAmount?:number; shyAmount?:number;
  eyeSmile?:number; tearAmount?:number; voiceEnergy?:number;
  smugAmount?:number;poutAmount?:number;reliefAmount?:number;determinedAmount?:number;
  hesitantAmount?:number;sleepyAmount?:number;expectantAmount?:number;aggrievedAmount?:number;tenderAmount?:number;surpriseAmount?:number;
  blinkLeft?:number; blinkRight?:number; smileAmount?:number; blush?:number;
}
export function animeMouthLayerMix(opacity:number,roundness:number):{talk:number;round:number};
export function animeEmotionMix(pose:AnimeEmotionChannels,options?:{sleeping?:boolean}):{
  sadness:number;downcast:number;blinkLeft:number;blinkRight:number;smile:number;
  smug:number;pout:number;relief:number;determined:number;
  hesitant:number;sleepy:number;expectant:number;aggrieved:number;tender:number;upperWarmth:number;
  eyeScaleLeft:number;eyeScaleRight:number;
  eyeSquintLeft:number;eyeSquintRight:number;browLeftLift:number;browRightLift:number;browFocus:number;
  blush:number;shy:number;tears:number;sparkle:number;
};
