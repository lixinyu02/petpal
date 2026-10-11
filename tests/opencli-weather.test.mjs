import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { OPENCLI_QUERY_POLICIES, describeOpenCliSites, loadOpenCliCatalog, validateOpenCliQuery } from '../server/opencli-sites.mjs';
import { OPENCLI_BROWSER_POLICIES } from '../server/opencli-browser-policies.mjs';
import { OPENCLI_WEATHER_POLICIES } from '../server/opencli-weather-policies.mjs';
import { parseWeatherLocations, parseWeatherSearch, parseCountyForecast, parseTownForecast } from '../server/opencli-weather-cn.mjs';
import { weatherFreshness, weatherTime, weatherText } from '../server/opencli-weather-common.mjs';
import { runWeatherQuery } from '../server/opencli-weather-adapters.mjs';
import { desktopToolSpecs } from '../server/desktop-tools.mjs';

// Synthetic minimal official-format fixtures, never copied website bodies.
const DIRECTORY_URL = 'https://j.i8tq.com/weather2020/search/city.js';
const COUNTY_ID = '101020600';
const TOWN_ID = '101020600001';
const COUNTY_URL = `https://www.weather.com.cn/weather/${COUNTY_ID}.shtml`;
const TOWN_URL = `https://forecast.weather.com.cn/town/weathern/${TOWN_ID}.shtml`;
const NOW = new Date('2026-12-31T04:00:00Z');
const COUNTY = { location_id: COUNTY_ID, name: '浦东新区', province: '上海市', city: '上海市', full_name: '上海市 / 浦东新区', precision: 'administrative-area' };
const DIRECTORY = `var city_data = ${JSON.stringify({
  上海市: { 上海市: { 浦东新区: { AREAID: COUNTY_ID, NAMECN: '浦东新区' } } },
  江苏省: { 苏州市: { 朝阳: { AREAID: '101190401', NAMECN: '朝阳' } } },
  辽宁省: { 朝阳市: { 朝阳: { AREAID: '101071201', NAMECN: '朝阳' } } },
})};`;
const request = (command, args) => validateOpenCliQuery({ site: 'weathercn', command, arguments: args });
const addDays = (base, days) => new Date(Date.parse(`${base}T00:00:00+08:00`) + days * 86400000 + 8 * 3600000).toISOString().slice(0, 10);
const dayLabel = date => `${Number(date.slice(-2))}日`;
const compactHour = ms => new Date(ms + 8 * 3600000).toISOString().slice(0, 13).replace(/[-T]/g, '');

async function withFetch(routes, fn) {
  const previous = globalThis.fetch, calls = [];
  globalThis.fetch = async input => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    assert.ok(Object.hasOwn(routes, url), `No network allowed: unexpected fixture URL ${url}`);
    const data = routes[url];
    if (data instanceof Response) return data;
    const response = new Response(typeof data === 'string' ? data : JSON.stringify(data), { status: 200 });
    Object.defineProperty(response, 'url', { value: url });
    return response;
  };
  try { return await fn(calls); } finally { globalThis.fetch = previous; }
}

