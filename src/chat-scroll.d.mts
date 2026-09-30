export type ChatScrollMetrics={scrollHeight:number;scrollTop:number;clientHeight:number};
export const CHAT_BOTTOM_THRESHOLD:number;
export function isNearChatBottom(metrics:ChatScrollMetrics,threshold?:number):boolean;
export function createChatScroll(options:{read():ChatScrollMetrics;scrollBottom():void;onFollowing?(following:boolean):void;isCurrent?():boolean;schedule?(callback:()=>void):number;cancel?(id:number):void}):{contentChanged():void;userScrolled():void;latest():void;close():void};
