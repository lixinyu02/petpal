'use strict';

const { timingSafeEqual } = require('node:crypto');

const publicError = Symbol('app-proxy-ipc-public-error');
const fail = (key, message) => Object.assign(new Error(message), { code: `PETPAL_APP_PROXY_IPC_${key}`, [publicError]: true });
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const text = (value, max = 160) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const keys = (value, expected) => plain(value) && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
const same = (left, right) => {
  if (left.url !== right.url) return false;
  const a = Buffer.from(left.token), b = Buffer.from(right.token);
  return a.length === b.length && timingSafeEqual(a, b);
};

// Runtime messages are fixed application strings. An upstream/native error that
// happens to carry the same code must never disclose its body, path or credentials.
const managerMessages = new Set([
  '代理操作已取消。', '代理私有目录无效，请保留文件后检查目录权限。',
  '代理配置文件无效或过大，原文件已保留。', '代理配置目标无效，原文件已保留。',
  '请导入不超过 4 MB 的 Clash YAML 配置。', '配置不是有效的 YAML，未覆盖原配置。',
  '代理配置必须为 YAML 对象。', '代理配置层级或展开内容过多。', '代理配置包含不支持的 YAML 类型。',
  '代理配置不支持循环引用。', '代理配置包含无效字段。', '代理 provider 配置无效。',
  '文件型 provider 请先合并到单个 YAML；小伴不会读取配置目录以外的文件。',
  '此平台暂无内置代理内核。', '内置代理内核尚未准备好，请更新完整客户端。', '内置代理内核清单不匹配。',
  '内置代理内核文件不匹配。', '内置代理内核校验失败，请重新下载完整客户端。', '代理正在退出。',
  '代理启动偏好读取失败，已保持关闭，原文件未覆盖。', '代理配置读取失败，已保持关闭，原文件未覆盖。',
  '代理内核已退出，小伴已恢复直连；任务不会自动重试。', '代理内核退出尚未确认，请退出小伴后重试。',
  '上一个代理内核退出尚未确认，请关闭代理后重试。', '代理内核已退出；小伴恢复直连尚未确认，请关闭代理后重试。',
  '配置校验超时，请检查节点、规则及远程 provider 是否可用。', '配置校验未通过，请检查节点、规则及远程 provider 是否可用。',
  '请先关闭代理，再更换配置。', '代理配置保存失败，原配置已保留。', '代理启动选项无效。',
  '代理内核尚未就绪。', '代理内核暂未就绪，请刷新状态。', '代理内核状态过大。', '请先导入 Clash YAML 配置。',
  '代理内核启动失败，检查配置与节点资源后重试。', '代理未能启用，小伴已恢复直连。',
  '恢复直连尚未确认，请关闭代理后重试。', '代理运行配置清理失败，请退出小伴后检查私有目录。',
  '请先启用代理并选择有效节点。', '节点列表已变化，请刷新后再选。',
]);

function appProxyPublicStatus(value) {
  if (!plain(value) || !['stopped', 'checking', 'starting', 'running', 'stopping', 'error'].includes(value.state) ||
      typeof value.version !== 'string' || value.version.length > 32 || !/^\d+\.\d+\.\d+$/.test(value.version) ||
      !['win32', 'linux'].includes(value.platform) || !['x64', 'arm64'].includes(value.arch))
    throw fail('STATUS', '无法读取应用代理状态，请重新打开设置。');
  return {
    supported: value.supported === true, state: value.state, configured: value.configured === true,
    autoStart: value.autoStart === true, running: value.state === 'running' && value.running === true,
    version: value.version, platform: value.platform, arch: value.arch,
    groups: Array.isArray(value.groups) ? value.groups.slice(0, 128).filter(group => plain(group) && text(group.name) && Array.isArray(group.choices)).map(group => ({
      name: group.name, selected: text(group.selected) ? group.selected : '',
      choices: group.choices.slice(0, 2048).filter(choice => text(choice)),
    })) : [],
    ...(value.error ? { error: managerMessages.has(value.error) ? value.error : '应用代理暂不可用，请刷新状态后重试。' } : {}),
  };
}

