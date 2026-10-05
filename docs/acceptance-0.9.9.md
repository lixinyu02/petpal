# 小伴 0.9.9 发布与客户端验收

本轮冻结源码为 `76f6a54c713a9f42eac3d4db384706f95fca848e`，版本 `0.9.9`、stable 更新 sequence `11`、Android versionCode `19`。六个分发包与冻结构建绑定，Windows 两种分发完成实际启动和完整 smoke，Android 与 Ubuntu 完成完整包审计；Android 实体设备与 Ubuntu 目标机 GUI 尚未验收。

GitHub 正式版、服务器静态前端、两源更新清单、旧公共包归档与归档后的生产Chrome验收已完成下述回执验收。最终HTTPS health为0.9.9，业务字段精确保留。证据目录为 `evidence/release-099-20261005/`；自动化功能的独立运行证据位于 `evidence/automations-099/`。

## 六个冻结分发包

| 文件 | bytes | SHA-256 |
| --- | ---: | --- |
| PetPal-0.9.9-Windows-x64.exe | 220918416 | `787852d569d878ff529b43452d5b35519147b0db411a5ecf46f6f114bd7547c7` |
| PetPal-0.9.9-Windows-x64.zip | 373200535 | `33e2a14549370547155b3ca0d941b496309d147535076e84a75454da79306e39` |
| PetPal-0.9.9-Ubuntu-x64.tar.gz | 343847774 | `5e35993f2f99770368c28fcde85e0b684b66dc3029e19c5a4d18d72f4f748734` |
| PetPal-0.9.9-Ubuntu-arm64.tar.gz | 338044470 | `a9395d45d50591ef993ffd1ec411ea499911fd70728c77a1fce1c30c0350b9f0` |
| PetPal-0.9.9-Android-debug.apk | 60724465 | `77e2c84028f75ad01251990cfff13bad59945def3084751d0da713b8603709a7` |
| PetPal-0.9.9-Web.zip | 55939053 | `72d2f6106cd3cc38238c4ee3b1300d4ce5f1849db1fbf285ddb6749830a63f5e` |

总包体积 `1,392,674,713` bytes。清单来自本轮 `public-preparation.json` 与 `releases/v0.9.9/release-manifest.json`，不能复用 0.9.8 的大小或摘要。GitHub 的十项 asset 为六包加四项 metadata。

## 自动化与浏览器验收

- 本轮最终串行回归 `2058/2058`、自动化相关targeted测试 `123/123`，fail/cancelled/skipped均为0；前端构建成功，保留超过500kB chunk的Vite提示。这些是本轮原始日志结果，不复用0.9.8测试数字。证据：`evidence/automations-099/full-regression-final.log`、`targeted-final.log`、`ui-build-final.log`。最终TypeScript `tsc --noEmit` 退出0，成功日志 `evidence/release-099-20261005/final-typecheck.log` 为0 bytes；退出码另由 `final-production-state.json` 记录，不能只用空日志本身证明成功。
- 真实 `gpt-6.1-sol` 在隔离环境中通过 Agent 创建停用计划，继承当前任务范围；随后使用真实时钟、15 秒调度 tick 执行一次计划，结果会话完成、内容核对通过，并默认不出现在普通历史中。该环境没有桌面操作工具，未修改生产计划。这证明本轮隔离 Agent/调度路径，不代表生产任务或外部电脑上的真实操作已执行。证据：`evidence/automations-099/live-agent.json`。
- 早期浏览器 fixture 曾在原生确认框处被 Chrome 插件阻断，随后 IAB 经键盘事件完成内联丢弃、暂停保存及 `412×960`/`320×320` 检查。这份证据保留为早期范围，不能替代最终包前端的验收。证据：`evidence/automations-099/ui-acceptance.json`。
- 最终 canonical 0.9.9 前端的 Chrome 插件补验收通过：`412×960`、scrollWidth `412`，实际检查内联草稿确认、继续编辑保留内容、停用计划保存及退出账号；生产计划创建数为 `0`。checkbox 指针自动点击没有切换，焦点后的 Space 成功；full-page screenshot 超时，保留 viewport screenshot。这些工具限制不写成鼠标路径或整页截图通过。证据：`chrome-canonical-099.json`、`chrome-canonical-099-mobile.jpg`。
- 最终fixture会话stdin已关闭，预设 `close-fixture` 关闭指令因而不可用；复核其准确node命令及3289端口后仅停止PID `96000`，没有共享控制台信号。后续确认fixture已退出、监听数为 `0`，生产PID `109008` 前后相同，HTTPS health仍为 `ok=true/version=0.9.9`。

