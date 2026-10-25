import type { MemoryRuntimeBridge } from './platform/memory';
import { connectionFetch, type RemoteRequest, type RemoteEvent } from './auth/native-fetch';
import { restoreTargetConnection } from './auth/connection-targets.mjs';
import type { DesktopUpdates } from './platform/updates';
import type { DesktopMusicMcp } from './platform/music-mcp';
import type { PreferencesBridge } from './platform/app-preferences';
import type { CentralServerBridge } from './platform/central-server';
import { createRequestScope, SessionChangedError } from './auth/request-scope.mjs';
import type { SpeechStreamHandlers } from './avatar/speech-stream.mjs';
import type { SpeechEmotion } from './avatar/speech-emotion.mjs';
import type { WakeSettings } from '../server/voice-wake.mjs';
export { SessionChangedError };
export type AgentAccess = 'none'|'workspace'|'full';
export type AgentPermissions = { access:'read-only'|'workspace-write'|'full-access'; approval:'ask'|'auto'|'review';reviewProviderId?:string|null };
export type ApprovalReviewCapability = {available:boolean;modelStrategy:'agent-model'|'native';dynamicTools:'bounded-audio-rules-with-manual-fallback';version:1|2;independentModel?:boolean;message?:string};
export type AgentApprovalReview = {status:'inProgress'|'approved'|'denied'|'timedOut'|'aborted';reviewId?:string;targetItemId?:string;rationale?:string;riskLevel?:string;userAuthorization?:string;source?:'native'|'local-rule'};
export type AutomationSchedule = {kind:'once';at:string} | {kind:'daily';time:string;timezone:string} | {kind:'weekly';time:string;timezone:string;weekdays:number[]} | {kind:'interval';minutes:number};
export type AutomationRun = {id:string;scheduledFor:string;trigger:'scheduled'|'manual';status:'claiming'|'queued'|'running'|'completed'|'error'|'skipped'|'unknown'|'cancelled';conversationId?:string;message?:string;startedAt:string;finishedAt?:string};
export type Automation = {id:string;title:string;prompt:string;hostId:string;hostName?:string;providerId:string|null;providerName?:string;projectDirectory?:string;permissions:AgentPermissions;schedule:AutomationSchedule;enabled:boolean;quickLaunch?:boolean;revision:string;createdBy:'user'|'agent';sourceConversationId?:string;createdAt:string;updatedAt:string;nextRunAt:string|null;runs:AutomationRun[]};
export type AutomationCatalog = {allowAgentCreate:boolean;automations:Automation[]};
export type User = { id:string; username:string; displayName:string; role:'user'|'admin'; isAdmin:boolean; isOwner:boolean; canUseCodex:boolean; agentAccess:AgentAccess };
export type ManagedUser = User & { disabled:boolean; providerIds:string[]; hasPassword:boolean };
export type ReasoningEffort = '' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';
export type Provider = { id: string; name: string; protocol: 'chat-completions' | 'responses'; baseUrl: string; model: string; reasoningEffort?:ReasoningEffort; hasApiKey: boolean; editable?:boolean; testable?:boolean; supportsImages?:boolean; source?:'official-account' };
export type Attachment = {id:string;mimeType:string;name:string;size:number;width:number;height:number};
export type DownloadPackage = {
  id:string;platform:'android'|'windows'|'ubuntu';arch:'universal'|'x64'|'arm64';version:string;channel:'stable'|'preview';
  format:'apk'|'portable-exe'|'portable-zip'|'tar.gz'|'appimage'|'deb';filename:string;url:string;releaseUrl:string;
  bytes:number;publishedAt:string;sha256?:string;debug:boolean;source?:'server'|'github';fallbackUrl?:string;
};
export type DownloadsCatalog = {repository:string;releasesUrl:string;checkedAt:string|null;stale:boolean;error:string|null;
  retryAt:string|null;packages:DownloadPackage[];latestVersion?:string|null;latestVersions?:Record<string,string>;catalogFloorVersion?:string|null;source?:'server'|'github'|'mixed'|'none';notices?:string[]};