function createAppProxyHandlers({ manager, origin, isAllowed, readConnection, verifyConnection, openConfigFile } = {}) {
  let local;
  try { local = new URL(origin); } catch {}
  if (!manager || !local || !['http:', 'https:'].includes(local.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(local.hostname) ||
      local.origin !== origin || local.pathname !== '/' || local.search || local.hash || local.username || local.password ||
      ![isAllowed, readConnection, verifyConnection, openConfigFile].every(value => typeof value === 'function'))
    throw new TypeError('Invalid application proxy IPC setup');

  const trusted = event => {
    let allowed = false; try { allowed = isAllowed(event) === true; } catch {}
    if (!allowed) throw fail('UNTRUSTED', '应用代理仅允许可信主窗口管理。');
  };
  const connection = value => {
    if (!keys(value, ['url', 'token']) || !text(value.url, 2048) || !text(value.token, 4096) || /\s/.test(value.token))
      throw fail('LOGIN', '请先登录这台电脑的小伴管理员账号。');
    // Exact origin: aliases, URL paths and remote-server tokens are not reused.
    if (value.url !== origin) throw fail('LOCAL', '应用代理仅可由本机管理员管理，请切换到客户端本机服务。');
    return { url: origin, token: value.token };
  };
  const guardFor = async (event, supplied) => {
    trusted(event);
    const expected = connection(supplied); let identity;
    const compare = async () => {
      trusted(event); let current;
      try { current = connection(await readConnection(event)); } catch { throw fail('CHANGED', '登录账号已变化，请重新打开应用代理设置。'); }
      trusted(event);
      if (!same(current, expected)) throw fail('CHANGED', '登录账号已变化，请重新打开应用代理设置。');
    };
    const authorize = async () => {
      await compare(); let next;
      try { next = await verifyConnection({ ...expected }); }
      catch { throw fail('OWNER', '无法验证本机管理员登录，请重新登录后重试。'); }
      await compare();
      if (!plain(next) || !identifier(next.userId) || !identifier(next.instanceId) || identity && (identity.userId !== next.userId || identity.instanceId !== next.instanceId))
        throw fail('CHANGED', '登录账号已变化，请重新打开应用代理设置。');
      identity = { userId: next.userId, instanceId: next.instanceId };
    };
    await authorize(); return { authorize };
  };
  const noInput = input => { if (input !== undefined) throw fail('INPUT', '应用代理请求格式无效。'); };
  const yamlInput = input => {
    if (!keys(input, ['yaml']) || typeof input.yaml !== 'string' || !input.yaml.trim() || Buffer.byteLength(input.yaml) > 4 * 1024 * 1024)
      throw fail('INPUT', '请导入不超过 4 MB 的 Clash YAML 配置。');
    return input.yaml;
  };
  const operations = {
    status: async (guard, input) => { noInput(input); return manager.refresh(); },
    importFile: async (guard, input) => {
      noInput(input); const source = await openConfigFile(); await guard.authorize();
      if (source === null) return manager.status();
      return manager.importConfiguration(yamlInput({ yaml: source }), { authorize: guard.authorize });
    },
    importText: async (guard, input) => manager.importConfiguration(yamlInput(input), { authorize: guard.authorize }),
    start: async (guard, input) => { noInput(input); return manager.start({ authorize: guard.authorize }); },
    stop: async (guard, input) => { noInput(input); return manager.stop({ authorize: guard.authorize }); },
    preferences: async (guard, input) => {
      if (!keys(input, ['autoStart']) || typeof input.autoStart !== 'boolean') throw fail('INPUT', '代理启动选项无效。');
      return manager.updatePreferences({ autoStart: input.autoStart }, { authorize: guard.authorize });
    },
    select: async (guard, input) => {
      if (!keys(input, ['group', 'name']) || !text(input.group) || !text(input.name)) throw fail('INPUT', '请选择有效的代理节点。');
      return manager.select(input.group, input.name, { authorize: guard.authorize });
    },
  };
  return Object.fromEntries(Object.entries(operations).map(([action, work]) => [`petpal:app-proxy:${action}`, async (event, supplied, input) => {
    const guard = await guardFor(event, supplied); let result;
    try { result = await work(guard, input); }
    catch (failure) {
      await guard.authorize();
      if (failure?.[publicError]) throw failure;
      if (failure?.code === 'PETPAL_PROXY' && managerMessages.has(failure.message)) throw fail('RUNTIME', failure.message);
      throw fail('OPERATION', '应用代理操作未完成，请刷新状态后重试。');
    }
    await guard.authorize(); return appProxyPublicStatus(result);
  }]));
}

module.exports = { createAppProxyHandlers, appProxyPublicStatus };
