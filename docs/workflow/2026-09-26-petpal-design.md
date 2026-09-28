# 小伴 PetPal 四端桌宠设计

- Date: 2026-09-26
- Complexity: L2
- Status: updated

## Background
用户要求 Web、Android、Ubuntu、Windows 四端个人桌宠，完整前后端，可配置 LLM Chat Completions / Responses；Windows 与 Ubuntu 必须实际管理后台 Codex CLI。参考 Codex Remote 进程生命周期、协议适配和错误呈现方式。实现独立放在 petpal/，不修改板卡与 Codex Remote 工程。

## Goal
中文小猫桌宠；陪伴聊天和 Codex 工作双模式；多提供商配置、流式回复、历史会话、停止生成、错误恢复。Electron 透明置顶浮窗、托盘、主界面和本地服务；Android Capacitor 原生应用及用户授权后的系统悬浮小猫；Web 响应式应用。桌面后端运行真实 codex app-server stdio 协议，默认只读工作区；操作审批明确展示。

## Non-goals
不改固件、不重启或安装到用户开发板；不复用参考项目凭据；不默认开放公网；不声明未执行的 Android/Ubuntu 实机验收。初版是单用户个人服务，多端连接同一服务共享历史；不实现账号云同步、计费或商店发布。

## Solution
React + TypeScript + Vite 共享前端；Node 22+ / Express 后端，JSON 原子落盘、提供商配置和密钥仅后端保存。Electron 主进程直接拥有同一后端及 Codex 子进程，退出时回收。Android 连接用户指定 HTTPS 后端，独立原生 Overlay Service。网络服务默认 127.0.0.1，Bearer 配对令牌；跨来源仅允许显式名单，拒绝任意站点调用；LLM 请求在后端发出，密钥 API 回读只给 hasApiKey。不内置虚构 AI 回答。

## Contracts
- `GET /api/health` 返回 `{ok:true, version}`。
- 所有其他 `/api` 路径都要求 `Authorization: Bearer <token>`。
- `GET /api/state` → `{settings, providers, conversations, codex}`。settings 包含 `petName, persona`；provider 包含 `id,name,protocol,baseUrl,model,hasApiKey`；conversation 包含 `id,title,mode,providerId,messages,createdAt,updatedAt`，message 包含 `id,role,content,status,createdAt`。
- `PATCH /api/settings` 更新 `petName,persona`。
- `POST /api/providers` 创建或更新（body 包含可选 id；apiKey 空白保留原值）；`DELETE /api/providers/:id`；`POST /api/providers/:id/test` 返回 `{ok,message}`。
- `POST /api/conversations` body `{mode:'chat'|'codex',providerId?}`；`DELETE /api/conversations/:id`。
- `POST /api/conversations/:id/messages` body `{content}`，SSE `event: meta|delta|status|approval|done|error`，JSON data；delta `{text}`；meta `{conversationId}`；approval `{id,kind,description}`；done `{conversation}`；error `{message}`。同会话禁止并发生成。
- `POST /api/conversations/:id/stop`；`POST /api/codex/approvals/:id` body `{decision:'accept'|'decline'}`；`GET /api/codex/status`。
- `server/app.mjs` export async `createPetServer({dataDir,token,staticDir,allowedOrigins,workspaceRoot,codex}={})` → `{server,token,close}`；调用方用 `server.listen(port,host)`；close 等待 HTTP 和 owned child 关闭。
- `server/codex.mjs` export class `CodexBridge`，constructor `{workspaceRoot,command?}`；async `status()`；async `run({prompt,threadId?,model?,signal,onEvent})` → `{threadId,text}`；`approve(id,decision)`；async `close()`。事件同 SSE，thread `{threadId}` 仅供后端保存；真实线程连续复用。缺失 CLI／认证明确报错。
- Electron preload 通过 `window.petpal` 暴露 `connection():Promise<{url,token}>`, `showPet()`, `showMain()`, `hidePet()`；URL `?pet=1` 进入透明小猫视图。不得暴露通用 shell 或 IPC。

## Visual and interaction plan
视觉：暖白与深松绿，简洁留白，手绘感小猫为主视觉。内容：左侧会话导航，中间聊天，右侧小猫；设置侧页管理模型连接。交互：小猫呼吸与眨眼、抚摸反馈、等待和回复状态；窗口与表单轻量过渡；尊重 reduced-motion。移动端一列聊天和可折叠导航。

## Impact
新增独立项目和构建脚本。现有 Codex 只通过受支持 app-server 协议调用，保留已有账户配置；CLI 检测、初始化、错误、取消和退出都要有证据。模型 id 用户配置，不硬编码特定供应商默认模型。

## Risks
Electron Linux 透明浮窗在 X11/Wayland 支持不同；ARM64 需要目标构建。Android 悬浮权限必须由用户开启，厂商后台限制可能影响常驻。API 提供商实现有差异；流中错误与提前断开不能当成功。客户端断开必须取消后端任务。密钥本地存储须最小权限，不放进前端或日志。

## Verification Plan
Node 单测与 HTTP 集成覆盖真实本地 fixture 的 Chat/Responses 流、配置持久化和凭据脱敏、鉴权、取消、错误、Codex RPC 生命周期。Chrome 插件验收主流程和移动布局。构建 Web、Windows 包、Android APK；Ubuntu 能运行时做独立构建或记录未验收边界。真实 CLI 至少 version/initialize/status 握手，真实模型调用仅使用现有合法登录、不提取或输出凭据。

## 2026-09-26 用户追加：明显动作与更可爱造型
使用内置 ImageGen 生成毛绒奶油色小猫 4×4 动作源图；视频色键合成为透明素材，四行分别为招手、蹦跳、摸头撒娇、打盹。共享 CatV2 组件逐帧调度，与 CSS 呼吸/跳跃结合；增加 `/?animations=1` 四动作预览、暂停与下载 GIF。Android 原生 Canvas 同步消费相同图集。原矢量猫保留为资源加载失败回退。最终有效源图、prompt、动画生成脚本与文件摘要保存在 outputs/animations；早期不合格透明草稿不进入 public 或安装包。

## References
- https://developers.openai.com/codex/app-server
- https://developers.openai.com/api/docs/guides/streaming-responses
- https://developers.openai.com/api/docs/guides/migrate-to-responses
