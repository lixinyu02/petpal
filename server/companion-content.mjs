import { queryCompanionWeather } from './companion-weather.mjs';
import { weatherFreshness } from './opencli-weather-common.mjs';

const clean = (value, limit = 160) => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit) : '';
const markdown = value => clean(value, 600).replace(/[\\`*_{}\[\]<>#|]/g, '\\$&');
const locationId = value => typeof value === 'string' && /^101\d{6}(?:\d{3})?$/.test(value);
const sourceUrl = id => id.length === 12 ? `https://forecast.weather.com.cn/town/weathern/${id}.shtml` : `https://www.weather.com.cn/weather/${id}.shtml`;
const failure = message => Object.assign(new Error(message), { status: 400 });
const dateParts = (now, timezone) => Object.fromEntries(new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
  timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
}).formatToParts(now).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
const isoDate = parts => `${parts.year}-${parts.month}-${parts.day}`;
const dateTime = (value, timezone) => {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return '未知';
  return new Intl.DateTimeFormat('zh-CN', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value));
};

function queryRows(result, command) {
  if (!result || result.site !== 'weathercn' || result.command !== command || !Array.isArray(result.rows) || result.rows.length > 50 || result.count !== result.rows.length) throw new Error('官方天气返回格式无效。');
  return result.rows;
}

/** Every returned candidate requires the user's explicit confirmation. */
export async function searchCompanionLocations(query, { signal, weatherQuery = queryCompanionWeather, province, city, limit = 10 } = {}) {
  signal?.throwIfAborted();
  if (typeof query !== 'string' || !query.trim() || query.length > 80 || /[\x00-\x1f\x7f]/.test(query) || !Number.isInteger(limit) || limit < 1 || limit > 20) throw failure('请填写 1 到 80 字的具体天气地点，候选数量为 1 到 20。');
  for (const value of [province, city]) if (value !== undefined && (typeof value !== 'string' || !value.trim() || value.length > 80 || /[\x00-\x1f\x7f]/.test(value))) throw failure('天气省市过滤条件无效。');
  const request = { site: 'weathercn', command: 'search', arguments: { query: query.trim(), ...(province ? { province: province.trim() } : {}), ...(city ? { city: city.trim() } : {}), limit } };
  const rows = queryRows(await weatherQuery(request, { signal }), 'search');
  signal?.throwIfAborted();
  const ids = new Set();
  return rows.map(row => {
    const id = row?.location_id, name = clean(row?.name, 80), fullName = clean(row?.full_name, 240);
    if (!locationId(id) || !name || !fullName || ids.has(id) || row.source_url !== sourceUrl(id)) throw new Error('官方地点候选缺少可确认的地点身份，请重新搜索。');
    ids.add(id);
    return { id, name, fullName, ...(clean(row.province, 80) ? { province: clean(row.province, 80) } : {}),
      ...(clean(row.city || row.parent_name, 80) ? { city: clean(row.city || row.parent_name, 80) } : {}), sourceUrl: sourceUrl(id) };
  }).slice(0, limit);
}

const solarHolidays = new Map([
  ['01-01', '元旦'], ['02-14', '情人节'], ['03-08', '妇女节'], ['03-12', '植树节'],
  ['05-01', '劳动节'], ['05-04', '青年节'], ['06-01', '儿童节'], ['09-10', '教师节'],
  ['10-01', '国庆节'], ['12-25', '圣诞节'],
]);
const lunarHolidays = new Map([['1-1', '春节'], ['1-15', '元宵节'], ['5-5', '端午节'], ['7-7', '七夕'], ['8-15', '中秋节'], ['9-9', '重阳节']]);
function lunarParts(civil) {
  const formatter = new Intl.DateTimeFormat('en-US-u-ca-chinese-nu-latn', { timeZone: 'UTC', year: 'numeric', month: 'numeric', day: 'numeric' });
  if (formatter.resolvedOptions().calendar !== 'chinese') throw new Error('农历支持不可用。');
  const parts = Object.fromEntries(formatter.formatToParts(civil).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  const month = /^(\d{1,2})(bis)?$/.exec(parts.month || '');
  if (!month || !/^\d{1,2}$/.test(parts.day || '')) throw new Error('农历日期格式不可用。');
  return { month: Number(month[1]), day: Number(parts.day), leap: !!month[2] };
}
function holidaysFor(parts, warnings) {
  const holidays = [], key = `${parts.month}-${parts.day}`;
  if (solarHolidays.has(key)) holidays.push(solarHolidays.get(key));
  // A civil date is converted at UTC noon, independently of the user's DST
  // offset. The Gregorian date has already been resolved in their chosen zone.
  const civil = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), 12));
  const weekday = civil.getUTCDay(), day = Number(parts.day);
  if (parts.month === '05' && weekday === 0 && day >= 8 && day <= 14) holidays.push('母亲节');
  if (parts.month === '06' && weekday === 0 && day >= 15 && day <= 21) holidays.push('父亲节');
  try {
    const lunar = lunarParts(civil);
    if (!lunar.leap) {
      const holiday = lunarHolidays.get(`${lunar.month}-${lunar.day}`);
      if (holiday) holidays.push(holiday);
      if (lunar.month === 12 && lunar.day >= 29) {
        const next = lunarParts(new Date(civil.getTime() + 86400000));
        if (!next.leap && next.month === 1 && next.day === 1) holidays.push('除夕');
      }
    }
  } catch { warnings.push('当前运行环境暂不能计算农历节日，未猜测日期。'); }
  return holidays;
}

