export function validVersion(value:unknown):value is string;
export function webUpdateState(current:string,deployed:string|null,release:unknown):'reload'|'waiting-deploy'|'current';
export function updateProgress(progress?:{received:number;total:number}):number|null;
