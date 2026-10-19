declare module '@novnc/novnc/lib/rfb.js' {
  export default class RFB extends EventTarget {
    constructor(target:HTMLElement,url:string,options?:{shared?:boolean});
    scaleViewport:boolean;resizeSession:boolean;viewOnly:boolean;focusOnClick:boolean;
    disconnect():void;focus():void;sendCtrlAltDel():void;
  }
}