function weatherText(payload, confirmed, now, warnings) {
  if (!payload || !locationId(confirmed?.id) || payload.location?.location_id !== confirmed.id || payload.source_url !== sourceUrl(confirmed.id) || clean(payload.location.name, 80) !== clean(confirmed.name, 80)) throw new Error('预报地点与已确认地点不一致。');
  const timezone = 'Asia/Shanghai', today = isoDate(dateParts(now, timezone));
  const town = Array.isArray(payload.daily), daily = town ? payload.daily : payload.daily?.entries;
  if (!Array.isArray(daily) || daily.length > 8) throw new Error('预报日数据结构无效。');
  const published = town ? payload.published_at : payload.daily.published_at;
  const freshness = weatherFreshness(published, now, 18);
  const displayLocation = clean(payload.location.full_name, 240) || confirmed.fullName || confirmed.name;
  const source = clean(payload.source, 160) || '中国天气网';
  const evidence = [`地点：${markdown(displayLocation)}（预报日期 ${today}，${timezone}）。`, `来源：[${markdown(source)}](${sourceUrl(confirmed.id)})。`,
    `数据发布时间：${dateTime(published, timezone)}；页面获取时间：${dateTime(payload.fetched_at, timezone)}。`];
  let summary = '';
  const day = daily.find(entry => entry?.date === today);
  const expired = payload.coverage_status === 'expired' || typeof payload.valid_to === 'string' && Number.isFinite(Date.parse(payload.valid_to)) && Date.parse(payload.valid_to) < now.getTime();
  if (expired || freshness.status === 'stale' || freshness.status === 'future') {
    const warning = freshness.status === 'future' ? '来源发布时间晚于当前时间，无法确认预报有效性，未使用其中的天气数值。' : '天气来源已过期，未把旧预报当作今天的天气。';
    warnings.push(warning);summary = '今天的天气暂时无法可靠确认。';
  } else if (!day) {
    warnings.push('来源没有与今天对应的预报数据，未使用其他日期代替。');summary = '来源暂未提供今天的天气预报。';
  } else {
    if (freshness.status === 'unknown') warnings.push('来源没有可信的数据发布时间，无法确认新鲜度；以下仅为页面标注日期的预报。');
    const temperature = value => typeof value === 'number' && Number.isFinite(value) && value >= -90 && value <= 65 ? value : null;
    const low = temperature(day.low_c), high = temperature(day.high_c), description = clean(day.weather, 100);
    const pieces = [];
    if (description) pieces.push(markdown(description));
    if (low !== null && high !== null && low <= high) pieces.push(`${low}～${high}℃`);
    else if (low !== null && high === null) pieces.push(`最低 ${low}℃`);
    else if (high !== null && low === null) pieces.push(`最高 ${high}℃`);
    if (Array.isArray(day.wind_directions)) {
      const wind = [...new Set(day.wind_directions.map(value => clean(value, 30)).filter(Boolean))].slice(0, 3);
      if (wind.length) pieces.push(markdown(wind.join('转')));
    }
    if (clean(day.wind_level, 40)) pieces.push(markdown(day.wind_level));
    if (!pieces.length) { warnings.push('今天的预报字段缺失，未填入默认温度或天气。');summary = '今天的天气信息暂不完整。'; }
    else summary = `今日地点预报：${pieces.join('，')}。`;
  }
  const intervals = payload.intervals, gaps = Array.isArray(intervals?.coverage_gaps) ? intervals.coverage_gaps : [];
  if (intervals?.coverage === 'gapped' || gaps.length) {
    const ranges = gaps.slice(0, 6).map(gap => `${dateTime(gap?.after, timezone)} 至 ${dateTime(gap?.before, timezone)}`).join('；');
    warnings.push(`分时预报存在缺口${ranges ? `：${ranges}` : ''}；未插值补齐，不能推断缺口内天气。`);
  }
  const precision = town ? '这是乡镇／街道地点预报，不代表小区或门牌实况。' : '这是所选行政区预报，不代表街道、小区或门牌实况。';
  return [summary, ...evidence, precision].join('\n\n');
}

