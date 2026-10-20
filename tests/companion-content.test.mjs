import test from 'node:test';
import assert from 'node:assert/strict';
import {lstat} from 'node:fs/promises';
import path from 'node:path';
import {buildCompanionContent,searchCompanionLocations} from '../server/companion-content.mjs';
import {queryCompanionWeather,closeCompanionWeatherQueries} from '../server/companion-weather.mjs';
import {parseCountyForecast,parseTownForecast} from '../server/opencli-weather-cn.mjs';

const TOWN='101020600001',COUNTY='101020600';
const townUrl=`https://forecast.weather.com.cn/town/weathern/${TOWN}.shtml`,countyUrl=`https://www.weather.com.cn/weather/${COUNTY}.shtml`;
const NOW=new Date('2026-10-20T02:00:00Z');
const location={id:TOWN,name:'北蔡镇',fullName:'上海市 / 浦东新区 / 北蔡镇',province:'上海市',city:'浦东新区',sourceUrl:townUrl};
const settings={timezone:'Asia/Shanghai',includeWeather:false,includeHolidays:true,birthday:'',tone:'gentle',location};
const result=(command,rows)=>({site:'weathercn',command,version:'1.8.8',rows,count:rows.length});
const atDate=date=>new Date(date+'T04:00:00Z');
const nextDay=(base,index)=>new Date(Date.parse(base+'T12:00:00Z')+index*86400000).toISOString().slice(0,10);
const parent={location_id:COUNTY,name:'浦东新区',province:'上海市',city:'上海市',full_name:'上海市 / 浦东新区'};
function countyPayload(){
  const days=Array.from({length:7},(_,index)=>`<li class="sky skyid"><h1>${Number(nextDay('2026-10-20',index).slice(-2))}日</h1><p class="wea">多云</p><p class="tem"><span>21℃</span><i>11℃</i></p><p class="win"><span title="北风"></span><i>&lt;3级</i></p></li>`).join('');
  return parseCountyForecast(`<title>浦东新区天气预报</title><a href="/weather/${COUNTY}.shtml">7天</a><input id="fc_24h_internal_update_time" value="2026102008"><div id="7d"><ul>${days}</ul></div>`,parent,NOW);
}
function townPayload(){
  const start=Date.parse('2026-10-20T08:00:00+08:00');
  const compact=instant=>new Date(instant+8*3600000).toISOString().slice(0,13).replace(/[-T]/g,'');
  const raw=Array.from({length:7},(_,index)=>Array.from({length:8},(_,hour)=>({jf:compact(start+(index*24+hour*3)*3600000),ja:'00',jb:20,jc:'0',jd:'8'})));
  const dates=Array.from({length:8},(_,index)=>`<li class="date-item"><p class="date">${Number(nextDay('2026-10-20',index-1).slice(-2))}日</p></li>`).join('');
  const days=Array.from({length:8},(_,index)=>`<li class="blue-item${index?'':' yesterday'}"><p class="weather-info" title="晴"></p><span class="wind-icon n" title="北风"></span></li>`).join('');
  const html=`<title>浦东新区北蔡镇天气预报</title><a href="/town/weathern/${TOWN}.shtml">7天</a><script>var villages=${JSON.stringify([{id:TOWN,name:'北蔡镇'}])};var hour3data=${JSON.stringify(raw)};var eventDay=${JSON.stringify([99,21,22,23,24,25,26,27])};var eventNight=${JSON.stringify([98,11,12,13,14,15,16,17])};</script><ul>${dates}</ul><ul>${days}</ul>`;
  return parseTownForecast(html,parent,TOWN,NOW);
}

