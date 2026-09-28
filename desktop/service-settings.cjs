const path = require('node:path');
const { open } = require('node:fs/promises');

const ENV_NAME = 'PETPAL_CODEX_HTTP_ORIGINS';
const MAX_FILE_BYTES = 64 * 1024;
const settingsError = message => Object.assign(new Error(message), { code: 'PETPAL_DESKTOP_SERVICE_SETTINGS' });

// This deployment policy is deliberately separate from the API-managed state.
// Never store endpoints with API paths, model settings, or credentials here.
async function readDesktopServiceSettings(userData, { env = process.env } = {}) {
  const { parseCodexHttpOrigins } = await import('../server/codex-config.mjs');
  if (env[ENV_NAME] !== undefined) {
    try { parseCodexHttpOrigins(env[ENV_NAME]); }
    catch { throw settingsError(`${ENV_NAME} 无效：须为逗号分隔的完整 HTTP origin，不可包含路径、凭据或通配符。`); }
    return { codexHttpOrigins: env[ENV_NAME] };
  }

  const file = path.join(userData, 'service-settings.json');
  let handle;
  try { handle = await open(file, 'r'); }
  catch (error) {
    if (error.code === 'ENOENT') return { codexHttpOrigins: '' };
    throw settingsError(`无法读取桌面服务配置：${file}。请检查文件及本机账户的读取权限。`);
  }
  let settings;
  try {
    if (!(await handle.stat()).isFile()) throw new Error('Not a regular file');
    const bytes = Buffer.alloc(MAX_FILE_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await handle.read(bytes, length, bytes.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > MAX_FILE_BYTES) throw new Error('Too large');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length));
    settings = JSON.parse(text);
    if (!settings || Array.isArray(settings) || typeof settings !== 'object' ||
        Object.keys(settings).length !== 1 || typeof settings.codexHttpOrigins !== 'string') throw new Error('Invalid settings schema');
    parseCodexHttpOrigins(settings.codexHttpOrigins);
  } catch {
    // Do not echo JSON parser errors: they can contain text from a private file.
    throw settingsError(`桌面服务配置无效：${file}。请使用不超过 64 KiB 的 UTF-8 JSON，仅包含 codexHttpOrigins 字符串；来源不可包含路径、凭据或通配符。修正文件后重新启动。`);
  } finally { await handle.close(); }
  return { codexHttpOrigins: settings.codexHttpOrigins };
}

module.exports = { readDesktopServiceSettings };
