export type ChatDisplay = {push(text:string):void;flush():void;close():void};
export function createChatDisplay(options:{onText(text:string):void;isCurrent?():boolean;delayMs?:number;schedule?(callback:()=>void):ReturnType<typeof setTimeout>;cancel?(timer:ReturnType<typeof setTimeout>):void}):ChatDisplay;
