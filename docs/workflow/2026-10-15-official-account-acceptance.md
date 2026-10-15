# 官方账号接入验收记录

日期：2026-10-15。设计与任务见同目录 `2026-10-15-official-account-design.md`、`2026-10-15-official-account-issues.md`。

## 完成范围

Windows/Ubuntu 本机服务上的小伴用户，可在原生「模型连接」设置中发起官方 Sign in with ChatGPT，取消、切换或退出本人的独立注册。目录从所选账号的官方接口读取；个人模型用于 Chat、Chat + Agent、本机/远程 Agent、独立审查与自动化。原有 API 连接及设备身份限制保留。不会读取宿主 `~/.codex/auth.json`、修改全局 Codex 配置或将官方凭据发送给执行机。

官方额度区域每 15 秒读取主进程缓存的观察结果，并支持手动刷新、恢复后重试及官方用量管理链接。仅已完成的真实响应累加本次连接请求/Token；未返回明细不按文本长度估算。SIWC 未公开套餐剩余百分比查询 API，界面不制造余额或重置时间。目录刷新不能证明推理或额度可用。

## 自动验证

- issue-1：153 项授权、签名、取消、隔离、续期、网关、IPC 和打包源检查通过。
- issue-2：562 项针对授权/用量、模型 API、Chat/Agent/远程中继、审批、自动化、UI、默认模型和会话的组合回归通过；生产构建通过。
- issue-3：真实原生入口验收发现额度恢复动作需要等待异步结果，已修复并在异步身份查询后重新验证当前小伴登录。新增拒绝/隔离回归；相关 145 项检查通过。
- 按官方错误语义修正“账号不具备资格”提示，保留切换账号和用量管理，避免诱导当前账号重复 OAuth。后续 60 项 UI/App 回归与生产构建通过。
- 内置 Codex 0.143 实际进程通过本地模拟的官方 Responses 协议完成了一次工具调用及回执；Chat 的 `run_agent` 完整工具回路也通过。两者均不代表真实官方推理。
- issue-4：修复官方响应缺失 SSE MIME 声明时的流识别，以及流式输出已到达、但 `response.completed.output=[]` 时的汇总校验。依据真实流事件保留输出，仍要求官方完成事件，不伪造成功。补齐原生启动 VM fixture 的官方账号依赖，保留原始启动／退出断言。
- issue-4 最终组合回归共 171 项：170 项通过，1 项 90 秒 Guardian 检查按运行配置跳过；生产构建通过。下述 Windows 真实账号续验与自动化替身结果分别记录。

日志保存在忽略的 `evidence/official-account-20261015/`，不提交凭据或运行数据。

## 原生结果

| 环境 | 实际结果 | 边界 |
| --- | --- | --- |
| Windows x64 / Electron 39.8.10 | 原生登录门禁与真实 IPC 通过；保留用户已完成的官方授权，读取 7 个模型；精确选择 `gpt-6-luna`，Chat HTTP 200 完成，内置 Codex Agent 只读短任务完成且实际模型匹配；实际用量与页面刷新计数一致 | `packaged:false`；短任务只回复 OK、未调用工具，不代表复杂工具、图片或远程执行实测；没有重打/发布安装包 |
| Ubuntu 24.04 / WSLg x64 / Electron 39.8.10 | 独立 `/tmp` stage、HOME、用户目录与 CODEX_HOME；实际 Linux 进程退出 0；相同门禁与设置/IPC 验收通过；未关闭 Chromium 沙箱 | 使用兼容且核对版本/哈希的 Linux 依赖；不是独立物理 Ubuntu 电脑或 ARM64 验收 |

已检查两端截图，官方账号入口可见、按钮可用、未登录时不显示未授权模型。Windows 记录见 `windows-c1c01a49079b4a33af19fdc69d019229/official-result.json`；Linux 记录见 `linux/run-receipt.json`、`linux/preflight.json`（均位于上述 evidence 目录）。

Windows 成功续验记录为 `windows-resume-bc96b300c5b54d33954ef407138161c2/official-resume-result.json`，对应 `official-resume.png` 已目视检查。截图遮罩账号标签，保留真实模型与用量界面；页面手动刷新后的状态与已完成请求数均匹配原生结果。测试窗口和同一私有 profile 已保留，未复制或导出官方凭据。

Linux `postcheck.json` 确认源码匹配且无残留测试进程；独立、无网络的同代码私有存储探针确认目录 `0700`、文件 `0600`，见 `auth-storage-permissions.json`。该探针不是已消失的 GUI 临时 profile 的事后权限证明。

## 真实官方授权边界

早期 Windows 登录等待窗口曾超时，原记录中的 `signedIn:false`、`inferenceCompleted:false` 作为历史证据保留。用户随后完成授权，已通过同一私有 profile 的非破坏性续验确认 `signedIn:true`、套餐授权有效及 7 个真实模型；旧超时结果已由本次成功续验替代，不需要因此重新授权。原生授权等待窗口已延长至 10 分钟。

续验精确要求 `gpt-6-luna`，目录中没有该模型时不会回退首项或其他模型。实际 Chat 连接测试 HTTP 200、`inferenceCompleted:true`；随后新建独立 Agent 会话，只读、手动审批，要求“仅回复 OK，不要调用任何工具或操作电脑”。任务实际完成、模型匹配，未调用工具或操作电脑；未实测复杂工具回路、图片输入或远程设备执行。

两次真实完成响应后，原生用量状态为 `available`，本次连接已完成请求数为 2，输入 Token 10,993、输出 10、合计 11,003。页面刷新状态与请求计数匹配。这些是当前身份本次连接的响应统计，不能据此推断套餐总量、剩余额度或重置时间。Ubuntu 此轮仅保留先前 WSLg 源码入口、登录门禁与 IPC 验收；没有在 Ubuntu 完成真实官方 OAuth 或套餐推理，也不是独立物理机器或 ARM64 验收。

真实套餐总用量以 [ChatGPT 官方用量](https://chatgpt.com/settings/usage)为准。协议依据：[Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)、[Errors and recovery](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery)、[官方集成说明](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt)。

## 提交与分发

- issue-1：`cc2106a`，私有授权及官方网关。
- issue-2：`a1f2f88`，个人模型、Chat/Agent、UI 和用量。
- issue-3：原生验收、额度重试异步隔离修复及使用说明，见本 issue 对应 Git 提交。
- issue-4：`fix(issue-4): handle official stream variants and verify Luna inference`，保留授权的原生续验、官方流兼容修复及 GPT 6 Luna 真实 Chat／Agent／用量结果。

本轮未推送 GitHub、未修改正式下载清单、未覆盖现有 0.9.11 安装包。新增原生文件已纳入 Windows/Ubuntu 打包源和校验清单。
