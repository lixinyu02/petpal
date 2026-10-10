export type WakeSettings = {enabled:boolean;phrases:string[];idleTimeoutSeconds:number};
export function defaultWakeSettings():WakeSettings;
export function normalizeWakeSettings(value?:unknown):WakeSettings;
export function matchWakePhrase(text:string,phrases:string[]):{phrase:string;text:string}|null;