export type Message = { id: string; role: 'user' | 'assistant'; content: string; model?: string; status?: string; error?:string; outputRendering?:'auto'|'markdown'|'openui'; createdAt?: string; attachments?:Attachment[]; steered?:boolean; assistantTaskId?:string; assistantTaskReport?:'progress'|'result' };
export type AgentQueueEntry = { id:string; submissionId:string; revision:number; content:string; attachmentIds:string[]; permissions:AgentPermissions; providerId:string|null; model:string; effort:string; createdAt:string;hostId?:string;hostName?:string;projectDirectory?:string };
export type AgentRun = { id:string; submissionId:string; status:'running'|'stopping'|'completed'|'cancelled'|'error'|'unknown'; turnId:string|null; permissions:AgentPermissions; providerId:string|null; model:string; effort:string; startedAt:string; finishedAt?:string;message?:string; error?:string;errorCode?:string;hostId?:string;hostName?:string;projectDirectory?:string;approvalReview?:AgentApprovalReview };
export type AgentSubmission = {submissionId:string;entryId:string;status:'queued'|'running'|'completed'|'cancelled'|'error'|'steered'|'uncertain';content?:string;createdAt?:string};
export type AgentApproval = {id:string;kind:string;description:string;requestedAt?:string;expiresAt?:string;canAccept?:boolean};
export type AgentInputQuestion = {id:string;header:string;question:string;isOther:boolean;isSecret:boolean;options?:{label:string;description:string}[]};
export type AgentUserInput = {id:string;questions:AgentInputQuestion[];requestedAt:string;expiresAt:string;deliveryUncertain?:boolean};
export type AgentState = { revision:number; queueRevision:number; paused:boolean; queue:AgentQueueEntry[]; run:AgentRun|null; approvals:AgentApproval[];userInputs?:AgentUserInput[]; submissions?:AgentSubmission[];contextRepairNeeded?:boolean;contextNotice?:string };
export type ChatAssistantConfig = {enabled:true;hostId:string;providerId:string|null;permissions:AgentPermissions;projectDirectory?:string};
export type ChatAssistantRequest = {assistant?:ChatAssistantConfig;submissionId:string};
export type AssistantTask = {id:string;conversationId?:string;hostId:string;hostName:string;status:'deciding'|'queued'|'running'|'completed'|'cancelled'|'error'|'unknown';message:string;createdAt:string;finishedAt?:string;projectDirectory?:string};
export type ConversationProject = {id:string;name:string;createdAt:string;updatedAt:string};
export type ConversationOrganization = {title?:string;projectId?:string|null;archived?:boolean};
export type Conversation = { id: string; title: string; customTitle?:string; projectId?:string|null; archivedAt?:string|null; mode: 'chat' | 'codex'; providerId?: string; messages: Message[]; createdAt: string; updatedAt: string; agent?:AgentState;codexConfigChanged?:boolean;agentHostId?:string;threadHostId?:string;agentProjectDirectory?:string;threadProjectDirectory?:string;assistantTasks?:AssistantTask[];backgroundParentId?:string;automationId?:string };
export type CodexStatus = { available?: boolean; running?: boolean; version?: string; authenticated?: boolean; error?: string; message?: string; workspaceRoot?: string; projectDirectory?:boolean; mode?:'host'|'api'; configured?:boolean; apiVerified?:boolean; eligibleProviderIds?:string[];approvalReviewProviderIds?:string[]; model?:string; reasoningEffort?:string; approvalReview?:ApprovalReviewCapability; [key: string]: unknown };
export type AgentHost = {id:string;name:string;kind:'central'|'desktop'|'docker';platform:string;online:boolean;codex?:CodexStatus;lastSeenAt?:string;arch?:string;owner?:{id:string;username:string;displayName:string};isOwn?:boolean};
export type CodexConfig = { mode:'host'|'api'; baseUrl:string; model:string; reasoningEffort?:ReasoningEffort; hasApiKey:boolean; revision:string; protocol:'responses'; configured:boolean };
export type MusicAction = 'open'|'play'|'pause'|'next'|'previous';
export type MusicPlayer = { id:'qqmusic'|'netease'; name:string; installed:boolean; session:boolean; state?:string; controls:string[]; message?:string };
export type OpenCliStatus = {available:boolean;version:string|null;runtime:'bundled';daemon:{state:'stopped'|'owned'|'shared'|'external'|'unavailable';owned:boolean;port:number;compatible?:boolean};extension:{connected:boolean;required:true;installUrl:string};profiles:{id:string;label:string;connected:boolean}[];selectedProfileId:string|null;ready:boolean;message:string;allowedOrigins:string[];websiteAccess?:'all'};
export type DesktopToolsStatus = {music:{platform:string;players:MusicPlayer[];message?:string};opencli:OpenCliStatus;busy?:boolean};
export type CompanionKind = 'anime' | 'cat';
export type State = { instanceId?:string; user?:User; settings: { petName: string; persona: string; companionKind: CompanionKind; defaultProviderId?:string|null;chatAssistantHostId?:string|null }; providers: Provider[]; conversations: Conversation[]; projects?:ConversationProject[]; codex: CodexStatus };
export type Connection = { url: string; token: string };
export type VoiceConnectionFields = {baseUrl:string;model:string;hasApiKey?:boolean;apiKey?:string;clearApiKey?:boolean};
export type VoiceConfig = {
  tts:VoiceConnectionFields & {mode:'system'|'remote'|'cosyvoice';voice:string;speed:number;emotion:'original'|'auto'|'neutral'|'happy'|'sad'|'angry'|'gentle';emotionIntensity:'natural'|'strong'};
  asr:VoiceConnectionFields & {mode:'disabled'|'browser'|'remote';language:string};
  wake?:WakeSettings;
  runtime?:{tts:string;asr:string;remoteConfiguredOnly:boolean;ttsSource?:'api-harbor'|'cosyvoice';streamingAvailable?:boolean};
};
export type CosyVoiceConfig = {configured:boolean;hasReference:boolean;referenceName:string;referenceText:string;baseUrl:string;hasApiKey:boolean;editable:boolean;revision:string;source?:'api-harbor'|'cosyvoice';streamingAvailable?:boolean;streamingSource?:'cosyvoice'|null};
export type AsrConfig = {configured:boolean;editable:boolean;baseUrl:string;hasApiKey:boolean;revision:string;busy:boolean;audio:{format:'pcm_f32le';sampleRate:number;channels:number;maxFrameBytes:number;maxSeconds:number}};
type CredentialKind = 'pairing'|'session'|'none';
export type SavedLoginConnection = Connection & {credentialKind:CredentialKind;target:'local'|'remote'};
/** Android implements this with a Keystore vault; browsers keep their existing session-only storage. */
export type LoginSessionBridge = {read():Promise<{connection:SavedLoginConnection|null}>;write(connection:SavedLoginConnection):Promise<void>;clear():Promise<void>};
export type StreamEvent = { type: string; data: Record<string, any> };
export type Identity = {instanceId:string;userId:string};
export type NativeExecutorStatus = {state:'disconnected'|'connecting'|'reconnecting'|'online'|'error';hostId?:string;name:string;platform:string;arch:string;error?:string;retryable?:boolean;retryAt?:number};
export type NativeExecutor = {connect(input:Connection & Identity):Promise<NativeExecutorStatus>;disconnect():Promise<void>;status():Promise<NativeExecutorStatus>};
export type OfficialAccountModel = {id:string;model:string;displayName:string;supportsImages:boolean};
export type OfficialAccountProfile = {id:string;email:string;label:string;signedIn:boolean;planUsageEnabled:boolean};
export type OfficialAccountUsage = {state:'unverified'|'available'|'limit-reached'|'temporarily-unavailable'|'not-eligible';checkedAt:string|null;lastModel:string|null;completedRequests:number;inputTokens:number;outputTokens:number;totalTokens:number};
export type OfficialAccountStatus = {supported:true;state:'signed-out'|'signing-in'|'signed-in';signInStage?:'browser'|'verifying';manualCallbackSupported?:boolean;activeProfileId:string|null;planUsageEnabled:boolean;profiles:OfficialAccountProfile[];models:OfficialAccountModel[];modelsLoading?:boolean;error?:string;modelsError?:string;usage?:OfficialAccountUsage};
export type OfficialAccountBridge = {status():Promise<OfficialAccountStatus>;start(input?:{profileId?:string}):Promise<OfficialAccountStatus>;cancel():Promise<OfficialAccountStatus>;select(profileId:string):Promise<OfficialAccountStatus>;logout():Promise<OfficialAccountStatus>;refresh():Promise<OfficialAccountStatus>;resumeUsage?():Promise<OfficialAccountStatus>;completeCallback?():Promise<OfficialAccountStatus>};
export type AppProxyStatus = {supported:true;state:'stopped'|'checking'|'starting'|'running'|'stopping'|'error';configured:boolean;running:boolean;autoStart:boolean;version:string;platform:'win32'|'linux';arch:'x64'|'arm64';groups:{name:string;selected:string;choices:string[]}[];remoteConfigured?:boolean;remoteUpdatedAt?:string;error?:string};
export type AppProxyBridge = {status():Promise<AppProxyStatus>;importFile():Promise<AppProxyStatus>;importText(input:{yaml:string}):Promise<AppProxyStatus>;importUrl?(input:{url:string}):Promise<AppProxyStatus>;updateRemote?():Promise<AppProxyStatus>;start():Promise<AppProxyStatus>;stop():Promise<AppProxyStatus>;preferences(input:{autoStart:boolean}):Promise<AppProxyStatus>;select(input:{group:string;name:string}):Promise<AppProxyStatus>};
export type DesktopRuntime = {readonly platform:string;readonly arch:string};
export type DesktopAppearanceSnapshot = Readonly<{preference:'day'|'night'|'auto';theme:'day'|'night';saved:boolean}>;
export type DesktopAppearanceBridge = {readonly initial:DesktopAppearanceSnapshot & {readonly sessionId?:string};status():Promise<DesktopAppearanceSnapshot>;setPreference(preference:'day'|'night'|'auto'):Promise<DesktopAppearanceSnapshot>};
declare global {
  interface Window { petpal?: { readonly runtime?:DesktopRuntime; readonly appearance?:DesktopAppearanceBridge; connection(): Promise<Connection>; remoteRequest?(request:RemoteRequest,onEvent:(event:RemoteEvent)=>void):Promise<void>; remoteAbort?(id:string):Promise<void>; remoteAck?(id:string,sequence:number):Promise<void>; showPet(): void; showMain(): void; hidePet(): void; preferences?:PreferencesBridge; centralServer?:CentralServerBridge; memoryRuntime?:MemoryRuntimeBridge; updates?:DesktopUpdates; executor?:NativeExecutor; musicMcp?:DesktopMusicMcp; officialAccount?:OfficialAccountBridge; appProxy?:AppProxyBridge }; }
  interface Window { petpalLoginSession?:LoginSessionBridge; }
}
const requests = createRequestScope();
const listeners = new Set<()=>void>();
let identity: Identity|null = null;
let initialization: Promise<Connection>|undefined;
let nativeConnection:Connection|undefined;
let executionTarget:'local'|'remote'='remote';
let targetSwitchSequence=0;
let executorScope:string|null=null;
let executorPendingScope:string|null=null;
let executorRevision=0;
let loginPersistenceError='';
let loginPersistenceQueue:Promise<void>=Promise.resolve();
let savedLoginRetry:{epoch:number;promise:Promise<Connection>}|undefined;
let savedLoginReadGeneration=0;
type SavedLoginRead={epoch:number;generation:number;controller:AbortController;promise:ReturnType<LoginSessionBridge['read']>};
let savedLoginRead:SavedLoginRead|undefined;
let sessionValidation:{epoch:number;promise:Promise<boolean>}|undefined;
// Only the Android entry installs this vault bridge. Desktop has its own
// connection bridge and must retain its existing session lifetime.
const remembersAndroidDevice=()=>Boolean(window.petpalLoginSession&&!window.petpal);
function authenticationHeaders(token:string){
  const headers=new Headers({Authorization:`Bearer ${token}`});
  if(remembersAndroidDevice())headers.set('X-PetPal-Remember-Device','1');
  return headers;
}
type WarmInitialState = {epoch:number;identity:Identity;history:boolean;controller:AbortController;promise:Promise<State>;expiresAt:number;timer?:ReturnType<typeof setTimeout>};
const warmInitialStates=new Map<boolean,WarmInitialState>();
function releaseWarmInitialState(entry:WarmInitialState,reason?:Error){
  if(warmInitialStates.get(entry.history)===entry)warmInitialStates.delete(entry.history);
  clearTimeout(entry.timer);
  if(reason)entry.controller.abort(reason);
}
function clearWarmInitialStates(){for(const entry of warmInitialStates.values())releaseWarmInitialState(entry,new SessionChangedError());}
function currentWarmInitialState(entry:WarmInitialState){return entry.epoch===getSessionEpoch()&&!!getConnection().token&&identity?.instanceId===entry.identity.instanceId&&identity.userId===entry.identity.userId;}
export const getLoginPersistenceError=()=>loginPersistenceError;
function setLoginPersistenceError(message:string){
  if(loginPersistenceError===message)return;
  loginPersistenceError=message;window.dispatchEvent(new Event('petpal:login-persistence-error'));
}
function invalidateSavedLoginRead(){
  savedLoginReadGeneration++;
  const previous=savedLoginRead;savedLoginRead=undefined;
  previous?.controller.abort(new SessionChangedError());
}
/** Native reads are side-effect free. A stalled bridge may be abandoned, but
 * its late result must never take ownership of a newer restoration or login. */
