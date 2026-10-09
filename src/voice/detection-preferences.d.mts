import type { VoiceGateOptions } from './audio.mjs';
export type VoiceSensitivity = 'noise-reduced'|'balanced'|'sensitive';
export const DEFAULT_VOICE_SENSITIVITY: VoiceSensitivity;
export function normalizeVoiceSensitivity(value:unknown):VoiceSensitivity;
export function voiceGateProfile(value:unknown):{listening:VoiceGateOptions;interruption:VoiceGateOptions};
export function createVoiceDetectionPreferences(storage:{getItem(key:string):string|null;setItem(key:string,value:string):void}|undefined|null,scope:string):{read():VoiceSensitivity;write(value:unknown):VoiceSensitivity;dispose():void};
