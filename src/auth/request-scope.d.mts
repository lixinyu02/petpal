export class SessionChangedError extends Error {}
export function createRequestScope(initial?: {url:string;token:string}): {
  connection(): {url:string;token:string}; epoch():number;
  subscribe(listener:()=>void):()=>void;
  replace(next:{url:string;token:string}):void;
  begin(signal?:AbortSignal|null):{connection:Readonly<{url:string;token:string}>;epoch:number;signal:AbortSignal;assertCurrent():void;close():void};
};
