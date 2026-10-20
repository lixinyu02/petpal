import {mkdir,open,readFile,rename,unlink} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {nextAutomationRun} from './automation-schema.mjs';
import {companionFailure as fail,companionId as id,companionObject as object,routineFields,normalizeRoutineSettings,routineDate,validateRoutineStore,publicRoutine,publicRoutineRun} from './companion-routine-schema.mjs';
import {buildCompanionContent,searchCompanionLocations} from './companion-content.mjs';

const fields=(value,keys)=>object(value)&&Object.keys(value).every(key=>keys.includes(key));
const active=run=>run.status==='claiming';
const fresh=()=>({version:1,accounts:[]});
const cleanError=()=> '这次问候暂时未能生成，可稍后手动重试；每日计划仍会继续。';
const maxStoreBytes=8*1024*1024;

/** User-owned, read-only briefings. No shell, computer, model or Agent authority. */
export async function createCompanionRoutineService({directory,instanceId,users,clock=Date.now,buildContent=buildCompanionContent,searchLocations=searchCompanionLocations,tickMs=15000,maxLatenessMs=1800000,autoStart=true}={}){
  if(!id(instanceId)||typeof users!=='function'||!Number.isInteger(tickMs)||tickMs<1||!Number.isFinite(maxLatenessMs)||maxLatenessMs<0)throw new Error('每日陪伴服务配置无效。');
  const filename=path.join(path.resolve(directory),'companion-routines.json');
  await mkdir(path.dirname(filename),{recursive:true,mode:0o700});
  let durable={...fresh(),instanceId},queue=Promise.resolve(),closed=false,timer,ticking;
  const tasks=new Set(),controllers=new Set(),previews=new Map();
  const drain=()=>queue.catch(error=>{if(!(error?.status>=400&&error.status<500))throw error;});
  const stamp=()=>new Date(clock()).toISOString();
  const userFor=userId=>{if(closed)throw fail(503,'每日陪伴服务正在退出。');const user=users().find(item=>item.id===userId&&!item.disabled);if(!user)throw fail(401,'每日陪伴账号已失效。');return user;};
  const account=(data,userId)=>data.accounts.find(item=>item.userId===userId);
  const identity=userId=>({instanceId,userId});
  const next=(settings,after=clock())=>settings.enabled?nextAutomationRun({kind:'daily',time:settings.time,timezone:settings.timezone},after):null;
  const prune=value=>{if(value.runs.length>60){const running=value.runs.filter(active);value.runs=[...value.runs.filter(run=>!active(run)).slice(-(60-running.length)),...running];}};
  const persist=(apply,guard)=>{
    const work=queue.catch(()=>{}).then(async()=>{
      guard?.();const data=structuredClone(durable),result=apply(data);validateRoutineStore(data,instanceId);
      const serialized=JSON.stringify(data,null,2)+'\n';
      if(Buffer.byteLength(serialized)>maxStoreBytes)throw fail(507,'每日陪伴记录已达到存储上限，请保留文件并联系管理员。');
      const temporary=filename+'.'+randomUUID()+'.tmp';
      try{const file=await open(temporary,'wx',0o600);try{await file.writeFile(serialized,'utf8');await file.sync();}finally{await file.close();}guard?.();await rename(temporary,filename);durable=data;return structuredClone(result);}
      finally{await unlink(temporary).catch(()=>{});}
    });queue=work;return work;
  };
  let restored=false;
  try{const raw=await readFile(filename,'utf8');if(Buffer.byteLength(raw)>maxStoreBytes)throw new Error('每日陪伴文件过大，请保留文件检查。');durable=validateRoutineStore(JSON.parse(raw),instanceId);restored=true;}
  catch(error){if(error.code!=='ENOENT')throw error;}
  if(restored && durable.accounts.some(value=>value.runs.some(active)))await persist(data=>{for(const value of data.accounts)for(const run of value.runs)if(active(run)){run.status='cancelled';run.finishedAt=stamp();run.warnings.push('服务重启，中断的问候未重复生成或通知。');}});
  function catalog(userId){userFor(userId);const value=account(durable,userId);return {...identity(userId),routine:publicRoutine(value),runs:value?[...value.runs].reverse().map(publicRoutineRun):[]};}
  function runView(userId,runId){userFor(userId);if(!id(runId))throw fail(400,'问候记录标识无效。');const run=account(durable,userId)?.runs.find(item=>item.id===runId);if(!run)throw fail(404,'问候记录不存在。');return {...identity(userId),run:publicRoutineRun(run)};}
  async function finish(userId,runId,result){
    await persist(data=>{
      const value=account(data,userId),run=value?.runs.find(item=>item.id===runId);if(!run||!active(run))return;
      const user=users().find(item=>item.id===userId&&!item.disabled);
      run.finishedAt=stamp();
      if(closed||!user||value.revision!==run.revision){run.status='cancelled';run.warnings.push('账号或计划已变化，本次结果不再通知。');return;}
      if(!result){run.status='error';run.warnings.push(cleanError());return;}
      if(typeof result.title!=='string'||typeof result.content!=='string'||!Array.isArray(result.warnings))throw new Error('问候内容结果格式无效。');
      run.status='completed';run.title=result.title.slice(0,80).replace(/[\x00-\x1f\x7f]/g,' ');run.content=result.content.slice(0,12000);run.warnings=result.warnings.slice(0,10).map(w=>String(w).replace(/[\x00-\x1f\x7f]/g,' ').slice(0,500));
      const expires=Math.max(Date.parse(run.scheduledFor),Date.parse(run.createdAt))+6*3600000;
      // Very slow or resumed work must not revive a stale weather notification.
      if(run.snapshot.notify&&expires>clock()){
        if(value.highWater===Number.MAX_SAFE_INTEGER)throw new Error('每日陪伴通知序列已达到上限。');
        run.seq=++value.highWater;run.validUntil=new Date(expires).toISOString();
        run.body=run.snapshot.notificationPreview?String(result.body||result.title).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,' ').slice(0,240):'你的每日问候已准备好，点击查看。';
      }
    });
  }
  function launch(userId,runId){
    const task=(async()=>{
      const run=account(durable,userId)?.runs.find(item=>item.id===runId&&active(item));if(!run||closed)return;
      const controller=new AbortController();controllers.add(controller);
      try{const user=userFor(userId);const result=await buildContent(structuredClone(run.snapshot),{userId,now:new Date(run.scheduledFor),displayName:user.displayName,signal:controller.signal});await finish(userId,runId,result);}
      catch{await finish(userId,runId,null);}
      finally{controllers.delete(controller);}
    })();tasks.add(task);void task.finally(()=>tasks.delete(task)).catch(()=>{});return task;
  }
  function claim(value,trigger,scheduledFor,requestId,skip){
    const run={id:randomUUID(),...(requestId?{requestId}:{}),revision:value.revision,snapshot:structuredClone(value.settings),status:skip?'skipped':'claiming',trigger,scheduledFor,localDate:routineDate(scheduledFor,value.settings.timezone),createdAt:stamp(),warnings:skip?[skip]:[]};
    if(skip)run.finishedAt=stamp();value.runs.push(run);prune(value);return run;
  }
  async function tick(){
    if(closed)return;if(ticking)return ticking;
    ticking=(async()=>{
      const due=durable.accounts.filter(value=>value.settings.enabled&&Date.parse(value.nextRunAt)<=clock()).slice(0,20);
      for(const item of due){
        if(closed)break;let launchId;
        await persist(data=>{
          const value=account(data,item.userId);if(!value?.settings.enabled||Date.parse(value.nextRunAt)>clock())return;
          const scheduledFor=value.nextRunAt,user=users().find(entry=>entry.id===value.userId&&!entry.disabled),date=routineDate(scheduledFor,value.settings.timezone);
          const duplicate=value.runs.some(run=>run.trigger==='scheduled'&&run.localDate===date);
          const skip=!user?'账号已停用，本次问候跳过。':duplicate?'今天的定时问候已处理。':value.runs.some(active)?'上一次问候尚未结束，本次跳过。':tasks.size>=4?'问候服务繁忙，本次跳过。':clock()-Date.parse(scheduledFor)>maxLatenessMs?'已错过本次问候时间，不补发过期天气。':null;
          value.nextRunAt=next(value.settings);
          if(!duplicate){const run=claim(value,'scheduled',scheduledFor,undefined,skip);if(!skip)launchId=run.id;}
        });
        if(launchId)void launch(item.userId,launchId);
      }
    })().finally(()=>{ticking=undefined;});return ticking;
  }
  const service={
    catalog,runView,tick,
    async configure(userId,body,{guard}={}){
      userFor(userId);
      if(!fields(body,[...routineFields,'revision'])||!Object.hasOwn(body,'revision')||body.revision!==null&&!id(body.revision))throw fail(400,'每日陪伴 revision 无效。');
      const {revision,...raw}=body,settings=normalizeRoutineSettings(raw);
      await persist(data=>{
        userFor(userId);let value=account(data,userId);
        if((value?.revision??null)!==revision)throw fail(409,'每日陪伴计划已变化，请重新读取后再保存。');
        if(!value){value={userId,revision:randomUUID(),settings,nextRunAt:null,highWater:0,runs:[]};data.accounts.push(value);}
        value.settings=settings;value.revision=randomUUID();value.nextRunAt=next(settings);
        for(const run of value.runs)if(active(run)){run.status='cancelled';run.finishedAt=stamp();run.warnings.push('计划已修改或暂停，本次问候取消。');}
      },guard);return catalog(userId);
    },
    async run(userId,body,{guard}={}){
      userFor(userId);if(!fields(body,['requestId'])||!id(body.requestId))throw fail(400,'试运行需要唯一 requestId。');
      let runId,created=false;
      await persist(data=>{
        userFor(userId);const value=account(data,userId);if(!value)throw fail(400,'请先保存每日陪伴设置。');
        const previous=value.runs.find(run=>run.requestId===body.requestId);if(previous){runId=previous.id;return;}
        if(value.runs.some(active)||tasks.size>=4)throw fail(409,'问候正在生成，请等待当前结果。');
        const last=[...value.runs].reverse().find(run=>run.trigger==='manual');
        if(last&&clock()-Date.parse(last.createdAt)<5000)throw fail(429,'请稍等几秒再试运行。');
        const run=claim(value,'manual',stamp(),body.requestId);runId=run.id;created=true;
      },guard);if(created)void launch(userId,runId);return runView(userId,runId);
    },
    async preview(userId,body){
      const user=userFor(userId),settings=normalizeRoutineSettings(body);
      if(previews.has(userId)||previews.size>=4)throw fail(429,'预览正在生成，请稍候。');
      const controller=new AbortController();previews.set(userId,controller);controllers.add(controller);
      try{const result=await buildContent(settings,{userId,now:new Date(clock()),displayName:user.displayName,signal:controller.signal});userFor(userId);return {...identity(userId),...result};}
      finally{previews.delete(userId);controllers.delete(controller);}
    },
    async locations(userId,query){
      userFor(userId);if(typeof query!=='string'||!query.trim()||query.length>80||/[\x00-\x1f\x7f]/.test(query))throw fail(400,'请输入1到80字的天气地点。');
      if(previews.has(userId)||previews.size>=4)throw fail(429,'地点搜索繁忙，请稍候。');
      const controller=new AbortController();previews.set(userId,controller);controllers.add(controller);
      try{const locations=await searchLocations(query.trim(),{signal:controller.signal});userFor(userId);return {...identity(userId),locations};}
      finally{previews.delete(userId);controllers.delete(controller);}
    },
    feed(userId,query={}){
      userFor(userId);if(!fields(query,['after','limit']))throw fail(400,'每日陪伴通知查询字段无效。');
      const value=account(durable,userId),highWater=value?.highWater??0;
      const parse=(raw,fallback,max)=>{if(raw===undefined)return fallback;if(typeof raw!=='string'||!/^\d{1,16}$/.test(raw)||!Number.isSafeInteger(Number(raw))||Number(raw)>max)throw fail(400,'每日陪伴通知游标无效。');return Number(raw);};
      const after=parse(query.after,highWater,Number.MAX_SAFE_INTEGER),limit=parse(query.limit,20,20);if(limit<1)throw fail(400,'通知数量无效。');
      const all=(value?.runs??[]).filter(run=>run.seq!==undefined).sort((a,b)=>a.seq-b.seq),minCursor=all[0]?all[0].seq-1:highWater;
      const resetRequired=query.after===undefined||after<minCursor||after>highWater;
      const events=resetRequired?[]:all.filter(run=>run.seq>after).slice(0,limit).map(run=>({seq:run.seq,id:run.id,runId:run.id,createdAt:run.finishedAt,validUntil:run.validUntil,title:run.title,body:run.body}));
      return {...identity(userId),events,nextCursor:resetRequired?highWater:events.at(-1)?.seq??after,highWater,minCursor,resetRequired};
    },
    async settle(){await drain();await Promise.allSettled([...tasks]);await drain();},
    async start(){if(closed||timer)return;await tick();if(!closed){timer=setInterval(()=>void tick().catch(()=>{}),tickMs);timer.unref?.();}},
    async close(){closed=true;clearInterval(timer);for(const controller of controllers)controller.abort();await ticking;await Promise.allSettled([...tasks]);await drain();},
  };
  if(autoStart)await service.start();
  return service;
}