async function runFixtureWorker(input, routes) {
  const scratchParent = path.resolve(tmpdir());
  const scratch = await mkdtemp(path.join(scratchParent, 'petpal-weather-worker-test-'));
  try {
    const mockPath = path.join(scratch, 'mock-fetch.mjs');
    const mockSource = `const routes=${JSON.stringify(routes)};
globalThis.fetch=async(input,init={})=>{
  const href=new URL(input).href;
  if(!Object.hasOwn(routes,href))throw new Error('No network allowed: unexpected fixture URL '+href);
  if(init.redirect!=='manual'||init.credentials!=='omit')throw new Error('Worker network policy was not applied');
  const route=routes[href];
  const response=new Response(route.body??'',{status:route.status??200,headers:route.headers??{}});
  Object.defineProperty(response,'url',{value:href});
  return response;
};
`;
    await writeFile(mockPath, mockSource, { encoding: 'utf8', mode: 0o600 });
    const env = { PATH: process.env.PATH ?? '', HOME: scratch, TEMP: scratch, TMP: scratch, ELECTRON_RUN_AS_NODE: '1' };
    if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
    const workerPath = fileURLToPath(new URL('../server/opencli-worker.mjs', import.meta.url));
    const child = spawnSync(process.execPath, ['--import', pathToFileURL(mockPath).href, workerPath], {
      cwd: scratch, env, input: JSON.stringify(input), encoding: 'utf8', shell: false, windowsHide: true, timeout: 15000, maxBuffer: 256 * 1024,
    });
    assert.equal(child.error, undefined, `Fixture worker failed to launch or exceeded its timeout: ${child.error?.message}`);
    assert.equal(child.signal, null, 'Fixture worker must finish normally');
    return { status: child.status, stdout: child.stdout, stderr: child.stderr };
  } finally {
    const relative = path.relative(scratchParent, path.resolve(scratch));
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative) && path.basename(scratch).startsWith('petpal-weather-worker-test-'), 'Only the newly created temporary fixture root may be removed');
    await rm(scratch, { recursive: true, force: true });
  }
}

function countyFixture({ base = '2026-12-31', published = `${base.replaceAll('-', '')}08`, hourlyPublished = `${base} 11:30`, hourly, empty = false, name = '浦东新区', navigationId = COUNTY_ID } = {}) {
  const points = hourly ?? Array.from({ length: 7 }, (_, i) => Array.from({ length: 8 }, (_, j) => {
    const hour = 20 + j * 3;
    return `${dayLabel(addDays(base, i + Math.floor(hour / 24)))}${String(hour % 24).padStart(2, '0')}时,n00,晴,${20 - j}℃,北风,<3级,0`;
  }));
  const days = Array.from({ length: 7 }, (_, i) => `<li class="sky skyid lv1"><h1>${dayLabel(addDays(base, i))}</h1>${empty ? '' : `<p class="wea">${i ? '多云' : '晴'}</p><p class="tem"><span>${25 + i}℃</span><i>${18 + i}℃</i></p><p class="win"><em><span title="北风"></span></em><i>&lt;3级</i></p>`}</li>`).join('');
  return `<title>${name}天气预报</title><a href="/weather/${navigationId}.shtml">7天</a><input id="fc_24h_internal_update_time" value="${published}"><input id="fc_3h_internal_update_time" value="${hourlyPublished}"><div id="7d"><ul>${days}</ul></div><script>var hour3data=${JSON.stringify({
    '7d': points,
    // Alternate UI sets deliberately disagree with 7d. They must not be concatenated.
    '1d': [`${dayLabel(base)}20时,n00,另一份,99℃,西风,8级,0`],
    '23d': [[`${dayLabel(base)}20时,n00,另一份,98℃,西风,8级,0`]],
  })};</script>`;
}

function townFixture({ base = '2026-12-31', townName = '花木街道', parentName = '浦东新区', id = TOWN_ID, navigationId = id, points, labels, highs, lows } = {}) {
  const start = Date.parse(`${base}T08:00:00+08:00`);
  const raw = points ?? Array.from({ length: 7 }, (_, i) => Array.from({ length: 8 }, (_, j) => ({
    jf: compactHour(start + (i * 24 + j * 3) * 3600000), ja: '00', jb: 20 + j, jc: '0', jd: '8',
  })));
  const dates = labels ?? Array.from({ length: 8 }, (_, i) => dayLabel(addDays(base, i - 1)));
  const items = Array.from({ length: 8 }, (_, i) => `<li class="blue-item${i ? '' : ' yesterday'}"><p class="weather-info" title="${i ? `晴${i}` : '昨天'}"></p><span class="wind-icon n" title="北风"></span></li>`).join('');
  const dateItems = dates.map(label => `<li class="date-item"><p class="date">${label}</p></li>`).join('');
  return `<title>${parentName}${townName}天气预报</title><a href="/town/weathern/${navigationId}.shtml">7天</a><script>var villages=${JSON.stringify([{ id, name: townName }])};var hour3data=${JSON.stringify(raw)};var eventDay=${JSON.stringify(highs ?? [90, 21, 22, 23, 24, 25, 26, 27])};var eventNight=${JSON.stringify(lows ?? [89, 11, 12, 13, 14, 15, 16, 17])};</script><ul class="date-container">${dateItems}</ul><ul class="blue-container">${items}</ul>`;
}

