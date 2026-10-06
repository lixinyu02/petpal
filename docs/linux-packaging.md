# Ubuntu 0.9.10 包与验收范围

Ubuntu 版包含共享 React 界面、Electron、Node 个人服务、Codex 0.143.0 和 OpenCLI 1.8.8，可使用本机 / 远程 Chat 与 Agent。当前发布格式为 x64 / arm64 portable `.tar.gz`，解压后运行 `./start-petpal.sh`；不需要另装 Node 或 Codex。两架构均为跨平台打包，归档、依赖与 ELF 审计不能替代 Ubuntu 目标机 GUI / 运行验收。当前版本结果见 [0.9.10 验收](acceptance-0.9.10.md)。

## 下载与运行

优先使用服务器 [Ubuntu x64](https://magicdatou.top:44318/downloads/PetPal-0.9.10-Ubuntu-x64.tar.gz) / [Ubuntu arm64](https://magicdatou.top:44318/downloads/PetPal-0.9.10-Ubuntu-arm64.tar.gz)；备用为 [v0.9.10 Release](https://github.com/lixinyu02/petpal/releases/tag/v0.9.10) 的 [x64](https://github.com/lixinyu02/petpal/releases/download/v0.9.10/PetPal-0.9.10-Ubuntu-x64.tar.gz) / [arm64](https://github.com/lixinyu02/petpal/releases/download/v0.9.10/PetPal-0.9.10-Ubuntu-arm64.tar.gz)。按发布页 SHA-256 核对实际文件。Ubuntu 22.04 或更高版本的桌面环境可执行：

```sh
tar -xzf PetPal-0.9.10-Ubuntu-x64.tar.gz
cd PetPal-0.9.10-Ubuntu-x64
./start-petpal.sh
```

ARM64 主机使用对应 arm64 文件及目录。整个解压目录需要保持完整；启动器使用包内 Electron 运行时。主窗口关闭后保留托盘，托盘退出会关闭自身个人服务与子进程。

首次进入应用先选择本机或远程服务并完成认证。owner 可以配置 Responses 服务，也可在主机模式使用自己的 Codex 登录；包内辅助启动器提供：

```sh
./codex.sh --version
./codex.sh login
./opencli.sh --version
```

API 模式使用独立 Codex home、配置和工作区；主机模式保留用户已有的 Codex 登录。桌面本地数据保存在 Electron 用户数据目录，包内没有凭据、上传图片或聊天历史。默认工作区在应用用户数据目录下；Agent 与 Chat + Agent 可在界面的“项目目录”中指定执行电脑上的现有绝对路径，详见 [项目目录](agent-project-directory.md)。每次任务仍遵循自己的访问和审批策略。

Agent 支持 `read-only` / `workspace-write` / `full-access` 与 `ask` / `auto` / `review`，默认只读 + 询问。成员需要 owner 授予 `workspace` 或 `full` 后才能使用，授权不会自动提升每次任务的策略。插入指令、最多 5 条等待队列、图片和停止 / 恢复行为与其他客户端一致；重启后队列暂停，不自动重放。0.9.10 包含语音插话打断、Chat 接收 Agent 进度与结果、对话归档／恢复／重命名／删除、项目分类及中央服务器入口。具体限制见 [README](../README.md#agent-工作台)。

OpenCLI 公开查询默认启用；网页操作需要官方 Chrome Browser Bridge 扩展和明确选择的浏览器档案。QQ 音乐 MCP 负责搜索及播放链接，返回链接不代表桌面已播放。网易云上游 MCP 仅支持 Windows，Ubuntu 桌面播放控制使用 MPRIS。Computer Use 默认启用，按任务授权使用 Accessibility 和截图等能力。Ubuntu 音乐控制需要播放器在当前用户 D-Bus 上提供兼容的 MPRIS 会话；MPRIS 本身不提供歌曲搜索。音乐 / 浏览器动作需要完整访问并遵循任务审批模式，安装扩展与真实动作不属于归档审计。

## 图形与系统依赖

需要 Linux GUI 依赖和可用的 WebGL 图形驱动。Ubuntu 完整桌面通常已有 GTK、NSS、X11 和音频库；极简系统需由管理员通过发行版软件源补齐。保留 Chromium 沙箱；不要以 root 运行，也不要加入 `--no-sandbox`。透明置顶桌宠优先使用 X11，Wayland 的位置控制、置顶和透明效果依赖合成器。

默认使用原创二次元伙伴，3D 小猫默认关闭；形象共用账号设置、模型和历史，选择持久化为 `settings.companionKind`。当前二次元运行源码位于 `src/avatar/cubism/`，包内 `public/avatars/akari-cubism-v12/` 包含真实 V12 `.moc3`、纹理、动作及物理文件，由官方 Cubism Core 6.0.1 加载，许可通知随包保留。主机 Core 结构读回为 16 个 drawables、22 个 parameters、3774 个 vertices，不能替代 Linux 图形运行验收。小猫使用 Three.js/WebGL；主界面与透明窗口共用 `PetScene`、`CatModel` 和行为状态机。八张原始 PNG、立绘网格与旧精灵图 / GIF 保留为历史方案素材；不能用静态截图代替实时渲染验证。

CosyVoice 已接入经过认证的个人服务，每条完成的 AI 消息可单独朗读 / 停止。共享语音控制器融合远程 ASR、流式 TTS、插话打断和空闲时的新 Agent 回报朗读；系统音色、麦克风、AEC 和物理扬声器取决于目标桌面。保存配置不会自动录音。本轮未进行 Ubuntu 语音端到端验收。

## 从源码跨平台打包

在独立源码副本中冻结代码、依赖锁文件与前端构建后执行，避免将在线服务的 dist 作为构建目录：

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

默认输出为：

- `releases/ubuntu/PetPal-0.9.10-Ubuntu-x64.tar.gz`
- `releases/ubuntu/PetPal-0.9.10-Ubuntu-arm64.tar.gz`

每个包旁有 SHA-256 文件，包内包含来源摘要 `BUILD-MANIFEST.json`。本地脚本同时生成通用和版本化回执，版本化文件为 `evidence/linux-package-x64-0.9.10.json` / `evidence/linux-package-arm64-0.9.10.json`，这些机器验收文件不随公开源码分发。本次实际发布包归集于 `releases/release-0.9.10/ubuntu/`；隔离来源镜像位于 `evidence/release-0910-20261006/ubuntu-package-source/`，最终回执保存在同一 release evidence 目录。

独立复核最终归档的实际字节、原生 ELF、架构、启动器和可执行权限。以下命令在含对应冻结 `dist/` 的源码副本执行：

```sh
node scripts/linux-verify.mjs releases/ubuntu/PetPal-0.9.10-Ubuntu-x64.tar.gz --compare-current-dist
node scripts/linux-verify.mjs releases/ubuntu/PetPal-0.9.10-Ubuntu-arm64.tar.gz --compare-current-dist
```

`--compare-current-dist` 逐字节比较包内前端与该源码副本的 `dist/`，并核对 desktop / server 源码，包括 Agent 权限与队列、附件、下载目录、远程传输、对话组织、Chat 派发／汇报及三个自动化模块。本轮 verifier 使用隔离镜像的 canonical 前端，不读取生产 live dist。`codex`、`codex-code-mode-host`、`rg`、`bwrap`、`zsh` 按目标架构封装并保留 0755 权限；同时校验 Electron ELF。最终文件数量和哈希以对应版本的独立回执为准，不能复用旧版数字。

本轮交付为可解压目录包。`npm run desktop:linux` 中另有 AppImage / deb 配置，需要适用的 Linux 构建环境与进一步验收；配置存在不代表这两种格式已经交付。

## 验收边界

历史 0.9.6 已有 Qwen 图片通过两条 Chat 连接、Windows 包内 Codex 的中央与 DesktopExecutor 的实际识图证据，详见 [0.9.6 验收](acceptance-0.9.6.md)；这些历史 Windows 和共享后端结果不能替代本轮 Ubuntu 执行证据。

0.9.10 两包分别通过完整归档字节、冻结前端与源码、ELF、依赖导入闭合、V12 Core 结构、许可证及已知私有值扫描。本轮未执行 Ubuntu 包内 Linux CLI / GUI 或目标设备。x64 / arm64 仍需目标机验证 GUI、WebGL、角色交互、托盘、透明置顶、本机 CLI、取消 / 退出清理、语音与媒体设备。ARM64 包也不代表 RK3566 板卡已经安装或测试。

请以 [0.9.10 验收](acceptance-0.9.10.md) 的本版结果为准。旧版 `codex-live.json`、0.2 的 3D 截图和历史包回执均不能替代本版 Ubuntu 运行证据。
