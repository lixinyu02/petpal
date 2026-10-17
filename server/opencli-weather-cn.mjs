import { weatherText, weatherLiteral, cleanWeatherText, weatherNumber, weatherTime, weatherFreshness } from './opencli-weather-common.mjs';

const DIRECTORY = 'https://j.i8tq.com/weather2020/search/city.js';
const countyUrl = id => `https://www.weather.com.cn/weather/${id}.shtml`;
const townUrl = id => `https://forecast.weather.com.cn/town/weathern/${id}.shtml`;
const norm = text => String(text || '').replace(/[\s/、>]+/g, '').replace(/特别行政区|维吾尔自治区|壮族自治区|回族自治区|自治区|省|市|新区|区|县/g, '').toLowerCase();
const object = value => value && typeof value === 'object' && !Array.isArray(value);

function htmlText(value) {
  return cleanWeatherText(String(value || '').replace(/<\/?[a-z][^>]*>/gi, ' ').replace(/&(?:lt|gt|amp|quot|apos|nbsp);/g, entity => ({ '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' })[entity]), 300);
}
function inputValue(html, id) {
  for (const match of html.matchAll(/<input\b[^>]*>/gi)) {
    if (new RegExp(`\\bid=["']${id}["']`).test(match[0])) return /\bvalue=["']([^"']*)["']/.exec(match[0])?.[1] || null;
  }
  return null;
}
function field(html, className) { return new RegExp(`<p\\b[^>]*class=["']${className}["'][^>]*>([\\s\\S]*?)<\\/p>`, 'i').exec(html)?.[1] || ''; }
const temps = text => weatherNumber(htmlText(text)?.replace(/[℃°C]/g, '').trim());
const datePart = time => time?.slice(0, 10) || null;
function dayAt(base, offset) { return new Date(Date.parse(`${base}T00:00:00+08:00`) + offset * 86400000 + 8 * 3600000).toISOString().slice(0, 10); }
function assertSelfLink(html, sourceUrl) {
  const expected = new URL(sourceUrl);
  const confirmed = Array.from(html.matchAll(/<a\b[^>]*\bhref=["']([^"']*)["'][^>]*>/gi)).some(match => {
    try {
      const url = new URL(match[1], expected);
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.port
        && url.hostname === expected.hostname && url.pathname === expected.pathname;
    } catch { return false; }
  });
  if (!confirmed) throw new Error('天气页面自身地点 ID 与所选地点不一致或无法确认。');
}

export function parseWeatherLocations(source) {
  const data = weatherLiteral(source, 'city_data');
  if (!object(data)) throw new Error('中国天气网地点目录格式已变更。');
  const rows = [], seen = new Set();
  for (const [province, cities] of Object.entries(data)) {
    if (!object(cities)) continue;
    for (const [city, counties] of Object.entries(cities)) {
      if (!object(counties)) continue;
      for (const [label, item] of Object.entries(counties)) {
        const id = item?.AREAID, name = cleanWeatherText(item?.NAMECN || label, 80);
        if (!/^101\d{6}$/.test(id || '') || !name || seen.has(id)) continue;
        seen.add(id);
        rows.push({ location_id: id, name, province: cleanWeatherText(province, 80), city: cleanWeatherText(city, 80),
          full_name: [...new Set([province, city, name])].join(' / '), precision: 'administrative-area', source: '中国天气网', source_url: countyUrl(id), directory_url: DIRECTORY });
      }
    }
  }
  if (!rows.length || rows.length > 10000) throw new Error('中国天气网地点目录为空或过大。');
  return rows;
}

function candidates(rows, query, province, city, limit) {
  const q = norm(query);
  if (!q) throw new Error('请提供具体地点名称，不使用只有行政后缀的搜索词。');
  const found = rows.filter(row => (!province || norm(row.province) === norm(province))
    && (!city || [row.city, row.parent_name, row.name].some(part => norm(part) === norm(city)))
    && norm(row.full_name).includes(q));
  found.sort((a, b) => Number(norm(b.name) === q) - Number(norm(a.name) === q));
  if (!found.length) throw new Error('没有找到匹配地点；请补充省、市、区县，或用 search 查询乡镇街道。');
  return found.slice(0, limit).map(row => ({ ...row, candidate_count: found.length, results_truncated: found.length > limit, selection_required: found.length > 1 }));
}

