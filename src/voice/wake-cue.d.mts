export const WAKE_CUE_DURATION:number;
export function wakeCueSamples(rate?:number):Float32Array;
export function createWakeCueController(options?:{
 createContext?:()=>AudioContext;getSpeakerId?:()=>string;
 schedule?:(callback:()=>void,delay:number)=>unknown;unschedule?:(timer:unknown)=>void;
}):{unlock():Promise<boolean>;play(signal?:AbortSignal):boolean;stop():void;release():void;dispose():void};
