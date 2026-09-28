# 小伴 PetPal 0.1.0 交付与验收

2026-09-26。源码目录：`petpal/`。现有 RK3566 固件、开发板及 Codex Remote 原项目未修改。

## 动画与入口

- 实际 Web 服务：`http://127.0.0.1:4318`，当前浏览器已经配对。
- 可播放/暂停的四动作预览：`http://127.0.0.1:4318/?animations=1`。
- 动图：`outputs/animations/kitten-motions.gif`；另有 wave/jump/cuddle/sleep 四个独立 GIF。
- 角色由内置 ImageGen 生成，再做逐帧动画合成；完整 prompt 和命令记录在 `outputs/animations/prompt-receipt.md`、`render-receipt.json`。

## 平台产物

| 平台 | 文件 / 运行方式 | 验收边界 |
| --- | --- | --- |
| Web | `npm ci && npm run build && npm start`；生产资源 `dist/` | Chrome 已验证桌面和手机宽度、两协议配置与聊天、停止、错误、历史、个性设置、动画播放/暂停 |
| Windows x64 | `releases/desktop/PetPal-0.1.0-Windows-x64.exe` | 最终便携程序实际启动；完整界面、内置 CLI 启动/登录状态/退出回收、透明置顶窗口与包内动画字节检查全部通过 |
| Android | `releases/android/PetPal-debug.apk` | Debug APK 编译、签名验证、包/权限/native classes/共享图集检查；未安装到设备或模拟器 |
| Ubuntu x64 | `releases/ubuntu/PetPal-0.1.0-Ubuntu-x64.tar.gz` | 完整 Electron＋原生 CLI；Linux ELF 架构、tar 可执行权限、依赖完整性、前端字节一致性通过；未运行 Ubuntu GUI |
| Ubuntu ARM64 | `releases/ubuntu/PetPal-0.1.0-Ubuntu-arm64.tar.gz` | ARM64 Electron＋原生 CLI，同上；没有 RK3566 实板运行证据 |

Ubuntu 解压后运行 `./start-petpal.sh`；使用 `./codex.sh login` 登录内置 CLI。普通用户运行，不需要 Node 全局安装。Linux 环境依赖及构建说明见 `docs/linux-packaging.md`。本机普通 WSL Ubuntu 的既有 VHDX 缺失，故没有用其他专用系统替代运行验收。没有绕过 Electron 沙箱。

## 已执行验证

- Web TypeScript / Vite 生产构建通过。
- `npm test`：**34 passed / 0 failed / 0 skipped**。覆盖提供商流协议、鉴权/来源限制、配置脱敏、取消、断流持久化、重启恢复、Codex 请求/审批/退出和内置二进制发现。
- Windows **真实 Codex CLI 0.143.0**：单次只读模型请求，19.312 秒返回精确 `PETPAL_CODEX_OK`，工作区没有创建文件，进程回收成功。见 `evidence/codex-live.json`。
- Chrome 插件验收：Chat Completions 和 Responses 使用本地隔离 HTTP fixture；这是 UI/协议证据，不是第三方供应商或收费模型验收。见 `evidence/browser-acceptance.json`。
- 动画图集 1280×1280 RGBA，4×4 单格 320；四动作 GIF 均可循环，合成 GIF 12 帧。角色主体保持一致，帧顶部采用透明安全边距以消除相邻姿势残边。Chrome 确认实际帧变化、暂停后帧保持、手机布局正确。
- Windows 原生证据、Android APK 核对在 `evidence/native/`；Linux 归档独立验证在 `evidence/linux-package-*-independent.json`。

## 使用限制

Chat/Responses 使用你配置的 API Key；实际供应商需自行测试。API Key 本版在后端本地明文保存，浏览器不能回读。Android 只接受可信 HTTPS 后端，配对令牌保留在当前 WebView 会话。桌面 Codex 默认只读工作区，未提供任意命令执行或自动批准；首次账户登录仍由用户完成。Windows 便携程序未做商业代码签名，Android 是开发签名 APK，尚未商店发布。

这些产物完成了主机构建与明确列出的验证；Android 实机悬浮生命周期、Ubuntu X11/Wayland 透明窗口和 ARM64 实机行为仍待目标端验收。

## 来源与交付完整性

参考了用户指定的 Codex Remote 会话及进程协议设计，未复制其未提交修改、凭据或业务数据。当前目录不是 Git 仓库，因此没有创建提交、推送或部署公网。源码包排除 node_modules、运行数据、配对令牌、私有日志、本机构建工具和 SDK 缓存；可通过 lockfile 重建。

源码交付为 `releases/PetPal-0.1.0-source.zip`，可用 `node scripts/package-source.mjs` 重建；每个 ZIP 成员经独立解压与 SHA-256 核对。全部交付文件摘要见 `releases/SHA256SUMS.txt`，机器可读清单见 `releases/release-manifest.json`。使用 `node scripts/release-manifest.mjs` 可重新计算并对照各平台最终验收回执。