test('weather adds exactly six public queries while all 23 pinned upstream queries remain intact', async () => {
  const catalog = await loadOpenCliCatalog();
  assert.equal(OPENCLI_QUERY_POLICIES.length, 23);
  assert.equal(OPENCLI_WEATHER_POLICIES.length, 6);
  const weather = catalog.records.filter(row => ['weathercn', 'nmc'].includes(row.site) && row.callable);
  assert.deepEqual(weather.map(row => `${row.site}/${row.command}`).sort(), ['nmc/locations', 'nmc/provinces', 'nmc/weather', 'weathercn/forecast', 'weathercn/locations', 'weathercn/search']);
  assert.ok(weather.every(row => row.access === 'read' && row.mode === 'public' && row.strategy === 'public' && row.browser === false && row.engine === 'builtin-public'));
  const upstream = catalog.records.filter(row => row.callable && row.mode === 'public' && !weather.includes(row));
  assert.equal(upstream.length, 23);
  assert.deepEqual(upstream.map(row => `${row.site}/${row.command}`).sort(), OPENCLI_QUERY_POLICIES.map(row => `${row.site}/${row.command}`).sort());
  assert.equal(catalog.summary.publicQueryCommands, 29);
  assert.equal(catalog.summary.queryCommands, 29 + OPENCLI_BROWSER_POLICIES.length);
  for (const site of ['weathercn', 'nmc']) {
    const entry = catalog.sites.find(row => row.site === site);
    assert.equal(entry.needsBrowserBridge, false);
    assert.equal(entry.queryCommands, 3);
    const details = await describeOpenCliSites({ site });
    assert.equal(details.commands.length, 3);
    assert.ok(details.commands.every(row => row.inputSchema.additionalProperties === false));
  }
});

test('weather schemas accept discovered identifiers and reject URLs, scripts, credentials and guessed station fields', () => {
  assert.deepEqual(request('locations', { query: ' 上海市浦东新区 ' }).arguments, { query: '上海市浦东新区', limit: 10 });
  assert.equal(request('forecast', { location_id: TOWN_ID }).arguments.location_id, TOWN_ID);
  for (const value of [
    { site: 'weathercn', command: 'forecast', arguments: { location_id: '101020600001', url: 'https://evil.example/' } },
    { site: 'weathercn', command: 'forecast', arguments: { location_id: '../../secret' } },
    { site: 'weathercn', command: 'locations', arguments: { query: '浦东', limit: '2' } },
    { site: 'weathercn', command: 'search', arguments: { query: '花木\n脚本' } },
    { site: 'nmc', command: 'weather', arguments: { province: 'ASH', station_id: 'x', api_key: 'synthetic' } },
    { site: 'nmc', command: 'weather', arguments: { province: 'ASH', wmo: '58367' } },
  ]) assert.throws(() => validateOpenCliQuery(value));
});

test('official location directory returns complete identities and ignores malformed or duplicate identifiers', () => {
  const rows = parseWeatherLocations(DIRECTORY);
  const pudong = rows.find(row => row.location_id === COUNTY_ID);
  assert.equal(pudong.full_name, '上海市 / 浦东新区');
  assert.equal(pudong.source_url, COUNTY_URL);
  assert.equal(pudong.precision, 'administrative-area');
  const malformed = 'var city_data={"上海市":{"上海市":{"假地点":{"AREAID":"../../wrong","NAMECN":"假地点"}}}};';
  assert.throws(() => parseWeatherLocations(malformed), /为空或过大/);
});

