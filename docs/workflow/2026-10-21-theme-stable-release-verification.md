# 0.9.14 四端主题与正式发布验收

- Date: 2026-10-21
- Status: 正式发布与最终公网验收完成。
- Product sourceRevision: `7b8f84f5b3962efaebbacb3d5af72cecdc790e59`
- Android: `versionName=0.9.14`，`versionCode=26`
- 本文绑定冻结产品的既有平台验收，以及正式发布后的完整网络回读、更新签名和业务保留收据；文档提交不改变产品 tag。

## 验收结论与适用范围

Web、Windows x64、Ubuntu x64/ARM64、Android 六个最终资产已完成归档全量读取、来源绑定、私有数据扫描和许可检查。四端统一使用冻结的 306 个前端资源。

Windows EXE 与 ZIP 解压后的实际客户端均启动通过；日夜主题通过真实设置控件保存，并在同一隔离用户目录、不同随机回环端口之间恢复。Ubuntu x64 在 WSL2 Ubuntu 24.04 / WSLg 中运行通过。Android 使用 API 36 模拟器完成实际 App 升级、登录重启、主题与系统栏验收。**这不代表 Android 真机、实体 Ubuntu 桌面或 Ubuntu ARM64 完整 GUI 已验收通过。**

本轮完整回归经明确的失败修复和两项超时独立复验后，按唯一用例计为 **3580 通过、6 条件跳过**；没有一次单独的 3586 项全绿运行。历史失败和超时日志保留。

## 改动范围

- 日间、夜间和按本机 07:00–19:00 自动切换保留；淡白背景仍是新设备默认值。
- 调整登录、设置、语音、自动化/每日陪伴、Markdown、任务提醒、模型与权限弹层的语义色、文字/控件对比度及窄屏布局。
- Windows / Ubuntu 将主题偏好保存到原生用户目录，避免客户端每次使用不同回环端口后丢失外观选择。
- Android 启动画面、应用主题、安全区和系统栏与选择的日夜主题保持一致；不修改系统全局日夜模式。
- 保留 Chat / Agent、远程执行电脑、语音、官方账户认证、内置代理、桌面工具等现有功能。本次不把构建/界面测试等同于新的真实账户推理或电脑控制验收。

## 最终资产

以下哈希来自 `.data/release-0.9.14/acceptance.json`。正式发布和网络完整回读结果在最后一节补充。

| 平台 | 文件 | 字节 | SHA256 |
| --- | --- | ---: | --- |
| Windows x64 便携 EXE | PetPal-0.9.14-Windows-x64.exe | 252965926 | bb70f737867e6f3d3b37e2f765046e77aa4a137f432aefacffa8ffc146669f4b |
| Windows x64 ZIP | PetPal-0.9.14-Windows-x64.zip | 409686158 | 4cc3e8d624ea32f5b88657608ffe96cd4e9387f59df4aaf646356ed39ccb9f78 |
| Ubuntu x64 | PetPal-0.9.14-Ubuntu-x64.tar.gz | 381537255 | 66f3ef9dc689db8aa8d4b88cac722809f6c91ed16852704fa951b524d9d2cc98 |
| Ubuntu ARM64 | PetPal-0.9.14-Ubuntu-arm64.tar.gz | 373812483 | 45ec0896ad95d64f8b8ee539ca88f2536a8bb4222c78ec87d803df4f34f3956b |
| Android | PetPal-0.9.14-Android-debug.apk | 149465965 | 8f8e69fa3c5c4364a202df60cce74ce030d4019610bf5476b4eb2a9b65c18fc9 |
| Web | PetPal-0.9.14-Web.zip | 51007139 | cca0aee0495b0249a207ddbae679fd1c36c362658de6106ab5d7185d45f507af |

## 自动化测试与 Chrome

### 完整回归的实际记录

