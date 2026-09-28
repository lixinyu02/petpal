import type {CodexConfig, MusicPlayer, MusicAction, OpenCliStatus, ReasoningEffort} from './api';
export const reasoningEfforts:readonly ReasoningEffort[];
export type CodexConfigDraft = {mode:'host'|'api';baseUrl:string;model:string;reasoningEffort:ReasoningEffort;apiKey:string;clearApiKey:boolean};
export function codexConfigDraft(config:CodexConfig):CodexConfigDraft;
export function codexConfigPatch(config:CodexConfig,draft:CodexConfigDraft):{mode:'host'|'api';baseUrl:string;model:string;reasoningEffort:ReasoningEffort;revision:string;apiKey?:string;clearApiKey?:boolean};
export function canControlPlayer(player:MusicPlayer|undefined,action:MusicAction):boolean;
export function playerStateLabel(player:MusicPlayer):string;
export function canOpenMusicSite(status:OpenCliStatus|undefined,profileId:string):boolean;
