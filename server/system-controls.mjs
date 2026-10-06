import { spawn } from 'node:child_process';
import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const object = value => value && typeof value === 'object' && !Array.isArray(value);
const failure = (message, code = 'system_control_unavailable', status = 400) => Object.assign(new Error(message), { code, status });
const abortError = () => Object.assign(new Error('系统操作已停止。'), { name: 'AbortError' });
const checkAbort = signal => { if (signal?.aborted) throw abortError(); };
const unavailable = (platform, message, code = 'system_control_unavailable') => ({ ok: false, available: false, platform, code, message });
export const SYSTEM_AUDIO_ACTIONS = Object.freeze(['status', 'set-volume', 'adjust-volume', 'set-muted']);
export const SYSTEM_SETTINGS_SECTIONS = Object.freeze(['sound', 'display']);

/** Values are complete actions, not optional overrides to a command or device. */
export function validateSystemAudioCommand(value) {
  if (!object(value) || !SYSTEM_AUDIO_ACTIONS.includes(value.action)) throw failure('系统音量操作无效。', 'invalid_arguments');
  const field = { 'set-volume': 'volumePercent', 'adjust-volume': 'delta', 'set-muted': 'muted' }[value.action];
  const keys = field ? ['action', field] : ['action'];
  if (Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) throw failure('系统音量操作参数与动作不匹配。', 'invalid_arguments');
  if (field === 'volumePercent' && (!Number.isInteger(value.volumePercent) || value.volumePercent < 0 || value.volumePercent > 100)) throw failure('系统音量须为 0–100 的整数。', 'invalid_arguments');
  if (field === 'delta' && (!Number.isInteger(value.delta) || value.delta === 0 || Math.abs(value.delta) > 20)) throw failure('每次音量调整须为 -20 至 20 的非零整数。', 'invalid_arguments');
  if (field === 'muted' && typeof value.muted !== 'boolean') throw failure('静音状态须为布尔值。', 'invalid_arguments');
  return { action: value.action, ...(field ? { [field]: value[field] } : {}) };
}
export function validateSystemSettingsCommand(value) {
  if (!object(value) || Object.keys(value).length !== 1 || !SYSTEM_SETTINGS_SECTIONS.includes(value.section)) throw failure('系统设置仅支持声音或显示入口。', 'invalid_arguments');
  return { section: value.section };
}

/** Fixed executable and argv only; no shell and no inherited model/API secrets. */
export function systemControlEnvironment(source = process.env) {
  const allowed = /^(?:path|systemroot|windir|systemdrive|comspec|pathext|programfiles(?:\(x86\))?|programw6432|programdata|appdata|localappdata|home|userprofile|homedrive|homepath|username|user|logname|temp|tmp|tmpdir|display|wayland_display|xauthority|xdg_runtime_dir|xdg_session_type|xdg_current_desktop|xdg_session_desktop|dbus_session_bus_address|pulse_server|pulse_cookie|pipewire_remote)$/i;
  const env = Object.fromEntries(Object.entries(source).filter(([key, value]) => allowed.test(key) && typeof value === 'string' && !value.startsWith('()')));
  env.LANG = 'C'; env.LC_ALL = 'C';
  return env;
}
export function runSystemControlProcess(file, args, { signal, timeoutMs = 12000, env = systemControlEnvironment() } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const child = spawn(file, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env });
    let output = '', size = 0, error, settled = false;
    const abort = () => { error = abortError(); child.kill(); };
    const timer = setTimeout(() => { error = failure('系统音量接口响应超时；不会自动重试。', 'system_control_timeout', 504); child.kill(); }, timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', data => { size += data.length; if (size > 64 * 1024) { error = failure('系统音量接口返回内容过大。', 'invalid_output', 502); child.kill(); } else output += data.toString('utf8'); });
    child.stderr.on('data', () => {});
    const finish = (code, spawnError) => {
      if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (error || spawnError || code !== 0) reject(error ?? failure('系统音量接口不可用，请检查目标电脑的用户音频会话。'));
      else resolve(output.trim());
    };
    child.once('error', error => finish(null, error)); child.once('close', code => finish(code));
  });
}

