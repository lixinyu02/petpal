# Agent 实测与工作台空间整理验收

- 日期：2026-09-29 至 2026-09-30（Asia/Shanghai）
- 前端源码：`04e14b5fe28ba7b4451f1e8e47c95fcb6f7bdacf`
- 范围：网页；安装包仍为 0.9.0，本轮不重新打包或发布 Release。

## 真实 Agent 执行

在生产 HTTPS 网页登录 test，选择中央服务器、GPT-6 Luna / max、只读和需要时询问。通过真实页面提交任务，并在看到具体命令后选择“允许本次”。内置 Codex CLI 0.143 的终端工具实际执行：

```powershell
Write-Output (Get-Location).Path
Write-Output ([System.Runtime.InteropServices.RuntimeInformation]::OSDescription)
Write-Output (2 + 3)
```

工具记录的退出码为 0，用时 0.2409 秒。实际输出包括用户隔离工作目录、`Microsoft Windows 10.0.26200` 和 `5`；随后回复 `AGENT_READONLY_OK`。证据来自 terminal function_call_output，不仅是模型文字。

审批等待期间加入第二条任务。刷新页面后重新选择此测试对话，审批与队列仍在；第一条完成后，第二条自动执行，在同一 native thread 中复述上一条结果 `5`，返回 `QUEUE_CONTEXT_OK`。刷新没有自动选回会话，需从历史列表进入；未宣称自动恢复选中。

停止验证中，一条只输出文本的短命令直接完成，未进入审批，因此不把它作为停止成功证据。随后提交仅等待和输出文字的命令，在审批等待阶段点击“停止生成”：运行状态变成 cancelled、审批消失、队列保持一条且 paused=true。约 11 秒后的状态读回仍为暂停。点击“继续队列”后，该条被调度并完成，队列清空、paused=false。该条提示词要求模型判断“明确恢复”，模型并不知道 UI 按钮的语义，最终未照搬指定回复标记；恢复结论依据实际调度与完成状态，不依据该标记。测试会话保留。

真实测试只覆盖中央 Windows 执行服务器。当前没有已登录在线的其他 Windows/Ubuntu 客户端，不能据此宣称异机或音乐软件控制已实机通过，也未进行不受限的文件修改测试。

## 回归与界面

- 13 个 Agent 相关测试文件 152/152 通过，覆盖授权、权限、队列、追加、停止恢复、执行主机隔离、断线和协议。codex-real 启动真实内置 CLI，但模型上游是 loopback fixture，区别于以上生产调用。
- UI 修改后 TypeScript、隔离 Vite 构建、git diff --check，以及 36 项权限/队列/主机选择回归通过。
- Chrome 插件模拟 CSS 视口：1280×800、1280×600、390×844、412×915，未作为手机实机或原生包验收。
- 1280×800 默认布局：消息区域从 699×258.5 增至 992.6×392.4 CSS px。顶部上下文从 208.5 降至 131.5 px；中屏伙伴栏默认收起，可主动展开。
- 主区保留 Chat/Agent 清晰切换，侧栏统一为“对话”；模型与执行电脑同排。
- 权限、语音、就绪信息与主机帮助按需展开；Escape 收起并归焦，焦点移出或外部点击会关闭；权限与模型的运行中禁用逻辑保留。
- 队列默认显示数量与暂停状态，展开可编辑并保存条目；停止、恢复、错误与状态未知提示保留可见；审批“查看请求”会滚动并聚焦审批卡。
- 390px 审批页无横向溢出，审批按钮与停止入口可见；412px 权限弹层在视口内。手机顶部二次元伙伴正常呈现。
- 隔离预览用合成账号与模拟中央/Windows/Ubuntu 执行器验收了模型搜索切换、主机选择、审批、队列编辑/停止/恢复、失败提示及 Chat。它不运行真实 CLI、外部模型或电脑软件，不读取生产状态。

## 部署

2026-09-30 00:13:52 完成备份部署。部署前确认无活跃任务、审批或待执行队列；备份最新完整状态、服务配置和旧静态资源后受控替换。服务 PID 从 216172 变为 217052。

部署回执确认：2 个账号、16 个会话、所有消息与用户/模型/语音配置完整保留，服务实例与配置不变，CosyVoice 参考音频哈希不变；23 个静态文件与隔离构建一致。私有备份保留于 `.data/https/workspace-density-backup-20260930-001335-342-8632ee1c`。

公网校验完成：23/23 静态文件 SHA-256 与隔离构建逐一相同；health 正常，版本仍 0.9.0；匿名 `/api/state` 与 `/api/voice` 均返回 401。

Chrome 已从公网重新加载新资源并打开真实测试会话，历史与结果完整。1280×800 消息区为 992.6×392.4 CSS px；390×844 页面宽度严格为 390px，消息区高度 449px，语音弹层位于 x=16..326、y=601.4..791，仍显示 CosyVoice 流式朗读就绪。浏览器未记录 error。已清理视口模拟，保留线上结果页；隔离预览进程已停止，4327 无监听。

## 证据

私有原始证据保留在 Git 忽略目录，不提交账号凭据、token、会话哈希或参考音频：

- `evidence/agent-live/terminal-evidence.json`、`before-approval.json`、`stop-paused.json`、`stop-resumed.json`
- `evidence/workspace-density/targeted-tests.log`
- `evidence/workspace-density/permissions-desktop.png`、`approval-short.png`、`mobile-approval-390.png`
- `evidence/workspace-density/online-desktop-1280.png`、`online-mobile-390.png`、`public-verification.json`
- `.data/https/workspace-density-deployment-20260930-001335-342-8632ee1c.json`
