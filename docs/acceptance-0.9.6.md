# PetPal 0.9.6 安装包验收

日期：2026-10-01。issue-70 构建与识图；issue-71 公共发布。发布进度见 [任务记录](workflow/2026-10-01-petpal-release-096-issues.md)。

## 本版内容

重打 Android、Windows x64、Ubuntu x64/ARM64，包含最新项目目录、Qwen 累计分段 Responses 兼容、图片附件、Chat 派发 Agent、电脑/音乐/OpenCLI 能力与 Android 后台通知及 OEM 设置入口。

Agent 与 Chat + Agent 可指定执行电脑上的现有绝对路径；同项目续接、切项目开新原生线程。执行、排队和不确定状态保留目录快照。详见 [项目目录](agent-project-directory.md)。Qwen 图片入口已启用，显式禁图的其他模型配置仍保持。

## 实际 Qwen 识图

使用两条现有 Qwen Responses 连接和 Windows 0.9.6 包内 Codex 0.143.0：两条 Chat、中央只读 Agent、selected DesktopExecutor 共四次任务均 completed，正确回答自建图片的“左蓝、中黄、右紫，中间黄色块下部黑色圆形”。预期答案未进入 prompt；原生 Agent 输入实际为 text + localImage，没有执行终端、电脑、音乐或网页工具。

上传、回取和实际调用在隔离后端完成，HTTP 上传 201、回取字节一致；真实公网只检查 Qwen 图片能力并退出独立登录。生产原会话、暂停队列、账号、provider/Codex 配置、主机和附件保持，临时图片、后台、执行器和 runtime 已清理。第一次自动词汇断言漏掉正确答复中的“低于”，保留原记录并只做语义复核，没有重试任务或增加模型请求。

图片定向回归 19/19，打包来源、原生资产、下载目录与更新源定向回归 76/76 通过。此次两条实际 Chat 连接均为 Responses；Chat Completions 的图片链路为回归覆盖，不混称当前上游实测。

## 安装包

| 文件 | bytes | SHA-256 |
| --- | ---: | --- |
| PetPal-0.9.6-Windows-x64.exe | 200440982 | 0d707ff2b5b1e65663a7290b13670a120beeb4b67c9a3290f204a44e7176c1c0 |
| PetPal-0.9.6-Windows-x64.zip | 332412131 | 14c8f362c375a7ac8aadf1cdedfdab8b32daf93375866c3d3864e87805f8076f |
| PetPal-0.9.6-Ubuntu-x64.tar.gz | 303044888 | 88e41206a30d6162af0e2850db616ea2152b4a428368aecaa447fcbeebc9ba63 |
| PetPal-0.9.6-Ubuntu-arm64.tar.gz | 297239600 | 901ea1e1bad82b95b8279af9a1ece83bd6af449e6b40eec62d61d821f2ea9b94 |
| PetPal-0.9.6-Android-debug.apk | 19399468 | 19e33b37845d1b6b0dac780bbd9cc284d4746d7ec04425debe689a3ae0ba6b6e |
| PetPal-0.9.6-Web.zip | 15195928 | 4844ced47759350edbdd52ef09f1444009b41cea51c3616d7130adc3892ef755 |

Windows 推荐完整 ZIP 解压到新目录后运行 PetPal.exe；不可只移动 EXE。便携 EXE 每次展开仍需时间，本版保持独立解压目录与启动提示。两种包不需要用户另装 Node/Codex/OpenCLI。实际 Authenticode 为 NotSigned；不能宣称受信任发布者签名或所有安全软件环境都已验收。

最终 EXE 已解出并核对 4791 文件、30 个冻结网页资产及新增项目目录/消息分段模块；实际启动 UIReady、health 0.9.6、执行器 online、OpenCLI 1.8.8 与头像/透明窗口通过，所属进程清理完成。ZIP 完整解码 10833 文件 / 905694824 字节，逐文件与冻结目录相同，其中 10832 个 runtime 文件与 EXE 实际 payload 相同；中文空格目录的 PetPal.exe 实际启动通过，所属进程为 0。包内 Codex --version 实际为 0.143.0，音乐/Computer Use/OpenCLI 许可齐全，私密扫描无已知凭据命中。

Android versionCode 16，沿用 0.9.3 的开发证书，v1/v2 有效。473 条归档完整读取，30 个网页资源和两个 Capacitor 桥字节一致；项目目录、图片入口、后台通知、固定 OEM 入口及更新器类在包。无 CLI/server、测试 fixture 或已知私密值。没有连接 Android 真机或模拟器，本轮不宣称系统安装/通知/麦克风设备验收。

