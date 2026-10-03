'use strict';

const { timingSafeEqual } = require('node:crypto');
const error = (key, message) => Object.assign(new Error(message), { code: `PETPAL_CENTRAL_IPC_${key}` });
const object = value => value && typeof value === 'object' && !Array.isArray(value);

function connection(value, origin) {
  if (!object(value) || Object.keys(value).length !== 2 || !Object.hasOwn(value, 'url') || !Object.hasOwn(value, 'token') ||
      typeof value.url !== 'string' || typeof value.token !== 'string' || !value.token || value.token.length > 4096 ||
      /[\x00-\x20\x7f]/.test(value.token)) throw error('LOGIN', '请先登录本机管理员账号。');
  // Exact loopback origin, with no aliases, URL prefixes or remote owner fallback.
  if (value.url !== origin) throw error('LOCAL', '中央服务器仅可由本机管理员管理，请切换到本机服务。');
  return { url: value.url, token: value.token };
}

function same(left, right) {
  if (left.url !== right.url) return false;
  const a = Buffer.from(left.token), b = Buffer.from(right.token);
  return a.length === b.length && timingSafeEqual(a, b);
}

function createCentralServerHandlers(manager, { isAllowed, readConnection, origin, assertOwnerSession }) {
  const trusted = event => {
    let allowed = false;
    try { allowed = isAllowed(event); } catch {}
    if (!allowed) throw error('UNTRUSTED', '中央服务器仅允许可信主窗口管理。');
  };
  const authorization = (event, value) => {
    trusted(event);
    const expected = connection(value, origin);
    return async () => {
      trusted(event);
      let current;
      try { current = connection(await readConnection(event), origin); }
      catch (failure) { if (/^PETPAL_CENTRAL_IPC_/.test(failure?.code || '')) throw failure; throw error('LOGIN', '请先登录本机管理员账号。'); }
      trusted(event);
      if (!same(expected, current)) throw error('CHANGED', '登录账号已变化，请重新打开中央服务器设置。');
      try { await assertOwnerSession(expected.token); }
      catch { throw error('OWNER', '仅本机管理员可管理中央服务器，请重新登录本机管理员账号。'); }
      trusted(event);
      let confirmed;
      try { confirmed = connection(await readConnection(event), origin); }
      catch { throw error('LOGIN', '请先登录本机管理员账号。'); }
      trusted(event);
      if (!same(expected, confirmed)) throw error('CHANGED', '登录账号已变化，请重新打开中央服务器设置。');
      // A logout may revoke the server session while the renderer read is pending.
      try { await assertOwnerSession(expected.token); }
      catch { throw error('OWNER', '仅本机管理员可管理中央服务器，请重新登录本机管理员账号。'); }
      trusted(event);
    };
  };
  const sanitized = (failure, operation) => {
    if (/^PETPAL_CENTRAL_(?:IPC|SERVER)_/.test(failure?.code || '')) return failure;
    return error(operation, operation === 'STATUS' ? '无法读取中央服务器状态，请重新打开小伴。' : '中央服务器设置未能保存，请稍后重试。');
  };
  return {
    'petpal:central-server:status': async (event, value) => {
      const authorize = authorization(event, value); await authorize();
      let result;
      try { result = await manager.status(); } catch (failure) { throw sanitized(failure, 'STATUS'); }
      await authorize(); return result;
    },
    'petpal:central-server:update': async (event, value, patch) => {
      const authorize = authorization(event, value); await authorize();
      let result;
      try { result = await manager.update(patch, { authorize }); } catch (failure) { throw sanitized(failure, 'UPDATE'); }
      await authorize(); return result;
    },
  };
}

module.exports = { createCentralServerHandlers };
