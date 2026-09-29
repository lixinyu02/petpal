export function readAsrEvents(response:Response,options?:{signal?:AbortSignal;assertCurrent?():void;onReady?(data:Record<string,unknown>):void;onTranscript?(text:string):void}):Promise<string>;
