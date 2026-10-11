// Public weather data only. The isolated worker supplies the bounded fetch.
export function cleanWeatherText(value, max = 300) {
  if (value === undefined || value === null) return null;
  const text = String(value).replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  return text && !/^(?:-?9999(?:\.0+)?|null|undefined|--?)$/i.test(text) ? text : null;
}

export function weatherNumber(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && (!value.trim() || !/^-?\d+(?:\.\d+)?$/.test(value.trim()))) return null;
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) !== 9999 ? number : null;
}

export function weatherTime(value) {
  const text = cleanWeatherText(value, 40);
  if (!text) return null;
  const match = /^(\d{4})-?(\d{2})-?(\d{2})(?:[ T]?(\d{2})(?::?(\d{2}))?(?::?(\d{2}))?(?:\.\d+)?)?$/.exec(text);
  if (!match) return null;
  const [, y, m, d, h = '00', min = '00', sec = '00'] = match;
  const result = `${y}-${m}-${d}T${h}:${min}:${sec}+08:00`;
  const date = new Date(result);
  if (!Number.isFinite(date.getTime())) return null;
  const local = new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 19);
  return local === result.slice(0, 19) ? result : null;
}

export function weatherFreshness(publishedAt, now = new Date(), maxAgeHours = 18) {
  const ms = publishedAt ? Date.parse(publishedAt) : NaN;
  if (!Number.isFinite(ms)) return { status: 'unknown', age_hours: null };
  const age = (now.getTime() - ms) / 3600000;
  return { status: age < -0.25 ? 'future' : age > maxAgeHours ? 'stale' : 'fresh', age_hours: Math.round(age * 100) / 100 };
}

export async function weatherText(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: new URL(url).hostname === 'www.nmc.cn' ? 'https://www.nmc.cn/' : 'https://www.weather.com.cn/' } });
  if (response.url && new URL(response.url).href !== new URL(url).href) {
    await response.body?.cancel();
    throw new Error('天气来源重定向到另一地址，无法确认地点。');
  }
  if (!response.ok) throw new Error(`天气来源返回 HTTP ${response.status}。`);
  const text = await response.text();
  if (!text.trim()) throw new Error('天气来源返回空数据，暂无法查询。');
  return text;
}

export async function weatherJson(url) {
  try { return JSON.parse(await weatherText(url)); }
  catch (error) { if (error instanceof SyntaxError) throw new Error('天气来源 JSON 格式已变更，暂无法查询。'); throw error; }
}

// Parse a fixed JSON literal from a script; never execute website JavaScript.
export function weatherLiteral(source, name, optional = false) {
  const match = new RegExp(`\\bvar\\s+${name}\\s*=\\s*`).exec(source);
  if (!match) { if (optional) return null; throw new Error(`天气来源缺少 ${name} 数据。`); }
  const start = match.index + match[0].length;
  if (!['{', '['].includes(source[start])) throw new Error('天气来源数据不是 JSON。');
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; continue; }
    if (c === '"') quoted = true;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      if (--depth === 0) { try { return JSON.parse(source.slice(start, i + 1)); } catch { break; } }
    }
  }
  throw new Error('天气来源 JSON 内容无效。');
}
