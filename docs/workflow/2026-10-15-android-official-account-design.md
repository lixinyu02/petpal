# Android 本机 ChatGPT 官方账号

- Date: 2026-10-15
- Complexity: L2
- Status: final

## Background

现有 SIWC 官方授权、模型与推理只在 Electron 主进程实现。Android 无 Node / Codex CLI，不能直接调用桌面 IPC。用户要求补齐手机本机授权及套餐模型调用。

## Goal

Android 系统浏览器登录、受保护的本机凭据、多账号切换、刷新与退出；官方模型进入既有 Chat、语音与远程 Agent 链路。账号身份、目录可见、实际推理完成分别验证。

用户追加：Android 内置 Mihomo，仅代理小伴自身，不申请 VPN、不改变其他应用网络。目标测试手机为小米 17 Pro Max，用户估计 Android 14；实际兼容性按运行时 API / ABI 判断，不按型号推定。

## Non-goals

不在 Android 内置 Codex CLI，不把手机变为电脑执行器；不读取桌面 OAuth 文件，不上传官方 token。最初仅预览，用户在 2026-10-16 追加授权后，范围扩展为 0.9.12 四端正式发布与配套生产服务更新。

## Solution

1. 原生 Capacitor PetOfficialAccount 插件使用 SIWC OSS 官方协议：稳定 host ID，动态客户端注册，127.0.0.1 随机端口 /auth/callback，PKCE / state / nonce，RS256 JWKS 验签。系统浏览器授权；不内嵌登录网页、不新增可被抢占的自定义 OAuth scheme。
2. 每个规范化后端 origin / instanceId / 小伴 userId 单独保存账号记录，AES-GCM + Android Keystore，原子保存并禁止备份。不同服务地址不自动共享官方授权。绑定前通过原生 /api/auth/me 验证普通登录会话，清除作用域使旧请求失效。
3. 官方 HTTPS 请求仅在原生发送到固定 auth.openai.com / api.openai.com 地址，拒绝重定向。模型来自官方目录；Responses 强制 store=false / stream=true，验证完整结束后统计实际 usage。取消、断线、刷新失败不自动重发推理。
4. 中央后端新增手机模型 relay：手机以普通小伴 session 注册模型目录，long-poll 领取请求、顺序 POST SSE 分块；后端仅保存进程内随机 loopback capability 与模型元数据，不接收 OAuth。复用现有 officialAccounts provider / Chat / Agent / reviewer 流程。
5. 授权范围沿用桌面已有按小伴账号隔离的官方模型语义：同账号在手机在线期间可以选用手机提供的模型，其他账号（包括管理员）不可访问。手机界面明确说明在线依赖；登记会话失效、退出或换官方身份立即撤销旧 capability，停止旧任务，不换模型自动重试。
6. 手机 relay 不承诺 Android 杀进程后继续提供模型；轮询 TTL / 掉线 / 退出均安全失败，已有 API 与其它设备不受影响。长任务依旧在用户选择的电脑运行。
7. 官方 Android Mihomo PIE 随 APK 原生库安装，由只读 nativeLibraryDir 启动，避免 Android 10+ 从可写 data 执行 ELF 的限制。代理及控制器仅监听回环，关闭 TUN / DNS 劫持 / LAN 入口；Java 显式代理与 AndroidX WebView ProxyController 分别覆盖原生及 WebView 请求。LAN / 回环直连；不改全局 ProxySelector。导入 YAML 和 HTTPS 远程配置支持大小限制、规则检查、原子保留与用户隔离。
8. 系统 Chrome / Custom Tabs 的网络不受应用内代理控制。SIWC 当前确认的是系统浏览器流程，不把内嵌 WebView 或 Codex 设备码认证冒充为已支持的 SIWC 套餐授权替代方案。模型、token交换与刷新走应用代理，外部授权网页仍需其自身网络可达。

## Impact

新增 Android 原生认证与网络类、后端隔离 relay、移动 bridge 与设置适配；保留所有桌面和 Web 原 API 路径。共享后端需要更新后才可登记手机官方模型；旧服务显示明确不支持状态。

## Risks

真实 OAuth 需要用户在官方页面确认；本机无已连接 adb 真机，模拟器、编译与协议夹具不得写为真机授权成功。官方账号资格和套餐余量由上游决定。公开 SIWC 未提供精确套餐余额查询，只显示实际完成请求统计及官方用量链接。手机断网/休眠会影响其官方模型，后台执行结果不代表手机连接必定可用。

## Verification Plan

原生 Java 单元与编译；授权回调、token验签/刷新/隔离夹具；relay 身份隔离、会话撤销、请求序列、断线、上下文大小/超时、Chat / Agent 与图片回归；TypeScript / Vite；APK 构建与清单审核；可用模拟器验证入口和门禁。真实授权及套餐推理单独记录，缺现场设备/用户授权时明确保留验收边界。

代理另外验证内核上游版本 / 哈希 / ABI / ELF 页对齐、API门禁，原生实际进程启动和WebView代理生效、LAN直连、停止恢复；不把x86_64模拟器运行写为arm64小米实机通过。

官方依据：https://developers.openai.com/siwc/token-sharing-open-source/sign-in 、 https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference 、 https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions 。
