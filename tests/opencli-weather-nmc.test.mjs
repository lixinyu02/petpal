import test from 'node:test';
import assert from 'node:assert/strict';
import { runNmcWeatherQuery } from '../server/opencli-weather-nmc.mjs';

const ORIGIN = 'https://www.nmc.cn';
const NOW = new Date('2026-10-11T04:14:00Z');
const PROVINCES = [
  { code: 'ASH', name: '上海市', url: '/publish/forecast/ASH.html' },
  { code: 'ABJ', name: '北京市', url: '/publish/forecast/ABJ.html' },
];
const LOCATIONS = [
  { code: 'atcMf', province: '上海市', city: '浦东', url: '/publish/forecast/ASH/pudong.html' },
  { code: 'ttcsH', province: '上海市', city: '闵行', url: '/publish/forecast/ASH/zuoxing.html' },
];

function fixture() {
  return {
    msg: 'success', code: 0,
    data: {
      real: {
        station: LOCATIONS[0], publish_time: '2026-10-11 11:40',
        weather: { temperature: 25.7, info: '晴', img: '0', feelst: 27, airpressure: 9999, humidity: 52, rain: 0 },
        wind: { direct: '东北风', degree: 18, power: '微风', speed: 1.9 },
        warn: { alert: '9999', url: '9999', issuetime: '' },
        sunriseSunset: { sunrise: '2026-10-11 05:53', sunset: '2026-10-11 17:27' },
      },
      predict: {
        station: LOCATIONS[0], publish_time: '2026-10-11 12:00',
        detail: [{ date: '2026-10-11', pt: '2026-10-11 12:00',
          day: { weather: { info: '多云', img: '1', temperature: '25' }, wind: { direct: '北风', power: '微风' } },
          night: { weather: { info: '晴', img: '0', temperature: '18' }, wind: { direct: '北风', power: '微风' } },
          precipitation: 0,
        }],
      },
      passedchart: [{ time: '2026-10-11 11:00', temperature: 25.6, humidity: 56, pressure: 1020, rain1h: 0, windSpeed: 4.3, windDirection: 9999 }],
      air: { forecasttime: '2026-10-11 11:00', aqi: 35, text: '优' },
      // This array contains both historical and predicted numbers upstream.
      // The adapter deliberately reads the dated predict.detail instead.
      tempchart: [{ time: '2026/10/01', max_temp: 9999, min_temp: 9999 }],
    },
  };
}

async function withFetch(fn, { provinces = PROVINCES, locations = LOCATIONS, weather = fixture() } = {}) {
  const previous = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async input => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    const data = url === `${ORIGIN}/rest/province/all` ? provinces
      : url === `${ORIGIN}/rest/province/ASH` ? locations
        : url === `${ORIGIN}/rest/weather?stationid=atcMf` ? weather : undefined;
    if (data === undefined) throw new Error(`unexpected fixture URL: ${url}`);
    const response = new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json; charset=UTF-8' } });
    Object.defineProperty(response, 'url', { value: url });
    return response;
  };
  try { return await fn(calls); } finally { globalThis.fetch = previous; }
}

const weatherRequest = { site: 'nmc', command: 'weather', arguments: { province: 'ASH', station_id: 'atcMf' } };

test('NMC province and location discovery retains official codes and complete place names', async () => {
  await withFetch(async () => {
    const provinces = await runNmcWeatherQuery({ site: 'nmc', command: 'provinces' });
    assert.equal(provinces[0].province_code, 'ASH');
    assert.equal(provinces[0].source_url, `${ORIGIN}/publish/forecast/ASH.html`);
    const rows = await runNmcWeatherQuery({ site: 'nmc', command: 'locations', arguments: { province: 'ASH', query: '浦东', limit: 1 } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].station_id, 'atcMf');
    assert.equal(rows[0].location, '上海市 浦东');
    assert.equal(rows[0].precision, 'city_or_county_station');
  });
});