Ubuntu 两包各 12529 tar 条目完整读取，并与 staged payload 逐文件比较；两次独立 linux-verify、CLI/Electron/Computer Use native 与来源门禁通过。ELF 架构 x64=62 / ARM64=183，native 要求 GLIBC 2.34；OpenCLI 必需运行文件与 query 导入闭包、每架构 11112 文件私密扫描通过。Docker Engine 当前不可用，本轮未新增 Ubuntu CLI/GUI 运行时测试，也不代表 RK3566 已安装或验收。网易云上游 MCP 仅支持 Windows；Ubuntu 桌面播放使用已有 MPRIS 路径。

## 构建与证据

全程使用独立构建目录，线上 dist/downloads 与历史包不作为临时输出。Web ZIP 从 canonical 0.9.6 bundle 生成，30 个文件完整字节读回一致。初次 Web ZIP 的 cwd 相对输出误放进新建临时子目录，已保留该 ZIP 到 ignored evidence、移除空目录并在绝对发布路径重建；没有改变生产网页或安装包。

本机证据在 ignored evidence/repackage-096-20261001：vision-live-result.json、vision-targeted-tests.txt、android-apk-audit.json、ubuntu-delivery.json、web-archive-audit.json 与 Windows 本轮审核回执。生产凭据只在内存用于扫描和请求，不进入公共源码、安装包或公开报告。

公开源码审核 634 文件通过。本轮将两条项目目录测试 fixture 的固定假密码改为随机 UUID、示例个人目录改为 Projects 路径，避免被公开源码规则误识别；没有放宽扫描规则或改变应用运行代码。调整后的 27 项项目目录回归全部通过，暂存变更的已知私密值扫描与 whitespace 检查通过。

## 正式发布与两种更新源

