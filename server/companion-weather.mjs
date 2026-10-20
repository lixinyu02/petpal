import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { OpenCliManager } from './opencli-manager.mjs';
import { validateOpenCliQuery } from './opencli-sites.mjs';

const retained = new Set();
const fail = message => Object.assign(new Error(message), { status: 502 });

async function removeScratch(directory, parent) {
  const resolved = path.resolve(directory), relative = path.relative(parent, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || path.dirname(resolved) !== parent || !path.basename(resolved).startsWith('petpal-companion-weather-')) throw fail('天气临时目录范围无效，已保留。');
  await rm(resolved, { recursive: true, force: true });
}

/** A failed close retains the exact owned process/manager, never a shared PID.
 * An explicit service shutdown can retry cleanup without launching more work. */
export async function closeCompanionWeatherQueries() {
  for (const entry of [...retained]) {
    await entry.manager.close();
    await removeScratch(entry.directory, entry.parent);
    retained.delete(entry);
  }
}

/** Only fixed official weather commands enter the existing bounded worker.
 * This manager owns a fresh temporary scope and cannot enable or read a user's
 * OpenCLI configuration, Chrome profiles, cookies, arbitrary URL or plugins. */
export async function queryCompanionWeather(request, { signal, managerFactory = options => new OpenCliManager(options) } = {}) {
  signal?.throwIfAborted();
  if (retained.size) throw fail('先前天气查询尚未确认退出，暂不启动新的查询。');
  if (request?.site !== 'weathercn' || !['search', 'forecast'].includes(request?.command)) throw Object.assign(new Error('每日陪伴只允许固定的官方地点搜索和预报查询。'), { status: 400 });
  const args = validateOpenCliQuery(request);
  const parent = path.resolve(tmpdir()), directory = await mkdtemp(path.join(parent, 'petpal-companion-weather-'));
  let manager, confirmed = false;
  try {
    signal?.throwIfAborted();
    manager = managerFactory({ dataDir: directory, scope: 'daily-companion-weather', timeoutMs: 20000, maxOutputBytes: 128 * 1024,
      browser: { async close() {} }, browserSetup: { async close() {} } });
    // The absent private config uses OpenCliManager's enabled default. Do not
    // call configure(): no saved user preference is modified for this service.
    return await manager.query(args, { signal });
  } finally {
    try { if (manager) await manager.close(); confirmed = true; }
    catch { retained.add({ manager, directory, parent }); throw fail('天气查询收尾未确认，已保留进程身份，未自动重试。'); }
    finally { if (confirmed) await removeScratch(directory, parent); }
  }
}