## Windows EXE / ZIP：实际客户端验收完成

- 两包完整 smoke 原始通过，使用包内 Electron `39.8.10`、Codex CLI `0.143.0`、OpenCLI `1.8.8` 与电脑控制原生资源，运行数据、Codex home、工作目录及临时目录隔离；无继承凭据或 Electron flags。中文及空格 ZIP 解压路径实际启动通过。没有使用 cursor repair/helper 来使本轮通过。
- 登录门禁、包内 loopback backend、executor 在线注册、默认 Cubism V12 与 WebGL 渲染，以及完整 smoke 的交互/睡眠/宠物路径通过；两包分别进行两次连续启动，profile 保持与退出清理通过，owned processes remaining 均为 `0`。在线注册和 Codex 进程可用不等于该 smoke 调用了真实模型。
- 两包中央服务器设置使用实际 UI 保存，密码门禁、未认证/bootstrap 拒绝、密码登录、同实例、端口冲突回滚和 public origin 变更通过；第二次启动恢复既有监听，实际 UI 关闭中央服务器后 loopback backend 保持。`412×960` 下 scrollWidth 为 `412`。此项是本机打包客户端验收，没有外部手机/电脑的 LAN 验收。
- 最终 EXE 逐层反解后核对 `5,052` 项文件与 `277` 项前端文件；ZIP 完整读取 `10,873` 项，与冻结来源一致，其中 `10,872` 个 runtime payload 与最终 EXE 内容相同。10 项已知私有值扫描无命中，运行模块、自动化前端、许可证与冻结 source bytes 核对通过。
- 证据：`windows-exe-smoke.json`、`windows-zip-smoke.json`、`windows-exe-repeat.json`、`windows-zip-repeat.json`、`windows-central-smoke.json`、`windows-final-verification.json`、`windows-exe-readback.json`、`windows-zip-private-audit.json`。

## Android APK：完整包审计完成，实体设备待验收

- 包名 `com.petpal.app`，versionCode `19`、minSdk `23`、targetSdk `35`。完整读取并核对 `720` 个条目的 CRC，`277` 个冻结前端文件与 `2` 个生成的 Capacitor bridge 一致；zipalign 与 v1/v2 签名校验通过。
- 证书集合与 0.9.8 相同，沿用开发证书，证书 SHA-256 为 `8ae49ee6b09900eee2e2996a0c4ecd659f94631f81b64c5df7fb53935835713c`。APK 内真实 Core 在审计主机执行，V12 MOC/20 项模型资源、Core `6.0.1`、22 parameters、16 drawables、3,774 vertices、2 个虹膜 mask 一致。
- 通知服务与 19 个 native classes 检查通过；无桌面 CLI/服务器 runtime、运行测试 fixture 或远程页面替换。10 项已知私有值扫描无命中。
- 没有安装到 Android 真机，没有验收实体麦克风/相机、音频、通知/省电、悬浮窗、实体返回键或远程执行电脑。证据：`android-apk-audit.json` 与签名、zipalign、badging 日志。

## Ubuntu x64 / ARM64：完整包审计完成，目标机待验收

- 两个 tar.gz 各 `12,865` 项，全部归档内容与 payload bytes/hash 核对通过；ELF machine 分别为 `62`/`183`，当前电脑控制 native 要求 GLIBC `2.34`。Ubuntu 22.04 基线满足版本要求，但本轮没有运行 Linux GUI 或目标架构原生程序。
- 两包含 Codex `0.143.0`、Electron `39.8.10`、OpenCLI `1.8.8`、MCP SDK `1.31.0`、Cubism V12/Core `6.0.1`。独立 source mirror 的 `407` 项 snapshot 完整 rehash，23 项 V12 模型资源与 7 个 runtime caches 完整核对。automation schema/tools/service 及 app/desktop/executor capabilities 核对通过。
- OpenCLI 静态导入闭包 `121` files/`222` edges；23 个公开查询模块宿主导入、25 个查询网站、46 个浏览器命令目录检查通过。Core 的真实执行发生在审计主机，模型结构为16 drawables/22 parameters/3,774 vertices；这些证据不能替代 Ubuntu GUI 渲染或 Linux 上实际查询/电脑操作。
- 每包 `11,409` 个 payload 文件完整扫描10项已知私有值，无命中。未复制生产私有数据，打包阶段没有修改生产 dist、WSL 或旧0.9.8资产。
- 证据：`ubuntu-source-snapshot.json`、`ubuntu-package-audit.json`、`linux-package-x64-0.9.9.json`、`linux-package-arm64-0.9.9.json`、`ubuntu-private-values-scan.json`、`ubuntu-query-import-closure.json`。

