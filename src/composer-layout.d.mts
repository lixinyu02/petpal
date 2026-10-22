export interface ComposerLayout {schedule():void;measure():void;dispose():void;}
export function createComposerLayout(input:HTMLTextAreaElement,options?:{window?:Window & typeof globalThis;schedule?:(callback:FrameRequestCallback)=>number;cancel?:(id:number)=>void;ResizeObserver?:typeof ResizeObserver}):ComposerLayout;
