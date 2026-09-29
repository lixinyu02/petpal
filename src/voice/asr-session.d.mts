export type AsrSession = { send(samples:Float32Array):Promise<void>; finish():Promise<string>; cancel():void };
export function openAsrTransport(options:{
 signal:AbortSignal; assertCurrent():void; onTranscript(text:string):void; onClose():void;
 request(path:string,options:RequestInit):Promise<any>; openEvents(id:string,signal:AbortSignal):Promise<Response>; remove(id:string):Promise<unknown>;
}):Promise<AsrSession>;
