const text = (description, maxLength = 80, extra = {}) => ({ type: 'string', minLength: 1, maxLength, description, ...extra });
const limit = { type: 'integer', minimum: 1, maximum: 50, default: 10 };
const province = text('provinces 返回的省份代码，例如 ASH；不能自行猜测', 3, { pattern: '^A[A-Z]{2}$' });
const define = (site, command, description, properties, required, hosts) => ({
  site, command, description, label: site === 'nmc' ? '中央气象台' : '中国天气网',
  mode: 'public', engine: 'builtin-public', hosts,
  inputSchema: { type: 'object', properties, required, additionalProperties: false },
});
const chinaHosts = ['j.i8tq.com', 'toy1.weather.com.cn', 'www.weather.com.cn', 'forecast.weather.com.cn'];
export const OPENCLI_WEATHER_POLICIES = [
  define('weathercn', 'locations', '搜索国内省市区县；返回完整行政层级与候选，不自动选同名地点', {
    query: text('区县或完整省市区县名称；街道用 search'), province: text('可选省份名称，用于同名地点消歧'), city: text('可选城市名称'), limit,
  }, ['query'], chinaHosts),
  define('weathercn', 'search', '官网地点搜索，支持有数据的乡镇、街道；返回候选与真实 ID', {
    query: text('地点名称，例如张江或陆家嘴；具体行政层级用 province/city 过滤'), province: text('可选省份名称'), city: text('可选所属市/区县名称'), limit,
  }, ['query'], chinaHosts),
  define('weathercn', 'forecast', '查询区县或乡镇街道七日及分时预报；发布时间未知会明示，不代表门牌实况', {
    location_id: text('locations/search 返回的 9 位区县或 12 位乡镇街道 ID', 12, { pattern: '^101[0-9]{6}(?:[0-9]{3})?$' }),
  }, ['location_id'], chinaHosts),
  define('nmc', 'provinces', '中央气象台省份目录，用于获取真实省份代码', {}, [], ['www.nmc.cn']),
  define('nmc', 'locations', '中央气象台省内区县/测站目录；先选省份，再消歧地点', {
    province, query: text('可选区县/测站名称'), limit,
  }, ['province'], ['www.nmc.cn']),
  define('nmc', 'weather', '中央气象台测站实况、历史观测与七日预报；观测不代表具体门牌', {
    province, station_id: text('locations 返回的 code；不是 WMO 五位数字站号', 20, { pattern: '^[A-Za-z0-9]{1,20}$' }),
  }, ['province', 'station_id'], ['www.nmc.cn']),
];
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
freeze(OPENCLI_WEATHER_POLICIES);
const byKey = new Map(OPENCLI_WEATHER_POLICIES.map(p => [`${p.site}/${p.command}`, p]));
export function weatherQueryPolicy(site, command) { const p = byKey.get(`${site}/${command}`); return p ? JSON.parse(JSON.stringify(p)) : null; }
