# 小伴 0.9.10 客户端与发布验收



冻结源码为 `d2ded9c66aad81310d8d40baa74761a3a8242242`。版本 `0.9.10`，Android `versionCode=20`，发布合同 stable sequence `12`，前一版 sequence `11`。本轮将语音打断、后台 Agent 进度与完成汇报、对话重命名／归档／恢复／删除及账号项目分类纳入四端共享界面；桌面仍内置 Codex `0.143.0`、OpenCLI `1.8.8`、Computer Use `7.4.0`，Electron `39.8.10`。六包均使用同一 canonical 前端，未消费含生产下载文件的 live dist。

## 六个交付文件

| 文件 | bytes | SHA-256 |
| --- | ---: | --- |
| `PetPal-0.9.10-Windows-x64.exe` | 220939191 | `333945f282daeb02427ef8b722ec6b561f8da3b67e8e5dc051248a09e250a1dc` |
| `PetPal-0.9.10-Windows-x64.zip` | 373237878 | `ffed1893d470c47651644fe6897bff41d842a031d96d04268be9078f405e22d1` |
| `PetPal-0.9.10-Ubuntu-x64.tar.gz` | 343871928 | `912c50627fcaae105fa59dfbe91f5eb02da1c5843ca7bd8128803d9075afcf69` |
| `PetPal-0.9.10-Ubuntu-arm64.tar.gz` | 338056406 | `8b16fd1ff0bc649f1d59a55ee1f55a5ef95e764ed92a7cd8be4cc217c1e7e7d1` |
| `PetPal-0.9.10-Android-debug.apk` | 60732669 | `f8ba3c8613a4ff0abea9106e5d38f37ce57dd390c99b20957f8c246bb9513863` |
| `PetPal-0.9.10-Web.zip` | 55945807 | `ccb7cb400bbdee2aa734e14e966a1af7cb3cf438c91e01194cb677b21c55714c` |

合计 `1,392,783,879` bytes。原始平台回执、实际文件摘要、冻结源码身份及六包合同已经由 `release-acceptance.json` 与 `release-contract.json` 绑定；后续文档提交不改变该构建来源。以上摘要不得从旧发布说明复制，也不得用仅有 HEAD 的长度检查代替完整包体校验。

## Windows：实际启动通过，ZIP 手势验收未完成

两个最终 Windows 包均通过实际启动、连续两次启动、账号门禁、默认本机服务、内置 CLI 状态／版本，以及 DesktopExecutor 在线登记。中央服务器的真实设置界面、设置持久化、第二次启动恢复和关闭中央监听后保留 loopback 服务均通过。EXE 完整 native smoke 通过，包括真实 Cubism V12 渲染和手势探针；各次验收所属进程退出后均为零。

ZIP 的完整 gesture smoke **没有通过**。两次失败回执均保留：原生 `pointermove` 混入模拟 press，使动作取消，停在 `smoke-anime-gestures`。没有挪动系统鼠标来使测试通过，也没有修改产品源码、手势断言或借用历史烟测结果。ZIP 的头像渲染截图、独立连续启动和中央服务器 UI 验收仍通过，必须保留 `zipCompleteGestureSmoke=false`／`windowsZipFullGestureSmoke=false`，不能写成两包完整手势验收均通过。

连续启动回执的 `wrapperLifecycleSeconds` 为 EXE `111.395 / 108.589` 秒，ZIP `7.383 / 6.931` 秒。这是固定验收流程的包装器生命周期，含展开／探针等工作，不是严格的首帧或冷启动性能基准；仅作为本轮实测流程数据。ZIP 解压后双击 `PetPal.exe`，必须保留同目录资源。便携 EXE 每次展开运行，无须独立安装 Node、Git、Codex 或 OpenCLI。两种包均为 `Authenticode=NotSigned`。

首次 Windows 构建的图标转换进程退出码为 `3221225477`。已经核对该次生成 ICO 的七个图标项及文件摘要，使用当前冻结源码重新打包；未修改 tracked 图标源码、未复用上一版安装包。该过程记录于 `windows-icon-recovery.json`，原失败日志保留。

最终 EXE 分层读回核对 `5,053` 项文件，其中 `277` 项前端。ZIP 全量解码 `10,873` 项，`10,872` 个 runtime 成员与最终 EXE payload 相同；额外文件为启动说明。全部冻结字节核对以及11个已知私有值扫描通过。新增对话组织、Chat 派发／汇报、三个自动化模块在必需成员合同和实际包体均出现。

