import type { Conversation } from '../api';
export function spokenReportText(content:string,maxChars?:number):string;
export function createVoiceReportTracker(options:{
 isCurrent():boolean;
 load(id:string,signal:AbortSignal):Promise<Conversation>;
 notify(report:{id:string;text:string;plainText:true}):boolean;
}):{start():void;stop():void;seed(id:string,signal:AbortSignal):Promise<Conversation|null>;accept(conversation:Conversation):void;flush():void};