| 日志 | 总数 | 通过 | 失败 | 取消/超时 | 跳过 | 解释 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `.data/release-0.9.14/full-regression.log` | 3569 | 3488 | 75 | 0 | 6 | 最早回归；保留原始失败，不能作为发布通过证明。 |
| `.data/release-0.9.14/full-regression-final.log` | 3586 | 3573 | 6 | 1 | 6 | 中间回归，仍有失败/超时，保留原始日志。 |
| `.data/release-0.9.14/full-regression-bounded.log` | 3586 | 3578 | 0 | 2 | 6 | 后续完整回归；两项真实 CLI 审查测试各到 60 秒取消。 |
| `.data/release-0.9.14/native-review-rerun.log` | 10 | 9 | 0 | 0 | 1 | 原超时所在文件独立复验，包含原两项且通过；条件跳过不重复累计。 |
| `.data/release-0.9.14/workspace-fixture-regression-final.log` | 53 | 53 | 0 | 0 | 0 | 修复工作区测试夹具后的独立回归。 |

两项恢复的用例分别是 guardian 请求转发与 guardian 独立模型路由。按去重用例计算，最后覆盖为 3580 通过 / 6 条件跳过；不是将完整回归与所有子集次数相加，也不是单次全绿。

相关主题/权限/语音 80 项、Linux 闭包与隐私过滤 100 项、桌面主题 92 项、Windows 验证闭包 16 项的结果已记录于本轮 issue；这些与完整回归存在重叠，不额外累计成新的唯一用例总数。

Chrome 通过 Playwright CLI 检查实际页面：1366×900、412×960、360×640、393×852、960×412。设备设置在这些尺寸下 `scrollWidth=viewportWidth`；手机聊天、模型选择与权限弹层日夜主题通过，权限控件高度为 44px；刷新后选定主题保留。结果与截图哈希见 `.data/release-0.9.14/chrome-acceptance.json`。

本轮没有提交真实生产模型请求。模型选择 UI 和 Agent 模式入口可用，不能据此宣称真实 OpenAI 套餐推理、额度、音频硬件或外部软件操作均被重新验收。

## Windows x64

入口收据：`evidence/release-0.9.14/windows/windows-acceptance.json`，SHA256 `42d35fe1dca2822159f16fc2c6728633edd041697269897d45ccb16c1d433500`。

- 最终 EXE 经 NSIS→7z→payload→asar/unpacked 独立解包，5139 项成员与冻结输入比较，306 个前端文件一致；661 个冻结输入在 finalize 时保持不变。
- ZIP CRC 验证后独立解压，11112 个文件与 stage 比较；除 ZIP 专有 `START-HERE.txt` 外，ZIP 全部 payload 与最终 EXE 解包内容逐文件 SHA256 相同。
- 最终 EXE 与 ZIP 提取出的 `PetPal.exe` 都完成实际启动 smoke：登录门禁、本机后端、执行器 preload、内置 Codex 0.143.0 / OpenCLI 1.8.8、音乐只读状态、Cubism V12 双窗口、重载/旧偏好兼容与透明宠物验证通过。
- 首次 ZIP smoke 的可信指针动作等待超时；相同字节、全新隔离配置的复验通过。原失败目录 `windows-zip-smoke` 与通过目录 `windows-zip-smoke-retry1` 均保留。
- 正常启动以独立 APPDATA/CODEX_HOME、清除凭据环境和受限 PATH 执行，没有 `--smoke-test`。真实主题 radio 保存 night 后，ZIP 与 EXE 在同一隔离 profile、三个不同 origin 中恢复 native seed/DOM/磁盘 night；随后 portable 通过真实 radio 保存 day。证据在 `appearance-runtime-retry3` 与 `appearance-resumed`。
- 本轮测得 ZIP 解压后主窗口可验收约 1326ms、native ready 764ms；单文件 EXE 冷启动约 114496ms、native ready 1355ms。差异包含便携包装器解压开销，不能据此声称单文件 EXE 秒开，也不是通用性能保证。建议用户完整解压 ZIP 后运行 `PetPal.exe`。
- 正常主题验收结束采用精确自有 PID 树受控终止，清理后为 0；没有将此记录成正常窗口优雅退出。smoke 独立验证了应用退出。早期私有 QA 的 90 秒 readiness、程序化 radio 和 `window.close` 策略失败保留在 aggregate 的 retries 中。
- Authenticode 实查 `NotSigned`，未将 electron-builder 的 signing 日志当成商业代码签名。
- 全 payload 11112 文件 / 1029711191 字节扫描 4 份私有来源的 11 个实际敏感值，0 命中；只在内存比较，未保存或打印私有值。142 项许可/notice/关键来源核对通过，包含 Mihomo GPL 许可与 2 份对应源码归档。

