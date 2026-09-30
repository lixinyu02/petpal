# PetPal Zavora Computer Use 集成

- Date: 2026-10-01
- Complexity: L2
- Status: implemented and verified; desktop repackaging deferred

## Background

用户要求 Windows / Ubuntu 客户端接入 Zavora，并实测第三方模型经真实 Codex 控制桌面的路径。现有执行电脑注册、账号授权、完整访问、询问/自动运行与音乐 MCP 管理入口可复用。固定 npm 7.4.0 提供 70 个工具、六种平台 native；Linux 发布 native 要求 GLIBC 2.39，不能直接用于 Ubuntu 22.04。当前动态工具仅返回文字，截图无法被模型看到。

## Goal

在实际选中的执行电脑运行固定 stdio MCP；支持应用发现、Accessibility、截图、鼠标、键盘、剪贴板、窗口与脚本工具，保持真实失败与平台限制。设置默认关闭，配置按服务实例/账号隔离；通过已有完整访问和审批流程运行。图片直接进入本机 Codex，再由受限模型中继转发，不进入聊天事件或 UI 日志。网页/后端先上线，客户端重打包延后。

## Non-goals

不安装 npx latest，不开放 MCP HTTP 端口，不修改 RK3566 板级工程，不自动操作用户音乐或其他私人应用。macOS 包与旧安装包验收不在本轮范围。应用限制列表不是系统沙箱；停止不能撤销已发生的桌面动作。

## Solution

- 固定 @zavora-ai/computer-use-mcp 7.4.0 与 lock integrity，启动 bundled dist/server.js，使用 Electron run-as-node / Node，明确不启动 browser backend。
- ComputerUseMcpManager 暴露 config/configure/status/connect/disconnect/tools/call/close。配置为 revision UUID、enabled=false、profile=full；可选 core/ax/scripting/windows-admin。无状态读取不得调用 doctor、截图或剪贴板。配置私有原子持久化与 CAS；忙时拒绝修改；注销、停用、取消、断连关闭独立子进程。
- 环境只保留 OS 与真实图形会话所需字段，剔除 API、模型、登录和代理凭据，audit 使用账号私有路径。仅允许固定 70 个真实工具名与实时 tools/list schema，通过 AJV 验证；参数与输出有界。模型不能设置启动程序、env、approval_token、任意 MCP 或安装依赖。支持 focus_strategy 的动作固定 strict；Wayland 目标窗口截图明确拒绝，避免默默变为全屏。
- 增加 petpal_computer_use_tools（可按名称取 schema）及 petpal_computer_use_call。发现/调用都要求完整访问并遵循 ask/review/auto；审批显示准确工具名、应用/窗口与完整参数，超限拒绝。被选中的 PC 使用自己的账号 manager；不能回落到 owner 或另一台主机。
- MCP 返回 {kind:'computer-use-mcp',ok,tool,content}；最终动态输出保留文本脱敏，严格验证 PNG/JPEG 魔数、base64、最多两图、单图 2 MiB/总图 3 MiB、文本 64 KiB。以 inputImage 输出，不把 base64 JSON 化。图像模型中继上限统一为 16 MiB，普通 API 与事件限制不变。
- 设置使用折叠区域，明确“这台执行电脑 / 服务主机”，私有账号作用域、CAS、会话 epoch 与二次认证，Web 仅 owner 管理服务主机，具有完整访问的 PC 登录账号可管理本机。
- Linux native 兼容性单独门禁；优先固定源 Ubuntu 22.04 构建、保存 SHA/provenance。若本机工具链不足则明确要求 24.04，不把 Windows 成功当成 Ubuntu 验收。打包剔除非目标 native、验证目标 ELF/PE 与许可证；外部 X11/AT-SPI 工具用无副作用预检说明。

## Impact

修改 desktop tools / Codex image reply / relay request budget、账号 native IPC、设置与包审计。工具版本升级，旧 Agent 对话保留历史并提示新建以注册新工具。已部署私有数据和下载包保持。

## Risks

桌面权限覆盖整个用户会话，应用列表无法形成沙箱。原生同步操作不能抢占取消。Ubuntu X11/Wayland 依赖不同、70 工具不保证每个平台等价。上游 doctor 的 Linux 假失败不能用于判定运行状态。图片累积受中继预算约束，超限须明确报错。

## Verification Plan

配置/CAS/账号/取消/schema/output/审批与图片中继回归。真实 Windows stdio 70 工具发现，在独立自建窗口完成 AX、截图、键鼠、脚本读回；再跑真实第三方模型→Codex→Computer Use，并验证选中执行电脑路径。Linux 兼容构建与可用图形环境分别记证据。Chrome 设置与 412x960 布局验收、完整测试、TS/Vite、源码 Electron smoke、审查后提交推送并部署网页/后端。没有重打包不能声称现有下载包包含新桥。

## Final Implementation Notes

- Ubuntu 22.04 x64 / ARM64 都携带固定源兼容 rebuild，实际要求 GLIBC 2.34，部署基线为 2.35。仅附一个固定 Linux X11 窗口标题/几何补丁，文件 SHA、base commit、Cargo lock 与各架构二进制 SHA 写入来源记录。运行时与独立包审计检查这些成员；任意替换或未知补丁拒绝加载。
- Ubuntu 发布 native 原先返回全零窗口边界，造成截图坐标比例 0；修正后产品 manager 在容器 X11 中读到真实窗口边界并完成坐标点击/文字输入/AX读回。ARM64 仅交叉编译和 QEMU Node 加载，无真实桌面运行证据。
- Linux 输入依赖按 X11/Wayland 与实际动作在文件系统预检；短键盘输入不无理由依赖 xdotool，长文本剪贴板路径另行检查。上游 native 仍可能受显示服务、权限或守护进程状态影响，操作后必须读回结果。
- openai_computer 的自由字段上游 schema 被收窄为固定 mapper 字段。批次先验证所有映射工具，再执行；沿用严格焦点、截图限额、Wayland 拒绝与 Linux 输入检查，不能借 adapter 绕过限制。
- Chrome 首次并发 status/config 实测发现私有配置初始化自锁，已修复并补回归。旧 Agent 对话不会自动重注册新 dynamic tools，请创建新 Agent 对话。
- Windows 构建脚本准备 afterPack 过滤/审计目标 native 与固定 runtime/license；本轮实际运行源码 Electron 与原生 MCP，没有重建或发布客户端包。
