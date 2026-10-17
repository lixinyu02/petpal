# Memobase 用户记忆与 PC 故障切换

- Date: 2026-10-18
- Complexity: L2
- Upstream: memodb-io/memobase v0.0.42 / 358c16bbc6d687937d79bc2f984a11c3be8da901 / Apache-2.0

## Goal

中央服务器与 Windows/Ubuntu PC 集成自托管Memobase。正常使用中央用户记忆并后台同步到已登录PC；中央不可用时PC自动启动本地服务，恢复后补同步（用户已明确选择）。同一个小伴账号跨对话、项目和设备共享一个逻辑记忆库，不同账号隔离；多个物理副本不是多个逻辑用户。

## Architecture

一套Memobase服务运行多个隔离user UUID，由中央instanceId与不可变userId生成UUIDv5，禁止用户名/设备作为库身份。普通用户API始终从当前登录身份取scope；管理员可管理服务，但不能从客户端指定他人userId读记忆。管理员在别人电脑执行任务时，中央仍按任务账号注入记忆，PC不得额外注入其登录用户的记忆。

小伴维护独立私有durable journal/outbox作为同步权威，Memobase是提炼/检索投影。只记录成功完成的user/assistant文本；不回填已有历史，不记录失败、取消、未知任务、图片、工具原始记录或敏感问答轮。记录稳定eventId，保存后异步提炼。上游HTTP和errno双重校验；未知写结果不能盲重试，持久原始blob字段eventId/epoch用于查证。

普通Chat两种协议、旧Codex、统一Agent central/remote、Chat派发和自动化均覆盖。查询超时800ms以内，缓存/空上下文降级，记忆故障不阻塞聊天、语音、首屏或重派Agent。注入内容标记为不可信历史事实，不能扩大任务授权。后台结果汇报不重复学习。

PC经auth/me核实中央实例和登录账号后绑定自己的scope；增量同步先拉epoch，再上传离线新事件，之后拉后续事件与缓存context。切账号/服务器/登出取消旧同步。冷启动异步恢复此前验证并持久化的绑定，不等首次页面查询；先重验auth/me，网络故障可用本账号缓存与备用，401/403撤销凭据并阻断缓存。清空自己记忆产生epoch墓碑，拒绝旧epoch上传，清除本地旧投影再重建，避免离线副本复活已忘记内容。

PC正常连接中央时不启动本地Memobase；不可达时按autoStart设置启动，后台从本账号journal建本地投影；恢复后继续中央权威同步。提炼模型需本机可用的API配置，不下发中央管理员模型密钥到普通PC。没有本地模型或Docker时使用缓存context与耐久队列，并明确状态。PC本机owner只在已验证远端绑定期间映到当前远端scope，其余本机用户维持自身实例身份。

## Runtime

固定官方版本及镜像摘要，专属compose project/卷。API只绑定127.0.0.1，不发布Postgres/Redis宿主端口；随机ACCESS_TOKEN和数据库密码存私有目录。Windows使用已有Docker Desktop/WSL2，Ubuntu使用Docker Engine；官方API镜像原生amd64/arm64，按本机架构拉取，不强制amd64。停止仅stop专属project，绝不down-v或删除用户数据。启动、下载、健康超时有明确状态，可取消/失败开放。

语言中文/上海时区，三提炼模型使用已配置兼容Chat Completions的模型，关闭embedding减少依赖，persistent_chat_blobs开启以便未知请求查证。上游日志可能包含DB口令，日志私有且不原文回传。Memobase自托管不依赖云账号；提炼使用已有API额度。

## UI

设置新增独立“记忆”页：自己的记忆开关/同步状态/记忆内容预览/立即同步/清空确认；管理员可配置提炼模型和管理本机服务；原生PC另显示本机自动故障启动与服务状态。沿用淡白主题与412×960单列，页面lazy加载，状态轮询只在可见时运行。Web/Android通过登录后的中央API使用记忆，不安装手机Docker。

## Acceptance and rollout

验证多账号/同名不同实例/管理员他人设备隔离、Chat与Agent全路径注入/成功单次写入、敏感轮跳过、context超时fail-open、未知插入查证与幂等、PC掉线/恢复/账号切换/clear墓碑、Docker缺失/daemon关闭/端口冲突/架构及包闭包。运行真实自托管Memobase，真实模型完成写入提炼和上下文查询，隔离数据不污染用户库；Chrome检查管理和普通账号界面。上线前fresh idle、固定回退、私有备份、业务/代理/下载保持与guardian接管。客户端集成源码与包装闭包先交付，未明确要求发新正式安装包时不擅自发布新release；准确说明native/ARM实机边界。
