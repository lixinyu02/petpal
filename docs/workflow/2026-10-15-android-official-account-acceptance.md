# Android 官方账号与 0.9.12 验收

- Date: 2026-10-16
- Version: 0.9.12 / Android versionCode 22
- Implementation: `11d6b0c`
- Release source: `88bc8ca842e776eb7d6a5e80b3b98e3847823e09`
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

已于 2026-10-16（Asia/Shanghai）正式发布 [v0.9.12](https://github.com/lixinyu02/petpal/releases/tag/v0.9.12)，非草稿、非预览、GitHub latest。标签固定到发布源 `88bc8ca`，六个安装包与四个配套文件全部齐全。

本机大包上传遇到连接超时及 HTTP 408，失败记录和未完成资产对账均保留，未把部分上传标为成功。后改用独立分支 `release-transfer-v0.9.12` 的受限字节转发工作流；[run 38778129853](https://github.com/lixinyu02/petpal/actions/runs/38778129853) 首次运行成功，只从固定 HTTPS 镜像读取六包、核 SHA 后上传，不执行安装包、不重新构建或签名、不自行发布。十个资产共 1,616,688,523 字节完成 GitHub API/CDN 整体读取与落盘哈希验证；独立验收将日志、工作流源码、固定计划、根门禁与资产 ID/大小/摘要绑定，正式发布后再次核实 latest、标签及同一资产集合。

中央网页和后端已上线 0.9.12，本机及公网健康、匿名手机 relay 的 401 门禁通过。首次切换的业务哈希断言发现旧会话规范化差异：仅 16 个 Agent 会话补齐 `queueRevision: 0` 并更新对应 revision。对切换前备份执行纯内存规范化后，与当前业务字段哈希完全一致，二次规范化没有变化；消息、账号、权限、模型配置和附件保持。保留原失败回执及独立解释，没有回写旧业务数据。维护标记已清除，守护进程实际恢复监控，隧道和 Caddy 未改动。

服务器目录只展示最新正式客户端，优先提供同站下载，GitHub 为备用。5 个签名更新地址及 6 个正式下载地址共 11 条 HTTPS 流、2,824,089,175 字节完成全量 SHA 核验；额外提供给转发工作流的 Windows ZIP 有单独完整证明。两源签名升级序列均为 14、覆盖五个目标，Android versionCode 22；继续使用已有信任锚。Web ZIP 保留在发布资产中，按既有设计不列入原生客户端下载选择器。

Chrome 验收确认切换后登录会话保持，设置页版本为 0.9.12，下载页仅提供最新正式版并标明服务器直连。最终本地回执位于 `evidence/release-0912-github-final/` 与 `.data/release-0.9.12/prepared/receipts/`，不发布真实运行数据。
