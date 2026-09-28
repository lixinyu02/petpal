import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const musicPlayers = Object.freeze({ qqmusic: 'QQ 音乐', netease: '网易云音乐' });
const actions = ['open', 'play', 'pause', 'next', 'previous'];
const fail = message => Object.assign(new Error(message), { status: 400 });
export function validateMusicCommand(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(key => !['player', 'action'].includes(key))) throw fail('音乐操作参数无效。');
  if (!Object.hasOwn(musicPlayers, args.player) || !actions.includes(args.action)) throw fail('请选择 QQ 音乐或网易云音乐及支持的操作。');
  return { player: args.player, action: args.action };
}

// Only fixed executable/argv pairs reach this helper; never invoke a shell.
export function runProcess(file, args, { signal, timeoutMs = 12000, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(Object.assign(new Error('操作已停止。'), { name: 'AbortError' }));
    const child = spawn(file, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env });
    let output = '', size = 0, error, done = false;
    const abort = () => { error = Object.assign(new Error('操作已停止。'), { name: 'AbortError' }); child.kill(); };
    const timer = setTimeout(() => { error = new Error('本机播放器响应超时。'); child.kill(); }, timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', data => { size += data.length; if (size > 128 * 1024) { error = new Error('播放器返回内容过大。'); child.kill(); } else output += data.toString('utf8'); });
    child.stderr.on('data', () => {});
    const finish = (code, spawnError) => {
      if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (error || spawnError || code !== 0) reject(error || new Error('本机媒体接口不可用，请确认桌面会话和播放器支持。'));
      else resolve(output.trim());
    };
    child.once('error', e => finish(null, e)); child.once('close', code => finish(code));
  });
}

const linuxExecutables = { qqmusic: ['qqmusic'], netease: ['netease-cloud-music', 'cloudmusic'] };
const linuxIdentity = { qqmusic: /qqmusic|qq音乐/i, netease: /netease-cloud-music|cloudmusic|网易云音乐/i };
const mprisMethods = { play: 'Play', pause: 'Pause', next: 'Next', previous: 'Previous' };
const mprisCapabilities = { play: 'CanPlay', pause: 'CanPause', next: 'CanGoNext', previous: 'CanGoPrevious' };
export function parseMprisNames(output) {
  return [...new Set(String(output).match(/org\.mpris\.MediaPlayer2\.[A-Za-z0-9_.-]+/g) || [])];
}
async function locate(names, env) {
  for (const dir of (env.PATH || '').split(path.delimiter).filter(Boolean)) for (const name of names) {
    const file = path.join(dir, name); try { await access(file, 1); return file; } catch { /* next */ }
  }
  return null;
}

