import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, rename, chmod, unlink } from 'node:fs/promises';
import { normalizeBaseUrl, normalizeReasoningEffort } from './providers.mjs';

const failure = (status, message) => Object.assign(new Error(message), { status });
export const CODEX_TOOL_VERSION = 'opencli-notebook-sites-v2';
export const CODEX_KEY_ENV = 'PETPAL_CODEX_API_KEY';
export const defaultCodexConfig = () => ({ mode: 'host', baseUrl: '', model: '', reasoningEffort: '', apiKey: '', revision: randomUUID(), toolVersion: CODEX_TOOL_VERSION });

// Deployment-only policy. The HTTP API cannot add origins to this set.
export function parseCodexHttpOrigins(raw) {
  if (raw === undefined || raw === '') return new Set();
  if (typeof raw !== 'string' || raw.length > 8192 || /[\x00-\x1f\x7f]/.test(raw)) throw new Error('PETPAL_CODEX_HTTP_ORIGINS 必须是逗号分隔的完整 HTTP origin。');
  if (!raw.trim()) return new Set();
  const entries = raw.split(',');
  if (entries.length > 32) throw new Error('PETPAL_CODEX_HTTP_ORIGINS 最多包含 32 个 HTTP origin。');
  const origins = new Set();
  for (const entry of entries) {
    const value = entry.trim();
    if (!/^http:\/\/[^/?#\\\s*%@]+$/i.test(value) || value.endsWith(':')) throw new Error('Codex HTTP origin 不可包含路径、查询、片段、凭据或通配符。');
    let url;
    try { url = new URL(value); } catch { throw new Error('Codex HTTP origin 格式无效。'); }
    if (url.protocol !== 'http:' || !url.hostname || url.username || url.password || url.search || url.hash || url.pathname !== '/' || url.hostname.includes('*')) throw new Error('Codex HTTP origin 不可包含路径、查询、片段、凭据或通配符。');
    origins.add(url.origin);
  }
  return origins;
}

export function publicCodexConfig(value) {
  return { mode: value.mode, baseUrl: value.baseUrl, model: value.model, reasoningEffort: normalizeReasoningEffort(value.reasoningEffort), hasApiKey: Boolean(value.apiKey), revision: value.revision,
    protocol: 'responses', configured: value.mode === 'host' || Boolean(value.baseUrl && value.model) };
}

function baseUrl(value, { allowedHttpOrigins = new Set() } = {}) {
  if (!(allowedHttpOrigins instanceof Set)) throw new Error('allowedHttpOrigins 必须由 parseCodexHttpOrigins 解析。');
  if (typeof value !== 'string' || !value.trim() || value.length > 2048 || /[\x00-\x20\x7f]/.test(value)) throw failure(400, '请输入完整的 Codex Responses 服务地址。');
  let normalized;
  try { normalized = normalizeBaseUrl(value, 'responses'); } catch (error) { throw failure(400, error.message); }
  const url = new URL(normalized);
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && !allowedHttpOrigins.has(url.origin)) throw failure(400, 'Codex 服务须使用 HTTPS；本机回环或部署者明确允许的 HTTP origin 除外。');
  return normalized;
}

export function patchCodexConfig(current, body, options = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['mode', 'baseUrl', 'model', 'reasoningEffort', 'apiKey', 'clearApiKey', 'revision'].includes(key))) throw failure(400, 'Codex 配置包含不支持的字段。');
  if (body.revision !== undefined && body.revision !== current.revision) throw failure(409, 'Codex 配置已变化，请刷新设置后重试。');
  const next = { ...current };
  try { next.reasoningEffort = normalizeReasoningEffort(body.reasoningEffort === undefined ? current.reasoningEffort : body.reasoningEffort); }
  catch (error) { throw failure(400, error.message); }
  if (body.mode !== undefined) {
    if (!['host', 'api'].includes(body.mode)) throw failure(400, 'Codex 模式必须是 host 或 api。');
    next.mode = body.mode;
  }
  if (body.baseUrl !== undefined) next.baseUrl = body.baseUrl === '' && next.mode === 'host' ? '' : baseUrl(body.baseUrl, options);
  else if (next.baseUrl) baseUrl(next.baseUrl, options);
  if (body.model !== undefined) {
    if (typeof body.model !== 'string' || body.model.length > 160 || /[\x00-\x1f\x7f]/.test(body.model)) throw failure(400, 'Codex 模型 ID 格式无效。');
    next.model = body.model.trim();
  }
  if (body.apiKey !== undefined && (typeof body.apiKey !== 'string' || body.apiKey.length > 8192 || /[\x00-\x1f\x7f]/.test(body.apiKey))) throw failure(400, 'Codex API Key 格式无效。');
  if (body.clearApiKey !== undefined && typeof body.clearApiKey !== 'boolean') throw failure(400, 'clearApiKey 必须为布尔值。');
  if (body.clearApiKey && body.apiKey?.trim()) throw failure(400, '清除密钥与填写新密钥不能同时使用。');
  if (current.apiKey && next.baseUrl !== current.baseUrl && !body.apiKey?.trim() && !body.clearApiKey) throw failure(400, '服务地址变化时请重新填写或明确清除 API Key，避免向另一服务发送原密钥。');
  if (body.clearApiKey) next.apiKey = '';
  else if (body.apiKey?.trim()) next.apiKey = body.apiKey.trim();
  if (next.mode === 'api' && (!next.baseUrl || !next.model)) throw failure(400, 'API 模式需要填写 Responses 服务地址和模型 ID。');
  if (['mode', 'baseUrl', 'model', 'apiKey'].some(key => next[key] !== current[key]) || next.reasoningEffort !== normalizeReasoningEffort(current.reasoningEffort)) next.revision = randomUUID();
  return next;
}