test('continuous full province/city/county place names resolve without separator guessing', async () => {
  await withFetch({ [DIRECTORY_URL]: DIRECTORY }, async () => {
    const rows = await runWeatherQuery(request('locations', { query: '上海市浦东新区' }));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].location_id, COUNTY_ID);
    assert.equal(rows[0].selection_required, false);
  });
});

test('same-name results remain multiple candidates and province filter resolves them explicitly', async () => {
  await withFetch({ [DIRECTORY_URL]: DIRECTORY }, async calls => {
    const rows = await runWeatherQuery(request('locations', { query: '朝阳' }));
    assert.equal(rows.length, 2);
    assert.ok(rows.every(row => row.selection_required && row.candidate_count === 2));
    assert.deepEqual(rows.map(row => row.province).sort(), ['江苏省', '辽宁省']);
    const truncated = await runWeatherQuery(request('locations', { query: '朝阳', limit: 1 }));
    assert.equal(truncated.length, 1);
    assert.equal(truncated[0].candidate_count, 2);
    assert.equal(truncated[0].selection_required, true);
    assert.equal(truncated[0].results_truncated, true);
    const selected = await runWeatherQuery(request('locations', { query: '朝阳', province: '辽宁' }));
    assert.equal(selected.length, 1);
    assert.equal(selected[0].location_id, '101071201');
    assert.equal(selected[0].selection_required, false);
    assert.ok(calls.every(url => url === DIRECTORY_URL), 'Discovery must not fetch any candidate forecast');
  });
});

test('town search preserves real parent identity and rejects executable JSONP wrappers', () => {
  const ref = [TOWN_ID, 'huamu', '花木街道', '', '浦东新区', '', '', '', '', '上海市'].join('~');
  const source = `success_jsonpCallback(${JSON.stringify([{ ref }, { ref }])});`;
  const rows = parseWeatherSearch(source);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].full_name, '上海市 / 浦东新区 / 花木街道');
  assert.equal(rows[0].precision, 'town-or-subdistrict-forecast');
  assert.equal(rows[0].source_url, TOWN_URL);
  for (const text of [source + 'globalThis.weatherInjected=true;', 'evilCallback([])', 'success_jsonpCallback([{}]);alert(1)', 'success_jsonpCallback([(()=>{})()])']) {
    assert.throws(() => parseWeatherSearch(text), /格式已变更/);
  }
  assert.equal(globalThis.weatherInjected, undefined);
});

test('county seven-day and three-hour forecasts retain accurate dates across New Year', () => {
  const data = parseCountyForecast(countyFixture(), COUNTY, NOW);
  assert.deepEqual(data.daily.entries.map(row => row.date), ['2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03', '2027-01-04', '2027-01-05', '2027-01-06']);
  assert.equal(data.daily.published_at, '2026-12-31T08:00:00+08:00');
  assert.equal(data.intervals.published_at, '2026-12-31T11:30:00+08:00');
  assert.deepEqual(data.intervals.entries.slice(0, 4).map(row => row.valid_at), ['2026-12-31T20:00:00+08:00', '2026-12-31T23:00:00+08:00', '2027-01-01T02:00:00+08:00', '2027-01-01T05:00:00+08:00']);
  assert.equal(data.intervals.entries.at(-1).valid_at, '2027-01-07T17:00:00+08:00');
  assert.equal(data.timezone, 'Asia/Shanghai');
  assert.match(data.notes.join(' '), /不是指定街道、小区或门牌的观测/);
});

test('county month and leap-day rollovers do not attach observations to the wrong calendar year', () => {
  for (const [base, next] of [['2026-01-31', '2026-02-01'], ['2028-02-28', '2028-02-29'], ['2028-02-29', '2028-03-01']]) {
    const data = parseCountyForecast(countyFixture({ base }), COUNTY, new Date(`${base}T12:00:00+08:00`));
    assert.equal(data.daily.entries[1].date, next);
    assert.equal(data.intervals.entries[2].valid_at, `${next}T02:00:00+08:00`);
  }
  assert.equal(weatherTime('2026-02-29 08:00'), null);
  assert.equal(weatherTime('2026-12-31 24:00'), null);
});

