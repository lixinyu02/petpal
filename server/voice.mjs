import { isIP } from 'node:net';

const FIELDS = {
  tts: ['mode', 'baseUrl', 'model', 'voice', 'speed', 'apiKey'],
  asr: ['mode', 'baseUrl', 'model', 'language', 'apiKey'],
};
const invalid = message => Object.assign(new Error(message), { status: 400 });
const own = (value, key) => Object.hasOwn(value, key);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function defaultVoiceSettings() {
  return {
    tts: { mode: 'system', baseUrl: '', model: '', voice: '', speed: 1, apiKey: '' },
    asr: { mode: 'disabled', baseUrl: '', model: '', language: 'zh-CN', apiKey: '' },
  };
}

function copySettings(settings) {
  const copy = defaultVoiceSettings();
  for (const section of ['tts', 'asr']) {
    if (!record(settings?.[section])) continue;
    for (const field of FIELDS[section]) {
      if (own(settings[section], field) && settings[section][field] !== undefined) copy[section][field] = settings[section][field];
    }
  }
  return copy;
}

/** The legacy remote mode remains metadata only; CosyVoice uses the shared server adapter. */
export function publicVoiceSettings(settings) {
  const copy = copySettings(settings);
  for (const section of ['tts', 'asr']) {
    copy[section].hasApiKey = typeof copy[section].apiKey === 'string' && copy[section].apiKey.length > 0;
    delete copy[section].apiKey;
  }
  return { ...copy, runtime: { tts: copy.tts.mode === 'cosyvoice' ? 'cosyvoice' : 'system', asr: 'not-connected', remoteConfiguredOnly: copy.tts.mode !== 'cosyvoice' } };
}

function textField(value, label, maxLength) {
  if (typeof value !== 'string' || value.length > maxLength || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw invalid(`${label} 必须为不含控制字符、最长 ${maxLength} 字符的文本。`);
  }
  return value.trim();
}

function localHostname(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (isIP(host) === 4) {
    const [a, b] = host.split('.').map(Number);
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (isIP(host) === 6) return host === '::1' || /^(?:fc|fd)[0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host);
  return false;
}

export function normalizeVoiceUrl(value, label = 'TTS') {
  const input = textField(value, `${label} 服务地址`, 2048);
  if (!input) return '';
  let url;
  try { url = new URL(input); } catch { throw invalid(`${label} 服务地址必须是完整的 HTTP/HTTPS URL。`); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || /[?#\\\s]/u.test(input)) {
    throw invalid(`${label} 服务地址只支持 HTTP/HTTPS，不可包含凭据、查询参数、片段或空白。`);
  }
  if (url.protocol === 'http:' && !localHostname(url.hostname)) {
    throw invalid(`${label} 远程服务必须使用 HTTPS；HTTP 仅允许回环、.local 和私网地址。`);
  }
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.toString().replace(/\/$/, '');
}

/** Whitelist a per-user patch; callers alone choose the authenticated user. */
export function patchVoiceSettings(previous, body) {
  if (!record(body)) throw invalid('语音配置必须是对象。');
  const result = copySettings(previous);
  for (const section of ['tts', 'asr']) {
    if (!own(body, section)) continue;
    const patch = body[section], label = section.toUpperCase(), next = result[section];
    if (!record(patch)) throw invalid(`${label} 配置必须是对象。`);
    const oldUrl = normalizeVoiceUrl(next.baseUrl, label), oldKey = next.apiKey;
    if (own(patch, 'mode')) {
      const modes = section === 'tts' ? ['system', 'remote', 'cosyvoice'] : ['disabled', 'browser', 'remote'];
      if (!modes.includes(patch.mode)) throw invalid(`${label} 模式必须为 ${modes.join(' / ')}。`);
      next.mode = patch.mode;
    }
    if (own(patch, 'baseUrl')) next.baseUrl = normalizeVoiceUrl(patch.baseUrl, label);
    for (const field of section === 'tts' ? ['model', 'voice'] : ['model', 'language']) {
      if (own(patch, field)) next[field] = textField(patch[field], `${label} ${field}`, field === 'language' ? 35 : 160);
    }
    if (own(patch, 'speed')) {
      if (section !== 'tts') throw invalid('ASR 不支持语速配置。');
      if (typeof patch.speed !== 'number' || !Number.isFinite(patch.speed) || patch.speed < 0.25 || patch.speed > 4) {
        throw invalid('TTS 语速必须是 0.25 到 4 之间的有限数值。');
      }
      next.speed = patch.speed;
    }
    if (own(patch, 'clearApiKey') && typeof patch.clearApiKey !== 'boolean') throw invalid(`${label} clearApiKey 必须是布尔值。`);
    const replacement = own(patch, 'apiKey') ? textField(patch.apiKey, `${label} API Key`, 8192) : '';
    if (/\s/u.test(replacement)) throw invalid(`${label} API Key 不可包含空白。`);
    if (patch.clearApiKey === true && replacement) throw invalid(`${label} 不可同时清除和替换 API Key。`);
    if (oldKey && next.baseUrl !== oldUrl && !replacement && patch.clearApiKey !== true) {
      throw invalid(`${label} 服务地址已改变，请重新填写 API Key 或明确清除已保存的密钥。`);
    }
    if (patch.clearApiKey === true) next.apiKey = '';
    else if (replacement) next.apiKey = replacement;
    if (next.mode === 'remote' && (!next.baseUrl || !next.model)) throw invalid(`${label} 远程模式必须填写服务地址和模型 ID。`);
    if (section === 'tts' && next.mode === 'cosyvoice' && (next.speed < 0.5 || next.speed > 2)) throw invalid('CosyVoice 语速必须为 0.5 到 2。');
  }
  return result;
}
