# Android 后台 Agent 任务通知

- Date: 2026-10-01
- Complexity: L2
- Baseline: 7bfabf5

## 目标

安卓用户显式开启提醒后，即使 WebView 进入后台，也可以收到其账号下远程 Agent 任务完成/失败的系统通知，点击返回对应 Agent 对话或 Chat 派发任务的父对话。覆盖断网、进程重建、重复投递、注销/切账号与冷启动，交付新的 Android 试用 APK。Android 不内置执行器/CLI；后台监听不影响任务执行权限。

## 架构

- 任务终态来自 `agent-tasks`，直接 Agent 与 Chat 子 Agent 共用一个持久化出口，不依赖前台 SSE、WebView 定时器或读取会话触发。
- 新增按账号的单调 sequence / 有界事件 feed。仅 completed/error 发提醒；cancelled/unknown 不伪装完成。事件以 Agent run ID 去重，Chat 子任务定位父会话。终态与事件进入同一次 store.save，成功后才对读取者可见、唤醒长轮询；失败回滚未发布事件。
- 每账号最多 500 条/30 天，首次启用以当前高位建立基线；离线从设备 cursor 补收。超过保留窗口返回明确 resetRequired，不能循环回放或静默假装完整。
- 登录接口签发独立随机 256-bit device token，只保存 hash，绑定 instance/user/installation/source-session，期限不超过来源 session 或七天。它仅能读取 feed、确认自身 cursor、撤销自身，不能访问聊天全文、语音、模型配置或 Agent 派发。注销、失效和撤权中止等待请求。
- 普通登录路由：POST `/api/notifications/devices` body `{deviceId}`；DELETE `/api/notifications/devices/:deviceId`。原生受限路由（通用账号鉴权前、Host/CORS 后）：GET `/api/notifications/device/feed?after=N&wait=25&limit=50`，POST `/api/notifications/device/ack` `{cursor}`，DELETE `/api/notifications/device`。
- 注册返回 `{deviceId,token,instanceId,userId,cursor,expiresAt}`。feed 返回 `{deviceId,instanceId,userId,events,nextCursor,highWater,minCursor,resetRequired,expiresAt}`；event 为 `{seq,id,conversationId,agentConversationId,runId,status,source,createdAt}`，`source` 为 `agent` 或 `chat-agent`。不含提示词、回复、路径、模型密钥或截图。普通设备撤销匹配原注册的来源 session；晚返回的旧注册不能覆盖或撤销新 session 的设备。

## Android 与前端

- 新增独立 `PetTaskNotifications` Capacitor 插件和前台监听 Service。服务由用户在可见 Activity 中打开，申请 Android13 通知权限，持续可见且可停止的通知。使用诚实描述此用户主动开启持续任务提醒的 specialUse 类型（既有 manifest 已使用）；不借 dataSync 绕过 Android15 六小时限制，不启动 boot 自动保活，不自动请求电池豁免或唤醒锁。
- 后台网络由原生独立线程长轮询，超时有界、指数退避、网络变化可重连；只使用系统可信 HTTPS，禁止重定向与 TLS 绕过。关闭/退出/换账号立即中止连接；所有响应与显示前检查 native generation 和 scope。401/403/过期停止并清理。
- token 以 Android Keystore AES-GCM 加密保存，不放 Intent、通知、JS日志、APK 或源码。配置和 cursor按账号/服务实例隔离；新的设备配置不能被旧回调恢复。
- 通知默认只有完成/失败与“点击查看”，锁屏不展示对话内容。稳定 event tag、onlyAlertOnce、显示后持久化 cursor/再 ack，重复投递避免重复提醒。显式 IMMUTABLE PendingIntent 只带受校验的事件定位/scope，不能携带任意 URL/凭据。
- 原生保留冷启动待打开目标，前端确认登录实例/账号一致、重新查询账号会话列表及目标会话、epoch 未变后才打开。通知凭据不恢复聊天登录；无已验证身份时，登录同一服务先保留待打开目标，再由完整身份验证决定是否匹配。已知账号切换、服务切换、401 和注销立即使原生 generation 失效并清理旧 scope。API 36 模拟器已验证系统通知启动实际 Activity、保留待打开目标并在重新登录后打开直接 Agent 对话；完整冷启动矩阵仍属于后续设备扩展验收。
- 设置放在「连接与设置 → 账号 → 后台任务提醒」折叠区域，只有 Android 展示；显示通知/运行/连接状态，提供停止、刷新与系统设置按钮。`enabled=true / running=false / connection=idle` 表示已停止，需用户点击「重新开启」；初始异步启动的 `connecting` 状态继续显示「正在启动」，不自动重启服务。常驻提示可打开应用或停止。系统设置入口仅在 Activity 前台打开本 App 的 `ACTION_APPLICATION_DETAILS_SETTINGS`，由用户手动检查通知或电池选项。初始化恢复、JS observer 卸载与真实注销/切换分开，避免页面重建误关已开启监听。

