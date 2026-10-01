import { MusicController, musicPlayers, validateMusicCommand } from './music.mjs';
import { validateBrowserAction } from './opencli.mjs';
import { OpenCliManager } from './opencli-manager.mjs';
import { validateOpenCliSites, validateOpenCliQuery } from './opencli-sites.mjs';
import { describeOpenCliQueryArguments } from './opencli-browser-policies.mjs';
import { MusicMcpManager, validateMusicMcpCall, MUSIC_MCP_TOOLS } from './music-mcp.mjs';
import { ComputerUseMcpManager, validateComputerUseCall, validateComputerUseTools } from './computer-use-mcp.mjs';
import { CODEX_TOOL_VERSION } from './codex-config.mjs';

const musicActions = { open: '打开', play: '播放', pause: '暂停', next: '下一首', previous: '上一首' };
export const desktopToolSpecs = [
  {type:'function',name:'petpal_opencli_sites',description:'查看选中执行电脑的内置 OpenCLI 网站库存与可调用查询。无参数返回网站概览与notebookSites常用网站；传site+command获取真实inputSchema。callable=true且mode=public无需Chrome；mode=browser/configured需要用户在此电脑设置中明确连接Chrome档案。needs-url/configRequired的站点先由用户填写网址。打包和ready不代表网站已登录或联网成功。',inputSchema:{type:'object',properties:{site:{type:'string'},command:{type:'string'}},additionalProperties:false}},
  {type:'function',name:'petpal_opencli_query',description:'用选中执行电脑的内置OpenCLI执行固定只读网站查询。先查petpal_opencli_sites的callable命令与schema。public走公开HTTP；browser/configured使用用户已显式连接的Chrome，失败时引导到OpenCLI设置，不自行选档案或重试。网盘只读目录，不下载或转存；configured站内搜索通过必应site:。需完整访问并遵循审批。失败如实报告，不用shell/npx/任意脚本代替，不自行启用工具。',inputSchema:{type:'object',properties:{site:{type:'string'},command:{type:'string'},arguments:{type:'object'}},required:['site','command','arguments'],additionalProperties:false}},
  {type:'function',name:'petpal_computer_use_tools',description:'在选中的执行电脑连接已启用的 Zavora Computer Use MCP，获取真实工具清单；传 tool 可获取一个工具的完整参数。支持应用、Accessibility、截图、键鼠、剪贴板和脚本。不会安装程序。每项实际操作需要完整访问并遵循当前审批方式。',inputSchema:{type:'object',properties:{tool:{type:'string'}},additionalProperties:false}},
  {type:'function',name:'petpal_computer_use_call',description:'调用选中执行电脑上的 Computer Use。先查真实 schema，再发现窗口、读取 Accessibility，必要时截图；基于最近结果操作并读回验证。截图直接给模型观察。先确认软件/窗口，支持 focus_strategy 的操作只允许 strict。失败不得声称完成。脚本/剪贴板/全屏观察也需完整访问与当前审批。',inputSchema:{type:'object',properties:{tool:{type:'string'},arguments:{type:'object'}},required:['tool','arguments'],additionalProperties:false}},
  { type: 'function', name: 'petpal_music_mcp_tools', description: '连接已启用的本机音乐 MCP 并返回真实工具清单与参数。网易云桌面 MCP 仅 Windows；Ubuntu 使用现有媒体工具。QQ MCP 仅查询和播放链接，不能控制QQ桌面播放。只在选中的执行电脑运行，不会配置或安装服务。', inputSchema: {type:'object',properties:{player:{type:'string',enum:['netease','qqmusic']}},required:['player'],additionalProperties:false} },
  { type: 'function', name: 'petpal_music_mcp_call', description: '按真实MCP工具清单调用音乐服务。先用petpal_music_mcp_tools获取参数。网易云支持搜索/播放/队列/循环模式/音量/桌面歌词；上一首下一首用petpal_music_command。QQ支持search/detail/lyric/url/recommend/mv/similar/producer/hot_comments；排行榜用detail(type=top)。QQ只返回链接，失败或返回链接均不得声称已播放。禁止全局快捷键和未列出的工具。', inputSchema:{type:'object',properties:{player:{type:'string',enum:['netease','qqmusic']},tool:{type:'string'},arguments:{type:'object'}},required:['player','tool','arguments'],additionalProperties:false} },
  { type: 'function', name: 'petpal_music_status', description: '检查本机 QQ 音乐和网易云音乐的安装、媒体会话与可用控制；不会打开或播放音乐。媒体接口不提供歌曲搜索。', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { type: 'function', name: 'petpal_music_command', description: '控制指定的本机音乐客户端。open 打开已安装软件；play/pause/next/previous 只作用于该软件公开的唯一媒体会话。失败时不得声称已完成，也不可用全局媒体键替代。操作由用户确认后执行。', inputSchema: { type: 'object', properties: { player: { type: 'string', enum: ['qqmusic','netease'] }, action: { type: 'string', enum: Object.keys(musicActions) } }, required: ['player','action'], additionalProperties: false } },
  { type: 'function', name: 'petpal_browser', description: '通过内置 OpenCLI Browser Bridge 操作 PetPal 独立会话租用的 QQ 音乐/网易云音乐网页。需要 Chrome 扩展与显式 profile。先 connect/tabs，再 open 官方HTTPS页面，snapshot获取真实ref，再click/fill/key。只允许音乐官网操作，不接受任意脚本；普通用户标签和其他活跃任务标签不可用，OpenCLI 可能复用自动化组内空闲标签。网页可能需用户登录、会员或点击播放；不是桌面播放器搜索接口。每项操作需确认。', inputSchema: { type: 'object', properties: {
    action: { type: 'string', enum: ['connect','tabs','open','snapshot','click','fill','key','close'] },
    profileId: { type: 'string' }, tabId: { type: 'string' }, url: { type: 'string' }, target: { type: 'integer' }, text: { type: 'string' }, key: { type: 'string' },
  }, required: ['action'], additionalProperties: false } },
];

export function createDesktopTools({ dataDir, music = new MusicController(), opencli, opencliDataDir = dataDir, opencliManager, musicMcpDataDir = dataDir, musicMcpScope = 'local', musicMcp, computerUseMcpDataDir = musicMcpDataDir, computerUseMcp, scopeForConversation } = {}) {
  const browser = opencliManager ?? new OpenCliManager({dataDir:opencliDataDir,scope:musicMcpScope,...(opencli?{browser:opencli}:{})});
  const browserScoped = new Map([[musicMcpScope,browser]]);
  const browserFor = conversationId => {
    const scope=scopeForConversation?scopeForConversation(conversationId):musicMcpScope;
    if(typeof scope!=='string'||!scope)throw new Error('无法确认网页任务所属账号，请重新创建对话。');
    if(!browserScoped.has(scope)){
      if(browserScoped.size>=32)throw new Error('本机网页助手账号实例已达上限。');
      browserScoped.set(scope,new OpenCliManager({dataDir:opencliDataDir,scope}));
    }
    return browserScoped.get(scope);
  };
  const mcp = musicMcp ?? new MusicMcpManager({dataDir:musicMcpDataDir,scope:musicMcpScope});
  const scoped = new Map([[musicMcpScope,mcp]]);
  const computer = computerUseMcp ?? new ComputerUseMcpManager({dataDir:computerUseMcpDataDir,scope:musicMcpScope});
  const computerScoped = new Map([[musicMcpScope,computer]]);
  const computerFor = conversationId => {
    const scope=scopeForConversation?scopeForConversation(conversationId):musicMcpScope;
    if(typeof scope!=='string'||!scope)throw new Error('无法确认电脑任务所属账号，请重新创建对话。');
    if(!computerScoped.has(scope)){
      if(computerScoped.size>=32)throw new Error('本机电脑助手账号实例已达上限。');
      computerScoped.set(scope,new ComputerUseMcpManager({dataDir:computerUseMcpDataDir,scope}));
    }
    return computerScoped.get(scope);
  };
  const managerFor = conversationId => {
    const scope = scopeForConversation ? scopeForConversation(conversationId) : musicMcpScope;
    if(typeof scope!=='string'||!scope)throw new Error('无法确认音乐任务所属账号，请重新创建对话。');
    if(!scoped.has(scope)){
      if(scoped.size>=32)throw new Error('本机音乐账号实例已达上限，请重启服务后重试。');
      scoped.set(scope,new MusicMcpManager({dataDir:musicMcpDataDir,scope}));
    }
    return scoped.get(scope);
  };
  let active = null, closed = false;
  function describe(name, args) {
    if(name==='petpal_opencli_sites'){
      const value=validateOpenCliSites(args);
      return {description:`查看内置 OpenCLI 网站清单${value.site?` · ${value.site}`:''}${value.command?`/${value.command}`:''}`,approvalRequired:false};
    }
    if(name==='petpal_opencli_query'){
      const value=validateOpenCliQuery(args);
      return {description:`OpenCLI 网站查询：${value.site}/${value.command}\n${describeOpenCliQueryArguments(value)}`,approvalRequired:true};
    }
    if(name==='petpal_computer_use_tools'){
      const value=validateComputerUseTools(args);
      return {description:`连接这台执行电脑的 Zavora MCP，读取${value.tool||'工具清单'}`,approvalRequired:true};
    }
    if(name==='petpal_computer_use_call'){
      const value=validateComputerUseCall(args);
      const description=`这台执行电脑 · Zavora ${value.tool}\n${JSON.stringify(value.arguments)}`;
      if(description.length>8000)throw new Error('电脑操作内容过长，无法完整展示审批，请拆分任务。');
      return {description,approvalRequired:true};
    }
    if(name==='petpal_music_mcp_tools'){
      if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).length!==1||!Object.hasOwn(MUSIC_MCP_TOOLS,args.player))throw new Error('请选择网易云或QQ音乐MCP。');
      return {description:`连接${musicPlayers[args.player]}MCP并读取工具（不会播放）`,approvalRequired:true};
    }
    if(name==='petpal_music_mcp_call'){
      const value=validateMusicMcpCall(args);
      return {description:`${musicPlayers[value.player]} MCP：${value.tool}\n${JSON.stringify(value.arguments)}`,approvalRequired:true};
    }
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
    musicMcp:mcp,
    computerUseMcp:computer,
    opencliManager:browser,
    describe,
    async status() { const [m, o, c, u] = await Promise.all([music.status(), browser.status(),mcp.status(),computer.status()]); return { music: m, opencli: o, musicMcp:c, computerUseMcp:u, toolVersion: CODEX_TOOL_VERSION, busy: Boolean(active) }; },
    async execute(name, args, { signal, conversationId } = {}) {
      describe(name, args);
      if (closed || signal?.aborted) throw Object.assign(new Error('操作已停止。'), { name: 'AbortError' });
      if (active) throw Object.assign(new Error('另一项电脑操作正在进行，请稍后重试。'), { status: 409 });
      const controller = new AbortController(); let finish;
      const operation = { controller, done: new Promise(resolve => { finish = resolve; }) }; active = operation;
      const cancel = () => controller.abort(); signal?.addEventListener('abort', cancel, { once: true });
      try {
        if(name==='petpal_opencli_sites')return await browserFor(conversationId).sites(args);
        if(name==='petpal_opencli_query')return await browserFor(conversationId).query(args,{signal:controller.signal});
        if(name==='petpal_computer_use_tools')return await computerFor(conversationId).tools(args,{signal:controller.signal});
        if(name==='petpal_computer_use_call')return await computerFor(conversationId).call(args,{signal:controller.signal});
        if(name==='petpal_music_mcp_tools'){
          const manager=managerFor(conversationId);await manager.connect(args.player,{signal:controller.signal});
          const status=await manager.status();return {ok:true,...status.servers.find(server=>server.id===args.player)};
        }
        if(name==='petpal_music_mcp_call')return await managerFor(conversationId).call(args,{signal:controller.signal});
        if (name === 'petpal_music_status') return await music.status({ signal: controller.signal });
        if (name === 'petpal_music_command') return await music.execute(args, { signal: controller.signal });
        return await browserFor(conversationId).executeBrowser(args, { signal: controller.signal });
      } finally { signal?.removeEventListener('abort', cancel); if (active === operation) active = null; finish(); }
    },
    async close() { closed = true; const pending = active; pending?.controller.abort(); await Promise.all([...Array.from(browserScoped.values(),manager=>manager.close()),...Array.from(scoped.values(),manager=>manager.close()),...Array.from(computerScoped.values(),manager=>manager.close())]); await pending?.done; },
  };
}
