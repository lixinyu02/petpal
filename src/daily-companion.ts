export type CompanionLocation={id:string;name:string;fullName:string;province?:string;city?:string;sourceUrl:string};
export type CompanionRoutineSettings={enabled:boolean;time:string;timezone:string;includeWeather:boolean;location:CompanionLocation|null;includeHolidays:boolean;birthday:string|null;notify:boolean;notificationPreview:boolean;tone:'gentle'|'brief'};
export type CompanionRoutine=CompanionRoutineSettings&{revision:string|null;nextRunAt:string|null};
export type CompanionRoutineRun={id:string;status:string;trigger:'manual'|'scheduled';scheduledFor:string;createdAt:string;finishedAt?:string|null;content?:string;title?:string;warnings?:string[];validUntil?:string|null};
export type CompanionRoutineCatalog={routine:CompanionRoutine;runs:CompanionRoutineRun[];instanceId:string;userId:string};
export type CompanionRoutinePreview={title:string;content:string;warnings:string[]};

export function defaultCompanionSettings():CompanionRoutineSettings{
  return {enabled:false,time:'08:00',timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'Asia/Shanghai',includeWeather:false,location:null,includeHolidays:true,birthday:null,notify:false,notificationPreview:false,tone:'gentle'};
}

/** Pick the complete wire settings so revision and response metadata never leak into previews. */
export function companionSettings(value:CompanionRoutineSettings):CompanionRoutineSettings{
  return {enabled:value.enabled,time:value.time,timezone:value.timezone,includeWeather:value.includeWeather,location:value.location?{id:value.location.id,name:value.location.name,fullName:value.location.fullName,...(value.location.province?{province:value.location.province}:{}),...(value.location.city?{city:value.location.city}:{}),sourceUrl:value.location.sourceUrl}:null,includeHolidays:value.includeHolidays,birthday:value.birthday||null,notify:value.notify,notificationPreview:value.notificationPreview,tone:value.tone};
}

export function companionSettingsEqual(a:CompanionRoutineSettings,b:CompanionRoutineSettings){return JSON.stringify(companionSettings(a))===JSON.stringify(companionSettings(b));}

export function companionSettingsIssue(value:CompanionRoutineSettings):string{
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(value.time))return '请选择有效的每日时间。';
  try{if(!value.timezone.trim()||value.timezone.length>100)throw Error();new Intl.DateTimeFormat('zh-CN',{timeZone:value.timezone});}catch{return '请输入有效的时区，例如 Asia/Shanghai。';}
  if(value.includeWeather&&(!value.location?.id||!value.location.fullName))return '请搜索天气地点，并明确选中一个候选地点。';
  if(value.birthday){const match=/^(\d{2})-(\d{2})$/.exec(value.birthday);if(!match)return '生日请填写月-日，例如 10-20。';const month=Number(match[1]),day=Number(match[2]),date=new Date(Date.UTC(2000,month-1,day));if(date.getUTCMonth()!==month-1||date.getUTCDate()!==day)return '请填写有效的生日日期。';}
  if(!['gentle','brief'].includes(value.tone))return '请选择问候语气。';
  return '';
}

export const companionRunPending=(run:CompanionRoutineRun)=>['claiming','queued','running'].includes(run.status);
export const companionRunLabel=(status:string)=>({claiming:'正在准备',queued:'等待生成',running:'正在生成',completed:'已生成',error:'生成失败',cancelled:'已取消',skipped:'已跳过',unknown:'状态待确认'} as Record<string,string>)[status]||'状态待确认';
export function companionDate(value?:string|null){if(!value)return '暂无';const date=new Date(value);return Number.isFinite(date.getTime())?date.toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'时间无效';}

export function readCompanionRequest(storage:Pick<Storage,'getItem'>|undefined,scope:string):string|null{
  try{const request=storage?.getItem(`petpal.companion-request:${scope}`);return request&&/^[a-zA-Z0-9-]{16,100}$/.test(request)?request:null;}catch{return null;}
}
export function saveCompanionRequest(storage:Pick<Storage,'setItem'|'removeItem'>|undefined,scope:string,requestId:string|null){
  try{const key=`petpal.companion-request:${scope}`;if(requestId)storage?.setItem(key,requestId);else storage?.removeItem(key);}catch{/* The same request remains in the mounted view even if storage is unavailable. */}
}