test('alternate hour3data datasets never duplicate or contaminate the authoritative seven-day collection', () => {
  const data = parseCountyForecast(countyFixture(), COUNTY, NOW);
  assert.equal(data.intervals.entries.length, 56);
  assert.ok(data.intervals.entries.every(row => row.temperature_c < 90));
  assert.equal(data.intervals.entries[0].temperature_c, 20);
  assert.equal(new Set(data.intervals.entries.map(row => row.valid_at)).size, 56);
});

test('duplicate or reversed intervals inside the authoritative county collection fail rather than give contradictory temperatures', () => {
  for (const hourly of [
    [['31日20时,n00,晴,20℃,北风,1级', '31日20时,n00,晴,22℃,北风,1级']],
    [['31日23时,n00,晴,20℃,北风,1级', '31日20时,n00,晴,22℃,北风,1级']],
  ]) assert.throws(() => parseCountyForecast(countyFixture({ hourly }), COUNTY, NOW), /时间|顺序|重复/);
});

test('county stale, future and unknown publication status stays separate from forecast valid times', () => {
  const stale = parseCountyForecast(countyFixture({ base: '2026-12-29' }), COUNTY, NOW);
  assert.equal(stale.daily.freshness.status, 'stale');
  assert.equal(stale.intervals.freshness.status, 'stale');
  const future = parseCountyForecast(countyFixture({ base: '2027-01-01' }), COUNTY, NOW);
  assert.equal(future.daily.freshness.status, 'future');
  const unknown = parseCountyForecast(countyFixture({ published: '', hourlyPublished: '' }), COUNTY, NOW);
  assert.equal(unknown.daily.published_at, null);
  assert.equal(unknown.daily.freshness.status, 'unknown');
  assert.ok(unknown.daily.entries.every(row => row.date === null));
  assert.ok(unknown.intervals.entries.every(row => row.valid_at === null));
  assert.equal(unknown.intervals.freshness.status, 'unknown');
  assert.equal(weatherFreshness('invalid', NOW).status, 'unknown');
});

test('missing temperatures remain null, valid zero remains zero, and hourly missing values are not degrees', () => {
  const html = countyFixture().replace('<span>25℃</span><i>18℃</i>', '<span>9999℃</span><i></i>').replace('晴,20℃', '晴,0℃').replace('晴,19℃', '晴,-9999℃');
  const data = parseCountyForecast(html, COUNTY, NOW);
  assert.equal(data.daily.entries[0].high_c, null);
  assert.equal(data.daily.entries[0].low_c, null);
  assert.equal(data.intervals.entries[0].temperature_c, 0);
  assert.equal(data.intervals.entries[1].temperature_c, null);
});

test('county title mismatch, inconsistent daily date and wholly empty forecast do not masquerade as weather', () => {
  assert.throws(() => parseCountyForecast(countyFixture().replace('浦东新区天气预报', '闵行天气预报'), COUNTY, NOW), /地点.*不一致/);
  assert.throws(() => parseCountyForecast(countyFixture().replace('<h1>1日</h1>', '<h1>2日</h1>'), COUNTY, NOW), /日期.*不一致/);
  assert.throws(() => parseCountyForecast(`<title>浦东新区天气预报</title><a href="/weather/${COUNTY_ID}.shtml">7天</a>`, COUNTY, NOW), /为空|结构/);
  assert.throws(() => parseCountyForecast(countyFixture({ empty: true, hourly: [] }), COUNTY, NOW), /为空|缺少|无效|有效/);
});

test('same-name county forecasts must retain the exact selected official id in their own navigation', () => {
  const selected = { ...COUNTY, location_id: '101190401', name: '朝阳', province: '江苏省', city: '苏州市', full_name: '江苏省 / 苏州市 / 朝阳' };
  const valid = countyFixture({ name: '朝阳', navigationId: selected.location_id });
  assert.equal(parseCountyForecast(valid, selected, NOW).location.location_id, selected.location_id);
  const wrongProvince = countyFixture({ name: '朝阳', navigationId: '101071201' });
  assert.throws(() => parseCountyForecast(wrongProvince, selected, NOW), /地点|所选|导航|身份/);
  assert.throws(() => parseCountyForecast(valid.replace(`<a href="/weather/${selected.location_id}.shtml">7天</a>`, ''), selected, NOW), /地点|所选|导航|身份/);
});