/** Fixed friendly copy, verified dates and public official weather; no LLM or
 * Agent authority is needed to generate an account's daily companion record. */
export async function buildCompanionContent(settings, { now = new Date(), displayName = '', signal, weatherQuery = queryCompanionWeather } = {}) {
  signal?.throwIfAborted();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw failure('每日陪伴的当前时间无效。');
  const timezone = settings?.timezone || 'Asia/Shanghai';
  let parts;try { parts = dateParts(now, timezone); } catch { throw failure('每日陪伴的时区无效。'); }
  const name = clean(displayName, 40), hour = Number(parts.hour), brief = settings?.tone === 'brief', warnings = [];
  const greeting = hour >= 5 && hour < 11 ? '早上好' : hour < 14 && hour >= 11 ? '中午好' : hour >= 14 && hour < 18 ? '下午好' : hour >= 18 && hour < 23 ? '晚上好' : '夜深了';
  const hello = `${name ? `${markdown(name)}，` : ''}${greeting}。${brief ? '小伴来向你问好。' : '小伴来陪你打个招呼，愿今天有件让你开心的小事。'}`;
  const content = [hello, `今天是 ${parts.year} 年 ${Number(parts.month)} 月 ${Number(parts.day)} 日（${timezone}）。`];
  const holidays = settings?.includeHolidays ? holidaysFor(parts, warnings) : [];
  if (holidays.length) content.push(`今天是${holidays.join('、')}。${brief ? '祝你节日快乐！' : '愿这份小小的祝福，为今天添一点温暖。节日快乐！'}\n\n节日提示仅按日历日期，不代表放假或调休安排。`);
  const birthday = typeof settings?.birthday === 'string' && settings.birthday === `${parts.month}-${parts.day}`;
  if (birthday) content.push(brief ? '生日快乐！愿你新的一岁平安顺心。' : '生日快乐！愿你被温柔以待，也愿新的一岁有更多值得期待的小美好。');
  if (settings?.includeWeather) {
    const location = settings.location;
    if (!locationId(location?.id) || !clean(location?.name, 80) || !clean(location?.fullName, 240)) warnings.push('还没有确认天气地点，今天未查询天气。');
    else {
      try {
        const rows = queryRows(await weatherQuery({ site: 'weathercn', command: 'forecast', arguments: { location_id: location.id } }, { signal }), 'forecast');
        signal?.throwIfAborted();
        if (rows.length !== 1) throw new Error('天气来源没有返回唯一的已确认地点。');
        content.push(`### 今日天气\n\n${weatherText(rows[0], location, now, warnings)}`);
      } catch {
        signal?.throwIfAborted();warnings.push('天气暂时查询失败，未编造天气信息；稍后可以再查看。');
        content.push(`### 今日天气\n\n本次未能取得可确认的天气预报与数据时间。已选地点网页：[${markdown(location.fullName)}](${sourceUrl(location.id)})。这不代表本次查询成功。`);
      }
    }
  }
  signal?.throwIfAborted();
  if (warnings.length) content.push(`### 提示\n\n${warnings.map(warning => `- ${warning}`).join('\n')}`);
  const title = birthday ? '生日快乐' : holidays.length ? `${holidays[0]}的问候` : `小伴向你说${greeting}`;
  const text = content.join('\n\n');
  const body = text.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1').replace(/\\([\\`*_{}\[\]<>#|])/g, '$1').replace(/^#+\s*/gm, '').replace(/\s+/g, ' ').trim().slice(0, 280);
  return { title, content: text, warnings, body };
}