export async function findSystemExecutable(names, env, platform = process.platform) {
  const separator = platform === 'win32' ? ';' : ':';
  for (const name of names) for (const directory of String(env.PATH || '').split(separator)) {
    if (!directory || !(platform === 'win32' ? path.win32 : path.posix).isAbsolute(directory)) continue;
    const candidate = (platform === 'win32' ? path.win32 : path.posix).join(directory, name);
    try { await access(candidate, constants.X_OK); if ((await stat(candidate)).isFile()) return candidate; } catch { /* next fixed name */ }
  }
  return null;
}
function endpointName(value) {
  const name = String(value).trim();
  if (!/^[A-Za-z0-9_.:-]{1,256}$/.test(name)) throw failure('无法确认默认输出设备。', 'invalid_output', 502);
  return name;
}
export function parseWpctlEndpoint(output) {
  const match = /^id\s+([1-9]\d{0,8}),\s*type\s+PipeWire:Interface:Node\b/m.exec(String(output));
  if (!match) throw failure('无法确认 PipeWire 默认输出设备。', 'invalid_output', 502);
  return match[1];
}
export function parseWpctlVolume(output) {
  const match = /^Volume:\s*(\d+(?:\.\d+)?)(?:\s+(\[MUTED\]))?\s*$/.exec(String(output).trim());
  if (!match || Number(match[1]) > 10) throw failure('PipeWire 音量读回无效。', 'invalid_output', 502);
  return { volumePercent: Math.round(Number(match[1]) * 10000) / 100, muted: Boolean(match[2]) };
}
export function parsePactlVolume(output, muteOutput) {
  const values = [...String(output).matchAll(/\/\s*(\d+(?:\.\d+)?)%\s*\//g)].map(match => Number(match[1]));
  const mute = /^Mute:\s*(yes|no)\s*$/.exec(String(muteOutput).trim());
  if (!values.length || values.length > 64 || values.some(value => value > 1000) || !mute) throw failure('PulseAudio 音量读回无效。', 'invalid_output', 502);
  return { volumePercent: Math.max(...values), muted: mute[1] === 'yes' };
}
function snapshot(value) {
  if (!object(value) || typeof value.endpoint !== 'string' || !value.endpoint || value.endpoint.length > 512 || !Number.isFinite(value.volumePercent) || value.volumePercent < 0 || value.volumePercent > 1000 || typeof value.muted !== 'boolean') throw failure('系统音量读回无效。', 'invalid_output', 502);
  return { endpoint: value.endpoint, volumePercent: value.volumePercent, muted: value.muted };
}
function actionResult(platform, backend, before, after, value, defaultEndpointChanged) {
  const desired = value.action === 'set-volume' ? value.volumePercent : value.action === 'adjust-volume' ? Math.min(100, Math.max(0, before.volumePercent + value.delta)) : before.volumePercent;
  const verified = value.action === 'set-muted' ? after.muted === value.muted && Math.abs(after.volumePercent - before.volumePercent) <= 0.5 : Math.abs(after.volumePercent - desired) <= 0.5 && after.muted === before.muted;
  return { ok: verified && !defaultEndpointChanged, available: true, platform, backend, ...after, before, verified, defaultEndpointChanged,
    ...(defaultEndpointChanged ? { code: 'default_endpoint_changed', message: '操作期间默认输出设备已变化；只操作了原设备，不会自动重试，请检查当前设备。' }
      : !verified ? { code: 'readback_mismatch', message: '系统音量读回未达到要求；不会自动重试。' }
        : { message: `已验证系统输出${value.action === 'set-muted' ? value.muted ? '静音' : '取消静音' : `音量 ${Math.round(after.volumePercent * 100) / 100}%`}。` }) };
}

export class SystemControls {
  constructor({ platform = process.platform, env = process.env, run = runSystemControlProcess, find = findSystemExecutable, launch } = {}) {
    this.platform = platform; this.env = systemControlEnvironment(env); this.run = run; this.find = find; this.launch = launch ?? this._launch.bind(this);
  }
  async _call(file, args, signal) { checkAbort(signal); const result = await this.run(file, args, { signal, env: this.env, timeoutMs: 12000 }); checkAbort(signal); return result; }
  async _windows(action, params, signal) {
    const powershell = path.win32.join(this.env.SystemRoot || this.env.SYSTEMROOT || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const script = fileURLToPath(new URL('./native/system-windows.ps1', import.meta.url)).replace(/\.asar([\\/])/i, '.asar.unpacked$1');
    let result;
    try { result = JSON.parse(await this._call(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', script, '-Action', action, ...params], signal)); }
    catch (error) { if (error.name === 'AbortError') throw error; throw failure(error.code === 'system_control_timeout' ? error.message : 'Windows 系统音量接口不可用。', error.code); }
    if (!object(result) || typeof result.ok !== 'boolean') throw failure('Windows 系统音量接口返回无效数据。', 'invalid_output', 502);
    return result;
  }
  async _linuxBackend(signal) {
    checkAbort(signal);
    const wpctl = await this.find(['wpctl'], this.env, this.platform); checkAbort(signal);
    if (wpctl) return { backend: 'pipewire', file: wpctl };
    const pactl = await this.find(['pactl'], this.env, this.platform); checkAbort(signal);
    if (pactl) return { backend: 'pulseaudio', file: pactl };
    throw failure('目标电脑缺少 wpctl / pactl；请在用户桌面准备音频工具。', 'dependency_missing');
  }
  async _endpoint(backend, signal) {
    return backend.backend === 'pipewire' ? parseWpctlEndpoint(await this._call(backend.file, ['inspect', '@DEFAULT_AUDIO_SINK@'], signal))
      : endpointName(await this._call(backend.file, ['get-default-sink'], signal));
  }
  async _read(backend, endpoint, signal) {
    const audio = backend.backend === 'pipewire' ? parseWpctlVolume(await this._call(backend.file, ['get-volume', endpoint], signal))
      : parsePactlVolume(await this._call(backend.file, ['get-sink-volume', endpoint], signal), await this._call(backend.file, ['get-sink-mute', endpoint], signal));
    return snapshot({ endpoint, ...audio });
  }
  async audio(args, { signal } = {}) {
    const value = validateSystemAudioCommand(args); checkAbort(signal);
    if (!['win32', 'linux'].includes(this.platform)) return unavailable(this.platform, '系统音量工具仅支持 Windows / Ubuntu。', 'platform_unsupported');
    let mutationAttempted = false, targetEndpoint;
    try {
      if (this.platform === 'win32') {
        const params = value.action === 'set-volume' ? ['-VolumePercent', String(value.volumePercent)] : value.action === 'adjust-volume' ? ['-Delta', String(value.delta)] : value.action === 'set-muted' ? ['-Muted', String(value.muted)] : [];
        mutationAttempted = value.action !== 'status';
        const result = await this._windows(value.action, params, signal);
        if (!result.ok) return { ...result, platform: this.platform };
        const current = snapshot(result);
        if (value.action === 'status') return { ok: true, available: true, platform: this.platform, backend: 'coreaudio', ...current, verified: true, defaultEndpointChanged: Boolean(result.defaultEndpointChanged) };
        const before = snapshot(result.before);
        if (before.endpoint !== current.endpoint) throw failure('系统音量接口没有绑定同一输出设备。', 'invalid_output', 502);
        return actionResult(this.platform, 'coreaudio', before, current, value, result.defaultEndpointChanged === true);
      }
      const backend = await this._linuxBackend(signal), endpoint = await this._endpoint(backend, signal), before = await this._read(backend, endpoint, signal);
      targetEndpoint = endpoint;
      const preflightEndpoint = await this._endpoint(backend, signal);
      if (preflightEndpoint !== endpoint) return { ok: false, available: true, platform: this.platform, backend: backend.backend, ...before, verified: false, defaultEndpointChanged: true, code: 'default_endpoint_changed', message: '默认输出设备已变化，未发送音量修改。' };
      if (value.action === 'status') return { ok: true, available: true, platform: this.platform, backend: backend.backend, ...before, verified: true, defaultEndpointChanged: false };
      if (value.action === 'adjust-volume' && before.volumePercent > 100) return { ok: false, available: true, platform: this.platform, backend: backend.backend, ...before, verified: false, defaultEndpointChanged: false, code: 'amplified_volume', message: '当前系统输出音量超过 100%；请明确指定 0–100 的目标值，未发送相对调整。' };
      const target = value.action === 'set-volume' ? value.volumePercent : Math.min(100, Math.max(0, before.volumePercent + (value.delta || 0)));
      const argv = backend.backend === 'pipewire' ? value.action === 'set-muted' ? ['set-mute', endpoint, value.muted ? '1' : '0'] : ['set-volume', '--limit', '1.0', endpoint, `${target}%`]
        : value.action === 'set-muted' ? ['set-sink-mute', endpoint, value.muted ? '1' : '0'] : ['set-sink-volume', endpoint, `${target}%`];
      mutationAttempted = true;
      await this._call(backend.file, argv, signal);
      // Never fall back to a second backend after a possibly completed mutation.
      const after = await this._read(backend, endpoint, signal), currentEndpoint = await this._endpoint(backend, signal);
      return actionResult(this.platform, backend.backend, before, after, value, currentEndpoint !== endpoint);
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      return mutationAttempted ? { ...unavailable(this.platform, '系统音量修改未能完成读回，结果未知；请检查目标输出设备，不会自动重试。', error.code), mutationOutcome: 'unknown', ...(targetEndpoint ? { endpoint: targetEndpoint } : {}) }
        : unavailable(this.platform, error.message, error.code);
    }
  }
  async _launch(file, args, { signal }) {
    checkAbort(signal);
    await new Promise((resolve, reject) => {
      const child = spawn(file, args, { shell: false, detached: true, stdio: 'ignore', env: this.env, windowsHide: true });
      child.once('error', () => reject(failure('无法打开目标电脑的系统设置。')));
      child.once('spawn', () => { child.unref(); resolve(); });
    });
  }
  async settings(args, { signal } = {}) {
    const value = validateSystemSettingsCommand(args); checkAbort(signal);
    if (this.platform === 'win32') return { ...await this._windows('open-settings', ['-Section', value.section], signal), platform: this.platform };
    if (this.platform !== 'linux') return unavailable(this.platform, '系统设置入口仅支持 Windows / Ubuntu。', 'platform_unsupported');
    if ((!this.env.DISPLAY && !this.env.WAYLAND_DISPLAY) || !this.env.DBUS_SESSION_BUS_ADDRESS) return unavailable(this.platform, '打开系统设置需要目标电脑的图形用户会话。', 'desktop_unavailable');
    const candidates = value.section === 'sound' ? [['gnome-control-center', ['sound']], ['pavucontrol', []], ['systemsettings', ['kcm_pulseaudio']], ['systemsettings5', ['kcm_pulseaudio']]]
      : [['gnome-control-center', ['display']], ['xfce4-display-settings', []], ['systemsettings', ['kcm_kscreen']], ['systemsettings5', ['kcm_kscreen']]];
    for (const [name, argv] of candidates) {
      const file = await this.find([name], this.env, this.platform); checkAbort(signal);
      if (!file) continue;
      await this.launch(file, argv, { signal, env: this.env });
      checkAbort(signal);
      return { ok: true, platform: this.platform, section: value.section, requested: true, verified: false, message: '已向目标电脑发送打开系统设置的请求；尚未验证窗口显示。' };
    }
    return unavailable(this.platform, '目标桌面没有可用的声音 / 显示设置程序。', 'dependency_missing');
  }
}
