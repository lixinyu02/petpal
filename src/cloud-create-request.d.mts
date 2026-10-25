export type CloudCreateBody={name:string;source:'local'|'platform';bundle:'desktop'|'agent';nodeId?:string;resources?:{cpus:number;memoryMiB:number;pids?:number}};
export type PendingCloudCreate={requestId:string;body:CloudCreateBody};
export function pendingCloudCreate(scope:string):PendingCloudCreate|null;
export function reserveCloudCreate(scope:string,body:CloudCreateBody,newId?:()=>string):PendingCloudCreate;
export function clearCloudCreate(scope:string,requestId:string):boolean;
