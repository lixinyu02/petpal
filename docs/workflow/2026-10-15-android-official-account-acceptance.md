# Android 官方账号与 0.9.12 验收

- Date: 2026-10-16
- Version: 0.9.12 / Android versionCode 22
- Implementation: `11d6b0c`
- Scope: Android 本机官方账号、应用内代理、共享后端，以及四端正式客户端。

## 功能与测试

Android 使用系统浏览器完成 SIWC、原生 Keystore 保存凭据；官方 token 不传给中央后端或远程电脑。手机模型通过按用户隔离的临时 relay 进入 Chat、语音、图片和远程 Agent。手机仍不提供本地 Codex CLI。

应用内 Mihomo 1.19.32 提供 ARM64、ARMv7、x86_64 核心、对应源码及许可。代理要求 Android 14+ 与兼容的 System WebView，不申请 VPN；外部系统浏览器授权页面仍需要浏览器自身网络可达。官方模型目录、登录状态、实际推理和套餐余额是不同状态，页面不把实际 Token 累计冒充套餐余量。

| 验证范围 | 结果与边界 |
| --- | --- |
| Node 组合回归 | 114 文件覆盖：1420 通过、1 项既有跳过。初次失败与超时保留；修复 App 测试导入后 52 项重跑通过，guardian 原超时夹具独立重跑通过。 |
| 手机 relay | 13/13，覆盖 Chat、图片、工具、远程 PC Agent 与独立审查模型，OAuth 不跨边界。 |
| Android bridge / 共享设置 | 19/19。 |
| 代理与包检查 | 17/17，含 AAPT 对 `.gz` 的自动处理修正。 |
| Java 单元 | 77/77。 |
| Android 原生仪器 | API 36 x86_64 模拟器 9/9：真实回环监听、Keystore、合成官方 HTTPS 上游、刷新与隔离、流式分块、取消，以及实际安装的 Mihomo 进程与代理路由。 |
| TypeScript / Vite | 通过。 |

## 安装包

六个正式资产为 Android APK、Windows x64 EXE/ZIP、Ubuntu x64/ARM64 tar.gz 和 Web ZIP。最终资产字节数及 SHA-256 由发布清单绑定；完整证据保存在本机构建目录，不公开真实运行数据。

- Android：738 个 ZIP 条目全部 CRC/字节读取，286 个冻结 Web 文件精确比对，26 个原生类、三种核心、源码及许可核验通过。与已发布 0.9.11 的签名集合相同，旧版安装后覆盖到新版成功，合成私有文件保持；模拟器实际冷启动并显示登录页。APK 延续现有开发证书签名，并未冒称另有正式密钥。
- Ubuntu：每包 13,106 条目、11,617 文件逐字节哈希对照冻结输入，两个架构各 7 个 ELF、依赖闭包与许可通过。最终 x64 包在 WSL2 Ubuntu 24.04 / WSLg 普通用户运行，Chromium sandbox 保持启用，后端健康、执行器在线、内置 Codex 0.143.0 / OpenCLI 1.8.8 与合成代理启停验证通过。ARM64 仅完成归档、架构和完整文件核验。
- Web：286 项全字节、CRC 和冻结构建比对，已知私有值扫描及 Cubism 许可通知保留检查通过。
- Windows：最终 EXE 独立解包后比对 5,089 份源码与 286 份 Web 文件；ZIP 的 11,049 条目完整解码，11,048 份实际文件与 EXE payload 完全相同。两种包均实际启动，ZIP 在含中文和空格的目录连续两次启动通过；本地服务、Codex 0.143.0、OpenCLI 1.8.8、Computer Use 原生模块及 Mihomo 版本/配置检查通过，自有进程退出后无残留。18 项已知私有值对完整 payload 扫描无命中。Windows Authenticode 状态为 NotSigned；不冒称有代码签名证书。

## 验收边界

本轮没有连接小米 ARM64 真机，没有完成真实 Android OpenAI 授权或套餐推理；模拟器的合成上游测试不能替代这些步骤。Ubuntu x64 是 WSLg 验证，未在物理 Ubuntu 桌面或 ARM64 板上运行。Windows/Ubuntu 的本次包验收不等于重新授权真实账号或播放真实音乐。所有生产更新必须保留既有账号、会话、附件与配置。

## 发布

GitHub 正式版本目标为 [v0.9.12](https://github.com/lixinyu02/petpal/releases/tag/v0.9.12)，服务器优先下载及两源升级清单使用相同六包哈希，签名更新序列为 14。最终上线状态记录在对应 issues 与发布回执中。
