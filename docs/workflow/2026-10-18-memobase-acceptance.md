# Memobase 集成验收说明

- 日期：2026-10-18（Asia/Shanghai）
- 状态：网页与中央后端已上线；PC 源码及打包闭包已集成，未重发原生安装包
- 设计：[用户记忆与 PC 故障切换](2026-10-18-memobase-design.md)
- 任务：[集成 Issues](2026-10-18-memobase-issues.md)

## 验收结论与范围

真实自托管 Memobase 0.0.42 已在本机完成健康检查及两轮真实 GPT 6 Luna 记忆提炼。同账号跨会话读取、不同账号隔离、重复事件去重、清空后的 epoch 推进及上游旧投影删除均通过。本次使用隔离验收数据，回执确认验收完成后仅清理本次创建的随机投影。

真实执行链为 **Windows x64 Node → 已有 WSL Linux Docker Engine → 本项目的 PostgreSQL、Redis、Memobase API**。这证明源码运行时能实际拉起和访问该服务；不等同于 Windows/Ubuntu 原生安装包或 ARM 设备实测。

真实验收回执明确记录 `realPcFallback=false`。第二台 PC 遇到中央断线后的自动启动、离线使用与重新联网补同步，尚未通过两台实机的断网场景验收。确定性回归覆盖与真实服务结果分别记录，不互相替代。

## 固定上游及运行条件

