# 桌面内置 Clash 兼容代理

- Date: 2026-10-15
- Complexity: L2
- Status: final

## Background

小伴 Windows/Ubuntu 内置 Node、Codex 和桌面工具，Chromium 与 Node 网络栈独立，现有 CLI 环境白名单不会继承 HTTP_PROXY。下载中心已有平台/架构字段，但默认选择 x64，Windows 构建及更新表尚未支持 ARM64。

## Goal

内置原版 Mihomo v1.19.32，为 Windows/Ubuntu x64、ARM64 准备对应内核和分发能力。用户在本机设置导入 Clash YAML，手动启停并可选择随小伴启动。默认关闭，只为本应用提供代理；本机与局域网模型、ASR/TTS、OAuth 回调和 CLI 私有网关保持直连。

## Non-goals

不修改系统代理、路由、DNS、防火墙，不启用 TUN、不提权、不启动系统服务。不接管外部 Chrome 网络。不把节点凭据上传中央服务器，不读已有 Clash 配置，不自动订阅第三方服务。ARM 指 ARM64，不将 ARMv7 或独立 ARM 实机未验收当作已支持证据。此次不自动发布 GitHub 正式版。

## Solution

固定官方 MetaCubeX/mihomo v1.19.32，x64 使用 amd64-compatible（GOAMD64=v1），ARM64 使用官方 arm64。构建时获取固定资产，验证压缩包字节数/SHA-256及解压后的 PE/ELF 架构；不在客户端启动时下载 latest。开发缓存与打包 payload 分开，随包带完整 GPL-3.0 许可、固定 commit 的对应源码及 vendor/source notices，不暴露内核自更新。

主进程拥有内核子进程与私有配置目录。导入文件/粘贴 YAML 有大小与结构限制，保存前使用内核校验；强制 loopback、随机端口、随机认证、禁 TUN/额外 listeners/公网 controller，并清除 CLASH_* 环境覆盖。原配置及运行配置仅存本机用户目录，权限收紧；状态不返回节点密码、订阅地址、原 YAML 或 controller secret。启动需要就绪检查、超时、进程归属验证，退出/失败清理自身子进程。停止不重放模型/工具任务，活动请求明确结束或完成后释放。

主进程稳定的 Undici dispatcher 按目标选择直连/本地代理，流式响应不缓冲，保留取消与 TLS 校验。Electron 仅设置自身 session 代理及回环/private bypass，不写系统代理。Codex API/官方推理由主进程私有 transport 转发，因此同时覆盖。子进程只接收本应用生成的受限代理环境；独立 Node worker 显式启用同样 dispatcher。切换不会强杀正在执行的用户 Agent；已有外部工具进程的环境限制在界面说明。公开 ASR WebSocket 单独走受控 CONNECT agent，局域网默认直连。

设置仅通过可信主窗口 IPC，要求当前本机登录；设备级配置修改验证本机 owner 身份及会话在异步操作前后未变化。网页/Android 无本机内核控制入口。下载页提供系统/架构选择与可靠设备提示；无法识别时保留显式选择，不把 ARM 用户默认分配 x64。更新清单增加 Windows ARM64，不声称未发布架构已经可下载。

## Impact

增加内核获取/校验工具、私有进程管理与代理路由、原生 IPC/设置页面；扩展包源清单、Windows 架构构建及下载选择。生产依赖显式声明 YAML/Undici/CONNECT agent，避免依赖开发依赖的偶然存在。旧版本偏好保持，未启用时行为不变。

## Risks

错误节点或远程规则可能导致连接失败，导入/启用不等于节点已联网；不把本地内核就绪当代理出口可用。配置中的远程 provider/geodata 资源需网络，失败明确报告并保留上次配置；不打印原始核心日志。Windows ARM64 客户端还需内置 Codex 和 Computer Use 的原生架构一致。物理 ARM/独立 Ubuntu 与 WSLg 分开记录。

## Verification Plan

本地 HTTP/HTTPS CONNECT 替身验证认证、私有地址绕过、流式取消、启停/崩溃/不重放、IPC 隔离及 YAML 限制。实际官方内核在 Windows x64 和 Ubuntu WSL x64 完成版本/配置/HTTP 转发测试；ARM64 校验 ELF/PE 与包成员，能够执行时再记录实际结果。下载 UI 用 Chrome 检查系统/架构选择和登录限制，TypeScript/Vite 构建及相关回归通过后逐 issue 提交。安装包/公开发布以实际生成、验收状态为准。