证据：`windows-acceptance.json`、`windows-final-verification.json`、`windows-exe-readback.json`、`windows-exe-smoke.json`、`windows-{exe,zip}-{repeat,central}.json`、`windows-zip-private-audit.json`、`windows-icon-recovery.json`，以及两份 `windows-zip-smoke-*-failed/` 的原始错误、日志和截图。

## Ubuntu：两架构全包审计，无目标机运行验收

Windows 主机在独立源码 mirror 交叉打包 x64／ARM64，未使用 WSL，未执行 Linux GUI、Linux CLI 或真实目标设备。归档与静态证据不代表 Ubuntu 运行时已经验收。

冻结 mirror 的 `408` 项来源字节核对通过。两包各 `12,866` 条 tar entries，`277` 项前端资源和 `80` 项应用源码均与 canonical／source receipt 匹配；tar 中全部文件的摘要与最终 staged payload 一致。独立 verifier 的 `--compare-current-dist` 指向该镜像的隔离 dist，未比较或修改生产 live dist。

Electron、Codex 和 Computer Use 原生架构分别为 ELF machine `62 / 183`，Computer Use 要求 glibc `2.34`，满足 Ubuntu22打包约束。官方 Electron SHA-256 和 Codex npm SHA-512完整性验证通过。Cubism V12在主机真实 Core 中读取到 `16` drawables、`22` parameters、`3,774` vertices，模型、纹理、motions、Core与许可来源一致；这是 Core结构验收，不是 Linux窗口渲染验收。

每包 `11,410` 个 payload 文件全量扫描11个已知私有值，无命中；每架构 `123` 个源码／依赖文件、`225` 条导入边闭合。Windows主机实际导入两个 assistant模块、三个 automation模块、三个工具桥及23条公开查询适配器，OpenCLI默认开启；没有网络查询、Agent任务或Linux原生执行。播放器／网站控制仍遵循任务权限，未在本轮进行真实音乐和网站操作。

产物位于 `releases/release-0.9.10/ubuntu/`。证据：`ubuntu-package-audit.json`、`ubuntu-source-snapshot.json`、`ubuntu-{x64,arm64}-independent.json`、`linux-package-{x64,arm64}-0.9.10.json`、`ubuntu-private-values-scan.json`、`ubuntu-query-import-closure.json`。

## Android：签名连续性与完整APK审计，无手机安装验收

包名 `com.petpal.app`，版本 `0.9.10 / versionCode20`，minSdk23、targetSdk35、compileSdk36。沿用0.9.9的开发证书，SHA-256为 `8ae49ee6b09900eee2e2996a0c4ecd659f94631f81b64c5df7fb53935835713c`；真实 apksigner对比的 signer set相同，versionCode递增，具备覆盖同签名旧包的条件，仍不属于应用商店正式签名。

完整读取 `720` 项APK成员并核对CRC，`277` 项冻结网页资源及两个生成的Capacitor桥逐字节比较通过，zipalign通过。19个原生类、后台提醒的非导出 `specialUse` 服务、Cubism V12模型及真实Core结构已核对。包中没有桌面 Codex、OpenCLI或服务端执行器，没有运行测试fixture或远程页面覆盖；11个已知私有值扫描无命中。

Android通过个人服务执行远程Agent，本机不运行桌面CLI。本轮未安装到手机或模拟器，也未验证实体设备上的升级、麦克风、扬声器、相机、OEM省电限制和后台通知。

证据：`android-apk-audit.json`及对应 badging、manifest、permissions、signature、zipalign 和 previous APK原始日志。

## Web与当前静态部署

Web ZIP完整解码、CRC和全部 `277` 项冻结资源摘要比较通过，含新功能和V12模型／Core／许可；11个已知私有值扫描无命中。审计前后归档和canonical bundle保持一致。

静态部署已完成：生产 `277` 项本轮资源与 canonical 全量摘要匹配，实际改写2项并新增27项，`index.html`最后切换，HTTPS首页body与canonical index完全匹配；旧资源和备份保留。下载目录在部署前后的清单、长度与mtime保持。该静态回执不代表后端切换无故障，也不代表本轮已完成所有浏览器交互和语音设备验收。

证据：`web-archive-audit.json`、`web-archive-artifact-audit.json`、`static-deployment.json`。

## 后端切换与业务数据保留

