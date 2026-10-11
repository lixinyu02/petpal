import { runChinaWeatherQuery } from './opencli-weather-cn.mjs';
import { runNmcWeatherQuery } from './opencli-weather-nmc.mjs';
import { weatherQueryPolicy } from './opencli-weather-policies.mjs';

export function runWeatherQuery(request, options) {
  if (!weatherQueryPolicy(request.site, request.command)) throw new Error('内置天气查询未开放。');
  return request.site === 'weathercn' ? runChinaWeatherQuery(request, options) : runNmcWeatherQuery(request, options);
}
