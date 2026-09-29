import type { AvatarMicroExpression } from './performance.mjs';
export interface AvatarMicroactingPose{
  microExpression:AvatarMicroExpression;
  microProgress:number;
  gazeOffsetX:number;
  blink:number;
  smileAmount:number;
  warmAmount:number;
}
export function createAvatarMicroacting():{
  step(elapsedSeconds:number,options?:{enabled?:boolean}):AvatarMicroactingPose;
  cancel():void;
  reset():void;
};
