export type ViewportRect = {left:number;top:number;right:number;bottom:number;width:number;height:number};
export type ViewportSnapshot = {left:number;top:number;width:number;height:number;scale?:number};
export function safeViewportRect(viewport:ViewportSnapshot,insets?:Partial<Record<'top'|'right'|'bottom'|'left',number>>,gutter?:number):ViewportRect;
export function readSafeViewport(window:Window,document:Document,gutter?:number):ViewportRect & {viewport:ViewportSnapshot & {scale:number}};
