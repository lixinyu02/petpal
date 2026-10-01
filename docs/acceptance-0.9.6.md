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

Windows 推荐完整 ZIP 解压到新目录后运行 PetPal.exe；不可只移动 EXE。便携 EXE 每次展开仍需时间，本版保持独立解压目录与启动提示。两种包不需要用户另装 Node/Codex/OpenCLI。实际 Authenticode 为 NotSigned；不能宣称受信任发布者签名或所有安全软件环境都已验收。

最终 EXE 已解出并核对 4791 文件、30 个冻结网页资产及新增项目目录/消息分段模块；实际启动 UIReady、health 0.9.6、执行器 online、OpenCLI 1.8.8 与头像/透明窗口通过，所属进程清理完成。ZIP 完整解码 10833 文件 / 905694824 字节，逐文件与冻结目录相同，其中 10832 个 runtime 文件与 EXE 实际 payload 相同；中文空格目录的 PetPal.exe 实际启动通过，所属进程为 0。包内 Codex --version 实际为 0.143.0，音乐/Computer Use/OpenCLI 许可齐全，私密扫描无已知凭据命中。

Android versionCode 16，沿用 0.9.3 的开发证书，v1/v2 有效。473 条归档完整读取，30 个网页资源和两个 Capacitor 桥字节一致；项目目录、图片入口、后台通知、固定 OEM 入口及更新器类在包。无 CLI/server、测试 fixture 或已知私密值。没有连接 Android 真机或模拟器，本轮不宣称系统安装/通知/麦克风设备验收。

Ubuntu 两包各 12529 tar 条目完整读取，并与 staged payload 逐文件比较；两次独立 linux-verify、CLI/Electron/Computer Use native 与来源门禁通过。ELF 架构 x64=62 / ARM64=183，native 要求 GLIBC 2.34；OpenCLI 必需运行文件与 query 导入闭包、每架构 11112 文件私密扫描通过。Docker Engine 当前不可用，本轮未新增 Ubuntu CLI/GUI 运行时测试，也不代表 RK3566 已安装或验收。网易云上游 MCP 仅支持 Windows；Ubuntu 桌面播放使用已有 MPRIS 路径。

## 构建与证据

全程使用独立构建目录，线上 dist/downloads 与历史包不作为临时输出。Web ZIP 从 canonical 0.9.6 bundle 生成，30 个文件完整字节读回一致。初次 Web ZIP 的 cwd 相对输出误放进新建临时子目录，已保留该 ZIP 到 ignored evidence、移除空目录并在绝对发布路径重建；没有改变生产网页或安装包。

本机证据在 ignored evidence/repackage-096-20261001：vision-live-result.json、vision-targeted-tests.txt、android-apk-audit.json、ubuntu-delivery.json、web-archive-audit.json 与 Windows 本轮审核回执。生产凭据只在内存用于扫描和请求，不进入公共源码、安装包或公开报告。

公开源码审核 634 文件通过。本轮将两条项目目录测试 fixture 的固定假密码改为随机 UUID、示例个人目录改为 Projects 路径，避免被公开源码规则误识别；没有放宽扫描规则或改变应用运行代码。调整后的 27 项项目目录回归全部通过，暂存变更的已知私密值扫描与 whitespace 检查通过。
