import type { DesktopUpdates } from './platform/updates';
import { createRequestScope, SessionChangedError } from './auth/request-scope.mjs';
export { SessionChangedError };
export type User = { id:string; username:string; displayName:string; role:string; isOwner:boolean; canUseCodex:boolean };
export type ManagedUser = User & { disabled:boolean; providerIds:string[]; hasPassword:boolean };
export type ReasoningEffort = '' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';
export type Provider = { id: string; name: string; protocol: 'chat-completions' | 'responses'; baseUrl: string; model: string; reasoningEffort?:ReasoningEffort; hasApiKey: boolean; editable?:boolean; testable?:boolean };
export type Message = { id: string; role: 'user' | 'assistant'; content: string; status?: string; createdAt?: string };
export type Conversation = { id: string; title: string; mode: 'chat' | 'codex'; providerId?: string; messages: Message[]; createdAt: string; updatedAt: string };
export type CodexStatus = { available?: boolean; running?: boolean; version?: string; authenticated?: boolean; error?: string; message?: string; workspaceRoot?: string; mode?:'host'|'api'; configured?:boolean; apiVerified?:boolean; [key: string]: unknown };
export type CodexConfig = { mode:'host'|'api'; baseUrl:string; model:string; reasoningEffort?:ReasoningEffort; hasApiKey:boolean; revision:string; protocol:'responses'; configured:boolean };
export type MusicAction = 'open'|'play'|'pause'|'next'|'previous';
export type MusicPlayer = { id:'qqmusic'|'netease'; name:string; installed:boolean; session:boolean; state?:string; controls:string[]; message?:string };
export type OpenCliStatus = {available:boolean;version:string|null;runtime:'bundled';daemon:{state:'stopped'|'owned'|'shared'|'external'|'unavailable';owned:boolean;port:number;compatible?:boolean};extension:{connected:boolean;required:true;installUrl:string};profiles:{id:string;label:string;connected:boolean}[];selectedProfileId:string|null;ready:boolean;message:string;allowedOrigins:string[]};
export type DesktopToolsStatus = {music:{platform:string;players:MusicPlayer[];message?:string};opencli:OpenCliStatus;busy?:boolean};
export type CompanionKind = 'anime' | 'cat';
export type State = { instanceId?:string; user?:User; settings: { petName: string; persona: string; companionKind: CompanionKind; defaultProviderId?:string|null }; providers: Provider[]; conversations: Conversation[]; codex: CodexStatus };
export type Connection = { url: string; token: string };
export type VoiceConnectionFields = {baseUrl:string;model:string;hasApiKey?:boolean;apiKey?:string;clearApiKey?:boolean};
export type VoiceConfig = {
  tts:VoiceConnectionFields & {mode:'system'|'remote'|'cosyvoice';voice:string;speed:number};
  asr:VoiceConnectionFields & {mode:'disabled'|'browser'|'remote';language:string};
  runtime?:{tts:string;asr:string;remoteConfiguredOnly:boolean};
};
export type CosyVoiceConfig = {configured:boolean;hasReference:boolean;referenceName:string;referenceText:string;baseUrl:string;hasApiKey:boolean;editable:boolean;revision:string};
type CredentialKind = 'pairing'|'session'|'none';
export type StreamEvent = { type: string; data: Record<string, any> };
export type Identity = {instanceId:string;userId:string};
declare global {
  interface Window { petpal?: { connection(): Promise<Connection>; showPet(): void; showMain(): void; hidePet(): void; updates?:DesktopUpdates }; }
}
const requests = createRequestScope();
const listeners = new Set<()=>void>();
let identity: Identity|null = null;
let initialization: Promise<Connection>|undefined;
const notify = () => { for(const listener of listeners) listener(); };
export const getConnection = requests.connection;
export const getSessionEpoch = requests.epoch;
export const subscribeSession = (listener:()=>void) => { listeners.add(listener);return()=>{listeners.delete(listener);}; };
export const getIdentity = () => identity;
export const isSessionChanged = (error:unknown) => error instanceof SessionChangedError;
export function normalizeServerUrl(value:string) {
  const url=value.trim().replace(/\/+$/, '');
  if(url){const parsed=new URL(url);if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password||parsed.search||parsed.hash)throw new Error('服务地址须为 HTTP(S) 地址，不能包含凭据或查询参数。');}
  return url;
}
export function setConnection(next:Connection,credentialKind:CredentialKind=next.token?'pairing':'none') {
  const connection={url:normalizeServerUrl(next.url),token:next.token.trim()};
  void window.petpal?.updates?.cancel().catch(()=>{});
  identity=null;requests.replace(connection);
  try{sessionStorage.setItem('petpal.connection',JSON.stringify({...connection,credentialKind}));}catch{}
  try{window.speechSynthesis?.cancel();}catch{}
  window.dispatchEvent(new Event('petpal:session-change'));notify();
}
function acceptIdentity(value:{instanceId?:string;user?:User}) {
  if(!value.instanceId||!value.user?.id)return;
  if(identity?.instanceId===value.instanceId&&identity.userId===value.user.id)return;
  identity={instanceId:value.instanceId,userId:value.user.id};notify();
}
export function initConnection() {
  initialization ??= (async()=>{
    const native=window.petpal?await window.petpal.connection():undefined;
    const params=new URLSearchParams(location.hash.slice(1)),token=params.get('token');
    if(token){setConnection({url:native?.url||'',token});history.replaceState(null,'',location.pathname+location.search);return getConnection();}
    try{const saved=sessionStorage.getItem('petpal.connection');if(saved){const parsed=JSON.parse(saved);if(typeof parsed.url==='string'&&typeof parsed.token==='string'){
      // A local backend gets a fresh port and pairing token each launch. Preserve
      // explicit member sessions/logout, while refreshing native owner credentials.
      const kind:CredentialKind=!parsed.token?'none':parsed.credentialKind==='session'?'session':'pairing';
      const restored=native?(kind==='pairing'?native:{url:native.url,token:parsed.token}):parsed;
      setConnection(restored,kind);return getConnection();
    }}}catch{try{sessionStorage.removeItem('petpal.connection');}catch{}}
    if(native)setConnection(native);
    return getConnection();
  })();
  return initialization.then(()=>getConnection());
}
function message(data:any,status:number){return data.error?.message||data.error||data.message||`请求失败 (${status})`;}
async function responseJson(response:Response,request:ReturnType<typeof requests.begin>) {
  const data=await response.json().catch(()=>({}));request.assertCurrent();
  if(!response.ok){if(response.status===401&&request.connection.token)setConnection({url:request.connection.url,token:''});throw new Error(message(data,response.status));}
  return data;
}
export async function api<T = any>(path:string, options:RequestInit = {}):Promise<T> {
  const request=requests.begin(options.signal);
  try{
    request.assertCurrent();const headers=new Headers(options.headers);if(!headers.has('Content-Type'))headers.set('Content-Type','application/json');headers.set('Authorization',`Bearer ${request.connection.token}`);
    const response=await fetch(`${request.connection.url}/api${path}`,{...options,headers,signal:request.signal});request.assertCurrent();
    const data=await responseJson(response,request);if(path==='/state'||path==='/auth/me')acceptIdentity(data);request.assertCurrent();return data as T;
  }finally{request.close();}
}
/** Binary responses retain the same immutable credentials and epoch fence as JSON. */
export async function apiBlob(path:string, options:RequestInit = {}):Promise<Blob> {
  const request=requests.begin(options.signal);
  try{
    request.assertCurrent();const headers=new Headers(options.headers);if(!headers.has('Content-Type'))headers.set('Content-Type','application/json');headers.set('Authorization',`Bearer ${request.connection.token}`);
    const response=await fetch(`${request.connection.url}/api${path}`,{...options,headers,signal:request.signal});request.assertCurrent();
    if(!response.ok){await responseJson(response,request);throw new Error('音频请求失败。');}
    const blob=await response.blob();request.assertCurrent();return blob;
  }finally{request.close();}
}
/** Validate new credentials before atomically replacing the current account. */
export async function connectWithToken(next:Connection) {
  const url=normalizeServerUrl(next.url),token=next.token.trim();if(!token)throw new Error('请输入配对令牌。');
  const request=requests.begin();
  try{const response=await fetch(`${url}/api/auth/me`,{headers:{Authorization:`Bearer ${token}`},signal:request.signal});const data=await response.json().catch(()=>({}));request.assertCurrent();if(!response.ok)throw new Error(message(data,response.status));if(typeof data.instanceId!=='string'||!data.instanceId||typeof data.user?.id!=='string'||!data.user.id)throw new Error('服务身份响应无效。');setConnection({url,token},'pairing');acceptIdentity(data);}finally{request.close();}
}
export async function login(urlValue:string,username:string,password:string) {
  const url=normalizeServerUrl(urlValue),request=requests.begin();
  try{const response=await fetch(`${url}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:username.trim(),password}),signal:request.signal});const data=await response.json().catch(()=>({}));request.assertCurrent();if(!response.ok)throw new Error(message(data,response.status));if(typeof data.token!=='string'||!data.token)throw new Error('登录响应缺少会话凭据。');setConnection({url,token:data.token},'session');}finally{request.close();}
}
export function logout() {
  const previous=getConnection();setConnection({url:previous.url,token:''});
  if(previous.token){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),4000);void fetch(`${previous.url}/api/auth/logout`,{method:'POST',headers:{Authorization:`Bearer ${previous.token}`},signal:controller.signal}).catch(()=>{}).finally(()=>clearTimeout(timer));}
}
export async function streamMessage(id:string,content:string,signal:AbortSignal,onEvent:(event:StreamEvent)=>void) {
  const request=requests.begin(signal);let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  try{
    request.assertCurrent();const response=await fetch(`${request.connection.url}/api/conversations/${encodeURIComponent(id)}/messages`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${request.connection.token}`},body:JSON.stringify({content}),signal:request.signal});request.assertCurrent();
    if(!response.ok){await responseJson(response,request);return;}
    if(!response.body)throw new Error('当前环境不支持流式回复。');
    reader=response.body.getReader();const decoder=new TextDecoder();let buffer='',terminal=false;
    const dispatch=(block:string)=>{request.assertCurrent();let type='message';const payload:string[]=[];for(const line of block.split('\n')){if(line.startsWith('event:'))type=line.slice(6).trim();else if(line.startsWith('data:'))payload.push(line.slice(5).trimStart());}if(!payload.length)return;const data=JSON.parse(payload.join('\n'));if(type==='done'||type==='error')terminal=true;onEvent({type,data});};
    while(true){const{value,done}=await reader.read();request.assertCurrent();if(done)break;buffer+=decoder.decode(value,{stream:true});buffer=buffer.replace(/\r\n/g,'\n');let boundary;while((boundary=buffer.indexOf('\n\n'))>=0){dispatch(buffer.slice(0,boundary));buffer=buffer.slice(boundary+2);}}
    buffer+=decoder.decode();if(buffer.trim())dispatch(buffer);if(!terminal)throw new Error('连接提前断开，回复可能不完整。请重试。');
  }finally{await reader?.cancel().catch(()=>{});reader?.releaseLock();request.close();}
}
