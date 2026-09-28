export function restoreTargetConnection(saved:unknown,native?:{url:string;token:string}):null|{target:'local'|'remote';credentialKind:'none'|'session'|'pairing';connection:{url:string;token:string}};
