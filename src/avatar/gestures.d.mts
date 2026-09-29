import type { AvatarGesture } from './performance.mjs';
export interface AvatarGesturePose {
  gesture:AvatarGesture;
  gestureProgress:number;
  bodyLean:number;
  bodyLift:number;
  bodyTurn:number;
  headShake:number;
  headTilt:number;
  headNod:number;
  shoulderLift:number;
}
export function gestureAtSpeechBoundary(text:string,index:number):{gesture:Exclude<AvatarGesture,'none'>;sentenceStart:number}|null;
export function createAvatarGestures():{
  trigger(id:string,gesture:Exclude<AvatarGesture,'none'>,enabled?:boolean):boolean;
  /** Real elapsed seconds so covered-window throttling does not stretch the gesture lifetime. */
  step(dt:number,options?:{blocked?:boolean}):AvatarGesturePose;
  cancel():void;
  reset():void;
};