test('town daily identity belongs to the resolved parent and exact selected town id', async () => {
  await withFetch({ [DIRECTORY_URL]: DIRECTORY, [TOWN_URL]: townFixture() }, async () => {
    const [data] = await runWeatherQuery(request('forecast', { location_id: TOWN_ID }), { now: NOW });
    assert.equal(data.location.location_id, TOWN_ID);
    assert.equal(data.location.parent_id, COUNTY_ID);
    assert.equal(data.location.parent_name, '浦东新区');
    assert.equal(data.location.name, '花木街道');
    assert.equal(data.location.full_name, '上海市 / 浦东新区 / 花木街道');
    assert.equal(data.location.precision, 'town-or-subdistrict-forecast');
    assert.equal(data.source_url, TOWN_URL);
  });
  assert.throws(() => parseTownForecast(townFixture({ parentName: '闵行区' }), COUNTY, TOWN_ID, NOW), /不属于|地点不一致/);
  assert.throws(() => parseTownForecast(townFixture({ id: '101020600999' }), COUNTY, TOWN_ID, NOW), /不属于|地点不一致/);
});

test('a town listed among neighboring villages is not proof that it is the displayed forecast town', () => {
  const wrongTown = townFixture({ navigationId: '101020600002' });
  assert.throws(() => parseTownForecast(wrongTown, COUNTY, TOWN_ID, NOW), /地点|所选|导航|身份|不一致/);
  const missingNavigation = townFixture().replace(`<a href="/town/weathern/${TOWN_ID}.shtml">7天</a>`, '');
  assert.throws(() => parseTownForecast(missingNavigation, COUNTY, TOWN_ID, NOW), /地点|所选|导航|身份|不一致/);
});

test('town interval coverage crosses month/year and daily highs exclude yesterday', () => {
  const data = parseTownForecast(townFixture(), COUNTY, TOWN_ID, NOW);
  assert.equal(data.valid_from, '2026-12-31T08:00:00+08:00');
  assert.equal(data.valid_to, '2027-01-07T05:00:00+08:00');
  assert.deepEqual(data.daily.map(row => row.date), ['2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03', '2027-01-04', '2027-01-05', '2027-01-06']);
  assert.deepEqual(data.daily.map(row => row.high_c), [21, 22, 23, 24, 25, 26, 27]);
  assert.deepEqual(data.daily.map(row => row.low_c), [11, 12, 13, 14, 15, 16, 17]);
  assert.equal(data.intervals.entries.length, 56);
  assert.deepEqual(data.intervals.temporal_resolution_hours, [3]);
  assert.equal(data.intervals.entries[6].valid_at, '2027-01-01T02:00:00+08:00');
  assert.equal(data.intervals.entries[8].valid_at, '2027-01-01T08:00:00+08:00');
});

test('town dates cannot repeat across day groups even when interval ordering is superficially valid', () => {
  const start = Date.parse('2026-12-31T08:00:00+08:00');
  const points = Array.from({ length: 7 }, (_, i) => Array.from({ length: 2 }, (_, j) => ({ jf: compactHour(start + (i * 6 + j * 3) * 3600000), jb: 20, ja: '00', jc: '0', jd: '8' })));
  assert.throws(() => parseTownForecast(townFixture({ points }), COUNTY, TOWN_ID, NOW), /日期|每日|顺序|内容|范围/);
});

test('town visible day labels must agree with dated intervals before highs/lows are attached', () => {
  const labels = Array.from({ length: 8 }, (_, i) => dayLabel(addDays('2026-12-31', i - 1)));
  labels[2] = '2日';
  assert.throws(() => parseTownForecast(townFixture({ labels }), COUNTY, TOWN_ID, NOW), /日期|日标签|不一致/);
});

