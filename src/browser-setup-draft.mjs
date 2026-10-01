export const browserSetupTask = '帮我在这台选中的执行电脑准备 Chrome 和内置 OpenCLI Browser Bridge。先用 petpal_opencli_setup(action=status) 只读检查；OpenCLI 已内置，不另装全局 npm 包。Chrome 缺失时按本轮权限和审批，用 install-browser 下载并验证官方安装器，给出路径让我完成安装和系统确认，prepared 不能当作已安装。Chrome 已安装后可用 open-extension 打开官方商店页，我来确认扩展权限。最后引导我在这台电脑的 OpenCLI 设置中检查连接、明确选择在线 Chrome 档案。不要自动改默认浏览器、登录网站、选档案或提高权限。如果当前客户端没有这个工具，说明需要更新客户端，不用 shell 或其他下载途径替代。';

/** A draft only: no permissions, model, project, network or submission mutations. */
export function createBrowserSetupDraft({ connected, canUseCodex, host, busy, draft = '', attachmentCount = 0 }) {
  if (!connected || !canUseCodex) throw new Error('请先登录并开通 Agent。');
  if (busy) throw new Error('当前任务或设置正在处理，请完成后再准备浏览器。');
  if (draft.trim() || attachmentCount) throw new Error('输入框还有未发送内容，请先发送或清空后再准备浏览器。');
  if (!host?.online || !host.id) throw new Error('请先在 Agent 中选择一台在线执行电脑。');
  if (host.platform && !['win32', 'linux'].includes(host.platform)) throw new Error('当前安装引导支持 Windows 和 Ubuntu 执行电脑。');
  return { hostId: host.id, content: browserSetupTask };
}