## Web：完整归档与生产静态部署完成

Web.zip 完整解码、CRC 与全部 `277` 项冻结资源逐字节匹配，含自动化前端、V12 模型/Core/许可证；10项已知私有值扫描无命中，审计前后归档和 canonical bundle 未变。静态部署已将本轮 `277` 项资源切换到生产，HTTPS index 校验通过，并保留旧静态备份与下载文件。`static-deployment.json` 的 `backendRestarted=false` 仅表示这次静态部署没有重启后端，不能抹去下述更早的后端退出事件。证据：`web-archive-audit.json`、`web-archive-artifact-audit.json`、`static-deployment.json`。

## 后端运行态、数据保留与清理恢复事件

生产后端实际升级到0.9.9。HTTPS health 返回 `ok=true/version=0.9.9`，TLS 默认校验开启、禁止重定向；automations及三条语音接口的未认证调用均为401，owner/test登录后的计划列表200，test退出后session被撤销。验收没有创建生产计划、提交生产任务、写provider/模型配置或调用真实上游语音。

本轮有精确语义 before/after 比对：`2`个用户、`5`个provider/模型配置、`33`个会话、settings、instance/owner及Codex业务字段保持。允许的启动迁移仅为新增空 `automations version1`、`codexConfig.toolVersion` 从 `opencli-browser-setup-v1` 到 `opencli-browser-setup-automations-v1`，以及随toolVersion变化旋转 `revision`。登录测试会话新增后已移除，先前session数恢复为7。不能描述为整个state文件字节完全未变。证据：`backend-runtime-acceptance.json`。

清理早期隔离浏览器 fixture session `21244` 时发送过Ctrl+C；生产PID `68152` 在 `2026-10-05T08:53:34.8277735Z` 退出，旧stderr为空，guardian于 `08:53:40.5731876Z` 恢复为PID `109008`，约六秒。时间上关联Windows共享控制台SIGINT是当前假设，`causeVerified=false`，没有确认是产品缺陷。恢复后health为0.9.9，用户/provider/33会话/settings/Codex业务字段精确保留，active persisted tasks与automations均为0。后续canonical fixture清理采用准确PID停止，没有再广播控制台信号。证据：`backend-cleanup-recovery.json`。

原始云端日志中的EXE download-only retry `08:53:36.5834785Z` 落在这一退出/恢复窗口；Ubuntu x64 `09:17:29.7951408Z` 与APK `09:44:58.5106791Z` 另有download-only retry，原因未知。所有重试后的六包完整mirror与官方asset回读摘要均通过；没有不确定upload事件、没有Actions rerun或本机第二次上传。时间相关性不能替代因果证明，也不能因最终通过写成期间没有下载影响。证据：`cloud-transfer-byteproof.json`。

归档与生产Chrome验收后最终复核，服务PID `109008`、guardian PID `20840`保持稳定，maintenance已移除，HTTPS health仍为0.9.9；2用户/5模型配置/33会话与全部业务字段精确保持，空automations未变，生产任务提交与配置写入为0。九项发布回执均通过，release仍为latest，tag仍指向冻结源码。证据：`final-production-state.json`。

## 正式发布、完整公网回读与归档