原始后端切换 helper 在 stop 阶段失败。`backend-restart-failure.json` 记录旧PID `51780`，`phase=stop`、`stopped=true`、`started=false`、`newPid=0`，没有自动重试或回滚；该阶段失败原因仍为 `unknown`。root 报告随后手动调用一次既有 `Start-PetPal-Service.ps1` 恢复服务；调用本身没有独立 invocation log，不能把恢复结果改写成原 helper 一次无中断升级成功。

后续独立只读验收确认 node.exe PID `54736`、精确既有 `server/index.mjs` 服务命令、匹配进程创建时间及4318端口监听身份。实际创建时间为北京时间 `2026-10-06 13:01:34.5697530`，进程检查为 `13:11:42.9188680`；`13:11:43` 的本机与公网HTTPS health均返回 `200 / ok=true / version=0.9.10`，公网TLS验证启用且禁止重定向。旧PID及其两项已知子进程均已消失，maintenance flag不存在。

原 listenHost、networkOrigins与 guardian/config 字节保持；私有备份目录ACL受保护，只保留当前账号、SYSTEM和Administrators的FullControl允许项，无Deny或继承。独立验收的 `passed=true` 仅适用于恢复后的运行态，不代表原 helper 成功，也不代表上游模型、语音或实体设备验收。

业务投影摘要与切换前相同，`changedFields=[]`：2个用户、5个provider、35个会话、0个项目、1个附件、0个自动化计划及其他保留业务字段保持。`sessions`、`executionHosts`、`notifications`、`updateTrustState` 明确排除于业务投影。原始／当前完整state摘要在该检查时点也相同，不能推广为整个恢复期间文件逐字节始终不变。

初始attempt/failure JSON没有停止事件时间字段；文件mtime不能当作精准停止时间，现有回执不足以确定停机时长。`backend-runtime-verifier-initial-failure.json` 是独立verifier初次误要求绝对入口路径，与原stop失败没有已建立的因果关系；原失败日志保留。

证据：`backend-runtime-acceptance.json`、`backend-runtime-facts.md`、`backend-restart.attempt.json`、`backend-restart-failure.json`、`state-before-restart.json`、`state-before-stop-check.json`、`state-after-recovery-check.json`。恢复验收对上述五份原始小JSON的长度与摘要绑定通过。

## 正式发布、两源更新与下载归档

发布合同为stable sequence12。GitHub和服务器分别沿用既有独立Ed25519信任锚：

- GitHub：`5e649530901ba590d7ed894e74c3f77e29f34e0ca0ac4c5a5bfe1dfefa300d6c`。
- 服务器：`1841fdaf57bb74769dc94049d07fc79d675f29c4633f156c3b1ec65781f8d5d3`。

五个更新目标为Windows EXE、Ubuntu x64、UbuntuARM64、Android、Web，Windows ZIP额外下载。服务器清单地址为 `https://magicdatou.top:44318/downloads/updates/petpal-update.json`，服务器包保持同HTTPS origin／updates目录。更新清单签名不能代替Windows或Android平台签名。

六包与四项metadata共10个GitHub资产由 `release-plan.json` 绑定，release ID为 `404334344`，原始manifest摘要为 `a8efcf08e826f4ec03de8f6c09fd716fe9090e5a0079966ee85803b67f736456`。本轮存在真实传输失败，原日志、attempt及小回执均保留，不覆盖或删除历史失败事实。

### 云端失败与实际部分回读

云端run `37419799452`、`37424105405`、`37438906433` 均以completed/failure结束，attempt均为1。最后续传run的停止proof由完整终态日志、新鲜run身份和资产集合前后比对绑定；失败代码为 `range-fragment-failed`，底层原因仍为unknown。

GitHub Actions内实际完整API/CDN body读取已证明三项：Windows EXE ID `614722528`、ZIP ID `614753915`、Ubuntu x64 ID `615021154`，实际bytes/SHA-256与frozen合同一致，final资产身份匹配。两项Windows原ID复用，Ubuntu x64在该run有一项reserved/POST201链；剩余七项在该run没有POST reservation；停止proof采集时尚无对应本地attempt，其后的本机direct实际失败见下一节，不能由此补成完整十项读回。这是云端三项部分传输证据，不能写成十项云端发布成功。云端range/assembly下载没有执行任何客户端安装程序。

证据：`direct-completion-stopped-proof.json`、`direct-completion-authorized.json` 与其所绑定的终态完整日志；此前cloud failure和partial receipts继续保留。

### 本机direct失败与重试语义