未使用生产凭据、真实模型、真实代理、浏览器动作或音乐播放；没有重新测量麦克风、扬声器和摄像头实物能力。

## Android

入口收据：`evidence/theme-stable-release-20261021/android-acceptance.json`。最终 APK 为 0.9.14 / code26，minSdk23 / targetSdk35；306 个前端资源与 37 个原生 Java 源摘要一致，构建后产品源码未变。与 0.9.13 / code25 的签名集合一致，保持现有**开发签名**，不能称为新增商业发行签名。

Java 单测 51 通过；API36 原生 runtime 10 通过；实际 MainActivity 流程 8 个阶段通过：旧版 code25、覆盖升级恢复、night、night 重启恢复、day、最终登录恢复、退出登录、退出后清除。真实表单/控件、加密登录保险库、进程重启恢复与退出不复活会话均有收据。日夜界面和应用系统栏一致，系统全局 night mode 未改变。

**以上运行证据来自 Android API36 模拟器，不是荣耀 Magic7/Magic8、小米 17 Pro Max 或其他实体手机。** 未重新证明这些厂商 ROM 的省电白名单、闹钟/通知时效、后台唤醒、真实网络代理节点、ARM Mihomo 运行或系统浏览器官方授权回跳。ARM 原生代理库只完成归档检查；外部输入法主题不由应用控制。

本轮模拟器、隔离登录服务/端口与进程已清理，其他 AVD 保留，未触碰生产账户或执行生产 Agent 任务。早期合成/加载截图保留，未作为完成画面冒充验收。

## Ubuntu x64 / ARM64

入口收据：`releases/0.9.14/ubuntu/evidence/ubuntu-package-audit-final.json`；最终源码绑定见同目录 `ubuntu-source-binding.json`，绑定产品提交 `7b8f84f5b3962efaebbacb3d5af72cecdc790e59`，未重建或改写归档。

两架构各 13234 归档条目、11728 文件、306 前端资源、137 应用源码和 7 个 ELF；全文件分别读取 928654253 / 885528716 字节，与冻结 stage 比较哈希。466 项输入匹配，源码比较对文本 CRLF/LF 的归一化单独记账，二进制必须逐字节一致；70 项生成的前端资源绑定冻结构建字节，不声称重新复现 Vite 输出。

x64 最终包在 WSL2 Ubuntu24.04.4 / WSLg、UID1000 下真实解压启动，保持 Chromium sandbox。后端 0.9.14、执行器注册在线、Codex0.143.0、OpenCLI1.8.8、Mihomo1.19.32 合成代理启停、远程配置获取和回环/局域网直连通过；两个实际启动退出后自有进程为 0。该环境不是实体 Ubuntu22.04 桌面。

**ARM64 完整 Electron 桌面、OpenCLI 包装启动器和 GUI 未通过运行验收。** 独立 Ubuntu24.04 ARM64 / QEMU 用户态任务容器只证明直接包内 Codex binary 能输出0.143.0、Mihomo能输出1.19.32。Electron 内嵌 Node 在 2GiB 与 6GiB 限制下均触发 OOM（累计4次，包装 Codex/OpenCLI exit137），GUI exit133；没有加入 `--no-sandbox`、修改包或重配宿主 Docker 来掩盖失败。全部任务容器已清理，实体 ARM64 仍待验收。

两包各以 11 个真实敏感值做全文件扫描，0 命中；各 263 份 license/notice 与 29 项关键声明、Live2D Core/Framework/noVNC、Mihomo GPL/2 份对应源码完成原字节核对。首次裸 PEM marker 对合法库字符串误报的证据保留，最终使用完整 PEM 块和跨 chunk 检测重扫通过。

本轮未触碰 RK3566 硬件，不包含真实账户授权、模型推理、浏览器/音乐/电脑控制验收。