test('town untrusted browser update text cannot create a publication time or fresh claim', () => {
  const data = parseTownForecast(townFixture() + '<div class="updateTime">今天12:00更新</div>', COUNTY, TOWN_ID, NOW);
  assert.equal(data.published_at, null);
  assert.deepEqual(data.freshness, { status: 'unknown', age_hours: null });
  assert.equal(data.coverage_status, 'includes-future');
  const expired = parseTownForecast(townFixture({ base: '2026-12-01' }), COUNTY, TOWN_ID, NOW);
  assert.equal(expired.coverage_status, 'expired');
  assert.equal(expired.freshness.status, 'unknown');
  assert.match(data.notes.join(' '), /浏览器时钟/);
  assert.match(data.notes.join(' '), /不代表小区\/门牌实况/);
});

test('town invalid calendar dates, reversed points, missing values and malformed JSON are handled explicitly', () => {
  const fixture = townFixture();
  assert.throws(() => parseTownForecast(fixture.replace('2026123108', '2026023008'), COUNTY, TOWN_ID, NOW), /完整日期|时间无效/);
  assert.throws(() => parseTownForecast(fixture.replace('2026123111', '2026123108'), COUNTY, TOWN_ID, NOW), /时间顺序/);
  assert.throws(() => parseTownForecast(fixture.replace('var villages=', 'var villages=notJson;var unused='), COUNTY, TOWN_ID, NOW), /不是 JSON/);
  const missing = parseTownForecast(townFixture({ highs: [1, 9999, 0, 21, 22, 23, 24, 25], lows: [1, '', -9999, 0, 12, 13, 14, 15] }).replace('"jb":20', '"jb":""'), COUNTY, TOWN_ID, NOW);
  assert.equal(missing.daily[0].high_c, null);
  assert.equal(missing.daily[0].low_c, null);
  assert.equal(missing.daily[1].high_c, 0);
  assert.equal(missing.daily[1].low_c, null);
  assert.equal(missing.daily[2].low_c, 0);
  assert.equal(missing.intervals.entries[0].temperature_c, null);
});

test('forecast rejects unknown administrative ids before fetching an unrelated page', async () => {
  await withFetch({ [DIRECTORY_URL]: DIRECTORY }, async calls => {
    await assert.rejects(runWeatherQuery(request('forecast', { location_id: '101999999001' })), /不在.*官方行政目录/);
    assert.deepEqual(calls, [DIRECTORY_URL]);
  });
});

test('empty and non-JSON source responses fail without inventing weather or falling back to another host', async () => {
  await withFetch({ [DIRECTORY_URL]: '' }, () => assert.rejects(runWeatherQuery(request('locations', { query: '浦东' })), /空数据/));
  await withFetch({ [DIRECTORY_URL]: 'var city_data=window.someFunction();' }, () => assert.rejects(runWeatherQuery(request('locations', { query: '浦东' })), /不是 JSON/));
  await withFetch({ 'https://www.nmc.cn/rest/province/all': '<html>maintenance</html>' }, () => assert.rejects(runWeatherQuery({ site: 'nmc', command: 'provinces', arguments: {} }), /JSON 格式已变更/));
  await withFetch({ [DIRECTORY_URL]: DIRECTORY, [COUNTY_URL]: `<title>浦东新区天气</title><a href="/weather/${COUNTY_ID}.shtml">7天</a>` }, () => assert.rejects(runWeatherQuery(request('forecast', { location_id: COUNTY_ID })), /预报为空|结构已变更/));
  await assert.rejects(async () => runWeatherQuery({ site: 'weathercn', command: 'execute', arguments: {} }), /未开放/);
});

