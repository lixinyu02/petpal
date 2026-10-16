import {getConnection,getExecutionTarget,getIdentity,getSessionEpoch,SessionChangedError,type OfficialAccountBridge,type OfficialAccountStatus,type OfficialAccountUsage} from '../api';
import {androidOfficialAccount,supportsAndroidOfficialAccount} from './android-official-account';

export type OfficialAccountAction='status'|'start'|'cancel'|'select'|'logout'|'refresh'|'resumeUsage';
export type OfficialAccountSnapshot={scope:string;status:OfficialAccountStatus|null;busy:OfficialAccountAction|'';error:string;defaultRequest:number};
type Context={scope:string;bridge:OfficialAccountBridge|undefined;allowed:boolean;snapshot:OfficialAccountSnapshot;revision:number;pending:Promise<OfficialAccountStatus>|null;timer:ReturnType<typeof setTimeout>|null};
const listeners=new Set<()=>void>();
let active:Context|undefined,defaultSequence=0,listening=false;
const bounded=(value:unknown,limit:number)=>typeof value==='string'&&value.length<=limit&&!/[\x00-\x1f\x7f]/.test(value);

export function nativeOfficialAccount():OfficialAccountBridge|undefined{
  const bridge=window.petpal?.officialAccount||androidOfficialAccount();
  return bridge&&['status','start','cancel','select','logout','refresh'].every(key=>typeof bridge[key as keyof OfficialAccountBridge]==='function')?bridge:undefined;
}
export function officialAccountIsLocal(){return supportsAndroidOfficialAccount()||getExecutionTarget()==='local';}
export const officialAccountDevice=()=>supportsAndroidOfficialAccount()?'手机':'电脑';
function scope(){const identity=getIdentity();return `${getSessionEpoch()}:${identity?.instanceId||''}:${identity?.userId||''}:${getExecutionTarget()}`;}
function stopTimer(context:Context){if(context.timer!==null){clearTimeout(context.timer);context.timer=null;}}
function context(){
  const key=scope(),bridge=nativeOfficialAccount();
  if(!active||active.scope!==key||active.bridge!==bridge){
    if(active){stopTimer(active);active.revision++;}
    active={scope:key,bridge,allowed:!!bridge&&officialAccountIsLocal()&&!!getIdentity()&&!!getConnection().token,snapshot:{scope:key,status:null,busy:'',error:'',defaultRequest:0},revision:0,pending:null,timer:null};
  }
  return active;
}
function current(value:Context,revision=value.revision){return active===value&&value.scope===scope()&&value.revision===revision&&value.allowed;}
function notify(){for(const listener of listeners)listener();}
function lifecycle(){context();notify();}
function nativeChanged(){void readOfficialAccount().catch(()=>{});}
function visible(){if(document.hidden){if(active)stopTimer(active);return;}if(active?.snapshot.status&&(active.snapshot.status.state==='signing-in'||active.snapshot.status.modelsLoading))void readOfficialAccount().catch(()=>{});}
function schedule(value:Context){
  stopTimer(value);
  if(!listeners.size||!current(value)||document.hidden||!value.snapshot.status||!(value.snapshot.status.state==='signing-in'||value.snapshot.status.modelsLoading))return;
  value.timer=setTimeout(()=>{value.timer=null;void readOfficialAccount().catch(()=>{});},1800);
}

