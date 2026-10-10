import type { AsrSession } from './api';
import type { ChatAssistantRequest } from '../api';
import type {WakeSettings} from '../../server/voice-wake.mjs';
export type VoicePhase='idle'|'starting'|'armed'|'listening'|'recognizing'|'thinking'|'speaking'|'error';
export type VoiceConversationState={phase:VoicePhase;active:boolean;transcript:string;reply:string;level:number;error:string;conversationId:string;hasUtterance:boolean;wake:WakeSettings;awaitingWake:boolean};
export function cleanTranscript(text:string):string;
export function createVoiceConversation(options:{
 onState(state:VoiceConversationState):void;id():string;isCurrent():boolean;isAllowed():boolean;getProviderId():string;getDeviceId():string;
 getSensitivity?():unknown;
 createCapture(callbacks:{onFrame(frame:Float32Array,level:number):void;onError(error:Error):void}):{start(deviceId:string):Promise<void>;pause():void;stop():void};
 unlock():Promise<boolean>;verify(signal:AbortSignal):Promise<unknown>;stopSpeech():void;
 openAsr(signal:AbortSignal,onTranscript:(text:string)=>void):Promise<AsrSession>;
 createChat(providerId:string,signal:AbortSignal):Promise<string>;
 stopChat?(id:string,signal:AbortSignal):Promise<unknown>;
 getChatRequest?():ChatAssistantRequest|undefined;
 streamChat(id:string,text:string,signal:AbortSignal,onEvent:(event:{type:string;data:Record<string,any>})=>void,request?:ChatAssistantRequest):Promise<unknown>;
 play(text:string,id:string,signal:AbortSignal):Promise<void>;
}):{start():Promise<void>;stop():void;interrupt():Promise<void>;finishUtterance():Promise<boolean>;notifyReport(report:{id:string;text:string;plainText?:boolean}):boolean;snapshot():VoiceConversationState;dispose():void};