云端三项完成后，本机direct wrapper实际复用EXE ID `614722528`、ZIP ID `614753915`、Ubuntu x64 ID `615021154`；真实日志均为 `uploadInvocations=0`。ARM由wrapper预留并调用一次gh进程，root记录该direct流程最终以exit1结束。该次流程没有生成完整十资产上传结果，没有执行成功的十项本机网络body读回，也没有正式发布；后续Android、Web两包和四项metadata共六个目标未被该direct流程调用。

独立官方源码调查确认实际gh版本为 `2.89.0`：其资产上传在网络错误或HTTP>=500时会内部重试，最多四次应用层 `uploadAsset` 尝试；每次重新打开文件并构造POST。wrapper只预留和调用一次gh进程，`uploadInvocations` 统计进程调用，不能证明HTTP POST次数。实际wire POST总数未知，未采集逐请求trace。原 `noAutomaticRetry` 记录只适用于wrapper层，不覆盖gh内部行为；历史授权、attempt、失败日志不改写，以 `direct-completion-semantics-correction.json` 追加纠正。

终态只读proof确认旧node65784、所有gh进程和upload lock均已消失，三个旧cloudrun均terminal/failure/attempt1；三项完整原ID保持。ARM ID `615075320` 仍为未完成 `starter`、digestnull，created/updated均为 `2026-10-06T09:34:37Z`。direct失败原因unknown。此前starter ID变化与内部重试相符，但不能据此确定重试次数、确切因果或底层网络原因。

证据：`github-direct-completion-upload.log`、原ARM `github-upload-PetPal-0.9.10-Ubuntu-arm64.tar.gz.attempt.json`、`direct-completion-terminal-proof.json`、`direct-completion-semantics-correction.json`、`gh-internal-retry-review/source-review.json`。小回执对原log、attempt、语义纠正、官方源码审查和历史授权raw摘要的绑定通过。

### 精确失败ARM占位清理

清理目标仅为未发布draft内精确ID `615075320` 的ARM starter；三原完整ID、原attempt、本地包与失败日志继续保留。只读代码审查已通过固定schema、身份、source/contract/plan、三terminal run/head、进程/lock、old latest和原证据hash闭包。脚本按服务端 `updated_at` metadata年龄至少30分钟门禁，最早为 `2026-10-06T10:04:37Z`；这不是声称从首次现场GET已连续观察30分钟。未知DELETE结果只允许GET协调，不由wrapper再次DELETE。

`github-arm-starter-cleanup.json` 证明，root只调用一次精确清理命令，移除未发布失败ARM占位 `615075320`；新鲜GET确认该ID消失、三个完整包保持原ID。原ARM attempt、本地包与失败日志均保留。清理命令返回成功，原始回执摘要已绑定到gen5授权与恢复计划。

### 新gen5云端续传与完整读回

新的gen5续传使用独立授权和真实清理receipt，已完成实际完整body读取及资产身份核对，随后发布正式版。原三项已完成资产按原ID复用；本次成功不覆盖之前direct流程的失败历史，也不改变其实际HTTP POST次数未知的结论。