上游为 [memodb-io/memobase](https://github.com/memodb-io/memobase)，版本 **0.0.42**，源码提交 `358c16bbc6d687937d79bc2f984a11c3be8da901`，保留 Apache-2.0 许可。来源、补丁和哈希记录在 `server/memobase-assets/PROVENANCE.json`。

| 组件 | 固定镜像摘要 |
| --- | --- |
| Memobase 0.0.42 | `sha256:1647d7c706434273f9b5738cadec767ff9b90af0010156198740a191a1e0262f` |
| pgvector / PostgreSQL 17 | `sha256:ac08538c6f8b9904c33c8224c5e5706dbe760aca29db1d096972b4052c22a75d` |
| Redis 7.4 | `sha256:4fa24486b8bcca8eec45ee0eb166edc674795e53a2b53d1a9ef263eecebaac85` |

本次使用 WSL 内已有 Docker Engine 29.1.3 和 Compose 2.39.4。Docker Hub 直连在该环境返回 EOF，两个 Docker Hub 依赖通过显式配置的镜像中转取得，仍校验上述官方摘要；Memobase 使用官方 GHCR。没有修改 Docker 全局 context、镜像配置或地址池，也没有清理其他项目的网络、镜像或数据。

现有 daemon 的默认网络地址池已耗尽，本项目通过显式配置空闲的私有 `/24` 网段创建自己的网络。此设置仅作用于本项目；未配置时仍沿用 Docker 默认网络行为。WSL 发行版、镜像中转与可选网段可保存在本机私有 `transport.json`，服务重启不依赖临时终端环境。

API 只发布到 `127.0.0.1:8019`，PostgreSQL、Redis 不发布宿主端口。随机 API 令牌、数据库口令和提炼模型配置保存在私有目录，不进入本文或前端响应。停止运行时仅停止本项目，保留记忆卷。上游配置日志已脱敏，并使用经过哈希校验的适配文件关闭 OpenTelemetry/Prometheus 指标监听。

## 真实服务与模型验收

证据为私有回执：

- `.data/memobase-20261018/runtime-start.json`
- `.data/memobase-20261018/real-memory-acceptance-receipt.json`

本文只摘录状态、计数及耗时，不复制记忆文本、账号标识、上游地址、令牌、模型密钥或私有文件内容。

真实提炼验收时间为 **2026-10-18 03:41:26–03:41:49（Asia/Shanghai）**，总耗时约 **23.434 秒**。运行时回执记录 `platform=win32`、`arch=x64`、`version=0.0.42`、`running=true`、`configured=true`、`needsModel=false`，且 `privateValuesIncluded=false`。

| 验收项 | 实际结果 |
| --- | --- |
| 真实 Memobase/API 健康检查 | `realMemobase=true`、`healthConfirmed=true` |
| 真实 GPT 6 Luna 提炼 | `realLlmExtraction=true`；两轮提炼均确认完成，耗时约 10.580 秒、12.585 秒 |
| 同账号跨会话记忆 | `sameAccountContextAcrossConversations=true`；两个会话的新事件归入同一逻辑用户记忆 |
| 不同账号隔离 | `otherAccountIsolated=true`；隔离账号没有读取到另一账号的验收标记 |
| 重复事件去重 | `sameIdSamePayloadOneEvent=true`；重复提交后 journal 事件数仍为 1 |
| 清空记忆 | `clearAdvancedEpoch=true`、`clearedContextHasNoOldMarkers=true` |
| 上游旧投影清理 | `upstreamOldProjectionDeleted=true`、`upstreamDeletionPending=false`、`upstreamDeletionStateAccurate=true` |
| 隔离验收数据清理 | `cleanupCompleted=true`；只处理本次拥有的随机投影 |
| 本轮整体结果 | `passed=true`，无失败阶段 |

一个小伴用户使用一个逻辑记忆库，身份由中央实例与不可变用户 ID 确定，不按用户名或执行电脑合并。已有聊天历史不自动回填；仅对接入后符合条件的新完成回合异步记录和提炼。图片、工具原始输出、失败/取消/未知结果以及敏感交互不作为普通记忆学习材料。

## 自动化回归与真实验收的区别

最终定向回归 **229/229 通过**，包含服务、上游契约、用户 API、Chat/Agent、记忆设置真实事件、桌面生命周期/打包闭包、现有 Agent 队列/引导、自动化与账号认证。TypeScript no-emit 与隔离 Vite 构建通过。

Chrome 正式页面发现预览暴露内部上下文边界及上游空模板，已改为只显示事实 Markdown，并将空模板呈现为友好的空状态。修复后 **12/12 记忆设置 UI 事件测试**及 TypeScript/Vite 再次通过；网页增量原子发布，没有再次重启后台。

桌面运行时及打包闭包子集 **64/64 通过**：

```powershell
node --test tests/memobase-runtime.test.mjs tests/desktop-memory.test.mjs tests/desktop-executor.test.mjs tests/central-server-package.test.mjs
```

该组覆盖固定摘要与镜像中转校验、Docker 缺失/未启动、端口冲突、架构选择、私有配置及 WSL 路径、网段校验、账号绑定/切换/退出、可信窗口 IPC 和打包闭包。独立 Node 子进程回归确认健康检查需要重试时，启动等待会保持进程存活并正常返回，不再因未完成的顶层 await 提前退出。Memobase 哈希资产固定原始字节；使用 Git 的 Windows checkout filter 验证三份补丁/许可仍与 provenance 摘要一致，避免 CRLF 自动转换破坏运行时校验。

服务回归另覆盖真实 HTTP 中央连接断开后，PC 冷重启无需页面读取或再次绑定即可异步尝试本机备用；`autoPoll=false` 则保持静默。已保存凭据仍先验证，明确 401/403 时撤销绑定和旧缓存。关闭记忆或停用账号会屏蔽迟到上下文、排队写入和后续提炼；既有清空墓碑的删除可以继续，不创建新投影。

这些测试中的 Docker/窗口/账号故障由测试替身构造；不会据此声称已在所有系统、架构或手机上完成实际安装和断线恢复。真实 Memobase、GPT 6 Luna 提炼与隔离清空结果，以前述私有运行回执为依据。

## PC 自动故障切换条件与待验范围

正常连接中央时，PC 同步当前已验证账号的 journal 和上下文，不为此启动本地 Memobase。中央不可用时，只有本机具有可用 Docker、镜像及自己的提炼模型配置，才具备自动拉起本地服务并继续提炼的条件。

**中央管理员模型密钥不会下发到普通 PC 或前端。** 本机缺少 Docker、模型配置或网络不可用时，应继续使用已有上下文缓存和耐久待同步记录，并显示对应状态；该条件下不能声称已完成本地模型提炼。中央恢复后补同步属于已实现和回归覆盖的路径，但本次真实回执未验证第二台电脑的实际断线过程。

尚待实机验收：

- 新打包的 Windows 与 Ubuntu 原生客户端安装、启动、退出及后续升级。
- Ubuntu x64、Windows ARM64、Ubuntu ARM64 的实际宿主机/Docker 环境。
- 第二台 PC 真实断开中央、自动启动、本机提炼、重新联网补同步。
- 多台 PC 离线期间交错写入、清空墓碑及旧副本再次联网的完整实机场景。

## 部署与保留检查

实现提交为 `3004106`。2026-10-18 **03:51–03:56（Asia/Shanghai）**完成网页与中央后端上线及公网复验，正式入口为 [小伴](https://magicdatou.top:44318/)，入口为「连接与设置 → 记忆」。保留版本号 0.9.13，未修改正式安装包、升级清单或发布新客户端。

后台只重启一次；部署前核对 PID/启动时间/可执行路径、端口占用及 fresh idle，先建立私有备份和固定回退 `1ecda6d848ff200cfba60be8da39a584b1417b2b`，逐文件校验后原子发布、index 最后切换。备份包括原业务数据、代理配置和新记忆目录/本地运行时私有配置；不将这些内容提交源码。后台新实例通过登录后管理 API 接管已有本项目 Memobase 容器，未依赖部署终端的临时环境。

本机与公网 HTTPS 的健康、登录后记忆状态均通过。匿名访问 status/context/sync 返回 401，正式普通测试账号只能取得自己的 scope，响应不带管理员 runtime 配置，配置接口返回 403；已分配代理配置仍可用。公网入口和各轮 MemorySettings 静态资产共 7 个文件与冻结构建 SHA-256 一致。没有向正式账号导入验收内容、清空其记忆或自动回填旧对话。

部署前后保留业务字段哈希相同：`33d397af5c096ef1ddb233a8328c13713ea9910725445d8df7fbf20c38aad7b3`。账号 3、模型 5、聊天 54、附件 1、自动化 0 保持；下载/升级资源清单、服务设置、guardian 配置保持。guardian 已接管新后台，maintenance 已移除；最终 fresh idle 通过。

Chrome 正式账号实际确认记忆页面 lazy 加载、个人控件、连接状态及空记忆预览，`412×960` 下 `scrollWidth=412`，没有横向溢出；临时视口已恢复。管理员启停/模型配置、暂停与清空确认取消在隔离网页中验证，未对正式用户执行清空；隔离 UI 服务已按进程与监听身份核对后停止。

私有证据分别位于 `.data/memobase-20261018/deploy-receipts/`、`post-deploy-receipt.json`、`final-retention.json`、`final-regression.log` 以及 `production-memory-mobile.png`。这些回执包含内部路径/业务摘要，仅保留本机。上述部署及浏览器验收不替代前文列出的第二台 PC 与原生安装包/ARM 实机边界。