0.9.6 已正式公开发布：[GitHub Release](https://github.com/lixinyu02/petpal/releases/tag/v0.9.6)，release ID `400860804`，draft=false、prerelease=false，latest 为 v0.9.6。冻结包和发布标签来源为 `eaae5322566c915b06070e7248f1770470cdd197`；后续文档提交不改变这批包的来源。服务器下载与签名更新源也已上线。内部 preview 准备记录和清单快照保留，转 stable 时仅替换草稿中的本轮发布元数据，没有重建或改写六个冻结包。

GitHub 与服务器两份清单均为 stable / sequence 8，覆盖 windows-x64、ubuntu-x64、ubuntu-arm64、android、web 五个目标；Windows 更新目标使用便携 EXE，ZIP 为额外下载资产。全部目标为 0.9.6，Android versionCode 16，长度和 SHA-256 对应本页冻结包。两种来源各自沿用旧签名身份，不互换公钥：GitHub 指纹为 `5e649530901ba590d7ed894e74c3f77e29f34e0ca0ac4c5a5bfe1dfefa300d6c`；服务器指纹为 `1841fdaf57bb74769dc94049d07fc79d675f29c4633f156c3b1ec65781f8d5d3`。Ed25519 清单签名不改变 Android 开发证书或 Windows NotSigned 状态。

服务器源为 `https://magicdatou.top:44318/downloads/updates/petpal-update.json`。已验证可信 TLS、签名、五目标版本/sequence/code16/包摘要及公网资产状态；旧资产大小/mtime和来源选择保留。实际部署的 30 个网页资源与冻结 0.9.6 bundle 相同，HTTPS 页面读回匹配。受控重启时 state/token 字节保持，原 2 个账号、5 个提供商、31 个会话和 1 条暂停队列保持；随后更新验收只推进预期的更新信任 sequence，没有改变原模型、账号或任务配置。语音、ASR、更新和 Codex 受保护接口的匿名请求均为 401。

修复了服务器公开 `update-public.pem` 缺失、链接返回 SPA HTML 的问题：只补发原公钥，指纹不变，未生成新密钥或修改生产来源配置。初次发布在公钥验签处停止，清单仍为 sequence7；已对独立暂存的五包重新核对完整哈希和 HTTPS 长度，再以旧清单/配置/防回滚高水位门禁原子推广 sequence8。Chrome 软件更新检查已显示当前 0.9.6 为最新；实际 CSS 412×960 下 document 宽度与 scrollWidth 均为412。

隔离 DesktopUpdateManager 从服务器源检查 0.9.5 → 0.9.6 并实际完整下载 Windows EXE：200440982 bytes，SHA-256 `0d707ff2b5b1e65663a7290b13670a120beeb4b67c9a3290f204a44e7176c1c0`。流式摘要和缓存文件独立重算均一致，无残留 partial，管理器与服务已关闭。此验收使用应用的更新下载路径和隔离 store/cache，未访问生产 state，没有调用安装、启动下载 EXE 或完成更新交接；其余目标的更新检查不能代替实际系统安装验收。

GitHub 验收通过：Windows EXE/ZIP、Ubuntu x64/ARM64 四个大包均完成服务器镜像与 GitHub 完整字节读回；Android APK、Web ZIP、release-manifest.json、SHA256SUMS.txt、petpal-update.json 和公钥六项完成直接完整读回。十项资产的官方 digest、长度和 SHA-256 一致，正式公开前后 asset ID/长度/digest 保持；v0.9.6 标签固定指向冻结提交。GitHub 原公钥完整读回与指纹一致，两源五目标从 0.9.5 检查均返回 0.9.6 / sequence8，当前 0.9.6 Web 返回无更新。

Windows ZIP 首次大包传输 run `36850939626` 在 16 分钟公网读取期限内未完成，失败发生在资产 POST 之前。保留原失败证据后，仅将镜像读取期限延长至 32 分钟、job 延长至 40 分钟并增加进度记录；恢复沿固定 Actions pins 与 concurrency 顺序 fast-forward，没有 force。四个大包最终成功 run 分别为 `36849810429`、`36853949762`、`36855488619`、`36857054445`。服务器旧资产仅验证 size/mtime 保持，不据此声称全部旧资产做过前后全字节哈希比较。

Chrome 登录下载页验收通过：Android、Windows、Ubuntu 三个卡片默认选择 0.9.6 稳定版；实际切换 Windows ZIP/EXE 和 Ubuntu x64/ARM64，并核对五包版本、平台、真实 GitHub URL、安装文案与冻结 SHA-256。实际 CSS 412×960 下 document/client/scrollWidth 均为412，没有横向溢出。下载中心没有 Web 卡片，Web ZIP 依据 GitHub 资产读回验收。验收后通过界面退出本轮 test 登录、恢复 viewport 并关闭本轮标签；未更改模型、历史或暂停队列。

## Windows 重复启动与验收边界

两种 Windows 包各完成一次完整原生 smoke，再使用独立 profile 各连续启动两次，同一包的两次启动复用自己的隔离 profile。四次 startup-only 均 exit0，health 0.9.6、登录门禁、执行电脑 online、包内 Codex 可用和 OpenCLI 1.8.8 正常；最后本轮所属进程为 0。ZIP 运行路径实际含中文和空格，两种正式包的首页截图均已视觉检查。该验收没有真实模型请求、播放音乐或控制其他软件。

便携 EXE 两次 wrapper 生命周期为 142.572 / 140.554 秒，ZIP 为 7.326 / 7.491 秒；数字包含展开、应用运行和退出清理，不能当作纯 UI 启动耗时。初次重复启动 harness 的 120 秒窗口在应用已完成 startup smoke 后因 NSIS 清理而超时；保留原诊断，将窗口改为 300 秒后两次均通过，没有为此修改产品。旧 PowerShell 5.1 校验工具的 UTF-8/JSON 序列化差异也保留，已用 PowerShell 7 验证同一份完成的运行结果。

Windows 运行环境为 Windows 11 x64 build26200，未增加 Windows10、其他实体电脑或安全软件矩阵验收。Ubuntu 本轮仅完整归档、架构与依赖审核，Android 仅版本、同开发证书、全部资源/dex与私密扫描；没有 Ubuntu GUI、Android 手机或模拟器的本轮安装/通知/麦克风实测。Windows 未签名、Android 开发签名及上述运行边界不因正式 stable 发布而改变。

新增脱敏证据位于 ignored `evidence/repackage-096-20261001`：`server-stable-publication.json`、`live-server-updates.json`、`live-github-updates.json`、`server-desktop-live-download.json`、`deployment.json`、`windows-acceptance-summary.json`、`windows-exe-repeat-startup.json`、`windows-zip-repeat-startup.json`、`large-transfer-delivery.json`、`chrome-downloads-096.json`、`public-downloads-096-dom.txt`、`public-downloads-096-412x960.png` 和 `chrome-cleanup-096.json`；GitHub 最终回执为 `actions-transfer-recovery/github-published-verification.json` 与同目录 `direct-draft-cloud-verification.json`。