## Web 归档、后端部署与业务保留

`releases/0.9.14/web/PetPal-0.9.14-Web.zip` 的 306 条目全部解压、CRC 和逐文件冻结字节比较通过；11 个真实敏感值扫描与 Live2D 许可核对通过。证据为 `.data/release-0.9.14/web-audit/web-package-audit.json`。

网页/后端先独立部署，正式客户端 Release 在后续步骤完成。部署前后本机和公网 health 均返回 `ok=true, version=0.9.14`；157 项服务源码与 306 个新网页文件匹配，先合入带哈希静态资源、最后替换 index，没有清空现有下载目录。

业务保留证明：

- 部署前再次检查 Agent 运行/排队/未知状态、待汇报结果、流式消息、自动化运行及未来90秒到期任务，所有阻塞计数为0。
- canonical 业务摘要前后均为 `33d397af5c096ef1ddb233a8328c13713ea9910725445d8df7fbf20c38aad7b3`。保留字段包括用户、provider、会话、项目、附件、自动化、ASR/TTS/Codex配置和settings；会话令牌、设备在线状态、通知、更新信任等运行字段按既有规范排除，不能把业务摘要写成整个 state 文件逐字节未变。
- 计数保持：3用户、5 provider、54会话、0项目、1附件、0自动化任务。该值是本次部署收据快照，不是永久实时统计。
- 原 state/token/服务配置与附件、CosyVoice、已分配代理文件建立私有备份；原服务 guardian 配置摘要保持，新的服务身份已核对并被原 guardian 接管。
- 现有47个下载/更新文件在后端部署阶段全文件清单/哈希保持；seq15正式指针、旧包、已分配代理文件保持，授权代理配置本机/公网均可见1份。新资产的后续正式推广另外验收。
- 维护标记已按本轮所有权移除；原源码回退归档、旧静态资源前像与失败证据保留。没有回写旧业务数据。

主证据：`.data/release-0.9.14/backend-acceptance-final.json` 与它绑定的 `backend-deploy/run-20261021-014355-9eee5a395e344ffcba9ea9e3ac703cc4/success.json`、`baseline.json`、`guardian-finish.json`。隔离 QA 清理另见 `.data/release-0.9.14/qa-cleanup.json`。这些证据不等于对外部 Memobase 数据库另做了完整备份/恢复演练。

## 私有数据与发布准备

冻结产品提交前的 Git index 公共源扫描 `.data/release-0.9.14/source-audit-final.json`：1680 文件 / 272381293 字节，pass=true，issues为空。测试中的合成凭据使用显式逐文件 allowlist，真实密钥、账号密码、数据库与运行日志不提交。包内私有值全量扫描、许可检查和各架构来源由四端 aggregate 绑定。发布文档暂存后的独立扫描见 `source-audit-published-docs.json`。

GitHub 与服务器两份升级 envelope 已准备并签名，序列均为16，沿用各自已有公钥；六资产冻结摘要已准备，后端升级不改包。`prepared/receipts/signed.json` 与 `server-staged.json` 显示准备/暂存通过，暂存时 `latestCatalogChanged=false`、`latestUpdateChanged=false`。

阶段性服务器验证只证明 signed-update 资产完整回读及本地下载文件匹配；`prepared/receipts/server-readback.json` 的 `fullByteReadback=false`，六个 canonical下载URL当时因catalog未推广而明确延后。Windows ZIP另有一次完整HTTPS回读，见 `server-extra-zip-readback.json`。**不能在此阶段写成六个正式下载URL全部完整回读通过。**

## 正式发布完成记录