新的云端run [37447926269](https://github.com/lixinyu02/petpal/actions/runs/37447926269)（attempt1、候选 `ea6cbbc3e629ee0e4b7f8a8823e80ff62d75494e`）完成。`cloud-verification-37447926269.json` 与规范化 `github-draft-readback.json` 证明，GitHub Actions对六包和四项metadata共十项完整官方API/CDN body读取，实际bytes/SHA-256与冻结合同一致；三个原ID保持。API bearer未转发CDN、TLS验证启用；没有运行安装程序。这是云端十项完整回读，本机没有重复下载十项GitHub包体。本轮有七个应用层native fetch上传调用，分别包括ARM显式失败上传恢复及其他六项首次上传；源码没有上传重试循环。计数来自调用预约和执行链，并非独立HTTP wire trace；先前gh内部历史wire次数仍为unknown。

GitHubBearer只发送首个精确官方API地址，CDN不携带Bearer；TLS与实际完整stream bytes/hash必需。API digest、HEAD长度或构建本地hash不能替代网络包体读取。新gen5完整读回、publication身份核对与重复published body读取是不同证据。

正式 Release `v0.9.10`（ID `404334344`）已公开并成为latest，`draft=false`、`prerelease=false`，tag指向冻结源码；十项资产ID与run 37447926269的完整云端回读保持。`github-publication.json`通过发布前后身份核对，完整包体证据继承自上述GitHub Actions验证。
发布后核对latest、tag、版本、十项资产name/id/state/bytes/digest及原ID保持，没有再次读取相同十项包体。publication继承gen5云端完整回读；该身份核对不能称为第二轮published完整body读取。

### 服务器包与两源软件更新

本机 `server-packages-full-readback.json` 已完整读取HTTPS `/downloads/` 六包及 `/downloads/updates/` 五个更新目标，实际bytes/SHA-256与frozen合同一致；均为200、TLS验证启用、无重定向。服务器包回读不能替代signed清单原子promotion或实际更新服务检查。

`server-promotion.json` 证明服务器stable签名清单已从sequence11原子切换到sequence12，并通过公网完整清单回读；沿用原有服务器公钥与来源信任。原清单保存在私有可恢复目录。
`live-update-sources.json` 使用实际更新服务分别验证GitHub／服务器各五目标：0.9.9均发现0.9.10／sequence12；Android code20；当前Web0.9.10不再提示升级。此验证使用独立临时store，没有改写生产用户更新配置。

### 旧公开下载归档

旧0.9.9的精确13个公共文件已移入私有可恢复归档，保留当前15个公共文件；GitHub历史Release与本地旧安装包保留。`previous-archive.json`校验归档字节，`archive-http-acceptance.json`证明旧13URL返回404、新15URL返回200且长度匹配；HEAD用于归档可见性，完整包体来自前述十一条服务器全量回读。首次只读verify调用exit1，具体失败原因unknown，原 `previous-archive-verify.log` 保留；随后诊断调用导出的verify得到exit0及上述完整28条HEAD结果，记录于 `previous-archive-verify-diagnostic.log`，没有再次运行apply。最终成功回执不能改写为首次检查无故障通过。

## 生产Chrome下载界面

`chrome-downloads-acceptance.json` 已记录生产0.9.10下载页、test登录、只显示最新版、服务器优先直连、Windows ZIP/EXE切换、Ubuntu x64/ARM64切换。CSS viewport为412×960，scrollWidth为412，无横向溢出；验收后viewport恢复。截图为 `downloads-mobile-412x960.jpg` 和 `downloads-desktop.jpg`。

这些是下载页和响应式界面证据，不能证明当时GitHub正式发布或两源更新指针已切换；下载元数据可先于发布收尾显示。此receipt未独立记录匿名受保护API门禁、真实模型Agent任务、更新源切换或实体设备行为。CSS viewport不是Android／Ubuntu原生客户端验收。

已有 `chrome-downloads-acceptance.json` 记录生产Chrome下载页仅显示0.9.10正式版、服务器直连优先，Windows格式／Ubuntu架构切换和412×960无横向溢出检查通过。本轮收尾只绑定该既有记录，没有宣称发布后再次刷新，也未追加真实模型Agent、上游ASR／TTS或实体媒体设备验收。

## 回归与发布工具审查

打包／更新／下载定向回归 `142/142`、新增缺失／改字节包装合同fixture `7/7` 和 TypeScript检查通过；两组测试存在范围重叠，不合计成唯一测试总数。源成员合同覆盖 `conversation-organization.mjs`、`chat-assistant.mjs`和三个automation模块，测试实际拒绝源码遗漏、ASAR同长损坏、三方receipt摘要差异、Linux包体／manifest漏项及PowerShell实际字节校验失败。

发布helper的mock证据为Node `30/30`（release18、state retention12），PS5／PS7身份／日期／网络判定各16项。未知上传结果只GET协调，不自动再次上传；GitHubBearer仅发送到首个精确官方API地址，不转发CDN；服务器禁止重定向，TLS和完整stream bytes/hash核对必需。独立审查提出的PS5 ACL模块加载、archive raw-plan摘要与exact13/15集合绑定均已修复；现有隔离ACL目录只读复核为protected、3 Allow、0 Deny、0继承，均FullControl。mock或隔离测试不得写为实际发布／网络验收。

## 本轮验收范围

本轮没有真实模型任务、上游ASR／CosyVoice端到端调用、实体麦克风／相机、真实音乐或网站控制验收。Windows仅有固定本机系统朗读事件探针，不能由此证明上游音色或连续语音质量。语音打断和Agent汇报的先前功能验收应引用对应feature文档，不能扩写成四端打包后已再次完成端到端设备验收。Android／Ubuntu实体运行、ZIP完整gesture、恢复后运行验收，以及正式发布／更新状态应分别按对应原始回执区分。
