import {
  weatherJson,
  cleanWeatherText,
  weatherNumber,
  weatherFreshness,
} from './opencli-weather-common.mjs';

const ORIGIN = 'https://www.nmc.cn';
const SOURCE = '中央气象台';
const MAX_AGE_HOURS = { observation: 3, forecast: 18, air: 3 };

function code(value, label) {
  const result = cleanWeatherText(value, 40);
  if (!result || !/^[A-Za-z0-9]{1,20}$/.test(result)) throw new Error(`${label}必须是官方列表中的字母数字代码`);
  return result;
}

function sourceUrl(value, fallback = null) {
  if (!value) return fallback;
  const text = cleanWeatherText(value, 400);
  let url;
  try { url = new URL(text, ORIGIN); } catch { throw new Error('中央气象台返回了无效来源地址'); }
  if (!['http:', 'https:'].includes(url.protocol)
    || !['www.nmc.cn', 'nmc.cn'].includes(url.hostname)
    || url.username || url.password || url.port
    || !/^\/publish\/[A-Za-z0-9_./-]+$/.test(url.pathname)
    || url.pathname.includes('..')) {
    throw new Error('中央气象台来源地址未通过官方主机校验');
  }
  return url.href;
}

// Upstream timestamps use Beijing time. Do not infer their year/date from fetch time.
function beijingTime(value) {
  const text = cleanWeatherText(value, 80);
  if (!text) return null;
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:\+08:00)?$/);
  if (!match) return null;
  const [, y, mo, d, h, mi, s = '00'] = match;
  const parts = [y, mo, d, h, mi, s].map(Number);
  const candidate = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]));
  if (candidate.getUTCFullYear() !== parts[0] || candidate.getUTCMonth() + 1 !== parts[1]
    || candidate.getUTCDate() !== parts[2] || candidate.getUTCHours() !== parts[3]
    || candidate.getUTCMinutes() !== parts[4] || candidate.getUTCSeconds() !== parts[5]) return null;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}+08:00`;
}

function beijingNow(now) {
  const date = new Date(now);
  if (!Number.isFinite(date.getTime())) throw new Error('无效查询时间');
  return new Date(date.getTime() + 8 * 3600000).toISOString().replace('Z', '+08:00');
}

function textOrNull(value, max = 300) {
  if (value == null || /^-?9999(?:\.0+)?$/.test(String(value).trim())) return null;
  return cleanWeatherText(value, max) || null;
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

async function provinces() {
  const rows = await weatherJson(`${ORIGIN}/rest/province/all`);
  if (!Array.isArray(rows) || !rows.length) throw new Error('中央气象台省份列表为空或格式异常');
  return rows.map(row => {
    const item = object(row);
    return {
      name: cleanWeatherText(item.name, 100),
      province_code: code(item.code, '省份代码'),
      source: SOURCE,
      source_url: sourceUrl(item.url, `${ORIGIN}/publish/forecast.html`),
    };
  }).filter(row => row.name);
}

async function provinceLocations(provinceCode) {
  const selected = (await provinces()).find(row => row.province_code === provinceCode);
  if (!selected) throw new Error('省份代码不在中央气象台当前官方列表中，请先查询 provinces');
  const rows = await weatherJson(`${ORIGIN}/rest/province/${provinceCode}`);
  if (!Array.isArray(rows) || !rows.length) throw new Error('中央气象台地点列表为空或格式异常');
  return rows.map(row => {
    const item = object(row);
    const city = cleanWeatherText(item.city, 100);
    const province = cleanWeatherText(item.province, 100) || selected.name;
    if (province !== selected.name) throw new Error('中央气象台地点所属省份与查询条件不符');
    return {
      name: city,
      location: `${province} ${city}`.trim(),
      province,
      province_code: provinceCode,
      station_id: code(item.code, '地点代码'),
      source: SOURCE,
      source_url: sourceUrl(item.url, selected.source_url),
      precision: 'city_or_county_station',
    };
  }).filter(row => row.name);
}

function limit(value) {
  if (value == null || value === '') return 10;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error('limit必须是正整数');
  return Math.min(parsed, 50);
}

function forecastPeriod(value) {
  const period = object(value);
  const weather = object(period.weather);
  const wind = object(period.wind);
  return {
    weather: textOrNull(weather.info),
    weather_code: textOrNull(weather.img, 30),
    temperature_c: weatherNumber(weather.temperature),
    wind_direction: textOrNull(wind.direct),
    wind_power: textOrNull(wind.power),
  };
}

function validDate(value) {
  const date = cleanWeatherText(value, 30);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && beijingTime(`${date} 00:00`) ? date : null;
}

function hasWeatherValues(row) {
  return Object.values(row).some(value => value !== null && value !== undefined);
}

function dateOffset(date, offset) {
  return new Date(Date.parse(`${date}T00:00:00+08:00`) + offset * 86400000 + 8 * 3600000)
    .toISOString().slice(0, 10);
}

function normalizeDaily(rows, publishedAt, now) {
  if (!Array.isArray(rows)) return [];
  if (rows.length > 15) throw new Error('中央气象台逐日预报长度与当前接口结构不符');
  const groupDate = publishedAt?.slice(0, 10) || null;
  let firstDate = null;
  return rows.map((item, index) => {
    const row = object(item);
    const date = validDate(row.date);
    if (!date) throw new Error('中央气象台逐日预报含无效日期，暂无法可靠查询');
    firstDate ||= date;
    if (date !== dateOffset(groupDate || firstDate, index)) {
      throw new Error('中央气象台逐日预报日期与分组发布时间或连续顺序不符，暂无法可靠查询');
    }
    const issued = beijingTime(row.pt);
    if (issued && issued.slice(0, 10) > date) {
      throw new Error('中央气象台逐日预报发布时间晚于对应预报日期');
    }
    const day = forecastPeriod(row.day);
    const night = forecastPeriod(row.night);
    const precipitation = weatherNumber(row.precipitation);
    const hasData = hasWeatherValues(day) || hasWeatherValues(night) || precipitation !== null;
    return {
      date,
      published_at: issued,
      has_data: hasData,
      freshness: weatherFreshness(hasData ? issued : null, now, MAX_AGE_HOURS.forecast),
      publication_matches_group: issued && publishedAt ? issued === publishedAt : null,
      day,
      night,
      precipitation_mm: precipitation,
    };
  });
}

function conservativeFreshness(groupFreshness, daily) {
  const all = [groupFreshness, ...daily.map(row => row.freshness)];
  // A fresh announcement header cannot promote old, unknown or future row data.
  for (const status of ['future', 'stale', 'unknown', 'fresh']) {
    const entries = all.filter(item => item.status === status);
    if (!entries.length) continue;
    const ages = entries.map(item => item.age_hours).filter(value => value !== null);
    return {
      status,
      age_hours: ages.length ? (status === 'future' ? Math.min(...ages) : Math.max(...ages)) : null,
    };
  }
  return { status: 'unknown', age_hours: null };
}

function warning(value, now) {
  const item = object(value);
  const title = textOrNull(item.alert);
  if (!title) return null;
  const publishedAt = beijingTime(item.issuetime);
  return {
    title,
    content: textOrNull(item.issuecontent, 3000),
    province: textOrNull(item.province),
    city: textOrNull(item.city),
    signal_type: textOrNull(item.signaltype),
    signal_level: textOrNull(item.signallevel),
    published_at: publishedAt,
    freshness: weatherFreshness(publishedAt, now, MAX_AGE_HOURS.observation),
    source_url: sourceUrl(textOrNull(item.url)),
    note: '上游当前返回的一条预警记录，不代表该地点的全部预警；是否解除应以官方预警详情为准。',
  };
}

function assertIdentity(value, expected) {
  const section = object(value);
  if (!Object.keys(section).length) return;
  const station = object(section.station);
  if (String(station.code ?? '') !== expected.station_id) {
    throw new Error('中央气象台天气响应地点代码与已选择地点不符');
  }
}

function normalizeWeather(payload, location, now) {
  if (!payload || typeof payload !== 'object' || ![0, '0'].includes(payload.code)
    || !payload.data || typeof payload.data !== 'object' || Array.isArray(payload.data)) {
    throw new Error('中央气象台未返回有效天气数据，请重新查询地点列表后重试');
  }
  const data = payload.data;
  const real = object(data.real);
  const predict = object(data.predict);
  assertIdentity(real, location);
  assertIdentity(predict, location);
  const weather = object(real.weather);
  const wind = object(real.wind);
  const realPublished = beijingTime(real.publish_time);
  const forecastPublished = beijingTime(predict.publish_time);
  const observedValues = {
    weather: textOrNull(weather.info),
    weather_code: textOrNull(weather.img, 30),
    temperature_c: weatherNumber(weather.temperature),
    feels_like_c: weatherNumber(weather.feelst),
    humidity_percent: weatherNumber(weather.humidity),
    pressure_hpa: weatherNumber(weather.airpressure),
    rain_mm: weatherNumber(weather.rain),
    wind_direction: textOrNull(wind.direct),
    wind_direction_degrees: weatherNumber(wind.degree),
    wind_power: textOrNull(wind.power),
    wind_speed_m_s: weatherNumber(wind.speed),
  };
  const hasRealData = hasWeatherValues(observedValues);
  const daily = normalizeDaily(predict.detail, forecastPublished, now);
  const hasForecastData = daily.some(row => row.has_data);
  if (!hasRealData && !hasForecastData) throw new Error('中央气象台天气响应不含有效实况或预报，气象值均缺测');
  const groupFreshness = weatherFreshness(forecastPublished, now, MAX_AGE_HOURS.forecast);
  const history = (Array.isArray(data.passedchart) ? data.passedchart : []).slice(0, 48).map(item => {
    const row = object(item);
    return {
      observed_at: beijingTime(row.time),
      temperature_c: weatherNumber(row.temperature),
      humidity_percent: weatherNumber(row.humidity),
      pressure_hpa: weatherNumber(row.pressure),
      precipitation_1h_mm: weatherNumber(row.rain1h),
      wind_speed_m_s: weatherNumber(row.windSpeed),
      wind_direction_degrees: weatherNumber(row.windDirection),
    };
  }).filter(row => row.observed_at);
  const air = object(data.air);
  const airPublished = beijingTime(air.forecasttime);
  const sunrise = object(real.sunriseSunset);
  return {
    ...location,
    source_api_url: `${ORIGIN}/rest/weather?stationid=${location.station_id}`,
    fetched_at: beijingNow(now),
    timezone: 'Asia/Shanghai',
    real: {
      published_at: realPublished,
      has_data: hasRealData,
      freshness: weatherFreshness(hasRealData ? realPublished : null, now, MAX_AGE_HOURS.observation),
      ...observedValues,
      rain_period: 'upstream_unspecified',
      sunrise_at: beijingTime(sunrise.sunrise),
      sunset_at: beijingTime(sunrise.sunset),
      note: '地点对应城市或县区气象站实况；不代表街道、门牌或用户所在位置的现场观测。rain字段未公开明确累计时段。',
    },
    predict: {
      published_at: forecastPublished,
      has_data: hasForecastData,
      group_freshness: groupFreshness,
      freshness: hasForecastData ? conservativeFreshness(groupFreshness, daily) : weatherFreshness(null, now, MAX_AGE_HOURS.forecast),
      temporal_resolution: 'daily_day_night',
      daily,
      note: '官方城市或县区日预报；每行保留自身发布时间与新鲜度，组时间不代替缺失或陈旧行时间。本接口未返回未来逐小时或三小时预报，不从过去实况推算。日降水量不等于降水概率。',
    },
    observations_history: {
      temporal_resolution: 'hourly_observation',
      rows: history,
      note: 'passedchart是过去逐小时实况，不是未来逐小时预报。',
    },
    air: {
      published_at: airPublished,
      freshness: weatherFreshness(airPublished, now, MAX_AGE_HOURS.air),
      aqi: weatherNumber(air.aqi),
      description: textOrNull(air.text),
    },
    warning: warning(real.warn, now),
    precision_note: '使用用户指定省份内的官方地点代码；未用IP或同名地点默认匹配。该接口不提供坐标或代表距离，不能宣称街道或门牌级精度。',
    missing_value_note: '上游空值和9999缺测标记返回null；没有预警记录不代表全部预警查询已完成。',
  };
}

export async function runNmcWeatherQuery(request, { now = new Date() } = {}) {
  if (request?.site !== 'nmc') throw new Error('无效中央气象台查询站点');
  const args = object(request.arguments);
  if (request.command === 'provinces') return provinces();
  if (!['locations', 'weather'].includes(request.command)) throw new Error('不支持的中央气象台查询命令');
  const provinceCode = code(args.province, '省份代码');
  const rows = await provinceLocations(provinceCode);
  if (request.command === 'locations') {
    const query = (cleanWeatherText(args.query, 120) || '').toLocaleLowerCase();
    return rows.filter(row => !query || row.location.toLocaleLowerCase().includes(query)).slice(0, limit(args.limit));
  }
  const stationId = code(args.station_id, '地点代码');
  const selected = rows.find(row => row.station_id === stationId);
  if (!selected) throw new Error('地点代码不在该省份当前官方列表中，请先查询 locations；不接受猜测的WMO站号');
  const payload = await weatherJson(`${ORIGIN}/rest/weather?stationid=${stationId}`);
  return [normalizeWeather(payload, selected, now)];
}
