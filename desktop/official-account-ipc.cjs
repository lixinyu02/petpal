'use strict';

const { timingSafeEqual } = require('node:crypto');
const { verifyPreferencesSessionConnection } = require('./app-preferences-ipc.cjs');

const publicError = Symbol('official-public-error');
const fail = (code, message) => Object.assign(new Error(message), { code: `PETPAL_OFFICIAL_${code}`, [publicError]: true });
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const text = (value, max = 256) => typeof value === 'string' && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) ? value : null;
function publicUsage(value) {
  if (!plain(value) || !['unverified', 'available', 'limit-reached', 'temporarily-unavailable', 'not-eligible'].includes(value.state)) return undefined;
  const counts = Object.fromEntries(['completedRequests', 'inputTokens', 'outputTokens', 'totalTokens'].map(key => [key, Number.isSafeInteger(value[key]) && value[key] >= 0 ? value[key] : 0]));
  return { state: value.state, checkedAt: timestamp(value.checkedAt), lastModel: text(value.lastModel, 200) && value.lastModel ? value.lastModel : null, ...counts };
}
const sameToken = (a, b) => {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

// Return only display data, even if a future runtime accidentally adds private
// fields. Account management never exposes bearer tokens or OAuth URLs to React.
function officialPublicStatus(value) {
  if (!plain(value) || !['signed-out', 'signing-in', 'signed-in'].includes(value.state))
    throw fail('STATUS', '无法读取官方账号状态，请重新打开设置。');
  return {
    supported: true, state: value.state, planUsageEnabled: value.planUsageEnabled === true,
    activeProfileId: text(value.activeProfileId, 160) ? value.activeProfileId : null,
    profiles: Array.isArray(value.profiles) ? value.profiles.slice(0, 64).filter(item => plain(item) && text(item.id, 160) && item.id).map(item => ({
      id: item.id, email: text(item.email, 320) ? item.email : '', label: text(item.label, 320) ? item.label : '',
      signedIn: item.signedIn === true, planUsageEnabled: item.planUsageEnabled === true,
    })) : [],
    models: Array.isArray(value.models) ? value.models.slice(0, 256).filter(item => plain(item) && text(item.id, 160) && item.id && text(item.model, 200) && item.model).map(item => ({
      id: item.id, model: item.model, displayName: text(item.displayName, 320) ? item.displayName : item.model,
      supportsImages: item.supportsImages === true,
    })) : [],
    ...(publicUsage(value.usage) ? { usage: publicUsage(value.usage) } : {}),
    ...(value.modelsLoading === true ? { modelsLoading: true } : {}),
    ...(timestamp(value.modelsCheckedAt) ? { modelsCheckedAt: timestamp(value.modelsCheckedAt) } : {}),
    ...(value.error ? { error: '官方账号需要重新连接，请重试登录或刷新状态。' } : {}),
    ...(value.modelsError ? { modelsError: '暂时无法读取官方模型，请刷新重试。' } : {}),
  };
}

function createOfficialAccountHandlers({ auth, accounts, origin, isAllowed, readConnection,
  verifyConnection = verifyPreferencesSessionConnection, unavailable = () => false } = {}) {
  const check = event => {
    let allowed = false;
    try { allowed = isAllowed(event); } catch {}
    if (!allowed) throw fail('UNTRUSTED', '官方账号仅允许可信主窗口管理。');
  };
  const connection = value => {
    if (!plain(value) || Object.keys(value).length !== 2 || !text(value.url, 2048) || !text(value.token, 4096) || !value.token || /\s/.test(value.token))
      throw fail('LOGIN', '请先登录这台电脑的小伴账号。');
    let url;
    try { url = new URL(value.url); } catch { throw fail('LOGIN', '请先登录这台电脑的小伴账号。'); }
    if (url.origin !== origin || url.pathname !== '/' || url.search || url.hash || url.username || url.password)
      throw fail('LOCAL', '官方账号保存在这台电脑，请先连接客户端的本机服务。');
    return { url: origin, token: value.token };
  };
  const guardFor = async (event, value) => {
    check(event);
    const expected = connection(value);
    let identity;
    const compare = async () => {
      check(event);
      let current;
      try { current = connection(await readConnection(event)); } catch { throw fail('CHANGED', '小伴登录已变化，请重新打开官方账号设置。'); }
      check(event);
      if (current.url !== expected.url || !sameToken(current.token, expected.token)) throw fail('CHANGED', '小伴登录已变化，请重新打开官方账号设置。');
    };
    const authorize = async () => {
      await compare();
      let next;
      try { next = await verifyConnection(expected); } catch { throw fail('VERIFY', '无法验证当前小伴登录，请重新登录后重试。'); }
      await compare();
      if (!plain(next) || !text(next.userId, 160) || !next.userId || !text(next.instanceId, 160) || !next.instanceId ||
          identity && (identity.userId !== next.userId || identity.instanceId !== next.instanceId))
        throw fail('CHANGED', '小伴登录已变化，请重新打开官方账号设置。');
      identity = next;
    };
    await authorize();
    return { userId: identity.userId, authorize, compare };
  };
  const operations = {
    status: (guard) => accounts.status(guard.userId),
    refresh: async guard => { await accounts.refresh(guard.userId); return accounts.status(guard.userId); },
    resumeUsage: async (guard, input) => {
      if (input !== undefined) throw fail('INPUT', '请使用客户端的额度重试入口。');
      await guard.authorize();
      await accounts.resumeUsage(guard.userId, { authorize: guard.authorize });
      return accounts.status(guard.userId);
    },
    start: async (guard, input) => {
      if (input !== undefined && (!plain(input) || Object.keys(input).some(key => key !== 'profileId') || input.profileId !== undefined && (!text(input.profileId, 160) || !input.profileId)))
        throw fail('INPUT', '请选择有效的官方账号。');
      await auth.start(guard.userId, input || {}, { authorize: guard.authorize });
      return accounts.status(guard.userId);
    },
    cancel: async guard => { await auth.cancel(guard.userId, { authorize: guard.authorize }); return accounts.status(guard.userId); },
    select: async (guard, profileId) => {
      if (!text(profileId, 160) || !profileId) throw fail('INPUT', '请选择有效的官方账号。');
      await auth.select(guard.userId, profileId, { authorize: guard.authorize });
      return accounts.status(guard.userId);
    },
    logout: async guard => { await auth.logout(guard.userId, { authorize: guard.authorize }); return accounts.status(guard.userId); },
  };
  return Object.fromEntries(Object.entries(operations).map(([action, work]) => [`petpal:official-account:${action}`, async (event, value, input) => {
    const guard = await guardFor(event, value);
    if (unavailable()) throw fail('STORAGE', '官方账号存储暂不可用，请检查客户端私有目录权限或系统密钥环后重启；原文件已保留。');
    let result;
    try { result = await work(guard, input); }
    catch (error) {
      await guard.compare();
      if (error?.[publicError]) throw error;
      throw fail('OPERATION', action === 'start' ? '未能打开官方登录，请检查网络后重试。' : '官方账号操作未完成，请刷新状态后重试。');
    }
    await guard.compare();
    return officialPublicStatus(result);
  }]));
}

module.exports = { createOfficialAccountHandlers, officialPublicStatus };
