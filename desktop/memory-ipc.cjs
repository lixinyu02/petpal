'use strict';

const { timingSafeEqual } = require('node:crypto');
const failure = (code, message) => Object.assign(new Error(message), { code: `PETPAL_MEMORY_IPC_${code}` });
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const states = new Set(['stopped', 'checking', 'preparing', 'starting', 'running', 'stopping', 'error']);

function connection(value) {
  if (!object(value) || Object.keys(value).length !== 2 || typeof value.url !== 'string' || !value.url || value.url.length > 2048 ||
      /[\x00-\x20\x7f\\?#]/.test(value.url) || typeof value.token !== 'string' || !value.token || value.token.length > 4096 || /[\x00-\x20\x7f]/.test(value.token))
    throw failure('LOGIN', '请先登录后管理本机记忆。');
  let url; try { url = new URL(value.url); } catch { throw failure('LOGIN', '请先登录后管理本机记忆。'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash ||
      url.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw failure('LOGIN', '请先登录后管理本机记忆。');
  return { url: url.href.replace(/\/+$/, ''), token: value.token };
}
function same(left, right) {
  const a = Buffer.from(left.token), b = Buffer.from(right.token);
  return left.url === right.url && a.length === b.length && timingSafeEqual(a, b);
}

function memoryRuntimePublicStatus(value, publicMessages) {
  if (!object(value) || !states.has(value.state) || typeof value.supported !== 'boolean' || typeof value.platform !== 'string' ||
      typeof value.arch !== 'string' || value.version !== '0.0.42' || value.port !== 8019 ||
      ['running', 'prepared', 'configured', 'needsModel', 'autoStart'].some(key => typeof value[key] !== 'boolean') ||
      value.running !== (value.state === 'running') || ['dockerAvailable', 'daemonAvailable'].some(key => value[key] !== null && typeof value[key] !== 'boolean'))
    throw failure('STATUS', '本机记忆状态不完整，请重新打开小伴。');
  return Object.fromEntries(['supported', 'platform', 'arch', 'version', 'port', 'state', 'running', 'prepared', 'configured', 'needsModel', 'autoStart', 'dockerAvailable', 'daemonAvailable']
    .map(key => [key, value[key]]).concat([['error', value.error && publicMessages.has(value.error) ? value.error : value.error ? '本机记忆需要检查，请重新读取状态。' : '']]));
}

/** Machine-local runtime management for the currently verified login; no model keys cross IPC. */
function createMemoryRuntimeHandlers({ manager, isAllowed, readConnection, verifyConnection, publicMessages = [] } = {}) {
  if (!manager || ![isAllowed, readConnection, verifyConnection].every(item => typeof item === 'function')) throw new Error('Invalid memory runtime integration');
  const safeMessages = new Set(publicMessages);
  const trusted = event => { let allowed = false; try { allowed = isAllowed(event); } catch {} if (!allowed) throw failure('TRUST', '本机记忆仅允许可信主窗口管理。'); };
  function guard(event, value) {
    trusted(event); const expected = connection(value); let expectedIdentity;
    return async () => {
      trusted(event); let current;
      try { current = connection(await readConnection(event)); } catch { throw failure('LOGIN', '请先登录后管理本机记忆。'); }
      trusted(event); if (!same(current, expected)) throw failure('CHANGED', '登录账号已变化，请重新打开记忆设置。');
      let identity; try { identity = await verifyConnection(expected); } catch { throw failure('VERIFY', '无法验证当前账号，请检查服务连接或重新登录。'); }
      if (!object(identity) || !id(identity.instanceId) || !id(identity.userId)) throw failure('VERIFY', '无法验证当前账号，请检查服务连接或重新登录。');
      if (expectedIdentity && (identity.instanceId !== expectedIdentity.instanceId || identity.userId !== expectedIdentity.userId)) throw failure('CHANGED', '登录账号已变化，请重新打开记忆设置。');
      expectedIdentity = identity; trusted(event);
      let confirmed; try { confirmed = connection(await readConnection(event)); } catch { throw failure('LOGIN', '请先登录后管理本机记忆。'); }
      trusted(event); if (!same(confirmed, expected)) throw failure('CHANGED', '登录账号已变化，请重新打开记忆设置。');
    };
  }
  return Object.fromEntries(['status', 'prepare', 'start', 'stop', 'preferences'].map(action => [`petpal:memory-runtime:${action}`, async (event, value, input) => {
    const authorize = guard(event, value); await authorize();
    if (action !== 'preferences' && input !== undefined) throw failure('INPUT', '本机记忆请求无效。');
    let result;
    try { result = action === 'status' ? await manager.status() : action === 'preferences' ? await manager.preferences(input, { authorize }) : await manager[action]({ authorize }); }
    catch (error) {
      if (/^PETPAL_MEMORY_IPC_/.test(error?.code || '')) throw error;
      if (/^PETPAL_MEMOBASE_/.test(error?.code || '') && safeMessages.has(error.message)) throw failure('RUNTIME', error.message);
      throw failure('RUNTIME', '本机记忆操作未能完成，请重新读取状态后重试。');
    }
    await authorize(); return memoryRuntimePublicStatus(result, safeMessages);
  }]));
}

module.exports = { createMemoryRuntimeHandlers, memoryRuntimePublicStatus };
