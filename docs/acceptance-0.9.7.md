# PetPal 0.9.7 客户端验收

日期：2026-10-03。构建与正式发布验收完成。GitHub latest=v0.9.7，两源 stable/sequence9，服务器历史文件私有归档、归档后 HTTP 与下载页验收通过。

## 本版内容

封装截至本轮的 Cubism V11 连续五官模型、原生虹膜遮罩、头部和合手区域互动、语音倾听及平滑动作过渡，以及已完成的桌面助手、项目目录、Qwen 图片、OpenCLI、电脑/音乐与 Android 后台提醒能力。模型没有在本轮重做。

下载中心只显示全局最新正式数字版本。同版 Windows EXE/ZIP、Ubuntu x64/ARM64 保留，不按平台回填旧版或预览版。已归档的服务器下载返回 404，不回落到首页 HTML。

## 构建验证

- 306 项 Cubism、动作、桌面启动、打包与更新回归通过；下载 API/UI/真实 HTTP 的 16 项回归通过；TypeScript 与独立 Vite 构建通过。
- Windows EXE/ZIP 均实际启动，账号登录门禁、本机后端 0.9.7、执行端 online、Codex 0.143.0、OpenCLI 1.8.8 与透明伙伴窗口通过。两个窗口实际显示 native Cubism V11，Core 6.0.1 / MOC 5，图片截图可核对。点击、双击、休息/唤醒及默认关闭小猫的设置回归通过，所属进程退出后为 0。
- EXE 4985 个应用成员与冻结源核对；ZIP 10837 个文件完整读回，与 EXE runtime 对照。Windows 未做 Authenticode 签名，完整 ZIP 解压后启动仍为推荐方式。
- Android versionCode 17，v1/v2 签名有效且证书与 0.9.6 相同。663 条 ZIP 记录的 CRC/长度完整验证，220 个网页文件逐个匹配；从 APK 实际读取 Core/V11 检查原生参数及遮罩。通知/OEM/更新类齐全，没有 CLI/server 或已知私有值。当前未连接 Android 真机/模拟器。
- Ubuntu 每架构 11306 文件完整 tar 流读回、ELF/GLIBC 2.34、Codex/OpenCLI/Computer Use 依赖来源、许可和隐私扫描通过。OpenCLI 118 文件、217 import 边闭包通过。仅包与宿主侧 Core 验证，未新增 Ubuntu GUI 运行验收；网易云原生 MCP 仍依照既有平台能力限 Windows。
- 本次冻结的六个发布包（含 Web ZIP）内置默认 V11，MOC SHA-256 为 `a193b01b60f3238fee982b558bc56a67e834dc2d3f0039a501ae423b8e21d5dd`。Web ZIP 与 canonical 构建 220 个文件完整逐字节对应。

## 包摘要

| 文件 | bytes | SHA-256 |
| --- | ---: | --- |
| PetPal-0.9.7-Windows-x64.exe | 220844505 | bc14d7717b510df8e57f3d16297f814283e5ce2c4f26151d5d14b51c9326a994 |
| PetPal-0.9.7-Windows-x64.zip | 369541847 | bd3da59480ea1ed549ca99a1adceab36d02bee438b10328f764815aaea055cdc |
| PetPal-0.9.7-Ubuntu-x64.tar.gz | 340216882 | f7e74bfcc652335198d5766cad6699b830e70e85f0871b43024086efc33d1242 |
| PetPal-0.9.7-Ubuntu-arm64.tar.gz | 334415149 | 31a44e86b1737a5de46c02a10a109f3028a4c3e43e4ae2dd2c53b6294b0b36e6 |
| PetPal-0.9.7-Android-debug.apk | 57059315 | 8c4884aaaf9e630ee081e1e9e913384ecadac2583c0a553ccd684c4b21bc01ca |

## 证据边界

完整本机证据位于 ignored `evidence/release-097-20261003/`。Windows smoke 使用新隔离 profile，真实加载当前 MOC；Core 版本另在结果与包审核中确认。资源历史的 V11 路径检测不单独作为模型身份结论。没有调用真实模型任务、播放音乐或操作用户桌面软件。

封包均使用独立目录，不把生产 dist 用作构建输出。网页 ZIP 准备时产生的无文件临时目录留在隔离构建路径，最终 ZIP 明确排除它；初始 ZIP 保留在 ignored 证据，运行文件字节未变。

## 发布后网页修复

冻结安装包保持 V11 和表中原摘要。之后完成的 V12 自然眼睑与 TapHead 修复仅上线 Web，详见 [眨眼修复验收](cubism/akari-natural-eyelids-acceptance.md)，没有用相同版本名替换发布字节。