export function validateStoredCodexConfig(value, options = {}) {
  if (!value || !['host', 'api'].includes(value.mode) || typeof value.apiKey !== 'string' || !/^[a-f0-9-]{36}$/.test(value.revision) || !['baseUrl', 'model'].every(key => typeof value[key] === 'string')) throw new Error('本地 Codex 配置无效，请保留数据并检查备份。');
  patchCodexConfig(value, { mode: value.mode, ...(value.baseUrl ? { baseUrl: value.baseUrl } : {}), model: value.model, apiKey: value.apiKey }, options);
}

// JSON string escaping is also valid for the TOML basic strings used here.
export function codexToml(config) {
  const reasoningEffort = normalizeReasoningEffort(config.reasoningEffort);
  // Custom-provider models may be absent from the CLI catalog. Without this
  // capability flag, Codex silently omits an explicitly selected effort.
  return [
    `model = ${JSON.stringify(config.model)}`, 'model_provider = "petpal"', 'approval_policy = "on-request"', 'approvals_reviewer = "user"',
    ...(reasoningEffort ? [`model_reasoning_effort = ${JSON.stringify(reasoningEffort)}`, 'model_supports_reasoning_summaries = true'] : []),
    'sandbox_mode = "read-only"', 'cli_auth_credentials_store = "ephemeral"', 'allow_login_shell = false', 'web_search = "disabled"',
    '[features]', 'shell_tool = true', 'unified_exec = true', 'shell_snapshot = false', 'multi_agent = false', 'apps = false', 'remote_plugin = false', 'hooks = false', 'goals = false', 'tool_suggest = false', 'image_generation = false', 'enable_request_compression = false',
    '[shell_environment_policy]', 'inherit = "core"', 'ignore_default_excludes = false', `exclude = [${JSON.stringify(CODEX_KEY_ENV)}, "OPENAI_*", "CODEX_*"]`,
    '[model_providers.petpal]', 'name = "PetPal Responses"', `base_url = ${JSON.stringify(config.baseUrl)}`, 'wire_api = "responses"',
    'requires_openai_auth = false', 'supports_websockets = false', 'request_max_retries = 0', 'stream_max_retries = 0',
    ...(config.apiKey ? [`env_key = ${JSON.stringify(CODEX_KEY_ENV)}`] : []), '',
  ].join('\n');
}

export function isolatedCodexEnvironment(config, home, source = process.env) {
  const allowed = /^(?:path|systemroot|windir|systemdrive|comspec|pathext|temp|tmp|tmpdir|home|userprofile|username|user|logname|appdata|localappdata|programfiles(?:\(x86\))?|programdata|lang|lc_[a-z_]+|term|display|wayland_display|xdg_runtime_dir|dbus_session_bus_address)$/i;
  const env = Object.fromEntries(Object.entries(source).filter(([key, value]) => allowed.test(key) && typeof value === 'string'));
  // CODEX_HOME isolates Codex state; the private user-home roots also prevent
  // automatic discovery of the host user's .agents skills and auxiliary configs.
  for (const key of Object.keys(env)) if (/^(home|userprofile|appdata|localappdata)$/i.test(key)) delete env[key];
  const profile = path.join(home, 'profile');
  env.HOME = profile;
  env.USERPROFILE = profile;
  env.APPDATA = path.join(profile, 'AppData', 'Roaming');
  env.LOCALAPPDATA = path.join(profile, 'AppData', 'Local');
  env.XDG_CONFIG_HOME = path.join(profile, '.config');
  env.XDG_DATA_HOME = path.join(profile, '.local', 'share');
  env.CODEX_HOME = home;
  env.ELECTRON_RUN_AS_NODE = '1';
  if (config.apiKey) env[CODEX_KEY_ENV] = config.apiKey;
  return env;
}

export async function prepareCodexRuntime(config, dataDir) {
  if (!path.isAbsolute(dataDir)) dataDir = path.resolve(dataDir);
  const home = path.join(dataDir, 'codex', config.revision);
  const workspaceRoot = path.join(home, 'workspace');
  await mkdir(workspaceRoot, { recursive: true, mode: 0o700 });
  await chmod(home, 0o700);
  const env = isolatedCodexEnvironment(config, home);
  await Promise.all([env.APPDATA, env.LOCALAPPDATA, env.XDG_CONFIG_HOME, env.XDG_DATA_HOME].map(directory => mkdir(directory, { recursive: true, mode: 0o700 })));
  const file = path.join(home, 'config.toml'), temp = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, codexToml(config), { mode: 0o600, flag: 'wx' });
    await rename(temp, file);
  } finally { await unlink(temp).catch(() => {}); }
  return { workspaceRoot, env };
}