function readSavedLogin(bridge:LoginSessionBridge):ReturnType<LoginSessionBridge['read']>{
  const epoch=getSessionEpoch();
  if(savedLoginRead?.epoch===epoch)return savedLoginRead.promise;
  const controller=new AbortController(),generation=++savedLoginReadGeneration;
  const entry:SavedLoginRead={epoch,generation,controller,promise:Promise.resolve({connection:null})};
  savedLoginRead=entry;
  const timer=setTimeout(()=>controller.abort(new Error('读取设备登录超时，请重试。')),15000);
  let pending:ReturnType<LoginSessionBridge['read']>;
  try{pending=bridge.read();}catch(error){pending=Promise.reject(error);}
  entry.promise=waitForInitialState(pending,controller.signal).then(value=>{
    if(savedLoginRead!==entry||generation!==savedLoginReadGeneration||epoch!==getSessionEpoch())throw new SessionChangedError();
    return value;
  }).finally(()=>{clearTimeout(timer);if(savedLoginRead===entry)savedLoginRead=undefined;});
  return entry.promise;
}
function persistLogin(connection:SavedLoginConnection,assertCurrent:()=>void=()=>{},commit:()=>void=()=>{}):Promise<void>{
  const epoch=getSessionEpoch(),fence=()=>{if(epoch!==getSessionEpoch())throw new SessionChangedError();assertCurrent();};
  const bridge=window.petpalLoginSession;
  if(!bridge){fence();commit();return Promise.resolve();}
  let pending:Promise<void>;
  if(connection.token){
    // Keep the durable write AND publishing its account in one serialized
    // transaction. Another same-epoch login must recheck before writing.
    pending=loginPersistenceQueue.catch(()=>{}).then(async()=>{fence();await bridge.write(connection);fence();commit();});
    loginPersistenceQueue=pending;
  }else{
    // Logout must reach native clear immediately, even when an older write's
    // callback is delayed. Native reserve cancels that write; queued JS writes
    // still fail their old epoch fence. New logins need not wait for it.
    loginPersistenceQueue=Promise.resolve();
    pending=(async()=>{
      fence();
      try{await bridge.clear();}
      catch{fence();const message='当前会话已关闭，但未能清除设备保存的登录。请重试清除后再关闭应用。';setLoginPersistenceError(message);throw new Error(message);}
      fence();setLoginPersistenceError('');commit();
    })();
  }
  void pending.catch(()=>{});return pending;
}
export function clearSavedLogin(){
  const connection=getConnection();
  if(connection.token)return Promise.reject(new SessionChangedError());
  return persistLogin({...connection,credentialKind:'none',target:executionTarget});
}
export const getExecutionTarget=()=>executionTarget;
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
function replaceConnection(next:Connection,credentialKind:CredentialKind,target:'local'|'remote'|undefined,reason:'change'|'restore'|'authenticate',persist:boolean) {
  const connection={url:normalizeServerUrl(next.url),token:next.token.trim()};
  invalidateSavedLoginRead();
  clearWarmInitialStates();
  executorScope=null;
  executorPendingScope=null;executorRevision++;
  void window.petpal?.executor?.disconnect().catch(()=>{});
  void window.petpal?.updates?.cancel().catch(()=>{});
  executionTarget=target || (nativeConnection && connection.url === nativeConnection.url ? 'local' : 'remote');
  identity=null;requests.replace(connection);
  const changedEpoch=getSessionEpoch();
  try{const saved={...connection,credentialKind,target:executionTarget};sessionStorage.setItem('petpal.connection',JSON.stringify(saved));sessionStorage.setItem(`petpal.connection.${executionTarget}`,JSON.stringify(saved));}catch{}
  try{window.speechSynthesis?.cancel();}catch{}
  window.dispatchEvent(Object.assign(new Event('petpal:session-change'),{detail:{reason}}));notify();
  return persist?persistLogin({...connection,credentialKind,target:executionTarget},()=>{if(changedEpoch!==getSessionEpoch())throw new SessionChangedError();}):Promise.resolve();
}
export function setConnection(next:Connection,credentialKind:CredentialKind=next.token?'pairing':'none',target?:'local'|'remote',reason:'change'|'restore'|'authenticate'='change') {
  return replaceConnection(next,credentialKind,target,reason,reason!=='restore');
}
function acceptIdentity(value:{instanceId?:string;user?:User}) {
  if(!value.instanceId||!value.user?.id)return;
  const executor=window.petpal?.executor;
  const scope=`${getSessionEpoch()}:${value.instanceId}:${value.user.id}:${Boolean(value.user.canUseCodex)}`;
  if(executor && executorScope!==scope && executorPendingScope!==scope){
    const revision=++executorRevision;executorPendingScope=scope;executorScope=null;
    const connection=getConnection(), canHost=value.user.canUseCodex;
    // Main verifies identity independently. Pending calls are deduplicated, but
    // a failed connection never permanently suppresses a later identity refresh.
    void Promise.resolve().then(async ():Promise<NativeExecutorStatus|void>=>{
      if(revision!==executorRevision)return;
      return canHost ? executor.connect({...connection,url:connection.url || location.origin,instanceId:value.instanceId!,userId:value.user!.id}) : executor.disconnect();
    }).then(status=>{
      if(revision!==executorRevision)return;
      if(!canHost || status && (status.state==='online'||status.state==='connecting'||status.state==='reconnecting'||status.retryable===false))executorScope=scope;
    }).catch(()=>{
      if(revision===executorRevision)executorScope=null;
    }).finally(()=>{
      if(revision===executorRevision)executorPendingScope=null;
    });
  }
  if(identity?.instanceId===value.instanceId&&identity.userId===value.user.id)return;
  const changed=!!identity;
  if(changed)clearWarmInitialStates();
  identity={instanceId:value.instanceId,userId:value.user.id};
  if(changed)window.dispatchEvent(Object.assign(new Event('petpal:session-change'),{detail:{reason:'identity'}}));
  notify();
}
export function initConnection(defaultUrl = '') {
  initialization ??= (async()=>{
    const epoch=getSessionEpoch();
    const native=window.petpal?await window.petpal.connection():undefined;
    if(epoch!==getSessionEpoch())return getConnection();nativeConnection=native;
    const params=new URLSearchParams(location.hash.slice(1)),token=params.get('token');
    if(token){setConnection({url:native?.url||'',token});history.replaceState(null,'',location.pathname+location.search);return getConnection();}
    let nativeReadFailed=false;
    if(window.petpalLoginSession){
      try{
        const saved=(await readSavedLogin(window.petpalLoginSession)).connection;
        if(epoch!==getSessionEpoch())return getConnection();
        const restored=restoreTargetConnection(saved,native);
        if(restored){setConnection(restored.connection,restored.credentialKind,restored.target,'restore');setLoginPersistenceError('');return getConnection();}
      }catch{if(epoch!==getSessionEpoch())return getConnection();nativeReadFailed=true;loginPersistenceError='无法恢复设备保存的登录，请重试；原私有文件已保留。';}
    }
    try{const saved=!nativeReadFailed&&sessionStorage.getItem('petpal.connection');if(saved){const parsed=JSON.parse(saved);if(typeof parsed.url==='string'&&typeof parsed.token==='string'){
      const restored=restoreTargetConnection(parsed,native);
      if(restored){if(window.petpalLoginSession&&restored.connection.token){await persistLogin({...restored.connection,credentialKind:restored.credentialKind,target:restored.target},()=>{if(epoch!==getSessionEpoch())throw new SessionChangedError();},()=>{setConnection(restored.connection,restored.credentialKind,restored.target,'restore');});}else setConnection(restored.connection,restored.credentialKind,restored.target,'restore');setLoginPersistenceError('');return getConnection();}
    }}}catch{if(epoch!==getSessionEpoch())return getConnection();try{sessionStorage.removeItem('petpal.connection');}catch{}}
    if(native)setConnection({url:defaultUrl || native.url,token:''},'none',undefined,'restore');
    else if(defaultUrl)setConnection({url:defaultUrl,token:''},'none',undefined,'restore');
    return getConnection();
  })();
  return initialization.then(()=>getConnection());
}
/** Retry a temporary vault read failure without deleting or replacing its file. */
export function retrySavedLogin(defaultUrl=''):Promise<Connection>{
  if(getConnection().token||!window.petpalLoginSession)return Promise.resolve(getConnection());
  const epoch=getSessionEpoch();
  if(savedLoginRetry?.epoch===epoch)return savedLoginRetry.promise;
  const bridge=window.petpalLoginSession;
  const entry={epoch,promise:Promise.resolve(getConnection())};
  entry.promise=(async()=>{
    try{
      const saved=(await readSavedLogin(bridge)).connection;
      if(epoch!==getSessionEpoch()||savedLoginRetry!==entry||getConnection().token)throw new SessionChangedError();
      const restored=restoreTargetConnection(saved,nativeConnection);
      const replacing=!!restored||!getConnection().url&&!!defaultUrl;
      if(restored)void setConnection(restored.connection,restored.credentialKind,restored.target,'restore');
      else if(replacing)void setConnection({url:defaultUrl,token:''},'none',undefined,'restore');
      if(getSessionEpoch()!==epoch+(replacing?1:0))throw new SessionChangedError();
      setLoginPersistenceError('');return getConnection();
    }catch(error){
      if(epoch!==getSessionEpoch()||isSessionChanged(error))throw new SessionChangedError();
      const message='无法恢复设备保存的登录，请重试；原私有文件已保留。';setLoginPersistenceError(message);throw new Error(message);
    }finally{if(savedLoginRetry===entry)savedLoginRetry=undefined;}
  })();
  savedLoginRetry=entry;return entry.promise;
}
export async function switchExecutionTarget(target:'local'|'remote',defaultRemoteUrl='https://magicdatou.top:44318') {
  const sequence=++targetSwitchSequence,epoch=getSessionEpoch();
  if(target==='local'&&!window.petpal)throw new Error('当前设备没有本机 Agent；请连接远程主机。');
  if(target===executionTarget)return;
  if(target==='local'){
    const native=await window.petpal!.connection();
    if(sequence!==targetSwitchSequence||epoch!==getSessionEpoch())throw new SessionChangedError();
    nativeConnection=native;
  }
  let saved;try{saved=JSON.parse(sessionStorage.getItem('petpal.connection.'+target)||'null');}catch{}
  const restored=restoreTargetConnection(saved,target==='local'?nativeConnection:undefined);
  if(restored&&restored.target===target)setConnection(restored.connection,restored.credentialKind,target);
  else setConnection({url:target==='local'?nativeConnection!.url:defaultRemoteUrl,token:''},'none',target);
}
function message(data:any,status:number){return data.error?.message||data.error||data.message||`请求失败 (${status})`;}
function confirmInvalidSession(request:ReturnType<typeof requests.begin>):Promise<boolean>{
  if(sessionValidation?.epoch===request.epoch)return sessionValidation.promise;
  // A business endpoint's 401 may belong to an upstream service. Confirm using
  // an independent, bounded request shared by this account epoch; aborting one
  // caller must not cancel another caller's confirmation.
  const controller=new AbortController(),validation=requests.begin(controller.signal);
  const timer=setTimeout(()=>controller.abort(new Error('登录验证暂时不可用。')),5000);
  const entry={epoch:request.epoch,promise:Promise.resolve(false)};
  entry.promise=waitForInitialState(connectionFetch(`${request.connection.url}/api/auth/me`,{headers:authenticationHeaders(request.connection.token),signal:validation.signal}).then(response=>{
    validation.assertCurrent();void response.body?.cancel().catch(()=>{});return response.status===401;
  }),validation.signal).catch(()=>false).finally(()=>{clearTimeout(timer);validation.close();if(sessionValidation===entry)sessionValidation=undefined;});
  sessionValidation=entry;return entry.promise;
}
async function responseJson(response:Response,request:ReturnType<typeof requests.begin>,route='') {
  let data:any;
  try{data=await waitForInitialState(response.json(),request.signal);}
  catch(error){
    request.assertCurrent();
    // A successful status does not make a truncated or unreadable body usable.
    // Error responses may still have an empty/non-JSON proxy error page.
    if(response.ok)throw Object.assign(new Error('服务响应不完整或格式无效，请重试。',{cause:error}),{status:response.status,code:'invalid_response'});
    data={};
  }
  request.assertCurrent();
  if(!response.ok){
    if(response.status===401&&request.connection.token){
      const invalid=data?.code==='session_invalid'||route==='/auth/me'||await waitForInitialState(confirmInvalidSession(request),request.signal);
      request.assertCurrent();
      if(invalid)await setConnection({url:request.connection.url,token:''}).catch(()=>{});
    }
    throw Object.assign(new Error(message(data,response.status)),{status:response.status,...(typeof data?.code==='string'?{code:data.code}:{})});
  }
  return data;
}
export type ApiRequestOptions = RequestInit & {timeoutMs?:number};
/** A caller may bound a finite JSON operation; streaming tasks retain their own lifecycle. */
export async function api<T = any>(path:string, options:ApiRequestOptions = {}):Promise<T> {
  const {timeoutMs,...init}=options;
  if(timeoutMs!==undefined&&(!Number.isFinite(timeoutMs)||timeoutMs<=0||timeoutMs>2147483647))throw new TypeError('请求超时须为有效的正毫秒数。');
  const controller=new AbortController(),abort=()=>controller.abort(init.signal?.reason);
  if(init.signal?.aborted)abort();else init.signal?.addEventListener('abort',abort,{once:true});
  const request=requests.begin(controller.signal);
  const timer=timeoutMs===undefined?undefined:setTimeout(()=>controller.abort(Object.assign(new Error('服务请求超时，请检查连接后重试。'),{name:'TimeoutError',code:'request_timeout'})),timeoutMs);
  try{
    request.assertCurrent();const headers=new Headers(init.headers),route=path.split('?')[0];if(!headers.has('Content-Type'))headers.set('Content-Type','application/json');headers.set('Authorization',`Bearer ${request.connection.token}`);if(route==='/auth/me'&&(!init.method||init.method.toUpperCase()==='GET')&&remembersAndroidDevice())headers.set('X-PetPal-Remember-Device','1');
    const pending=connectionFetch(`${request.connection.url}/api${path}`,{...init,headers,signal:request.signal}).then(response=>{
      try{request.assertCurrent();}
      catch(error){try{void response.body?.cancel().catch(()=>{});}catch{}throw error;}
      return response;
    });
    const response=await waitForInitialState(pending,request.signal);request.assertCurrent();
    const data=await responseJson(response,request,route);if(route==='/state'||route==='/bootstrap'||route==='/auth/me')acceptIdentity(data);request.assertCurrent();return data as T;
  }finally{clearTimeout(timer);init.signal?.removeEventListener('abort',abort);request.close();}
}
async function readInitialState(history:boolean,signal:AbortSignal):Promise<State>{
  try { return await api<State>(history?'/state?runtime=deferred':'/bootstrap',{signal}); }
  catch(error) {
    // Only an absent endpoint permits legacy fallback; auth/network failures
    // must not create a second request or conceal the original failure.
    if(history||signal.aborted||(error as {status?:number}).status!==404)throw error;
    return await api<State>('/state',{signal});
  }
}
/** A misbehaving transport must not hold a caller past cancellation. */
function waitForInitialState<T>(pending:Promise<T>,signal:AbortSignal):Promise<T>{
  return new Promise((resolve,reject)=>{
    const abort=()=>{signal.removeEventListener('abort',abort);reject(signal.reason);};
    if(signal.aborted){void pending.catch(()=>{});abort();return;}
    signal.addEventListener('abort',abort,{once:true});
    pending.then(value=>{signal.removeEventListener('abort',abort);resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});
  });
}
async function initialStateRead(history:boolean,signal:AbortSignal|undefined,timeoutMs:number,pending?:Promise<State>):Promise<State>{
  const controller=new AbortController(),epoch=getSessionEpoch();
  const abort=()=>controller.abort(signal?.reason);
  if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>controller.abort(new Error('加载个人设置超时，请重试连接。')),timeoutMs);
  try {
    controller.signal.throwIfAborted();
    const value=await waitForInitialState(pending??readInitialState(history,controller.signal),controller.signal);
    if(epoch!==getSessionEpoch())throw new SessionChangedError();
    controller.signal.throwIfAborted();return value;
  } finally { clearTimeout(timer);signal?.removeEventListener('abort',abort); }
}
/** Start only after LoginGate has verified this account, alongside its page module. */
export function warmInitialState({history=false}:{history?:boolean}={}){
  if(!identity||!getConnection().token)return;
  const previous=warmInitialStates.get(history);
  if(previous){if(currentWarmInitialState(previous)&&!previous.controller.signal.aborted&&previous.expiresAt>Date.now())return;releaseWarmInitialState(previous,new SessionChangedError());}
  const controller=new AbortController(),epoch=getSessionEpoch(),owner={...identity};
  let entry:WarmInitialState;
  const pending=initialStateRead(history,controller.signal,15000);
  entry={epoch,identity:owner,history,controller,expiresAt:Date.now()+15000,promise:pending.then(value=>{
    if(!currentWarmInitialState(entry)||controller.signal.aborted)throw new SessionChangedError();
    if(warmInitialStates.get(history)===entry){entry.expiresAt=Date.now()+5000;entry.timer=setTimeout(()=>releaseWarmInitialState(entry),5000);}
    return value;
  }).catch(error=>{releaseWarmInitialState(entry);throw error;})};
  warmInitialStates.set(history,entry);void entry.promise.catch(()=>{});
}
/** Bound only page startup; streaming and interactive tasks keep their own lifecycle. */
export async function loadInitialState({history=false,signal,timeoutMs=15000}:{history?:boolean;signal?:AbortSignal;timeoutMs?:number}={}):Promise<State>{
  let entry=warmInitialStates.get(history);
  if(entry&&(!currentWarmInitialState(entry)||entry.controller.signal.aborted||entry.expiresAt<=Date.now())){releaseWarmInitialState(entry,new SessionChangedError());entry=undefined;}
  // A page's StrictMode cleanup cancels only its reader. The warm owner can
  // finish for the replacement mount; a delivered snapshot is never cached.
  const value=await initialStateRead(history,signal,timeoutMs,entry?.promise);
  if(entry){if(!currentWarmInitialState(entry))throw new SessionChangedError();releaseWarmInitialState(entry);}
  return value;
}
/** Binary responses retain the same immutable credentials and epoch fence as JSON. */
export async function apiBlob(path:string, options:RequestInit = {}):Promise<Blob> {
  const request=requests.begin(options.signal);
  try{
    request.assertCurrent();const headers=new Headers(options.headers);if(!headers.has('Content-Type'))headers.set('Content-Type','application/json');headers.set('Authorization',`Bearer ${request.connection.token}`);
    const response=await connectionFetch(`${request.connection.url}/api${path}`,{...options,headers,signal:request.signal});request.assertCurrent();
    if(!response.ok){await responseJson(response,request);throw new Error('音频请求失败。');}
    const blob=await response.blob();request.assertCurrent();return blob;
  }finally{request.close();}
}
/** Keep optional speaking intention paired with the audio and its auth snapshot. */
export async function apiSpeechAudio(text:string, signal:AbortSignal):Promise<{blob:Blob;emotion:SpeechEmotion|null;source?:'api-harbor'|'cosyvoice'}> {
  const request=requests.begin(signal);
  try {
    request.assertCurrent();
    const response=await connectionFetch(`${request.connection.url}/api/voice/synthesize`,{
      method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${request.connection.token}`},body:JSON.stringify({text}),signal:request.signal,
    });
    request.assertCurrent();
    if(!response.ok){await responseJson(response,request);throw new Error('音频请求失败。');}
    const fields=['x-petpal-speech-emotion','x-petpal-speech-intensity','x-petpal-speech-source'].map(name=>response.headers.get(name));
    let emotion:SpeechEmotion|null;
    try { const {normalizeSpeechEmotion}=await import('./avatar/speech-emotion.mjs');request.assertCurrent();emotion=normalizeSpeechEmotion(fields.every(value=>value===null)?null:{emotion:fields[0],intensity:fields[1],source:fields[2]}); }
    catch(error){void response.body?.cancel().catch(()=>{});throw error;}
    const label=response.headers.get('x-petpal-audio-source');
    const source=label==='api-harbor'||label==='cosyvoice'?label:undefined;
    const blob=await response.blob();request.assertCurrent();return {blob,emotion,...(source?{source}:{})};
  }finally{request.close();}
}
/** Keep the credential snapshot and cancellation scope alive until playback consumes the stream. */
export async function apiSpeechStream(text:string, signal:AbortSignal, handlers:SpeechStreamHandlers):Promise<void> {
  const request=requests.begin(signal);
  try {
    request.assertCurrent();
    const {readSpeechStream}=await import('./avatar/speech-stream.mjs');request.assertCurrent();
    const response=await connectionFetch(`${request.connection.url}/api/voice/synthesize/stream`,{
      method:'POST',headers:{'Content-Type':'application/json',Accept:'application/x-petpal-speech-v2+ndjson',Authorization:`Bearer ${request.connection.token}`},
      body:JSON.stringify({text}),signal:request.signal,
    });
    request.assertCurrent();
    if(!response.ok){await responseJson(response,request);throw new Error('语音流请求失败。');}
    await readSpeechStream(response,{...handlers,signal:request.signal,assertCurrent:request.assertCurrent});
    request.assertCurrent();
  }finally{request.close();}
}
/** Validate new credentials before atomically replacing the current account. */
async function acceptLogin(request:ReturnType<typeof requests.begin>,connection:Connection,kind:CredentialKind,reason:'change'|'authenticate',accepted?:()=>void){
  const target=nativeConnection&&connection.url===nativeConnection.url?'local':'remote';
  await persistLogin({...connection,credentialKind:kind,target},request.assertCurrent,()=>{
    const nextEpoch=getSessionEpoch()+1;setLoginPersistenceError('');request.assertCurrent();replaceConnection(connection,kind,target,reason,false);
    if(getSessionEpoch()!==nextEpoch)throw new SessionChangedError();accepted?.();
  });
}
/** Bound the handshake and body only. Once the native write starts, account
 * publication stays in persistLogin's transaction, without a UI/network timer
 * that could report failure after the vault has already changed. */
async function readAuthenticationResponse(request:ReturnType<typeof requests.begin>,url:string,options:RequestInit){
  const network=new AbortController(),sessionChanged=()=>network.abort(request.signal.reason);
  if(request.signal.aborted)sessionChanged();else request.signal.addEventListener('abort',sessionChanged,{once:true});
  const timer=setTimeout(()=>network.abort(new Error('连接登录服务超时，请检查网络或服务地址后重试。')),15000);
  try{
    return await waitForInitialState((async()=>{
      request.assertCurrent();network.signal.throwIfAborted();
      const response=await connectionFetch(url,{...options,signal:network.signal});
      request.assertCurrent();network.signal.throwIfAborted();
      const data=await response.json().catch(()=>({}));
      request.assertCurrent();network.signal.throwIfAborted();
      return{response,data};
    })(),network.signal);
  }finally{clearTimeout(timer);request.signal.removeEventListener('abort',sessionChanged);}
}
export async function connectWithToken(next:Connection) {
  const url=normalizeServerUrl(next.url),token=next.token.trim();if(!token)throw new Error('请输入配对令牌。');
  const request=requests.begin();
  try{const {response,data}=await readAuthenticationResponse(request,`${url}/api/auth/me`,{headers:authenticationHeaders(token)});request.assertCurrent();if(!response.ok)throw new Error(message(data,response.status));if(typeof data.instanceId!=='string'||!data.instanceId||typeof data.user?.id!=='string'||!data.user.id)throw new Error('服务身份响应无效。');const reason=!identity&&request.connection.url===url?'authenticate':'change';await acceptLogin(request,{url,token},'pairing',reason,()=>acceptIdentity(data));}finally{request.close();}
}
export async function login(urlValue:string,username:string,password:string) {
  const url=normalizeServerUrl(urlValue),request=requests.begin();
  try{const {response,data}=await readAuthenticationResponse(request,`${url}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:username.trim(),password,...(remembersAndroidDevice()?{rememberDevice:true}:{})})});request.assertCurrent();if(!response.ok)throw new Error(message(data,response.status));if(typeof data.token!=='string'||!data.token)throw new Error('登录响应缺少会话凭据。');const reason=!identity&&request.connection.url===url?'authenticate':'change';await acceptLogin(request,{url,token:data.token},'session',reason);}finally{request.close();}
}
export function logout() {
  const previous=getConnection(),cleared=setConnection({url:previous.url,token:''});
  if(previous.token){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),4000);void connectionFetch(`${previous.url}/api/auth/logout`,{method:'POST',headers:{Authorization:`Bearer ${previous.token}`},signal:controller.signal}).catch(()=>{}).finally(()=>clearTimeout(timer));}
  return cleared;
}
export async function streamMessage(id:string,content:string,signal:AbortSignal,onEvent:(event:StreamEvent)=>void,attachmentIds:string[] = [],assistantRequest?:ChatAssistantRequest,clientRequestId?:string) {
  const request=requests.begin(signal);let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  try{
    request.assertCurrent();const response=await connectionFetch(`${request.connection.url}/api/conversations/${encodeURIComponent(id)}/messages`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${request.connection.token}`},body:JSON.stringify({content,attachmentIds,...(assistantRequest?{assistant:assistantRequest.assistant,submissionId:assistantRequest.submissionId}:{}),...(clientRequestId!==undefined?{clientRequestId}:{})}),signal:request.signal});request.assertCurrent();
    if(!response.ok){await responseJson(response,request);return;}
    if(!response.body)throw new Error('当前环境不支持流式回复。');
    reader=response.body.getReader();const decoder=new TextDecoder();let buffer='',terminal=false;
    const dispatch=(block:string)=>{request.assertCurrent();let type='message';const payload:string[]=[];for(const line of block.split('\n')){if(line.startsWith('event:'))type=line.slice(6).trim();else if(line.startsWith('data:'))payload.push(line.slice(5).trimStart());}if(!payload.length)return;const data=JSON.parse(payload.join('\n'));if(type==='done'||type==='error')terminal=true;onEvent({type,data});};
    while(!terminal){const{value,done}=await reader.read();request.assertCurrent();if(done)break;buffer+=decoder.decode(value,{stream:true});buffer=buffer.replace(/\r\n/g,'\n');let boundary;while(!terminal&&(boundary=buffer.indexOf('\n\n'))>=0){dispatch(buffer.slice(0,boundary));buffer=buffer.slice(boundary+2);}}
    if(!terminal){buffer+=decoder.decode();if(buffer.trim())dispatch(buffer);if(!terminal)throw new Error('连接提前断开，回复可能不完整。请重试。');}
  }finally{
    // The protocol terminal owns completion. Native/proxy cancellation may take
    // arbitrarily long; consume its rejection without holding the composer open.
    try{void reader?.cancel().catch(()=>{});}catch{}
    try{reader?.releaseLock();}catch{}
    request.close();
  }
}
