export interface ChatElementEntry<M,P,E>{readonly id:string;readonly message:M;readonly props:P;readonly element:E;}
export interface ChatElementSnapshot<M,P,E>{readonly scope:string;readonly ids:readonly string[];readonly ambiguous:ReadonlySet<string>;readonly entries:readonly ChatElementEntry<M,P,E>[];readonly elements:readonly E[];}
export function prepareChatElements<M extends {id:string},P extends object,E>(previous:ChatElementSnapshot<M,P,E>|null|undefined,scope:string,messages:readonly M[],properties:(message:M)=>P,createElement:(key:string,props:P)=>E):ChatElementSnapshot<M,P,E>;
