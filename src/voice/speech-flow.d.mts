import type { SpeechState } from '../avatar/speech.mjs';
export function createSpeechAwaiter():{begin(id:string,signal?:AbortSignal,onAbort?:()=>void):Promise<void>;observe(state:SpeechState):void;cancel(error?:unknown):void};
export function createSentenceSplitter(maxChars?:number):{push(delta:string):string[];finish():string[]};
export function createSpeechQueue(options:{play(text:string):Promise<void>;signal?:AbortSignal;maxChars?:number;maxItems?:number;onError?(error:unknown):void}):{enqueue(text:string):void;finish():Promise<void>;cancel():void};
