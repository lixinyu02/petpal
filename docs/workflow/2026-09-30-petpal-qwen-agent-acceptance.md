# Qwen Agent 模型适配验收

日期：2026-09-30。范围：issue-47，Agent 模型选择及纯文本输入限制。

历史记录：下文为 issue-47 当时的配置及验收结论。模型后来已支持图片，issue-58 移除了型号强制禁图；当前能力及网关恢复验收见 [首页选择器与 Qwen 兼容验收](2026-09-30-petpal-home-agent-compat-acceptance.md)。

## 交付

新增 `CLIProxyAPI · Qwen3.8 Flash Agent`，精确模型为 `halogen-qwen3.8-flash-next`。它通过现有 Codex 网关的同源 Responses 接口执行任务，显式使用 `reasoning.effort=none`，避免空值继承全局 GPT 的 max。owner 可用，test 已追加模型授权；原 GPT 默认、原生 Qwen Chat 连接、账号 Agent 权限等级及历史记录保留。私有连接配置通过管理 API 持久化，不写入公开源码。

Qwen 仅支持文字。Agent 界面使用实际运行任务的模型能力，禁用图片入口及图像粘贴；已有附图草稿在新提交前报错并保留。未确认提交继续复用原 UUID 和原 payload，保留既有确认与幂等语义。Chat 输入行为保持。

## 验证

- 现有两个服务的模型列表均列出目标模型；显式 none 的 Responses 函数调用及 function_call_output 续接均完成。
- 实际捆绑 Codex 使用 Qwen 执行 PowerShell `Write-Output 'PETPAL_QWEN_AGENT_TOOL_OK'`，真实工具回执 exit 0；随后同线程续接成功，全局配置保持。
- test 账号真实 Agent 任务完成，run.model 为目标模型、effort 为 none；终端输出 `PETPAL_QWEN_ACCOUNT_OK`，随后同一线程返回该标记及“账号续接通过”。测试对话已清理，独立测试登录已退出。
- 模型切换、Agent 权限、附件和远程执行定向回归 48/48；其中真实捆绑 CLI 回归验证 GPT → GPT → Qwen 的请求 model 与 high → high → none。TypeScript 与独立 Vite 构建通过。
- 生产静态文件 27 项逐项字节比对通过；最后原子替换 HTML，旧 assets 和 Windows 0.9.1 下载镜像保留。后端健康 200，匿名状态接口 401。后端没有为本次部署重启。
- Chrome 从公网 HTTPS 页面登录 test：Agent 列表可选 Qwen，显示 none/仅文字；选中后图片按钮禁用，切回 GPT 后恢复。验收使用空白工作页，没有新增浏览器任务或修改旧对话；结束时恢复原 GPT 选择并退出独立登录。

私有证据位于忽略目录 `evidence/qwen-agent-20260930/`：`configuration.json`、`tools.json`、`codex.json`、`codex-tools.json`、`live-account.json`、`tests.log`、`build.log`、`deployment.json` 与 `chrome-qwen.jpg`。凭据、原始协议日志、生产快照和截图均不提交公开仓库。

## 实测边界

本次已验证模型工具协议、Windows 主机上的真实 Codex 执行、test 账号的远程任务及网页选择入口。未据此宣称 QQ 音乐操作、Ubuntu 实机任务或四端新安装包均已验收；本轮没有重新制作安装包。