test('NMC observations, forecasts and hourly history keep separate Beijing timestamps', async () => {
  await withFetch(async () => {
    const [row] = await runNmcWeatherQuery(weatherRequest, { now: NOW });
    assert.equal(row.fetched_at, '2026-10-11T12:14:00.000+08:00');
    assert.equal(row.real.published_at, '2026-10-11T11:40:00+08:00');
    assert.equal(row.predict.published_at, '2026-10-11T12:00:00+08:00');
    assert.equal(row.real.freshness.status, 'fresh');
    assert.equal(row.predict.freshness.status, 'fresh');
    assert.equal(row.real.has_data, true);
    assert.equal(row.predict.has_data, true);
    assert.equal(row.predict.daily[0].freshness.status, 'fresh');
    assert.equal(row.predict.daily[0].publication_matches_group, true);
    assert.equal(row.predict.daily[0].day.temperature_c, 25);
    assert.equal(row.predict.daily[0].night.temperature_c, 18);
    assert.equal(row.predict.daily[0].precipitation_mm, 0);
    assert.equal(row.real.rain_period, 'upstream_unspecified');
    assert.equal(row.observations_history.temporal_resolution, 'hourly_observation');
    assert.equal(row.observations_history.rows[0].observed_at, '2026-10-11T11:00:00+08:00');
    assert.equal(row.predict.temporal_resolution, 'daily_day_night');
    assert.equal(row.predict.daily.length, 1);
    assert.equal(row.predict.hourly, undefined);
    assert.equal(row.predict.three_hourly, undefined);
    assert.match(row.precision_note, /不能宣称街道或门牌级精度/);
  });
});

test('NMC missing sentinel and empty strings return null while valid zero remains zero', async () => {
  const data = fixture();
  data.data.real.weather.feelst = '';
  data.data.real.wind.degree = -9999;
  data.data.predict.detail[0].night.weather.temperature = '9999';
  data.data.predict.detail[0].day.weather.info = '9999';
  await withFetch(async () => {
    const [row] = await runNmcWeatherQuery(weatherRequest, { now: NOW });
    assert.equal(row.real.pressure_hpa, null);
    assert.equal(row.real.feels_like_c, null);
    assert.equal(row.real.wind_direction_degrees, null);
    assert.equal(row.real.rain_mm, 0);
    assert.equal(row.predict.daily[0].day.weather, null);
    assert.equal(row.predict.daily[0].night.temperature_c, null);
    assert.equal(row.observations_history.rows[0].wind_direction_degrees, null);
    assert.equal(row.warning, null);
  }, { weather: data });
});

test('NMC unknown timestamps are not invented and invalid calendar dates are rejected', async () => {
  const data = fixture();
  data.data.real.publish_time = '11:40';
  data.data.predict.publish_time = '2026-02-30 12:00';
  data.data.predict.detail[0].pt = '12:00';
  data.data.passedchart[0].time = '2026-02-30 11:00';
  await withFetch(async () => {
    const [row] = await runNmcWeatherQuery(weatherRequest, { now: NOW });
    assert.equal(row.real.published_at, null);
    assert.equal(row.real.freshness.status, 'unknown');
    assert.equal(row.predict.published_at, null);
    assert.equal(row.predict.freshness.status, 'unknown');
    assert.equal(row.predict.daily[0].published_at, null);
    assert.equal(row.observations_history.rows.length, 0);
  }, { weather: data });
});

test('NMC stale observations and future issue times are reported independently', async () => {
  const data = fixture();
  data.data.real.publish_time = '2026-10-10 11:40';
  data.data.predict.publish_time = '2026-10-12 12:00';
  data.data.predict.detail[0].date = '2026-10-12';
  data.data.predict.detail[0].pt = '2026-10-12 12:00';
  await withFetch(async () => {
    const [row] = await runNmcWeatherQuery(weatherRequest, { now: NOW });
    assert.equal(row.real.freshness.status, 'stale');
    assert.equal(row.predict.freshness.status, 'future');
  }, { weather: data });
});

test('NMC validates a province against current official list before requesting its locations', async () => {
  await withFetch(async calls => {
    await assert.rejects(runNmcWeatherQuery({ site: 'nmc', command: 'locations', arguments: { province: 'ZZZ' } }), /当前官方列表/);
    assert.deepEqual(calls, [`${ORIGIN}/rest/province/all`]);
  });
});

test('NMC cannot guess a numeric WMO identifier or select a code from another province', async () => {
  await withFetch(async calls => {
    await assert.rejects(runNmcWeatherQuery({ ...weatherRequest, arguments: { province: 'ASH', station_id: '58367' } }), /不接受猜测的WMO站号/);
    assert.equal(calls.length, 2);
    assert.ok(calls.every(url => !url.includes('/rest/weather')));
  });
});

test('NMC requires the weather payload to match the selected station identity', async () => {
  const data = fixture();
  data.data.real.station = { ...data.data.real.station, code: 'otherStation' };
  await withFetch(() => assert.rejects(runNmcWeatherQuery(weatherRequest), /地点代码.*不符/), { weather: data });
});

