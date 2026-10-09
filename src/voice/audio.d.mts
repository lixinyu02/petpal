export const VOICE_RATE: number;
export function createResampler(sourceRate:number,targetRate?:number):{push(input:Float32Array):Float32Array;reset():void};
export function audioLevel(samples:Float32Array):number;
export function pcmFloat32LE(samples:Float32Array):ArrayBuffer;
export function microphoneWorkletSource():string;
export interface VoiceGateOptions {threshold?:number;silenceMs?:number;preRollMs?:number;minSpeechMs?:number;maxSeconds?:number;noiseRatio?:number}
export function createVoiceGate(options?:VoiceGateOptions):{push(frame:Float32Array,options?:{learnNoise?:boolean;noiseFloor?:number}):{started:boolean;ended:boolean;samples:Float32Array[];level:number;reason:string};reset():void;readonly active:boolean;readonly noiseFloor:number};
