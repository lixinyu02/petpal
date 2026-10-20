import { normalizeAutomationSchedule } from './automation-schema.mjs';

export const companionFailure = (status, message) => Object.assign(new Error(message), { status });
export const companionObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const companionId = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export const routineFields = ['enabled','time','timezone','includeWeather','location','includeHolidays','birthday','notify','notificationPreview','tone'];
const ownFields = (value, fields) => companionObject(value) && Object.keys(value).every(key => fields.includes(key));
const text = (value, maximum) => typeof value === 'string' && value.length > 0 && value.length <= maximum && !/[\x00-\x1f\x7f]/.test(value);
export const routineDefaults = () => ({enabled:false,time:'08:00',timezone:'Asia/Shanghai',includeWeather:false,location:null,includeHolidays:true,birthday:null,notify:true,notificationPreview:false,tone:'gentle'});

export function normalizeRoutineSettings(input) {
  if (!ownFields(input, routineFields) || Object.keys(input).length !== routineFields.length) throw companionFailure(400,'每日陪伴配置字段无效。');
  for (const key of ['enabled','includeWeather','includeHolidays','notify','notificationPreview']) if (typeof input[key] !== 'boolean') throw companionFailure(400,'每日陪伴开关需要布尔值。');
  if (!text(input.timezone,100)) throw companionFailure(400,'请选择有效的时区。');
  normalizeAutomationSchedule({kind:'daily',time:input.time,timezone:input.timezone});
  if (!['gentle','brief'].includes(input.tone)) throw companionFailure(400,'问候语气无效。');
  if (input.birthday !== null) {
    if (typeof input.birthday !== 'string' || !/^\d{2}-\d{2}$/.test(input.birthday)) throw companionFailure(400,'生日格式为 MM-DD。');
    const date = new Date('2000-'+input.birthday+'T12:00:00Z');
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(5,10) !== input.birthday) throw companionFailure(400,'生日日期无效。');
  }
  if (input.location !== null) {
    const place=input.location;
    if (!ownFields(place,['id','name','fullName','province','city','sourceUrl']) || !/^101\d{6}(?:\d{3})?$/.test(place.id) || !text(place.name,100) || !text(place.fullName,300) || !text(place.sourceUrl,2048) || ['province','city'].some(key=>place[key]!==undefined&&!text(place[key],100))) throw companionFailure(400,'请从搜索结果选择天气地点。');
    let url; try { url=new URL(place.sourceUrl); } catch { throw companionFailure(400,'天气地点来源无效。'); }
    if (!['http:','https:'].includes(url.protocol) || !['www.weather.com.cn','forecast.weather.com.cn'].includes(url.hostname) || url.username || url.password || url.port || url.hash) throw companionFailure(400,'天气地点来源必须是中国天气网。');
  }
  if (input.includeWeather && !input.location) throw companionFailure(400,'请先搜索并确认天气地点。');
  return structuredClone(input);
}

export function routineDate(instant, timezone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(instant)).map(p=>[p.type,p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

const iso = value => typeof value==='string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value));
export function validateRoutineStore(data, instanceId) {
  const invalid=()=>{throw new Error('每日陪伴数据无效，请保留 companion-routines.json 并检查备份。');};
  if (!ownFields(data,['version','instanceId','accounts']) || data.version!==1 || data.instanceId!==instanceId || !Array.isArray(data.accounts) || data.accounts.length>10000) invalid();
  const users=new Set();
  for(const account of data.accounts){
    if(!ownFields(account,['userId','revision','settings','nextRunAt','highWater','runs']) || !companionId(account.userId) || users.has(account.userId) || !companionId(account.revision) || !Number.isSafeInteger(account.highWater)||account.highWater<0||!Array.isArray(account.runs)||account.runs.length>60 || account.nextRunAt!==null&&!iso(account.nextRunAt))invalid();
    users.add(account.userId);try{normalizeRoutineSettings(account.settings);}catch{invalid();}
    if(account.settings.enabled !== (account.nextRunAt!==null))invalid();
    const ids=new Set(), requests=new Set(), sequences=new Set();
    for(const run of account.runs){
      if(!ownFields(run,['id','requestId','revision','snapshot','status','trigger','scheduledFor','localDate','createdAt','finishedAt','title','content','warnings','body','seq','validUntil']) || !companionId(run.id)||ids.has(run.id)||!companionId(run.revision)||!['claiming','completed','error','cancelled','skipped'].includes(run.status)||!['manual','scheduled'].includes(run.trigger)||!iso(run.scheduledFor)||!iso(run.createdAt)||!/^\d{4}-\d{2}-\d{2}$/.test(run.localDate)||run.finishedAt!==undefined&&!iso(run.finishedAt))invalid();
      ids.add(run.id);try{normalizeRoutineSettings(run.snapshot);}catch{invalid();}
      if(run.requestId!==undefined){if(!companionId(run.requestId)||requests.has(run.requestId))invalid();requests.add(run.requestId);}
      if(run.status==='claiming' && run.finishedAt!==undefined || run.status!=='claiming'&&!iso(run.finishedAt))invalid();
      if(run.title!==undefined&&!text(run.title,80)||run.content!==undefined&&(typeof run.content!=='string'||run.content.length>12000)||!Array.isArray(run.warnings)||run.warnings.length>10||run.warnings.some(value=>!text(value,500)))invalid();
      if(run.seq!==undefined){if(run.status!=='completed'||!Number.isSafeInteger(run.seq)||run.seq<1||run.seq>account.highWater||sequences.has(run.seq)||!text(run.title,80)||typeof run.body!=='string'||run.body.length>240||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(run.body)||!iso(run.validUntil)||Date.parse(run.validUntil)<=Date.parse(run.finishedAt))invalid();sequences.add(run.seq);}
    }
  }
  return data;
}

export function publicRoutine(account) {return {...structuredClone(account?.settings??routineDefaults()),revision:account?.revision??null,nextRunAt:account?.nextRunAt??null};}
export function publicRoutineRun(run){const {snapshot,revision,...result}=structuredClone(run);return result;}