## 约束与边界

没有 Google/厂商推送服务配置，本轮使用直接连接个人 HTTPS 后端的常驻服务；不宣称系统强制停止后仍能唤醒。厂商省电设置可能阻止运行，提示用户手动检查。specialUse 若未来上架 Google Play 需独立声明/审核，本轮是现有侧载试用路线。后台通知凭据不恢复全文登录，点击后必要时要求登录。

## 验收与交付

后端持久化/账号隔离/双设备/首次基线/补发/去重/保存失败/注销迟到/权限撤回测试，真实远程执行器注册到隔离后端的任务完成通知链路。原生 policy/unit 测试与 APK 编译/签名/资源审计、JS epoch/冷启动导航测试、Chrome 窄屏设置检查。若没有独立手机/模拟器，明确区分原生编译/测试与设备后台验收，不使用 RK3566 板代替手机。保留旧下载及私有数据；网页/后端按既有授权部署，新 APK作为独立试用产物交付，客户端版本单独递增。

## 最终验收与交付边界

- Node 最终回归记录 `evidence/android-notifications-20261001/final-tests.log` 为 1143/1143 通过；最后提醒 UI 小修另有 TypeScript 检查与 17/17 controller focused 通过。后续修改仍需对应验证。
- `real-executor-result.json` 记录真实 Codex CLI / `halogen-qwen3.8-flash-next` / 已选执行电脑的直接 Agent 与 Chat 子 Agent 均完成，通知 feed 持久化、后端重启后补读、确认后不回放和撤销中止长轮询通过；这不等同于手机点击验收。
- 最终 Android 0.9.2 / versionCode 12 APK 位于本地 `apk-delivery/PetPal-0.9.2-Android-debug.apk`，19,538,993 bytes，SHA-256 `bfa3a099c35fa10985871872da6d3ba9c2c89bfd562fd0e646304c4ead522aac`。最后 UI/原生补丁已包含，最终 `apk-audit.json` 验证同开发签名、资源/桥逐字节一致、无远程页面覆盖、无已知私密凭据、无测试 fixture 或 runtime-test 混入 App。
- 独立 Android API 36 模拟器最终 `android-runtime-result.json` 为 `ok:true`：真实 Qwen/Codex 直接 Agent 退后台完成、设备凭据加密、系统通知可见、实际系统通知点击启动 Activity、需重新登录后验证并打开目标会话、注销清除原生状态和服务端撤销全部通过。待打开目标在登录前保留、登录后已消费。
- 失败任务、Chat 子任务父对话、scope 切换/迟到回调、断网补读与去重由后端、controller 和 native 测试覆盖；本轮设备实测仅为上述直接 Agent 完成/需登录点击/注销链路，不宣称这些分支均已逐一设备实测。
- Android 13～15、实体手机/厂商后台限制、长期电池表现、完整冷启动/断网/切账号/系统设置设备矩阵及物理媒体为后续扩展验收。没有 Google/厂商推送和开机自动保活的限制保持不变。
- 交付为 `v0.9.2` prerelease 开发签名 APK，同时提供个人服务器下载；Windows/Ubuntu 保留旧包和私有数据。本 issue 实现及限定范围验收完成，提交由 root 统一办理。
