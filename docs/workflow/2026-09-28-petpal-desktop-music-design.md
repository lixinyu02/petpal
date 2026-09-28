# 桌面音乐助手与内置 CLI

- Date: 2026-09-28
- Complexity: L2
- Status: updated

## Background

0.4 已打包 Codex 0.143.0，但聊天模型连接不传给 CLI，CLI 继承本机配置且默认只读。用户要求优化 Windows/Ubuntu 包，配置 API 后操作 QQ 音乐、网易云音乐，并内置 OpenCLI。

## Goal

0.5 桌面包内置真实 Codex 与固定版本 @jackwener/opencli。主机 owner 在界面配置 Responses API、模型与密钥；Codex 通过具名工具操作音乐客户端和受限浏览器入口。显示实际安装、会话、桥连接状态，支持手动测试和取消。

## Non-goals

本轮不新增 Android 发行包；保留 0.4 Android。不会自动安装 Chrome 扩展、读取浏览器凭据、为既有 Chrome 打开调试端口，或声称可控制任意软件。OpenCLI 1.8.8 官方无 QQ/网易云专用 adapter；系统媒体控制不提供曲库搜索。无真实 API 凭据时只作本地协议/模拟模型验证。

## Solution

- 保持 owner-only。新增 GET/PATCH /api/codex/config 配置：mode=host|api，baseUrl/model/apiKey/clearApiKey。host 保持旧版可用；api 使用数据目录内独立 CODEX_HOME，不读取或改写用户全局配置，密钥只从服务端子进程环境注入。公网 HTTPS、本地 HTTP，换地址必须清除或替换密钥。接口仅返回 hasApiKey。
- 配置变更忙时拒绝；持久化 revision 绑定 Codex thread，配置变更后旧会话保留可读，继续发送返回 409 并提示新建会话，禁止跨凭据 resume。
- host模式保持旧只读工作区/on-request；api模式独立工作区并关闭默认shell，所有音乐/网页动作通过 Codex 0.143.0 实际生成 schema 验证的 dynamicTools 注册，原生command/file请求拒绝。具名工具由后端验证参数、目标和生命周期，操作先产生明确审批卡；停止/注销/重置及过期 turn 不得执行迟到操作。不存在任意 shell HTTP 入口。
- GET /api/desktop-tools/status 返回 capabilities/music/opencli；POST /api/desktop-tools/action 接收固定 tool 与 arguments，用于用户主动手动操作，owner 校验和请求断开清理。Codex 与手动调用共用工具注册器。GET 状态不启动 OpenCLI daemon、不启动音乐客户端。
- Windows 通过固定 PowerShell helper 查安装和 GSMTC。仅匹配 QQMusic/CloudMusic 会话；多匹配拒绝，绝不退回全局媒体键。Ubuntu 通过当前用户 D-Bus MPRIS 匹配 QQ/网易云 Identity/DesktopEntry，检查能力再执行。打开客户端仅允许已确认的指定播放器路径/固定桌面入口。无会话/无支持时报告限制。
- OpenCLI 固定版本依赖，使用内置 Electron 的 Node 模式，避免依赖系统 npm/node。Chrome Browser Bridge 是外部浏览器前置，界面提供说明和官方链接，默认不建立连接；不抢占其他 OpenCLI daemon。音乐网页入口限定官方 HTTPS 来源，浏览器操作必须可审阅，不能任意执行 JS/命令。
- 清楚区分本机播放器控制、OpenCLI 浏览器连接、Codex API 已配置与真实模型连通。保存配置或普通状态刷新不调用模型；用户发起 Codex 对话才调用所填 API。API 模式内置 apply_patch/view_image 仍受只读限制，不声称完全移除全部原生工具。

## Impact

server 配置、进程生命周期、动态工具与音乐/OpenCLI适配；React 桌面设置/审批；Windows 与 Ubuntu x64/ARM64 打包清单及独立校验；版本 0.5.0。只修改 petpal，保留旧包、历史数据与固件项目。

## Risks

GSMTC/MPRIS取决于播放器是否暴露接口，桌面会话和浏览器扩展不能通过包校验代替。API供应商需兼容 Responses 工具调用，不把任意 Chat Completions 网关当可用 Codex provider。配置重启、任务取消和动态工具审批竞态必须测试；OpenCLI bridge共享端口不能被状态探测抢占。

## Verification Plan

Node隔离fixture测试配置/密钥/owner/版本与线程切换、dynamic tool真正协议、取消/审批/失败；native helper静态与只读状态、模拟播放器操作；真实CLI本地mock Responses完成工具调用闭环；Chrome UI优先验收设置与状态；Windows最终EXE运行+内置双CLI检测、Ubuntu ELF和全文件字节审计。真实API/音乐播放/Ubuntu桌面未验则明确记录。

## Sources

- https://developers.openai.com/codex/config-advanced
- https://developers.openai.com/codex/app-server
- https://github.com/jackwener/opencli
- https://www.npmjs.com/package/@jackwener/opencli