test('search returns every explicitly confirmable candidate without selecting one or accepting arbitrary sources',async()=>{
  const calls=[];
  const rows=[{location_id:TOWN,name:'北蔡镇',full_name:location.fullName,province:'上海市',parent_name:'浦东新区',source_url:townUrl},
    {location_id:COUNTY,name:'浦东新区',full_name:parent.full_name,province:'上海市',city:'上海市',source_url:countyUrl}];
  const found=await searchCompanionLocations('北蔡',{weatherQuery:async(request,opts)=>{calls.push({request,opts});return result('search',rows);}});
  assert.equal(found.length,2);assert.deepEqual(found[0],location);assert.equal(found[1].id,COUNTY);
  assert.ok(found.every(row=>!Object.hasOwn(row,'selected')));assert.deepEqual(calls[0].request,{site:'weathercn',command:'search',arguments:{query:'北蔡',limit:10}});
  await assert.rejects(searchCompanionLocations('北蔡',{weatherQuery:async()=>result('search',[{...rows[0],source_url:'https://untrusted.example/weather'}])}),/身份/);
  await assert.rejects(searchCompanionLocations('北蔡',{weatherQuery:async()=>result('forecast',rows)}),/格式/);
});

test('search filters are bounded before any query and empty result remains an empty candidate list',async()=>{
  let calls=0;const weatherQuery=async()=>{calls++;return result('search',[]);};
  await assert.rejects(searchCompanionLocations(' ',{weatherQuery}),/地点/);
  await assert.rejects(searchCompanionLocations('北蔡',{limit:21,weatherQuery}),/候选/);
  await assert.rejects(searchCompanionLocations('北蔡',{city:'',weatherQuery}),/过滤/);assert.equal(calls,0);
  assert.deepEqual(await searchCompanionLocations('无结果',{weatherQuery}),[]);assert.equal(calls,1);
});

for(const [date,holiday] of [['2024-02-10','春节'],['2025-01-29','春节'],['2026-02-17','春节'],['2026-03-03','元宵节'],['2026-06-19','端午节'],['2026-08-19','七夕'],['2026-09-25','中秋节'],['2026-10-18','重阳节'],['2024-02-09','除夕'],['2026-02-16','除夕']]){
  test(`Chinese calendar recognises ${date} ${holiday}, including 29 and 30 day New Year eves`,async()=>{
    const content=await buildCompanionContent(settings,{now:atDate(date)});
    assert.match(content.content,new RegExp(`今天是[^。]*${holiday}`));assert.match(content.content,/不代表放假或调休/);assert.deepEqual(content.warnings,[]);
  });
}

test('leap fifth month never repeats Dragon Boat while the regular fifth month does',async()=>{
  const leap=await buildCompanionContent(settings,{now:atDate('2009-06-27')});
  const leap2=await buildCompanionContent(settings,{now:atDate('2028-06-27')});
  const regular=await buildCompanionContent(settings,{now:atDate('2009-05-28')});
  assert.doesNotMatch(leap.content,/端午|节日快乐/);assert.doesNotMatch(leap2.content,/端午/);assert.match(regular.content,/端午节/);
});

test('festival boundaries follow the selected civil timezone rather than UTC or the server timezone',async()=>{
  const now=new Date('2026-02-16T16:30:00Z');
  const china=await buildCompanionContent(settings,{now});
  const newYork=await buildCompanionContent({...settings,timezone:'America/New_York'},{now});
  assert.match(china.content,/春节/);assert.doesNotMatch(china.content,/除夕/);
  assert.match(newYork.content,/除夕/);assert.doesNotMatch(newYork.content,/春节/);
  const yearBoundary=await buildCompanionContent(settings,{now:new Date('2026-12-31T16:01:00Z')});assert.match(yearBoundary.content,/2027 年 1 月 1 日/);assert.match(yearBoundary.content,/元旦/);
});

test('birthdays are exact MM-DD, do not shift Feb 29, and can coexist with lunar and solar holidays',async()=>{
  const leap=await buildCompanionContent({...settings,birthday:'02-29'},{now:atDate('2024-02-29'),displayName:'小明'});assert.equal(leap.title,'生日快乐');assert.match(leap.content,/小明/);
  for(const date of ['2025-02-28','2025-03-01'])assert.doesNotMatch((await buildCompanionContent({...settings,birthday:'02-29'},{now:atDate(date)})).content,/生日快乐/);
  const both=await buildCompanionContent({...settings,birthday:'10-01'},{now:atDate('2020-10-01')});assert.match(both.content,/国庆节/);assert.match(both.content,/中秋节/);assert.match(both.content,/生日快乐/);
  const noCalendar=await buildCompanionContent({...settings,includeHolidays:false,birthday:'10-01',tone:'brief'},{now:atDate('2020-10-01')});assert.doesNotMatch(noCalendar.content,/国庆|中秋/);assert.match(noCalendar.content,/生日快乐/);
});

