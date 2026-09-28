import type {CodexConfig, MusicPlayer, MusicAction, OpenCliStatus} from './api';
export type CodexConfigDraft = {mode:'host'|'api';baseUrl:string;model:string;apiKey:string;clearApiKey:boolean};
export function codexConfigPatch(config:CodexConfig,draft:CodexConfigDraft):{mode:'host'|'api';baseUrl:string;model:string;revision:string;apiKey?:string;clearApiKey?:boolean};
export function canControlPlayer(player:MusicPlayer|undefined,action:MusicAction):boolean;
export function playerStateLabel(player:MusicPlayer):string;
export function canOpenMusicSite(status:OpenCliStatus|undefined,profileId:string):boolean;