test('final response URL cannot silently redirect a weather query to a same-name station or a different host', async () => {
  for (const finalUrl of ['https://www.weather.com.cn/weather/101071201.shtml', 'https://evil.example/weather/101020600.shtml']) {
    const response = new Response(countyFixture(), { status: 200 });
    Object.defineProperty(response, 'url', { value: finalUrl });
    await withFetch({ [COUNTY_URL]: response }, () => assert.rejects(weatherText(COUNTY_URL), /地址|重定向|不一致|来源/));
  }
  await withFetch({ [COUNTY_URL]: countyFixture() }, async () => assert.match(await weatherText(COUNTY_URL), /浦东新区天气预报/));
});

test('the actual isolated worker runs a normal weather query using explicit mock import and no network', async () => {
  const child = await runFixtureWorker(request('forecast', { location_id: COUNTY_ID }), {
    [DIRECTORY_URL]: { body: DIRECTORY },
    [COUNTY_URL]: { body: countyFixture() },
  });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stderr, '');
  const result = JSON.parse(child.stdout);
  assert.equal(result.site, 'weathercn');
  assert.equal(result.command, 'forecast');
  assert.equal(result.version, '1.8.8');
  assert.equal(result.count, 1);
  assert.equal(result.rows[0].location.location_id, COUNTY_ID);
  assert.equal(result.rows[0].source_url, COUNTY_URL);
  assert.equal(result.rows[0].daily.entries[1].date, '2027-01-01');
  assert.equal(result.rows[0].intervals.entries[2].valid_at, '2027-01-01T02:00:00+08:00');
});

test('the actual worker rejects an allowed-host redirect to a different same-name county with exit 1', async () => {
  const selectedId = '101190401';
  const selectedUrl = `https://www.weather.com.cn/weather/${selectedId}.shtml`;
  const redirectedUrl = 'https://www.weather.com.cn/weather/101071201.shtml';
  const child = await runFixtureWorker(request('forecast', { location_id: selectedId }), {
    [DIRECTORY_URL]: { body: DIRECTORY },
    [selectedUrl]: { status: 302, headers: { location: redirectedUrl }, body: '' },
    [redirectedUrl]: { body: countyFixture({ name: '朝阳', navigationId: '101071201' }) },
  });
  assert.equal(child.status, 1);
  assert.equal(child.stdout, '', 'Rejected redirect must not emit a successful weather envelope');
  assert.match(child.stderr, /天气来源重定向到另一地址，无法确认地点/);
  assert.doesNotMatch(child.stderr, /No network allowed|Worker network policy was not applied/);
});

test('model-visible tool discovery explains official location selection, freshness and forecast precision', async () => {
  const sites = desktopToolSpecs.find(tool => tool.name === 'petpal_opencli_sites');
  const query = desktopToolSpecs.find(tool => tool.name === 'petpal_opencli_query');
  const prompt = await readFile(new URL('../server/codex.mjs', import.meta.url), 'utf8');
  assert.match(`${sites.description} ${query.description}`, /weathercn/);
  assert.match(`${sites.description} ${query.description}`, /nmc/);
  for (const term of ['weathercn', 'nmc', '同名', 'published_at', 'stale', 'future', 'unknown', '门牌', '历史观测']) assert.ok(prompt.includes(term), `Agent guidance missing ${term}`);
});

test('Windows worker and both Linux architectures require the complete built-in weather source closure', async () => {
  const paths = ['server/opencli-weather-common.mjs', 'server/opencli-weather-policies.mjs', 'server/opencli-weather-cn.mjs', 'server/opencli-weather-nmc.mjs', 'server/opencli-weather-adapters.mjs'];
  const builder = await readFile(new URL('../desktop/electron-builder.yml', import.meta.url), 'utf8');
  assert.match(builder, /asarUnpack:[\s\S]*server\/opencli\*\.mjs/);
  for (const relative of ['scripts/linux-package.mjs', 'scripts/linux-verify.mjs', 'scripts/windows-native-verify.mjs', 'scripts/windows-native-finalize.mjs']) {
    const source = await readFile(new URL(`../${relative}`, import.meta.url), 'utf8');
    for (const path of paths) assert.ok(source.includes(path), `${relative} missing required weather closure ${path}`);
  }
});