test('real county adapter shape uses today only and retains published time and the official source',async()=>{
  const selected={id:COUNTY,name:'浦东新区',fullName:parent.full_name,sourceUrl:countyUrl};
  const calls=[],payload=countyPayload();
  const content=await buildCompanionContent({...settings,includeWeather:true,location:selected},{now:NOW,weatherQuery:async request=>{calls.push(request);return result('forecast',[payload]);}});
  assert.match(content.content,/11～21℃/);assert.match(content.content,/多云/);assert.match(content.content,/2026\/10\/20 08:00/);assert.ok(content.content.includes(countyUrl));assert.deepEqual(content.warnings,[]);
  assert.deepEqual(calls,[{site:'weathercn',command:'forecast',arguments:{location_id:COUNTY}}]);
});

test('real town adapter shape retains unknown freshness and explicit forecast gaps without fabricating hourly conditions',async()=>{
  const payload=townPayload();payload.intervals.coverage='gapped';payload.intervals.coverage_gaps=[{after:'2026-10-20T11:00:00+08:00',before:'2026-10-20T20:00:00+08:00',duration_hours:9}];
  const content=await buildCompanionContent({...settings,includeWeather:true},{now:NOW,weatherQuery:async()=>result('forecast',[payload])});
  assert.match(content.content,/11～21℃/);assert.match(content.content,/发布时间：未知/);assert.match(content.content,/无法确认新鲜度/);assert.match(content.content,/分时预报存在缺口/);
  assert.match(content.content,/11:00 至 2026\/10\/20 20:00/);assert.match(content.content,/未插值/);assert.match(content.content,/不代表小区或门牌实况/);assert.ok(content.content.includes(townUrl));
  assert.doesNotMatch(content.content,/最新实况|缺口内.*晴/);
});

test('missing today, expired and future source times never become a fabricated current forecast',async()=>{
  for(const kind of ['missing','expired','future']){
    const payload=countyPayload();
    if(kind==='missing')payload.daily.entries=payload.daily.entries.slice(1);
    if(kind==='expired')payload.daily.published_at='2026-10-18T08:00:00+08:00';
    if(kind==='future')payload.daily.published_at='2026-10-21T08:00:00+08:00';
    const content=await buildCompanionContent({...settings,includeWeather:true,location:{id:COUNTY,name:'浦东新区',fullName:parent.full_name}},{now:NOW,weatherQuery:async()=>result('forecast',[payload])});
    assert.doesNotMatch(content.content,/11～21℃|今日地点预报：/);assert.ok(content.warnings.length);assert.ok(content.content.includes(countyUrl));assert.match(content.content,/数据发布时间/);
  }
});

test('query failure, wrong identity, empty responses and missing location retain a greeting and never echo secrets',async()=>{
  for(const weatherQuery of [async()=>{throw Error('Authorization=secret-token');},async()=>result('forecast',[]),async()=>result('forecast',[{...townPayload(),location:{...townPayload().location,location_id:COUNTY}}])]){
    const content=await buildCompanionContent({...settings,includeWeather:true},{now:NOW,weatherQuery});
    assert.match(content.content,/早上好/);assert.match(content.content,/天气暂时查询失败/);assert.doesNotMatch(content.content,/secret-token|11～21℃/);assert.ok(content.content.includes(townUrl));
  }
  let calls=0;const content=await buildCompanionContent({...settings,includeWeather:true,location:null},{now:NOW,weatherQuery:async()=>{calls++;}});assert.equal(calls,0);assert.match(content.content,/还没有确认天气地点/);
});