test('NMC empty successful response and upstream error are not treated as actual weather', async () => {
  for (const weather of [{ code: 0, msg: 'success', data: '' }, { code: 0, data: {} }, { code: 1, data: fixture().data }]) {
    await withFetch(() => assert.rejects(runNmcWeatherQuery(weatherRequest), /有效天气数据|不含有效实况或预报/), { weather });
  }
});

function removeCurrentValues(data) {
  for (const section of ['weather', 'wind']) {
    data.data.real[section] = Object.fromEntries(Object.keys(data.data.real[section]).map(key => [key, '9999']));
  }
}

function removeForecastValues(row) {
  for (const period of ['day', 'night']) {
    for (const section of ['weather', 'wind']) {
      row[period][section] = Object.fromEntries(Object.keys(row[period][section]).map(key => [key, '9999']));
    }
  }
  row.precipitation = -9999;
}

test('NMC fresh station metadata and astronomy cannot make all-missing weather usable', async () => {
  for (const keepForecastRow of [false, true]) {
    const data = fixture();
    removeCurrentValues(data);
    if (keepForecastRow) removeForecastValues(data.data.predict.detail[0]);
    else data.data.predict.detail = [];
    // Historic observations and AQI remain populated, but cannot replace current weather.
    await withFetch(() => assert.rejects(runNmcWeatherQuery(weatherRequest, { now: NOW }), /气象值均缺测/), { weather: data });
  }
});

test('NMC all-missing current weather stays unknown when actual forecast is available', async () => {
  const data = fixture();
  removeCurrentValues(data);
  await withFetch(async () => {
    const [row] = await runNmcWeatherQuery(weatherRequest, { now: NOW });
    assert.equal(row.real.published_at, '2026-10-11T11:40:00+08:00');
    assert.equal(row.real.has_data, false);
    assert.equal(row.real.freshness.status, 'unknown');
    assert.equal(row.real.temperature_c, null);
    assert.equal(row.real.sunrise_at, '2026-10-11T05:53:00+08:00');
    assert.equal(row.predict.has_data, true);
    assert.equal(row.predict.freshness.status, 'fresh');
  }, { weather: data });
});

test('NMC a stale daily issue remains stale under a fresh group announcement', async () => {
  const data = fixture();
  data.data.predict.detail.push({ ...structuredClone(data.data.predict.detail[0]), date: '2026-10-12' });
  data.data.predict.detail[0].pt = '2026-10-10 06:00';
  await withFetch(async () => {
    const [row] = await runNmcWeatherQuery(weatherRequest, { now: NOW });
    assert.equal(row.predict.published_at, '2026-10-11T12:00:00+08:00');
    assert.equal(row.predict.group_freshness.status, 'fresh');
    assert.equal(row.predict.daily[0].published_at, '2026-10-10T06:00:00+08:00');
    assert.equal(row.predict.daily[0].freshness.status, 'stale');
    assert.equal(row.predict.daily[0].publication_matches_group, false);
    assert.equal(row.predict.daily[1].freshness.status, 'fresh');
    assert.equal(row.predict.freshness.status, 'stale');
  }, { weather: data });
});

test('NMC absent daily pt is not replaced by a fresh group timestamp', async () => {
  const data = fixture();
  data.data.predict.detail[0].pt = '';
  await withFetch(async () => {
    const [row] = await runNmcWeatherQuery(weatherRequest, { now: NOW });
    assert.equal(row.predict.group_freshness.status, 'fresh');
    assert.equal(row.predict.daily[0].published_at, null);
    assert.equal(row.predict.daily[0].freshness.status, 'unknown');
    assert.equal(row.predict.daily[0].publication_matches_group, null);
    assert.equal(row.predict.freshness.status, 'unknown');
  }, { weather: data });
});

test('NMC missing daily values cannot be hidden by a fresh group issue time', async () => {
  const data = fixture();
  data.data.predict.detail.push({ ...structuredClone(data.data.predict.detail[0]), date: '2026-10-12' });
  removeForecastValues(data.data.predict.detail[0]);
  await withFetch(async () => {
    const [row] = await runNmcWeatherQuery(weatherRequest, { now: NOW });
    assert.equal(row.predict.daily[0].has_data, false);
    assert.equal(row.predict.daily[0].freshness.status, 'unknown');
    assert.equal(row.predict.daily[1].has_data, true);
    assert.equal(row.predict.freshness.status, 'unknown');
  }, { weather: data });
});

