import { MusicController, musicPlayers, validateMusicCommand } from './music.mjs';
import { OpenCliRunner, validateBrowserAction } from './opencli.mjs';

const musicActions = { open: '打开', play: '播放', pause: '暂停', next: '下一首', previous: '上一首' };
export const desktopToolSpecs = [
  { type: 'function', name: 'petpal_music_status', description: '检查本机 QQ 音乐和网易云音乐的安装、媒体会话与可用控制；不会打开或播放音乐。媒体接口不提供歌曲搜索。', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { type: 'function', name: 'petpal_music_command', description: '控制指定的本机音乐客户端。open 打开已安装软件；play/pause/next/previous 只作用于该软件公开的唯一媒体会话。失败时不得声称已完成，也不可用全局媒体键替代。操作由用户确认后执行。', inputSchema: { type: 'object', properties: { player: { type: 'string', enum: ['qqmusic','netease'] }, action: { type: 'string', enum: Object.keys(musicActions) } }, required: ['player','action'], additionalProperties: false } },
  { type: 'function', name: 'petpal_browser', description: '通过内置 OpenCLI Browser Bridge 操作 PetPal 独立会话租用的 QQ 音乐/网易云音乐网页。需要 Chrome 扩展与显式 profile。先 connect/tabs，再 open 官方HTTPS页面，snapshot获取真实ref，再click/fill/key。只允许音乐官网操作，不接受任意脚本；普通用户标签和其他活跃任务标签不可用，OpenCLI 可能复用自动化组内空闲标签。网页可能需用户登录、会员或点击播放；不是桌面播放器搜索接口。每项操作需确认。', inputSchema: { type: 'object', properties: {
    action: { type: 'string', enum: ['connect','tabs','open','snapshot','click','fill','key','close'] },
    profileId: { type: 'string' }, tabId: { type: 'string' }, url: { type: 'string' }, target: { type: 'integer' }, text: { type: 'string' }, key: { type: 'string' },
  }, required: ['action'], additionalProperties: false } },
];

export function createDesktopTools({ dataDir, music = new MusicController(), opencli = new OpenCliRunner({ dataDir }) } = {}) {
  let active = null, closed = false;
  function describe(name, args) {
    if (name === 'petpal_music_status') {
      if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length) throw new Error('状态工具不接受额外参数。');
      return { description: '检查本机音乐播放器状态', approvalRequired: false };
    }
    if (name === 'petpal_music_command') {
      const value = validateMusicCommand(args);
      return { description: `${musicPlayers[value.player]}：${musicActions[value.action]}（控制服务主机上的客户端）`, approvalRequired: true };
    }
    if (name === 'petpal_browser') {
      const value = validateBrowserAction(args);
      const details = [value.action, value.url, value.profileId && `浏览器配置 ${value.profileId}`, value.tabId && `标签 ${value.tabId}`, value.target !== undefined && `页面控件 ${value.target}`, value.key, value.text !== undefined && `填写文本：${value.text.slice(0, 300)}`].filter(Boolean).join(' · ');
      return { description: `OpenCLI 音乐网页：${details}`, approvalRequired: true };
    }
    throw new Error('不支持的电脑助手工具。');
  }
  return {
    specs: desktopToolSpecs,
    describe,
    async status() { const [m, o] = await Promise.all([music.status(), opencli.status()]); return { music: m, opencli: o, toolVersion: 'music-browser-v1', busy: Boolean(active) }; },
    async execute(name, args, { signal } = {}) {
      describe(name, args);
      if (closed || signal?.aborted) throw Object.assign(new Error('操作已停止。'), { name: 'AbortError' });
      if (active) throw Object.assign(new Error('另一项电脑操作正在进行，请稍后重试。'), { status: 409 });
      const controller = new AbortController(); let finish;
      const operation = { controller, done: new Promise(resolve => { finish = resolve; }) }; active = operation;
      const cancel = () => controller.abort(); signal?.addEventListener('abort', cancel, { once: true });
      try {
        if (name === 'petpal_music_status') return await music.status({ signal: controller.signal });
        if (name === 'petpal_music_command') return await music.execute(args, { signal: controller.signal });
        return await opencli.execute(args, { signal: controller.signal });
      } finally { signal?.removeEventListener('abort', cancel); if (active === operation) active = null; finish(); }
    },
    async close() { closed = true; const pending = active; pending?.controller.abort(); await opencli.close(); await pending?.done; },
  };
}