- GitHub [v0.9.9](https://github.com/lixinyu02/petpal/releases/tag/v0.9.9) 已为 stable/latest；release ID `403517961`，draft/prerelease均false，tag精确指向冻结源码，发布前后十项asset ID未变。正式状态与sequence11签名核对通过。证据：`github-publication.json`、`github-release-acceptance.json`。
- 原始GitHub Actions run [37286309400](https://github.com/lixinyu02/petpal/actions/runs/37286309400)，attempt1、push event、reviewed candidate `87534a614531063f45ce161d7afb56513feca8c4` 成功；六包完整服务器mirror网络/落盘bytes及官方asset CDN回读全部匹配，18项原始有序事件核对通过。四项metadata在本机经官方API/CDN完整回读。六包公网全量验证发生在云端，不写成本机全量下载六包；云端没有执行安装包。证据：`github-transfer/cloud-verification-37286309400.json`、`server-packages-full-readback.json`、`cloud-transfer-byteproof.json`、`github-transfer/metadata-readback.json`。
- 请求URL、TLS默认校验、mirror无凭据且禁止重定向等请求事实来自已审查的冻结runner；原始日志提供完整bytes/hash事件，没有直接输出origin URL。Bearer仅发往准确的GitHub API asset请求，不转发至CDN。保留请求事实与body证明的来源差别。
- 服务器stage/promote通过，保留旧清单备份并完成原子切换；服务器与GitHub分别使用原有独立Ed25519信任锚，不要求两源key相同。两源五目标Windows x64、Ubuntu x64、Ubuntu ARM64、Android、Web均返回0.9.9/sequence11及冻结摘要，Android versionCode19；当前已为0.9.9时不重复提示更新，读取源时没有修改生产provider/用户配置。证据：`server-stage.json`、`server-promote.json`、`live-update-sources.json`。
- 按计划将13个旧0.9.8公共文件移到 `.data/release-archive/0.9.9-1791205565285`，完整bytes/hash保持且可恢复；公共目录保留15个当前文件，没有删除旧文件，GitHub历史Release保留。真实HTTPS HEAD验收为13条旧路径404、15条当前路径200并匹配Content-Length；绑定当前release/source/manifest/plan/archive及服务器/GitHub回执的七项身份。这次HEAD是存在性/长度检查，包体完整摘要来自上述独立回读。证据：`latest-only-archive-plan.json`、`latest-only-archive.json`、`archive-http-acceptance.json`。
- 独立审查19项release helpers，已修复archive sequence、签名前冻结source断言、重复freeze写前拒绝及archive HTTP身份。28项mocked cloud-transfer测试通过；另一个reviewer的29项archive fixtures通过，明确拒绝github/archive两回执都误用前一release ID `403398605`，并检查原始plan bytes、路径、bytes/hash、重定向及七项回执绑定。fixtures没有执行真实HEAD、签名或文件移动，不将其写成实际归档验收。证据：`release-helpers-independent-review.json`、`final-archive-helper-review.json`、`archive-http-boundary-fixtures-prior.json`；旧独立审查完整保留在 `release-helpers-independent-review.pre-final.json`。
- transfer临时分支以固定candidate commit进行guarded清理成功，原始run/commit proof保留，正式v0.9.9 tag未变。证据：`transfer-branch-cleanup.json`。
- Chrome插件在新标签页打开已部署的生产 `https://magicdatou.top:44318/?chat=1` 后，登录门禁与退出后的门禁通过；自动化页为生产空列表，打开真实表单核对五种schedule、project directory及默认 `central/read-only/ask`，随后取消，无计划创建。`412×960` 的scrollWidth为412。
- 生产下载页仅显示0.9.9，服务器为优先下载源；实际切换Windows ZIP/EXE与Ubuntu x64/ARM64均得到上表对应路径，Android指向本轮APK；随后恢复Windows ZIP/Ubuntu x64默认选择。未请求包body重复下载。`320×320` 下scrollWidth为320，导航与内容分别存在可滚动区域；退出test账号后恢复viewport并关闭tab。没有调用上游语音/模型或媒体设备，没有生产任务/配置写入。证据：`chrome-production-099.json`、`chrome-production-099-automations-412x960.jpg`、`chrome-production-099-downloads-412x960.jpg`。

## 证据边界

Windows两包的Authenticode为 `NotSigned`；Android沿用开发证书。Ed25519更新清单验签与操作系统安装包信任分别验证，不能互相替代。

Windows完整smoke经授权仅包含固定短句“你好，我是小伴。”的本机系统TTS事件探针，不读取个人文本、不开麦克风/相机、未调用上游ASR/TTS或真实模型；此项不证明上游音色、流式朗读或端到端语音聊天通过。隔离的真实GPT-6.1自动化验收另有独立证据，不能扩写为所有打包客户端/生产计划的模型验收。证据：`native-speech-acceptance-scope.json`。

本轮没有真实OpenCLI网站查询、音乐或用户应用控制验收，没有Android/Ubuntu目标设备验收，也没有外部设备的中央服务器验收。早期Chrome阻断、最终checkbox指针限制/整页截图超时、后端退出与下载重试、云端与本地回读范围均如实保留。