test('null and inverted temperatures do not become zero or a reversed range, and disabled weather makes no network call',async()=>{
  const payload=townPayload();payload.daily[0]={...payload.daily[0],low_c:null,high_c:null};
  const missing=await buildCompanionContent({...settings,includeWeather:true},{now:NOW,weatherQuery:async()=>result('forecast',[payload])});assert.doesNotMatch(missing.content,/0℃|null/);
  payload.daily[0].low_c=30;payload.daily[0].high_c=10;
  const reversed=await buildCompanionContent({...settings,includeWeather:true},{now:NOW,weatherQuery:async()=>result('forecast',[payload])});assert.doesNotMatch(reversed.content,/30～10℃/);
  await buildCompanionContent(settings,{now:NOW,weatherQuery:async()=>assert.fail('disabled weather cannot query')});
});

test('cancellation propagates instead of committing a degraded notification',async()=>{
  const abort=new AbortController();
  await assert.rejects(buildCompanionContent({...settings,includeWeather:true},{now:NOW,signal:abort.signal,weatherQuery:async()=>{abort.abort();return result('forecast',[townPayload()]);}}),{name:'AbortError'});
  await assert.rejects(searchCompanionLocations('北蔡',{signal:abort.signal,weatherQuery:async()=>assert.fail('aborted search')}),{name:'AbortError'});
});

test('fixed copy has bounded plain notification text and escapes user display markup without any model dependency',async()=>{
  const content=await buildCompanionContent({...settings,tone:'brief'},{now:NOW,displayName:'<script> [测试](url) **你好**'});
  assert.match(content.content,/\\<script\\>/);assert.equal(typeof content.body,'string');assert.ok(content.body.length<=280);assert.ok(content.title.length<=120);assert.doesNotMatch(content.body,/^###/);assert.match(content.content,/小伴来向你问好/);
});

test('weather wrapper uses a new enabled-default scope, fixed worker requests and confirmed cleanup without changing user configuration',async()=>{
  let captured,closed=0,calls=0;
  const reply=await queryCompanionWeather({site:'weathercn',command:'search',arguments:{query:'北蔡',limit:10}},{managerFactory:options=>{captured=options;return {query:async request=>{calls++;assert.equal(request.site,'weathercn');return result('search',[]);},close:async()=>{closed++;}};}});
  assert.equal(reply.count,0);assert.equal(calls,1);assert.equal(closed,1);assert.equal(captured.scope,'daily-companion-weather');assert.ok(path.basename(captured.dataDir).startsWith('petpal-companion-weather-'));assert.equal(captured.timeoutMs,20000);
  await assert.rejects(lstat(captured.dataDir),{code:'ENOENT'});
  await assert.rejects(queryCompanionWeather({site:'github',command:'search',arguments:{query:'x'}},{managerFactory:()=>assert.fail('unsupported source must not launch')}),/固定/);
  await assert.rejects(queryCompanionWeather({site:'weathercn',command:'forecast',arguments:{location_id:TOWN,url:'http://127.0.0.1'}}),/参数|字段/);
});

test('an unconfirmed weather worker close retains its identity and blocks new launches until explicit cleanup',async()=>{
  let directory,canClose=false,closes=0;
  await assert.rejects(queryCompanionWeather({site:'weathercn',command:'search',arguments:{query:'北蔡',limit:10}},{managerFactory:options=>{directory=options.dataDir;return{query:async()=>result('search',[]),close:async()=>{closes++;if(!canClose)throw Error('unconfirmed');}};}}),/收尾未确认/);
  assert.ok((await lstat(directory)).isDirectory());
  await assert.rejects(queryCompanionWeather({site:'weathercn',command:'search',arguments:{query:'北蔡',limit:10}},{managerFactory:()=>assert.fail('must retain previous exact manager')}),/尚未确认退出/);
  canClose=true;await closeCompanionWeatherQueries();assert.equal(closes,2);await assert.rejects(lstat(directory),{code:'ENOENT'});
});
