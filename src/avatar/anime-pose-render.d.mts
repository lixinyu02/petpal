export interface AnimePoseChannels {
  gesture?:string;gestureProgress?:number;bodyLean?:number;bodyLift?:number;bodyTurn?:number;headShake?:number;
}
export function animeHeadNodOffset(value:number,options?:{sleeping?:boolean;reducedMotion?:boolean;hidden?:boolean}):number;
export function animePoseTransform(pose:AnimePoseChannels,options?:{sleeping?:boolean;reducedMotion?:boolean;hidden?:boolean}):{
  gesture:string;progress:number;xPercent:number;yPercent:number;rotationDegrees:number;scale:number;
};