/** Drop every unrecognized field before publishing native status to UI state. */
export function readOfficialAccountStatus(value:unknown):OfficialAccountStatus{
  if(!value||typeof value!=='object')throw new Error('官方账号返回的状态不完整，请更新客户端。');
  const entry=value as Record<string,unknown>;
  if(entry.supported!==true||!['signed-out','signing-in','signed-in'].includes(entry.state as string)||typeof entry.planUsageEnabled!=='boolean'||!(entry.activeProfileId===null||bounded(entry.activeProfileId,160))||!Array.isArray(entry.profiles)||entry.profiles.length>64||!Array.isArray(entry.models)||entry.models.length>256)throw new Error('官方账号返回的状态不完整，请更新客户端。');
  const profiles=entry.profiles.map(profile=>{
    if(!profile||!bounded(profile.id,160)||!profile.id||!bounded(profile.email,320)||!bounded(profile.label,320)||typeof profile.signedIn!=='boolean'||typeof profile.planUsageEnabled!=='boolean')throw new Error('官方账号返回的状态不完整，请更新客户端。');
    return{id:profile.id as string,email:profile.email as string,label:profile.label as string,signedIn:profile.signedIn as boolean,planUsageEnabled:profile.planUsageEnabled as boolean};
  });
  const models=entry.models.map(model=>{
    if(!model||!bounded(model.id,160)||!model.id||!bounded(model.model,200)||!model.model||!bounded(model.displayName,320)||typeof model.supportsImages!=='boolean')throw new Error('官方模型目录不完整，请刷新重试。');
    return{id:model.id as string,model:model.model as string,displayName:model.displayName as string,supportsImages:model.supportsImages as boolean};
  });
  let usage:OfficialAccountUsage|undefined;
  if(entry.usage!==undefined){
    const item=entry.usage as Record<string,unknown>;
    if(!item||typeof item!=='object'||!['unverified','available','limit-reached','temporarily-unavailable','not-eligible'].includes(item.state as string)||!(item.checkedAt===null||bounded(item.checkedAt,64)&&Number.isFinite(Date.parse(item.checkedAt as string)))||!(item.lastModel===null||bounded(item.lastModel,200))||['completedRequests','inputTokens','outputTokens','totalTokens'].some(key=>!Number.isSafeInteger(item[key])||(item[key] as number)<0))throw new Error('官方用量状态不完整，请刷新重试。');
    usage={state:item.state as OfficialAccountUsage['state'],checkedAt:item.checkedAt as string|null,lastModel:item.lastModel as string|null,completedRequests:item.completedRequests as number,inputTokens:item.inputTokens as number,outputTokens:item.outputTokens as number,totalTokens:item.totalTokens as number};
  }
  return{supported:true,state:entry.state as OfficialAccountStatus['state'],activeProfileId:entry.activeProfileId as string|null,planUsageEnabled:entry.planUsageEnabled,profiles,models,...(usage?{usage}:{}),...(['browser','verifying'].includes(entry.signInStage as string)?{signInStage:entry.signInStage as 'browser'|'verifying'}:{}),...(entry.modelsLoading===true?{modelsLoading:true}:{}),...(entry.error?{error:'官方账号需要重新连接，请重试登录。'}:{}),...(entry.modelsError?{modelsError:supportsAndroidOfficialAccount()?'暂时无法连接手机官方模型，请检查网络并确认小伴服务已更新。':'暂时无法读取官方模型，请刷新重试。'}:{})};
}

export const officialAccountSnapshot=()=>context().snapshot;
export function subscribeOfficialAccount(listener:()=>void){
  listeners.add(listener);context();
  if(!listening){listening=true;window.addEventListener('petpal:session-change',lifecycle);window.addEventListener('petpal:official-native-change',nativeChanged);document.addEventListener('visibilitychange',visible);}
  return()=>{
    listeners.delete(listener);
    if(!listeners.size){if(active){stopTimer(active);active.revision++;active.pending=null;}active=undefined;window.removeEventListener('petpal:session-change',lifecycle);window.removeEventListener('petpal:official-native-change',nativeChanged);document.removeEventListener('visibilitychange',visible);listening=false;}
  };
}

export async function performOfficialAccount(action:OfficialAccountAction,input?:string):Promise<OfficialAccountStatus>{
  const owner=context();
  if(!owner.allowed||!owner.bridge)throw new Error(officialAccountIsLocal()?'请先登录这台电脑的小伴账号。':'官方账号保存在这台电脑，请先连接客户端的本机服务。');
  if(owner.pending&&action==='status')return owner.pending;
  if(owner.pending&&action!=='cancel')throw new Error('正在处理官方账号，请稍候。');
  const revision=++owner.revision;
  const previousDefault=owner.snapshot.defaultRequest;
  stopTimer(owner);
  if(action==='start'||action==='select')owner.snapshot={...owner.snapshot,defaultRequest:++defaultSequence};
  owner.snapshot={...owner.snapshot,busy:action,error:''};notify();
  const run=Promise.resolve().then(async()=>{
    try{
      const native=owner.bridge!;
      if(action==='resumeUsage'&&!native.resumeUsage)throw new Error('请更新客户端后重试。');
      const result=action==='start'?await native.start(input?{profileId:input}:undefined):action==='select'?await native.select(input||''):action==='resumeUsage'?await native.resumeUsage!():await native[action]();
      if(!current(owner,revision))throw new SessionChangedError();
      const status=readOfficialAccountStatus(result);
      owner.snapshot={...owner.snapshot,status,busy:'',error:'',...(['logout','cancel'].includes(action)?{defaultRequest:0}:{})};
      notify();return status;
    }catch(error){
      if(current(owner,revision)){owner.snapshot={...owner.snapshot,busy:'',defaultRequest:previousDefault,error:action==='start'?'无法打开官方登录，请检查网络或重试。':action==='status'?'无法读取官方账号，请刷新重试。':'官方账号操作未完成，请刷新重试。'};notify();}
      throw error instanceof SessionChangedError?error:new Error(action==='start'?'无法打开官方登录，请检查网络或重试。':'官方账号操作未完成，请刷新重试。');
    }finally{if(current(owner,revision)){owner.pending=null;schedule(owner);}}
  });
  owner.pending=run;return run;
}
export const readOfficialAccount=()=>performOfficialAccount('status');