test('NMC rejects stale target dates, duplicate dates, unsorted dates and gaps in a fresh group', async () => {
  for (const dates of [
    ['2026-10-10'], ['2026-10-11', '2026-10-11'],
    ['2026-10-12', '2026-10-11'], ['2026-10-11', '2026-10-13'],
  ]) {
    const data = fixture();
    data.data.predict.detail = dates.map(date => ({ ...structuredClone(data.data.predict.detail[0]), date }));
    await withFetch(() => assert.rejects(runNmcWeatherQuery(weatherRequest, { now: NOW }), /日期与分组发布时间或连续顺序不符/), { weather: data });
  }
});

test('NMC rejects invalid daily calendars and issue times after their target date', async () => {
  const invalidDate = fixture();
  invalidDate.data.predict.detail[0].date = '2026-02-30';
  await withFetch(() => assert.rejects(runNmcWeatherQuery(weatherRequest), /无效日期/), { weather: invalidDate });
  const lateIssue = fixture();
  lateIssue.data.predict.detail[0].pt = '2026-10-12 12:00';
  await withFetch(() => assert.rejects(runNmcWeatherQuery(weatherRequest), /发布时间晚于对应预报日期/), { weather: lateIssue });
});

test('NMC entirely older forecast group retains historical dates and reports stale data', async () => {
  const data = fixture();
  data.data.predict.publish_time = '2026-10-10 06:00';
  data.data.predict.detail[0].date = '2026-10-10';
  data.data.predict.detail[0].pt = '2026-10-10 06:00';
  await withFetch(async () => {
    const [row] = await runNmcWeatherQuery(weatherRequest, { now: NOW });
    assert.equal(row.predict.daily[0].date, '2026-10-10');
    assert.equal(row.predict.daily[0].freshness.status, 'stale');
    assert.equal(row.predict.freshness.status, 'stale');
    assert.equal(row.real.freshness.status, 'fresh');
  }, { weather: data });
});

test('NMC official listing cannot smuggle a different host, credential URL or protocol', async () => {
  for (const url of ['https://evil.example/publish/forecast/x.html', '//evil.example/publish/forecast/x.html', 'file:///publish/x', 'https://user:secret@www.nmc.cn/publish/x']) {
    const locations = [{ ...LOCATIONS[0], url }];
    await withFetch(() => assert.rejects(runNmcWeatherQuery(weatherRequest), /官方主机校验/), { locations });
  }
});

test('NMC only follows list metadata for the requested province', async () => {
  const locations = [{ ...LOCATIONS[0], province: '北京市' }];
  await withFetch(() => assert.rejects(runNmcWeatherQuery(weatherRequest), /所属省份.*不符/), { locations });
});

test('NMC warning retains its own issue time and official detail link', async () => {
  const data = fixture();
  data.data.real.warn = { alert: '大风蓝色预警', issuecontent: '测试预警', issuetime: '2026-10-11 10:00', signaltype: '大风', signallevel: '蓝色', url: '/publish/country/warning/wind.html' };
  await withFetch(async () => {
    const [row] = await runNmcWeatherQuery(weatherRequest, { now: NOW });
    assert.equal(row.warning.title, '大风蓝色预警');
    assert.equal(row.warning.published_at, '2026-10-11T10:00:00+08:00');
    assert.equal(row.warning.source_url, `${ORIGIN}/publish/country/warning/wind.html`);
    assert.match(row.warning.note, /不代表.*全部预警/);
  }, { weather: data });
});

test('NMC caps the location list and rejects malformed identifiers before weather fetch', async () => {
  const locations = Array.from({ length: 60 }, (_, i) => ({ ...LOCATIONS[0], code: `station${i}`, city: `地点${i}` }));
  await withFetch(async () => {
    assert.equal((await runNmcWeatherQuery({ site: 'nmc', command: 'locations', arguments: { province: 'ASH', limit: 100 } })).length, 50);
    assert.equal((await runNmcWeatherQuery({ site: 'nmc', command: 'locations', arguments: { province: 'ASH' } })).length, 10);
    await assert.rejects(runNmcWeatherQuery({ site: 'nmc', command: 'locations', arguments: { province: '../private' } }), /字母数字代码/);
    await assert.rejects(runNmcWeatherQuery({ site: 'nmc', command: 'locations', arguments: { province: 'ASH', limit: 0 } }), /正整数/);
  }, { locations });
});