- [唯一 CI 39469583282](https://github.com/lixinyu02/petpal/actions/runs/39469583282) 首次运行成功；传输分支提交为 `87d7e757f53620082c68806e19fe57ac3238c890`。该任务只传输冻结字节，不构建或执行客户端；没有重新运行或重复上传。六包各一次上传、48 个镜像分片、四份既有元数据 ID 保持，十个 GitHub response body 全量哈希和磁盘二次哈希全部通过。
- 正式版本：[v0.9.14](https://github.com/lixinyu02/petpal/releases/tag/v0.9.14)，Release ID `418674946`。发布后 fresh API 确认 `draft=false`、`prerelease=false`、latest 为 v0.9.14；十资产的 ID、字节数、digest 保持。产品 tag 仍是 `7b8f84f5b3962efaebbacb3d5af72cecdc790e59`，发布验收文档随后提交到 main，不移动该 tag。
- 官网：[https://magicdatou.top:44318](https://magicdatou.top:44318)。本机及公网的后端 health、Web version 均为 0.9.14，Web index 与冻结构建字节一致；匿名下载 API 返回401。登录后下载 API 只列五个 0.9.14 客户端包（Windows EXE/ZIP、Ubuntu x64/ARM64、Android），服务器来源，Windows ZIP 优先，不列旧版本；Web 构建包另保留在正式资产中。
- 服务器正式 catalog 与 sequence16 签名清单推广成功，旧 sequence15 envelope 留档。GitHub与服务器两源升级清单均验证签名、五个 target/版本和原公钥指纹；序列由15提升为16。原信任身份不变：GitHub `5e649530901ba590d7ed894e74c3f77e29f34e0ca0ac4c5a5bfe1dfefa300d6c`，服务器 `1841fdaf57bb74769dc94049d07fc79d675f29c4633f156c3b1ec65781f8d5d3`。
- 六个 canonical 服务器下载 URL 在推广后开启 TLS 验证、禁止重定向并完整下载，字节数与 SHA256 逐项匹配上表；加上五条升级包下载流共11条。最终 `server-full-readback.json` 为 `passed=true, fullByteReadback=true, tlsValidationEnabled=true`，SHA256 `09c02f75d6cc54bfa231f25e23c835b8d2b5a42d0442b60301a9e95c794c0179`。
- 最终只读保留复核确认业务摘要仍为 `33d397af5c096ef1ddb233a8328c13713ea9910725445d8df7fbf20c38aad7b3`，3用户/5 provider/54会话/1附件保持；46个既有下载文件逐字节哈希、1个已分配代理文件保持。旧下载中唯一预期变动是 `updates/petpal-update.json` 由seq15推进seq16；没有回写旧业务数据，没有声称外部 Memobase 备份恢复演练。此只读辅助脚本首次遇到 PowerShell 单对象 JSON 形式，规范化后复验通过，错误记录保留，未修改生产状态。
- 维护标记不存在，原 guardian 持续接管新服务；QA 与原有精确归属的临时上传进程清理收据保留。唯一云端传输任务已完成，最终公网回读命令只运行一次且exit0；未关闭生产服务或无关进程。

正式发布证据（相对于 `.data/release-0.9.14/`）：

| 收据 | 结论 |
| --- | --- |
| `github-draft-full-byte-readback.json` | 发布前十资产完整回读，SHA256 `382f24e61b48359df01fdbf5aa069e1f0fcf41bb7300f62c03ab9b342efce1ca`。 |
| `transfer-source/run-39469583282/proof-summary.json` | 唯一 CI 的十资产详细证据，SHA256 `ad6553fccb42e15c2d82b8d896aae328c7d67560b0fbaf2a7759035ba8751026`。 |
| `github-publication.json` | 最新正式 Release 身份、发布说明、产品 tag 与十资产保持。 |
| `prepared/receipts/server-promotion.json` | 正式 catalog/更新指针推进至0.9.14/seq16。 |
| `prepared/receipts/server-full-readback.json` | 十一条服务器完整回读，含六条 canonical 下载。 |
| `prepared/receipts/published-catalog-readback.json` | 本机/公网下载 API 仅列最新正式客户端，使用服务器下载地址。 |
| `final-online-acceptance.json` | 本机/公网网页、后端、两源签名、GitHub latest、tag与维护标记验收通过。 |
| `final-retention.json` | 最终业务/代理配置及旧下载保留复核。 |

issue-1 已完成，产品实现提交 `7b8f84f5b3962efaebbacb3d5af72cecdc790e59`。Android真机、实体Ubuntu和ARM64完整GUI的验收边界仍保留，正式发布没有将它们改写为通过。