export function parseWeatherSearch(source) {
  const match = /^\s*success_jsonpCallback\(\s*(\[[\s\S]*\])\s*\)\s*;?\s*$/.exec(source);
  let data;
  try { data = match && JSON.parse(match[1]); } catch { /* reject executable JSONP */ }
  if (!Array.isArray(data) || data.length > 1000) throw new Error('中国天气网地点搜索格式已变更。');
  const rows = [], seen = new Set();
  for (const entry of data) {
    const parts = typeof entry?.ref === 'string' ? entry.ref.split('~') : [];
    const [id, , name, , parent] = parts, province = parts[9];
    if (!/^101\d{6}(?:\d{3})?$/.test(id || '') || !cleanWeatherText(name) || !cleanWeatherText(province) || seen.has(id)) continue;
    seen.add(id);
    rows.push({ location_id: id, name: cleanWeatherText(name, 80), province: cleanWeatherText(province, 80), parent_name: cleanWeatherText(parent, 80),
      full_name: [...new Set([province, parent, name])].join(' / '), precision: id.length === 12 ? 'town-or-subdistrict-forecast' : 'administrative-area',
      source: '中国天气网', source_url: id.length === 12 ? townUrl(id) : countyUrl(id) });
  }
  return rows;
}

export function parseCountyForecast(html, location, now = new Date()) {
  assertSelfLink(html, countyUrl(location.location_id));
  const title = htmlText(/<title>([\s\S]*?)<\/title>/i.exec(html)?.[1]);
  if (!title?.includes(location.name)) throw new Error('天气页面地点与所选区县不一致。');
  const publishedAt = weatherTime(inputValue(html, 'fc_24h_internal_update_time'));
  const threePublishedAt = weatherTime(inputValue(html, 'fc_3h_internal_update_time'));
  const base = datePart(publishedAt);
  const content = /<div\b[^>]*id=["']7d["'][^>]*>([\s\S]*?)<\/ul>/i.exec(html)?.[1] || '';
  const blocks = Array.from(content.matchAll(/<li\b[^>]*class=["'][^"']*\bsky\b[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi));
  if (!blocks.length || blocks.length > 7) throw new Error('中国天气网七日预报为空或结构已变更。');
  const daily = blocks.map((match, index) => {
    const block = match[1], label = htmlText(/<h1>(.*?)<\/h1>/s.exec(block)?.[1]);
    const date = base ? dayAt(base, index) : null;
    if (date && Number(label?.match(/^(\d+)日/)?.[1]) !== Number(date.slice(-2))) throw new Error('七日预报日期与发布时间不一致，不能确定有效日期。');
    const temp = field(block, 'tem'), wind = field(block, 'win');
    return { date, date_label: label, weather: htmlText(field(block, 'wea')),
      high_c: temps(/<span>(.*?)<\/span>/s.exec(temp)?.[1]), low_c: temps(/<i>(.*?)<\/i>/s.exec(temp)?.[1]),
      wind_directions: Array.from(wind.matchAll(/\btitle=["']([^"']*)["']/g), m => htmlText(m[1])), wind_level: htmlText(/<i>(.*?)<\/i>/s.exec(wind)?.[1]) };
  });
  if (!daily.some(day => day.weather || day.high_c !== null || day.low_c !== null)) throw new Error('中国天气网七日预报没有有效天气数据。');
  const rawHourly = weatherLiteral(html, 'hour3data', true);
  const hourly = [];
  // Only the ordered 7d data; 1d and 23d are alternate UI datasets.
  if (rawHourly?.['7d']) {
    if (!Array.isArray(rawHourly['7d']) || rawHourly['7d'].length > 7) throw new Error('天气分时预报格式已变更。');
    for (const [index, points] of rawHourly['7d'].entries()) {
      if (!Array.isArray(points) || points.length > 24) throw new Error('天气分时预报条数异常。');
      const timeBase = datePart(threePublishedAt);
      for (const point of points) {
        if (typeof point !== 'string') throw new Error('天气分时预报格式已变更。');
        const fields = point.split(','), time = /^(\d{1,2})日(\d{2})时$/.exec(fields[0]);
        let validAt = null;
        if (time && timeBase) {
          const day = [dayAt(timeBase, index), dayAt(timeBase, index + 1)].find(d => Number(d.slice(-2)) === Number(time[1]));
          validAt = day ? weatherTime(`${day} ${time[2]}:00`) : null;
        }
        if (timeBase && !validAt) throw new Error('天气分时预报时间无效。');
        hourly.push({ valid_at: validAt, time_label: cleanWeatherText(fields[0]), weather: cleanWeatherText(fields[2]), temperature_c: temps(fields[3]), wind_direction: cleanWeatherText(fields[4]), wind_level: cleanWeatherText(fields[5]) });
      }
    }
  }
  for (let i = 1; i < hourly.length; i++) {
    if (hourly[i].valid_at && hourly[i - 1].valid_at && Date.parse(hourly[i].valid_at) - Date.parse(hourly[i - 1].valid_at) !== 3 * 3600000) throw new Error('天气分时预报时间重复或顺序异常。');
  }
  return { location, source: '中国天气网（页面标注数据来源中央气象台）', source_url: countyUrl(location.location_id), fetched_at: now.toISOString(), timezone: 'Asia/Shanghai',
    daily: { published_at: publishedAt, freshness: weatherFreshness(publishedAt, now, 18), temporal_resolution: '1 day', entries: daily },
    intervals: { published_at: threePublishedAt, freshness: weatherFreshness(threePublishedAt, now, 18), temporal_resolution: '3 hours', entries: hourly },
    notes: ['这是所选行政区预报，不是指定街道、小区或门牌的观测。', '分时预报为三小时间隔；发布时间未知、stale 或 future 时须明确提示。'] };
}

export function parseTownForecast(html, parent, id, now = new Date()) {
  assertSelfLink(html, townUrl(id));
  const villages = weatherLiteral(html, 'villages');
  if (!Array.isArray(villages) || villages.length > 1000) throw new Error('天气乡镇目录格式已变更。');
  const village = villages.find(item => item?.id === id);
  const name = cleanWeatherText(village?.name, 80);
  const title = htmlText(/<title>([\s\S]*?)<\/title>/i.exec(html)?.[1]);
  if (!name || !title?.includes(name) || !title?.includes(parent.name)) throw new Error('乡镇街道不属于所选区县或页面地点不一致。');
  const raw = weatherLiteral(html, 'hour3data'), highs = weatherLiteral(html, 'eventDay'), lows = weatherLiteral(html, 'eventNight');
  if (!Array.isArray(raw) || raw.length !== 7 || !Array.isArray(highs) || !Array.isArray(lows) || highs.length !== 8 || lows.length !== 8) throw new Error('乡镇七日预报结构已变更。');
  const blocks = Array.from(html.matchAll(/<li\b[^>]*class=["']([^"']*\bblue-item\b[^"']*)["'][^>]*>([\s\S]*?)<\/li>/gi)).filter(m => !/\byesterday\b/.test(m[1]));
  if (blocks.length !== 7) throw new Error('乡镇七日预报内容不完整。');
  const dateLabels = Array.from(html.matchAll(/<li\b[^>]*class=["'][^"']*\bdate-item\b[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi), m => htmlText(/<p\b[^>]*class=["']date["'][^>]*>(.*?)<\/p>/s.exec(m[1])?.[1]));
  if (dateLabels.length !== 8) throw new Error('乡镇预报日期标签不完整。');
  const intervals = [], daily = [], groupStarts = new Set();
  const base = datePart(weatherTime(raw[0]?.[0]?.jf));
  if (!base) throw new Error('乡镇预报缺少完整日期。');
  for (const [i, points] of raw.entries()) {
    if (!Array.isArray(points) || !points.length || points.length > 24) throw new Error('乡镇分时预报为空或过大。');
    const firstTime = weatherTime(points[0]?.jf);
    if (!firstTime) throw new Error('乡镇预报缺少完整日期。');
    if (datePart(firstTime) !== dayAt(base, i)) throw new Error('乡镇预报每日分组日期不一致。');
    if (Number(dateLabels[i + 1]?.match(/^(\d+)日/)?.[1]) !== Number(datePart(firstTime).slice(-2))) throw new Error('乡镇预报日期标签与分组日期不一致。');
    if (i > 0) groupStarts.add(intervals.length);
    const block = blocks[i][2];
    const weather = /<p\b[^>]*class=["']weather-info["'][^>]*title=["']([^"']*)["']/.exec(block)?.[1];
    daily.push({ date: datePart(firstTime), weather: cleanWeatherText(weather), high_c: weatherNumber(highs[i + 1]), low_c: weatherNumber(lows[i + 1]),
      wind_directions: Array.from(block.matchAll(/class=["']wind-icon[^"']*["']\s+title=["']([^"']*)["']/g), m => cleanWeatherText(m[1])) });
    for (const point of points) {
      const validAt = weatherTime(point.jf);
      if (!validAt) throw new Error('乡镇分时预报时间无效。');
      intervals.push({ valid_at: validAt, temperature_c: weatherNumber(point.jb), weather_code: cleanWeatherText(point.ja), wind_level_code: cleanWeatherText(point.jc), wind_direction_code: cleanWeatherText(point.jd) });
    }
  }
  const gaps = new Set(), coverageGaps = [];
  for (let i = 1; i < intervals.length; i++) {
    const gap = (Date.parse(intervals[i].valid_at) - Date.parse(intervals[i - 1].valid_at)) / 3600000;
    // The official hourly -> three-hour horizon can leave a sparse join between
    // adjacent dated groups. Preserve that hole explicitly; never sort, dedupe,
    // interpolate, or accept an internal gap/reversed/whole-day missing group.
    if (gap <= 0 || gap > (groupStarts.has(i) ? 24 : 3)) throw new Error('乡镇分时预报时间顺序异常。');
    if (groupStarts.has(i)) {
      if (gap > 3) coverageGaps.push({ after: intervals[i - 1].valid_at, before: intervals[i].valid_at, duration_hours: gap });
    } else gaps.add(gap);
  }
  const location = { ...parent, location_id: id, parent_id: parent.location_id, parent_name: parent.name, name, full_name: `${parent.full_name} / ${name}`, precision: 'town-or-subdistrict-forecast', source_url: townUrl(id) };
  return { location, source: '中国天气网乡镇街道预报', source_url: townUrl(id), fetched_at: now.toISOString(), timezone: 'Asia/Shanghai',
    published_at: null, freshness: { status: 'unknown', age_hours: null },
    valid_from: intervals[0].valid_at, valid_to: intervals.at(-1).valid_at, coverage_status: Date.parse(intervals.at(-1).valid_at) < now.getTime() ? 'expired' : 'includes-future',
    daily, intervals: { temporal_resolution_hours: [...gaps].sort((a, b) => a - b), coverage: coverageGaps.length ? 'gapped' : 'continuous', coverage_gaps: coverageGaps, entries: intervals },
    notes: ['乡镇街道页面未提供可信数据发布时间；网页显示更新时间由浏览器时钟合成，不作为发布或新鲜度证据。', '这是乡镇街道地点预报，未提供网格分辨率，不代表小区/门牌实况。', '分时天气/风为来源数字代码；不猜测未核实代码含义。', ...(coverageGaps.length ? ['分时预报在逐日分组交界存在缺口，详见 intervals.coverage_gaps；未插值补齐，不能推断缺口内天气或视为连续覆盖。'] : [])] };
}

export async function runChinaWeatherQuery(request, { now = new Date() } = {}) {
  const args = request.arguments;
  if (request.command === 'search') {
    const url = `https://toy1.weather.com.cn/search?cityname=${encodeURIComponent(args.query)}&callback=success_jsonpCallback`;
    return candidates(parseWeatherSearch(await weatherText(url)), args.query, args.province, args.city, args.limit);
  }
  const rows = parseWeatherLocations(await weatherText(DIRECTORY));
  if (request.command === 'locations') return candidates(rows, args.query, args.province, args.city, args.limit);
  if (request.command !== 'forecast') throw new Error('天气命令未开放。');
  const id = args.location_id, parent = rows.find(row => row.location_id === id?.slice(0, 9));
  if (!parent) throw new Error('地点 ID 不在国内官方行政目录中，请重新搜索。');
  if (id.length === 12) return [parseTownForecast(await weatherText(townUrl(id)), parent, id, now)];
  return [parseCountyForecast(await weatherText(countyUrl(id)), parent, now)];
}
