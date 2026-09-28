# 原生客户端

## Windows / Ubuntu

Electron 拥有本地 Node 后端和实际 Codex 子进程；服务每次启动随机选择 `127.0.0.1` 端口，并生成仅通过受限 preload 提供给自身窗口的随机令牌。聊天历史和服务端配置存储在 Electron `userData/data`。主窗口关闭会收起到托盘；托盘「退出小伴」会关闭 HTTP 服务与 Codex 子进程。

```sh
npm ci
npm run desktop
npm run desktop:win
npm run desktop:linux
```

打包脚本使用 `desktop/electron-builder.yml`，包含共享 Web 构建、完整后端、生产 npm 依赖、主进程和 preload。输出在 `releases/desktop/`。Windows 已构建 x64 portable；Ubuntu x64 / ARM64 的独立 portable tar.gz 构建见 `docs/linux-packaging.md` 与 `scripts/linux-package.mjs`。Linux 原生构建时另有 AppImage、deb 配置；这些配置并不代表已经生成或验收对应格式。桌宠透明窗口在 X11 下支持更稳定，Wayland 合成器可能限制全局置顶或位置控制。

桌面包包含平台原生 Codex 0.143.0，并调用真实 `codex app-server`，运行桌面包无需另外安装 Node。目标机器仍需通过 Codex CLI 的官方流程完成登录；应用会显示 CLI / 登录错误。可设置 `PETPAL_WORKSPACE` 指定允许的默认工作区，默认使用 Electron `userData/workspace` 下独立创建的工作目录。仅采用 CLI 支持的认证流程；应用不读取或显示现有凭据。

首页可在二次元伙伴与 Three.js 三维小猫之间切换，默认二次元伙伴。`?chat=1` 打开聊天 / Codex 双模式工作区，`?pet=1` 为 300×340 的透明桌宠视图。主窗口和桌宠同源，通过 localStorage 的 `petpal.companionKind` 及 storage 事件同步选择，每个视图只保留一个角色渲染器。二次元伙伴为自有 WebGL 2D 网格动画，当前不是 Cubism `.moc3` 运行时；相关研究见 `docs/avatar-research.md`。桌宠顶部拖动区域由 `-webkit-app-region: drag` 提供，交互按钮为 `no-drag`。托盘可显示 / 隐藏桌宠以及打开主窗口。渲染进程无 Node 权限、无通用 shell / 文件 / IPC 接口；外部页面不能获取本地连接令牌。

## Android

这是 Capacitor 原生 APK，复用同一 React 前端；不是只添加主屏幕的 PWA。从 0.6.2 开始，Android 首次打开预填 `https://magicdatou.top:44318`，可改为其他 HTTPS 后端，已有会话连接优先；登录凭据仍只保存在当前会话。后端需显式允许来源 `https://localhost`。提供商密钥始终保存在后端，APK 不包含密钥。

Android / Web 支持 Chat 与远程 Codex；远程 Codex / OpenCLI 在连接的后端电脑运行，不能据此控制手机上的其他 App。当前远程 Agent 仅对主机 owner 开放，普通成员使用管理员分配的聊天模型。Windows / Ubuntu 桌面包内置 Codex CLI、OpenCLI 和后端，可在本机使用两种模式。Android 包不内置这些 CLI 或 Node 运行时。

原生 `PetOverlay` 插件提供 `status()`、`requestPermission()`、`showPet({ companionKind })`、兼容的 `start({ companionKind })`、`stop()`。参数只接受 `anime` / `cat`，省略或非法值默认 `anime`；已运行时再次调用会更新该窗口的角色。`status()` 返回权限、服务是否运行及当前角色。TypeScript 声明和包装位于 `src/platform/overlay.ts`。用户先允许「显示在其他应用上层」，回到小伴后主动开启桌宠；插件不会在权限设置页返回后自动启动。Android 13+ 还会请求通知权限。

悬浮窗口尺寸为 184×232 dp，独立 WebView 使用 APK 内置的共享角色渲染器，URL 固定为 `?overlay=1&avatar=anime` 或 `?overlay=1&avatar=cat`。顶部原生把手用于拖动，「聊」按钮及通知进入固定聊天页面；角色区域可直接轻点互动。它没有 Capacitor 桥或 `addJavascriptInterface`，只允许读取固定 `https://appassets.androidplatform.net` 下的 APK `assets/public` 内容。所有外部请求、路径穿越、非 GET 请求、其他页面导航、文件 / 内容访问、下载、弹窗和权限申请均被拦截；CSP 进一步限定资源来源。它不依赖后端地址或令牌即可显示角色。Android 主 App 负责将当前选择传入原生层；独立 WebView 不共享主 App 的 localStorage。

常驻通知提供停止按钮。服务为 `START_NOT_STICKY`，不设置开机自启；熄屏时隐藏并暂停自身 WebView，停止服务时销毁窗口及 WebView。系统 / 厂商的后台限制可能停止服务，停止后应在小伴内重新开启。Android WebView 需要支持 WebGL；硬件加速已开启，实际设备的 GPU、透明窗口和耗电仍须实机验收。

安装 Node 22+、JDK 21、Android SDK API 36 后：

```powershell
npm ci
.\scripts\build-android.ps1 -SdkPath E:\Android\Sdk -JdkPath C:\path\to\jdk-21
```

Linux 主机设置 `ANDROID_HOME` 与 `JAVA_HOME` 后运行 `bash scripts/build-android.sh`。调试 APK 输出 `releases/android/PetPal-<version>-Android-debug.apk`，版本读取自 `package.json`，使用本机构建工具的 debug 签名；正式发布前需自行配置 release keystore 与发布流程，不能用 debug APK 代表商店发布验收。构建脚本不会安装应用或操作开发板。

## 已执行验证

Windows `desktop/verify-windows.ps1` 用隔离的临时用户目录、仅含 Windows 系统目录的 PATH 启动打包程序，验证本地后端、preload、内置 Codex 初始化 / 登录状态、透明像素与置顶窗口。v0.2 验证器要求两个窗口在 anime → cat → anime 切换中分别只有一个真实 WebGL 渲染器，且存储事件同步成功，并生成 native PNG 与脱敏 JSON；不会发起模型生成或接管其他运行中的小伴实例。设置 `PETPAL_SMOKE_POSES=1` 可额外采集 CSS 390×844 视口、分享点心口型、休息闭眼和小猫行走截图；这些 UI 操作仅在 `--smoke-test` 分支执行。

Android `OverlayAssetPolicyTest` 的 5 项单测已随真实 Gradle 编译通过，覆盖本地资源映射、外部请求拦截、编码路径穿越、两种角色的固定导航和严格 enum 默认值，摘要见 `evidence/native/android-avatar-policy.json`。`android/verify-apk.ps1` 检查签名、版本、APK Web 入口与当前构建的一致性、独立 WebView overlay 类及旧 Canvas 类的移除。最终包证据为 `evidence/native/android-final.json` 与 `evidence/native/windows-final/`，请以其中记录的版本为准；旧版证据不代表新版已完成验收。Android 权限设置、悬浮窗口及通知生命周期仍待手机 / 模拟器运行验收；没有操作 RK3566 实板。
