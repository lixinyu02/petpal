export type CompositionKey = Pick<KeyboardEvent,'key'> & Partial<Pick<KeyboardEvent,'isComposing'|'keyCode'>>;
export interface CompositionGuard {start():void;end():void;blocks(event:CompositionKey):boolean;keyUp(event:Pick<KeyboardEvent,'key'>):void;reset():void;}
export function createCompositionGuard(options?:{schedule?:(callback:FrameRequestCallback)=>number;cancel?:(id:number)=>void}):CompositionGuard;
export function composerKeyAction(event:Pick<KeyboardEvent,'key'|'isComposing'|'keyCode'|'defaultPrevented'|'shiftKey'|'altKey'|'ctrlKey'|'metaKey'>,options?:{touch?:boolean;composition?:CompositionGuard}):'none'|'newline'|'send';
