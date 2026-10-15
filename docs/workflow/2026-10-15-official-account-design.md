# 桌面官方 ChatGPT 账号与模型

- Date: 2026-10-15
- Complexity: L2
- Status: final

## Background

Windows/Ubuntu 已内置 Codex，但目前 host 模式继承系统登录，API 模式使用中央兼容接口。新增个人官方账号不能修改全局 Codex 登录或让其他小伴用户共享凭据。

## Goal

桌面端使用官方 Sign in with ChatGPT 授权，Chat/Agent 采用当前官方账号的模型目录与套餐授权。保留原有 API 连接、执行电脑选择、审批、图片、队列和用户隔离。

## Non-goals

不读取宿主 ~/.codex/auth.json，不使用内部 chatgptAuthTokens RPC，不抓取 ChatGPT 网页接口。不开公网 OAuth 管理入口、不修改线上服务或正式下载清单。本轮先绑定客户端内置本机服务上的小伴账号；连接中央服务时保持原模式并提示本机入口。

## Solution

采用官方 OSS Sign in with ChatGPT 流程：系统浏览器、127.0.0.1 临时回调、state/nonce/PKCE，动态注册后保存签发 client_id，验证官方 JWKS/issuer/audience/expiry/nonce/subject 与套餐 scope。主进程私有存储按本机服务的小伴 userId 隔离，保留每个官方注册的独立凭据和固定安装 host ID。刷新与退出遵循官方协议。登录/取消/切换/退出只经可信主窗口 IPC，并重复验证当前本机小伴登录，HTTP 后端无这些管理入口。

推理走官方公开 /v1/models 与 /v1/responses。主进程管理带随机临时密钥的回环 Responses 网关，OpenAI access/refresh token 不返回页面、中央服务或执行机。网关限制当前账号目录、模型和 SIWC 参数；拒绝重定向、过量请求及失效授权。普通 Chat 复用 Responses 流，只有已开启 Chat+Agent 才提供既有派发工具。

本机服务以依赖注入获取该用户的临时官方 Provider（稳定 ID、官方名称、图片能力、来源）。所有解析、状态及默认模型按当前用户授权，管理员也不能读取他人的官方模型或令牌。Provider 不写进共享 providers 数组。Agent 按该用户 Provider 生成隔离运行配置；本机和执行机的现有受限 relay 路径继续工作。退出/换账号撤销旧请求与排队授权，不把旧线程恢复到另一官方账号。

## Impact

新增官方 auth/storage/gateway、桌面 IPC 与设置组件；扩展后端个人 Provider resolver、Agent 按任务模型配置和打包清单。旧客户端及未注入该功能的 Web/Android/中央服务器保持原行为。

## Risks

OAuth 用户授权及官方账号/套餐准入需要实际用户完成。模型目录不等于每次推理都成功；必须等待 response.completed。防止取消后迟到回调、跨用户状态、刷新并发、错误泄密、来源切换恢复线程、长任务退出与审批阻塞。

## Verification Plan

真实签名/PKCE/HTTP callback 的本地替身、账号隔离/取消/撤销/刷新、目录与流式 EOF/401、Chat/Agent/relay/审批回归，TypeScript/Vite build。Windows 和 Ubuntu 隔离 profile 原生启动；真实授权由用户在官方页面完成后再验模型目录和短推理，不宣称未进行的账号推理验收。

## Official references

- https://developers.openai.com/siwc/token-sharing-open-source/sign-in
- https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions
- https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference
- https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations
- https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server