export class MusicController {
  constructor({ platform = process.platform, run = runProcess, env = process.env, find = locate } = {}) { this.platform = platform; this.run = run; this.env = env; this.find = find; }
  async windows(action, player, signal) {
    const powershell = path.join(this.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const script = fileURLToPath(new URL('./native/music-windows.ps1', import.meta.url)).replace(/\.asar([\\/])/i, '.asar.unpacked$1');
    const value = JSON.parse(await this.run(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', script, '-Action', action, ...(player ? ['-Player', player] : [])], { signal, env: this.env, timeoutMs: 20000 }));
    if (value.ok === false) throw new Error(value.message || '播放器未完成操作。');
    return value;
  }
  async dbus(args, signal) { return this.run('gdbus', ['call', '--session', ...args], { signal, env: this.env }); }
  async property(bus, iface, name, signal) {
    return this.dbus(['--dest', bus, '--object-path', '/org/mpris/MediaPlayer2', '--method', 'org.freedesktop.DBus.Properties.Get', iface, name], signal);
  }
  async linuxSessions(signal) {
    const output = await this.dbus(['--dest', 'org.freedesktop.DBus', '--object-path', '/org/freedesktop/DBus', '--method', 'org.freedesktop.DBus.ListNames'], signal);
    const sessions = [];
    for (const bus of parseMprisNames(output)) {
      if (signal?.aborted) throw Object.assign(new Error('操作已停止。'), { name: 'AbortError' });
      const [identity, desktopEntry] = await Promise.all([
        this.property(bus, 'org.mpris.MediaPlayer2', 'Identity', signal),
        this.property(bus, 'org.mpris.MediaPlayer2', 'DesktopEntry', signal).catch(e => { if (e.name === 'AbortError') throw e; return ''; }),
      ]).catch(e => { if (e.name === 'AbortError') throw e; return ['', '']; });
      for (const [id, pattern] of Object.entries(linuxIdentity)) if (pattern.test(identity) || pattern.test(desktopEntry)) sessions.push({ id, bus });
    }
    return sessions;
  }
  async status({ signal } = {}) {
    const players = Object.entries(musicPlayers).map(([id, name]) => ({ id, name, installed: false, session: false, controls: [] }));
    if (this.platform === 'win32') {
      try {
        const result = await this.windows('status', null, signal);
        result.players = result.players.map(p => ({ ...p, name: musicPlayers[p.id] || p.name,
          message: p.session ? undefined : p.message?.startsWith('Multiple') ? '存在多个同类媒体会话，请关闭多余会话。' : '尚无此播放器的系统媒体会话；可先手动播放一首歌。' }));
        if (result.message) result.message = '当前 Windows 会话未提供系统媒体控制。';
        return { platform: this.platform, ...result };
      }
      catch (e) { if (e.name === 'AbortError') throw e; return { platform: this.platform, players, message: e.message }; }
    }
    if (this.platform !== 'linux') return { platform: this.platform, players, message: '音乐客户端控制支持 Windows 和 Ubuntu 桌面。' };
    for (const player of players) player.installed = Boolean(await this.find(linuxExecutables[player.id], this.env));
    try {
      const sessions = await this.linuxSessions(signal);
      for (const player of players) {
        const matches = sessions.filter(s => s.id === player.id);
        if (matches.length !== 1) { player.message = matches.length ? '多个同类播放器会话，请关闭多余会话。' : '尚无此播放器的 MPRIS 会话。'; continue; }
        player.session = true;
        const bus = matches[0].bus;
        player.state = (await this.property(bus, 'org.mpris.MediaPlayer2.Player', 'PlaybackStatus', signal)).match(/Playing|Paused|Stopped/)?.[0] || 'Unknown';
        if (!/<true>/.test(await this.property(bus, 'org.mpris.MediaPlayer2.Player', 'CanControl', signal))) continue;
        for (const [action, prop] of Object.entries(mprisCapabilities)) if (/<true>/.test(await this.property(bus, 'org.mpris.MediaPlayer2.Player', prop, signal))) player.controls.push(action);
      }
      return { platform: this.platform, players };
    } catch (e) { if (e.name === 'AbortError') throw e; return { platform: this.platform, players, message: '当前桌面会话未提供 gdbus / MPRIS，请在已登录的 Ubuntu 桌面打开播放器。' }; }
  }
  async execute(args, { signal } = {}) {
    const { player, action } = validateMusicCommand(args);
    if (signal?.aborted) throw Object.assign(new Error('操作已停止。'), { name: 'AbortError' });
    if (this.platform === 'win32') return this.windows(action, player, signal);
    if (this.platform !== 'linux') throw new Error('此系统暂不支持音乐客户端控制。');
    if (action === 'open') {
      const executable = await this.find(linuxExecutables[player], this.env);
      if (!executable) throw new Error(`未检测到 ${musicPlayers[player]} 客户端。`);
      if (signal?.aborted) throw Object.assign(new Error('操作已停止。'), { name: 'AbortError' });
      // Launch the exact known desktop executable without passing model-generated arguments.
      await new Promise((resolve, reject) => {
        const child = spawn(executable, [], { detached: true, stdio: 'ignore', shell: false, env: this.env });
        child.once('error', () => reject(new Error('无法打开播放器。'))); child.once('spawn', () => { child.unref(); resolve(); });
      });
      return { ok: true, message: `已发送打开 ${musicPlayers[player]} 的请求。` };
    }
    const matches = (await this.linuxSessions(signal)).filter(s => s.id === player);
    if (matches.length !== 1) throw new Error(matches.length ? '存在多个同类播放器会话，无法确定目标。' : '播放器没有公开 MPRIS 会话，请先打开并播放一首歌。');
    const bus = matches[0].bus;
    if (!/<true>/.test(await this.property(bus, 'org.mpris.MediaPlayer2.Player', 'CanControl', signal)) || !/<true>/.test(await this.property(bus, 'org.mpris.MediaPlayer2.Player', mprisCapabilities[action], signal))) throw new Error('播放器当前不支持这项操作。');
    await this.dbus(['--dest', bus, '--object-path', '/org/mpris/MediaPlayer2', '--method', `org.mpris.MediaPlayer2.Player.${mprisMethods[action]}`], signal);
    return { ok: true, message: `已向 ${musicPlayers[player]} 发送${{play:'播放',pause:'暂停',next:'下一首',previous:'上一首'}[action]}指令。` };
  }
}
