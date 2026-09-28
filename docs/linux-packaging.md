# Ubuntu 包与验收范围

0.2 提供默认二维日系少女和可切换的橘白 3D 小猫，名字、聊天/Codex 会话与模型连接共用，形象选择通过 `settings.companionKind` 持久化。小猫使用 Three.js/WebGL；Web、Electron 主界面与透明桌宠窗口共用 `PetScene`、`CatModel` 和行为状态机，支持注视、走动、抚摸、进食、跳跃和持续睡眠。少女源码与资源位于 `src/avatar/` 和 `public/avatars/`，源码打包脚本递归收录，最终归档前要求两处都存在有效文件。旧的精灵图/GIF 仅保留为 0.1 美术来源，不代表当前产品。

在模型、前端和桌面代码冻结，完成 `npm ci`、`npm test` 和 `npm run build` 后执行。最终打包前不应使用旧 0.1 包或回执声称 0.2 已验收：

```powershell
node scripts/linux-package.mjs
# 或单架构
node scripts/linux-package.mjs x64
node scripts/linux-package.mjs arm64
```

脚本在独立的 `releases/ubuntu/.stage/` 构建，不改当前依赖、不依赖 WSL，不会触及 RK3566 板卡、固件或其 Ubuntu 发行版。生产依赖由已安装的锁定依赖复制；Linux Electron 和 Codex 原生文件分别通过官方 SHA-256 与 npm SHA-512 integrity 验证。`electron-builder` 使用真正的 Linux Electron 执行 `dir` 打包，之后生成带 POSIX 可执行权限的 portable `.tar.gz`。

已生成的 0.2 包为 `releases/ubuntu/PetPal-0.2.0-Ubuntu-x64.tar.gz` 与 `PetPal-0.2.0-Ubuntu-arm64.tar.gz`。每个包旁有 SHA-256 文件；详细清单在 `evidence/linux-package-x64.json` / `evidence/linux-package-arm64.json`，包内有来源摘要 `BUILD-MANIFEST.json`。两架构均已通过独立归档字节、ELF、权限、18 个前端资源及七个 desktop/server 源码成员检查，见 `evidence/linux-package-audit.md`。Windows 上的打包与 ELF 架构审计不能替代 Ubuntu GUI、WebGL、角色交互、托盘、透明置顶和 Codex 执行验收。

独立复核最终压缩包内的真实字节、六个原生 ELF、架构与可执行权限：

```powershell
node scripts/linux-verify.mjs releases/ubuntu/PetPal-0.2.0-Ubuntu-x64.tar.gz --compare-current-dist
node scripts/linux-verify.mjs releases/ubuntu/PetPal-0.2.0-Ubuntu-arm64.tar.gz --compare-current-dist
```

`--compare-current-dist` 还会逐字节校验包内前端与当前 `dist/` 一致，并比较包内 desktop/server 源码。具体前端文件名和哈希由冻结后的构建生成，以独立 JSON 回执为准。`codex`、`codex-code-mode-host`、`rg`、`bwrap` 和 `zsh` 五个 CLI 相关原生文件都按目标架构封装并具有 0755 权限。

当前 3D 浏览器证据使用 `companion-3d-acceptance.json`、`companion-3d-desktop.png` 和 `companion-3d-mobile.png`，测试和构建证据使用 `test-results-0.2.json` / `web-build-0.2.json`。`codex-live.json` 是复用的旧版真实 CLI 后端协议证据，不是本次 0.2 模型调用、Linux 运行或 3D 原生设备验收。源码包保留 Android `OverlayAssetPolicy.java` 与对应 JUnit 测试，独立浮窗只能加载包内受限资源，不能由网页导航到任意网络地址。

Ubuntu 22.04 或更高的桌面环境解压后运行：

```sh
tar -xzf PetPal-0.2.0-Ubuntu-x64.tar.gz
cd PetPal-0.2.0-Ubuntu-x64
./codex.sh --version
./codex.sh login
./start-petpal.sh
```

ARM64 主机选择 arm64 包。`codex.sh` 复用包内 Electron 的 Node 运行时，因此无需另外安装 Node 或 Codex；CLI 使用用户自己的登录状态。首次使用前端时添加模型连接；本地配置和密钥写入用户数据目录，包内不含凭据或聊天历史。

需要系统的 Linux GUI 依赖与可用的 WebGL 图形驱动。Ubuntu 完整桌面通常已有 GTK、NSS、X11、音频库；极简系统需要由管理员通过发行版软件源补齐。WebGL 不可用时界面显示重试提示，不能以静态截图当作渲染成功。保留 Chromium 沙箱；不要以 root 运行，也不要加入 `--no-sandbox`。透明置顶小猫优先使用 X11，Wayland 的效果取决于合成器。

该跨平台流程交付的是可解压目录包。AppImage/deb 需要在适用 Linux 打包环境进一步构建和运行验收；不能把目录包称作已通过 Ubuntu 实机验收的 AppImage/deb。
