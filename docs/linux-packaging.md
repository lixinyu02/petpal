# Ubuntu 0.7.0 包与验收范围

Ubuntu 版包含共享 React 界面、Electron、Node 个人服务、Codex 0.143.0 和 OpenCLI 1.8.8，可使用本机 / 远程 Chat 与 Agent。当前发布格式为 x64 / arm64 portable `.tar.gz`，解压后运行 `./start-petpal.sh`；不需要另装 Node 或 Codex。两架构均为跨平台打包，归档、依赖与 ELF 审计不能替代 Ubuntu 目标机 GUI / 运行验收。当前版本结果见 [0.7.0 验收](acceptance-0.7.md)。

## 下载与运行

在 [v0.7.0 Release](https://github.com/lixinyu02/petpal/releases/tag/v0.7.0) 选择 [Ubuntu x64](https://github.com/lixinyu02/petpal/releases/download/v0.7.0/PetPal-0.7.0-Ubuntu-x64.tar.gz) 或 [Ubuntu arm64](https://github.com/lixinyu02/petpal/releases/download/v0.7.0/PetPal-0.7.0-Ubuntu-arm64.tar.gz)，按发布页 SHA-256 核对文件。Ubuntu 22.04 或更高版本的桌面环境可执行：

```sh
tar -xzf PetPal-0.7.0-Ubuntu-x64.tar.gz
cd PetPal-0.7.0-Ubuntu-x64
./start-petpal.sh
```

ARM64 主机使用对应 arm64 文件及目录。整个解压目录需要保持完整；启动器使用包内 Electron 运行时。主窗口关闭后保留托盘，托盘退出会关闭自身个人服务与子进程。

首次进入应用先选择本机或远程服务并完成认证。owner 可以配置 Responses 服务，也可在主机模式使用自己的 Codex 登录；包内辅助启动器提供：

```sh
./codex.sh --version
./codex.sh login
./opencli.sh --version
```

API 模式使用独立 Codex home、配置和工作区；主机模式保留用户已有的 Codex 登录。桌面本地数据保存在 Electron 用户数据目录，包内没有凭据、上传图片或聊天历史。默认工作区在应用用户数据目录下，可通过 `PETPAL_WORKSPACE` 指定项目；每次任务仍遵循自己的访问和审批策略。

0.7.0 Agent 支持 `read-only` / `workspace-write` / `full-access` 与 `ask` / `auto` / `review`，默认只读 + 询问。成员需要 owner 授予 `workspace` 或 `full` 后才能使用，授权不会自动提升每次任务的策略。插入指令、最多 5 条等待队列、图片和停止 / 恢复行为与其他客户端一致；重启后队列暂停，不自动重放。具体限制见 [README](../README.md#agent-工作台)。

OpenCLI 网页控制需要官方 Chrome Browser Bridge 扩展和明确选择的浏览器档案。Ubuntu 音乐控制需要播放器在当前用户 D-Bus 上提供兼容的 MPRIS 会话；MPRIS 本身不提供歌曲搜索。音乐 / 浏览器动作需要完整访问并遵循任务审批模式，安装扩展与真实动作不属于归档审计。

## 图形与系统依赖

需要 Linux GUI 依赖和可用的 WebGL 图形驱动。Ubuntu 完整桌面通常已有 GTK、NSS、X11 和音频库；极简系统需由管理员通过发行版软件源补齐。保留 Chromium 沙箱；不要以 root 运行，也不要加入 `--no-sandbox`。透明置顶桌宠优先使用 X11，Wayland 的位置控制、置顶和透明效果依赖合成器。

二次元伙伴和 3D 小猫共用账号设置、模型和历史，形象选择持久化为 `settings.companionKind`。小猫使用 Three.js/WebGL；主界面与透明窗口共用 `PetScene`、`CatModel` 和行为状态机。二次元角色源码与资源位于 `src/avatar/` 和 `public/avatars/`，为原创 PNG 和网格动画，不是 Cubism `.moc3` 运行时。旧精灵图 / GIF 仅保留为历史素材；不能用静态截图代替实时渲染验证。

CosyVoice 已接入经过认证的个人服务，每条完成的 AI 消息可单独朗读 / 停止。系统音色和物理扬声器取决于目标桌面；通用远程 TTS、远程 ASR 与浏览器识别仍只是预备配置。保存配置不会自动录音。

## 从源码跨平台打包

冻结代码、依赖锁文件与前端构建后执行：

```sh
npm ci
npm test
npm run build
node scripts/linux-package.mjs
# 或单独选择架构
node scripts/linux-package.mjs x64
node scripts/linux-package.mjs arm64
```

脚本在独立的 `releases/ubuntu/.stage/` 构建，不改当前依赖、不依赖 WSL，也不会触及 RK3566 板卡或固件。生产依赖从已安装的锁定依赖复制；Linux Electron 和 Codex 原生文件分别按官方 SHA-256 与 npm SHA-512 integrity 验证。`electron-builder` 使用 Linux Electron 执行 `dir` 打包，再生成带 POSIX 可执行权限的 portable `.tar.gz`。

输出为：

- `releases/ubuntu/PetPal-0.7.0-Ubuntu-x64.tar.gz`
- `releases/ubuntu/PetPal-0.7.0-Ubuntu-arm64.tar.gz`

每个包旁有 SHA-256 文件，包内包含来源摘要 `BUILD-MANIFEST.json`。本地构建清单位于 `evidence/linux-package-x64.json` / `evidence/linux-package-arm64.json`，这些机器验收文件不随公开源码分发。

独立复核最终归档的实际字节、原生 ELF、架构、启动器和可执行权限：

```sh
node scripts/linux-verify.mjs releases/ubuntu/PetPal-0.7.0-Ubuntu-x64.tar.gz --compare-current-dist
node scripts/linux-verify.mjs releases/ubuntu/PetPal-0.7.0-Ubuntu-arm64.tar.gz --compare-current-dist
```

`--compare-current-dist` 逐字节比较包内前端与当前 `dist/`，并核对 desktop / server 源码，包括 Agent 权限与队列、附件、下载目录和远程传输模块。`codex`、`codex-code-mode-host`、`rg`、`bwrap`、`zsh` 按目标架构封装并保留 0755 权限；同时校验 Electron ELF。最终文件数量和哈希以对应版本的独立回执为准，不能复用旧版数字。

本轮交付为可解压目录包。`npm run desktop:linux` 中另有 AppImage / deb 配置，需要适用的 Linux 构建环境与进一步验收；配置存在不代表这两种格式已经交付。

## 验收边界

0.7.0 已有共享后端的真实 Responses 文字 / 图片与真实 Codex CLI 只读任务证据；它们不等同于在 Ubuntu 包内执行成功。x64 / arm64 仍需目标机验证 GUI、WebGL、角色交互、托盘、透明置顶、本机 CLI、取消 / 退出清理、语音与媒体设备。ARM64 包也不代表 RK3566 板卡已经安装或测试。

请以 [0.7.0 验收](acceptance-0.7.md) 的本版结果为准。旧版 `codex-live.json`、0.2 的 3D 截图和历史包回执均不能替代本版 Ubuntu 运行证据。
