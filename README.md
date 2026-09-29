# 小伴 PetPal

可以聊天、陪伴和使用真实 Codex CLI 的个人伙伴。已发布稳定版为 **0.7.0**，下文执行电脑说明针对更新后的源码。Web、Android、Windows 与 Ubuntu 共用 React 界面；Node 个人服务负责账号、模型连接、图片、历史和 Agent 任务。支持 Chat Completions / Responses、图片聊天、可授权的 Agent 工作台、CosyVoice 朗读，以及二次元伙伴和 3D 小猫。

| 平台 | Chat 与图片 | 当前源码的 Agent 执行位置 | 已发布 0.7.0 交付形式 |
| --- | --- | --- | --- |
| Web | 登录个人服务 | 同账号的在线电脑 / 中央服务器 | Web 构建 / 自部署源码 |
| Android | 登录个人服务 | 同账号的在线电脑 / 中央服务器 | 开发签名 APK，versionCode 9 |
| Windows | 登录同一个人服务 | 此电脑 / 同账号其他电脑 / 中央服务器 | x64 便携 EXE |
| Ubuntu | 登录同一个人服务 | 此电脑 / 同账号其他电脑 / 中央服务器 | x64 / arm64 `.tar.gz` |

桌面包包含 Electron、Node 运行时、Codex **0.143.0** 和 OpenCLI **1.8.8**，无需另装 Node/npm。手机和网页上的 Agent 在所选电脑执行，不会因此获得手机本地其他 App 的控制能力。**旧 v0.7.0 桌面包没有同账号电脑注册功能，需要升级桌面客户端；更新网页不能替换旧客户端里的执行器。** 使用方法见 [执行电脑](docs/execution-hosts.md)，历史发布的验收范围见 [0.7.0 验收](docs/acceptance-0.7.md)。

## 下载与开始使用

源码仓库：[lixinyu02/petpal](https://github.com/lixinyu02/petpal)。[0.7.0 发布入口](https://github.com/lixinyu02/petpal/releases/tag/v0.7.0) 对应文件：

- [Windows x64 便携 EXE](https://github.com/lixinyu02/petpal/releases/download/v0.7.0/PetPal-0.7.0-Windows-x64.exe)：下载后直接运行，没有独立安装器，未商业签名。
- [Ubuntu x64](https://github.com/lixinyu02/petpal/releases/download/v0.7.0/PetPal-0.7.0-Ubuntu-x64.tar.gz) / [Ubuntu arm64](https://github.com/lixinyu02/petpal/releases/download/v0.7.0/PetPal-0.7.0-Ubuntu-arm64.tar.gz)：解压后运行 `./start-petpal.sh`；目标机 GUI 尚未验收。
- [Android 开发签名 APK](https://github.com/lixinyu02/petpal/releases/download/v0.7.0/PetPal-0.7.0-Android-debug.apk)：版本 0.7.0 / versionCode 9，尚未实机验收，不是应用商店正式签名包。
- [Web 静态包](https://github.com/lixinyu02/petpal/releases/download/v0.7.0/PetPal-0.7.0-Web.zip)：需配合同版本 Node 后端。
- [源码归档](https://github.com/lixinyu02/petpal/archive/refs/tags/v0.7.0.zip)：GitHub 按发布标签提供，包含前后端和原生壳源码，可按锁文件重建。

以 Release 实际文件、校验摘要及验收说明为准。登录后的「下载」页从本项目 GitHub Releases 读取真实发布文件，显示平台、架构、版本、稳定 / 预览渠道和开发签名标记；不存在的包不会显示下载按钮，网络失败可以重试。

进入应用后先连接并登录个人服务。电脑客户端登录同一公共服务账号后自动登记为执行电脑；Web、Android 和桌面版都在 Agent 的「执行电脑」下拉框选择目标。选择电脑保持当前账号、模型和中央聊天历史，不会切换整套后端或要求重新登录。主账号在「连接与设置 → 电脑助手」配置中央 Responses 地址、模型与密钥；成员使用管理员分配的模型和 Agent 权限。中央服务器原有的本机 Codex 登录模式继续保留。

桌面主窗口关闭后继续留在托盘，也继续为当前登录账号接收任务；注销账号、切换个人服务或在托盘彻底退出会关闭这台电脑的执行连接并停止其任务。拖动伙伴窗口顶部的三个点移动窗口，点击聊天图标打开工作台。

从源码运行 Web（Node.js 22+）：

```sh
npm ci
npm run build
npm start
```

打开启动日志给出的配对链接。默认服务地址 `http://127.0.0.1:4318`。链接中的 `#token=` 用于主机 owner 配对，前端读取后会立即清除地址栏片段。普通成员使用管理员创建的账号密码登录；未认证不能访问模型、聊天、语音合成、图片和 Agent 接口。

开发模式：`npm run dev`。Vite 地址 `http://127.0.0.1:5173`，API 由 Vite 代理到 4318，在登录页登录或使用主机配对凭据。

## Chat 与图片

1. 打开「连接与设置 → 模型连接」。
2. 填写连接名称、API 地址、模型 ID 和 API Key；无认证的本地模型可留空。
3. 选择 **Chat Completions** 或 **Responses**。API 地址可以是 `https://api.openai.com/v1`，也可包含对应接口后缀。
4. 保存并点击「测试」；测试会发出真实的简短模型请求。回到工作台选择模型开始聊天。

支持中文增量回复、会话历史、停止生成、断流错误提示、模型搜索和推理强度设置（包括 max）。可发送文字、图片或纯图片；两种协议都会传递实际图片内容，后续消息保留图片上下文。Chat 不执行提供商工具调用。伙伴名字和性格提示词可以修改；摸头、投喂、休息是本地互动，不消耗模型额度。

图片支持 PNG、JPEG、WebP，每条最多 4 张、单张最多 8 MiB，边长最多 8192、总像素最多 32MP；每个账号最多保存 1000 张或 500 MiB，包含尚未发送的图片。Chat 单次上下文最多 16 张或 32 MiB，重复引用也计数。图片按账号认证读取，历史只公开所属图片的元数据。

连接可标记为仅文字；已知 `halogen-qwen3.8-flash-next` 为仅文字模型，含图历史不能切换到它，图片不会被静默丢弃。图片请求失败会保留相应内容并显示错误。

## Agent 工作台

后台真实运行 `codex app-server`，支持线程创建 / 恢复、开始任务、停止、操作审批及运行中插入指令。主机模式使用本机 Codex 登录；API 模式使用独立 Codex home、配置和工作区，不修改全局 Codex 配置。

执行电脑主动连接个人服务接收任务，无需给每台电脑开放入站端口。中央保存账号、模型和会话；桌面执行器按账号隔离工作区，通过限定当前任务和模型的短期 Responses relay 凭据调用模型，中央上游 API Key 不分发到执行电脑。换电脑后保留同一段聊天记录，后台为新电脑建立新的 Codex 线程并附有限的近期文字上下文，不迁移另一台电脑上的本地文件。

API 模式消费 Responses 服务。Agent 可选模型必须已分配给当前账号，并与主机 Codex 使用同一 Responses 上游；其他模型仍可用于 Chat。全局 Codex 模式、地址或凭据变更后需新建工作会话，旧历史保留。

| 账号 Agent 授权 | 可选任务访问范围 |
| --- | --- |
| `none`（新成员默认） | 不可使用 Agent |
| `workspace` | 只读、工作区写入 |
| `full`（owner 固定拥有，也可授予成员） | 只读、工作区写入、完整主机访问 |

每次任务独立选择访问策略 `read-only` / `workspace-write` / `full-access`，以及审批模式 `ask`（询问）/ `auto`（自动）/ `review`（自动审查）；默认是**只读 + 询问**。账号获得 `full` 不会把每次任务自动改成完整访问。文件、命令和桌面工具遵循所选策略；音乐 / 浏览器动作需要完整访问并按所选审批模式处理。owner 继续独占账号管理、全局配置和直接桌面工具接口；获授权成员可运行自己的 Agent 任务、处理自己的审批。

运行中可插入指令，也可加入下一条任务；每个会话一次运行一条，最多等待 5 条。队列允许修改文字或取消，保留已有附件及提交时的电脑、模型、推理强度和权限。追加指令、审批、停止都发往原执行电脑。离线电脑不能接新任务，也不会自动回落到中央服务器。停止会暂停队列，服务重启后也不会自动重放任务，需明确恢复。若断线导致「执行状态未知」，请先在原电脑退出客户端并确认任务进程已停止；可开启新对话处理其他任务，原记录保留。提交 ID 用于去重；无法确认插入指令是否送达时保留回执和附件，不自动重复发送。Agent 图片只来自当前账号已上传的受控文件。

桌面包优先使用内置 CLI，源码版发现项目 npm 依赖或 PATH 中的 CLI。源码主机登录可执行：

```sh
npx --no-install codex login
```

Windows 用户也可通过官方 CLI 的 `codex login` 建立主机登录状态；Ubuntu 包提供 `./codex.sh login`。API 模式则在设置中填写服务连接。桌面默认工作区为个人应用数据目录下的 `workspace`；可在启动前设置 `PETPAL_WORKSPACE` 指向自己的项目目录。实际读写范围仍由任务策略和运行平台决定。

OpenCLI 网页工具另需官方 Chrome Browser Bridge 扩展和明确选择的浏览器档案。Ubuntu 音乐控制需要播放器在当前用户 D-Bus 上提供兼容 MPRIS 接口；这些依赖和真实桌面动作需在目标主机配置与验证。

## 账号、朗读与设备

主机管理员在「连接与设置 → 账号」创建成员、分配模型及 Agent 授权。成员的聊天、伙伴设置、默认模型和语音配置独立；退出登录、停用、改密码或降低授权会使受影响会话失效并停止对应后台任务。

自动朗读默认关闭，每条完成的 AI 回复旁提供「朗读 / 停止」按钮，使用当前账号选择的语音引擎；点击另一条会停止上一条。关闭朗读、切换会话或账号、隐藏窗口、进入休息及离开页面会停止当前播放。二次元伙伴和小猫按实际播放进度近似同步口型，不能视为音素级唇形同步。

系统朗读使用与语言匹配的本地音色；缺少中文音色时需安装系统中文语音包。已接通的远程引擎为 [CosyVoice](docs/cosyvoice.md)：主机管理员配置固定 Gradio 服务、参考声音及可选密钥，成员可以选择、试听并朗读消息。音频通过已认证的个人服务返回，CosyVoice 失败会明确报错，不自动换成系统音色。

通用远程 TTS、远程 ASR 和浏览器语音识别仍为**配置预备**；CosyVoice 本身不提供 ASR，保存设置不会启用录音。真实合成和浏览器播放已有证据，物理扬声器听感与 Android / Ubuntu 目标设备语音仍需分别确认。

「语音与设备」可选择本机麦克风、摄像头和扬声器。主动点击「测试麦克风」「预览摄像头」「播放测试音」才开始对应测试；输入测试不录制、不上传。停止、隐藏页面或切换账号会释放媒体轨道。设备选择按服务实例和账号保存在当前浏览器，不能同步到其他设备。

扬声器选择只用于支持输出路由的网页音频。**系统 TTS 始终使用系统默认输出**；不支持网页输出路由的浏览器也使用系统默认扬声器。设备流程见 [账号与语音配置](docs/user-accounts-and-voice.md)，当前能力和证据以 [0.7.0 验收](docs/acceptance-0.7.md) 为准。

## 两种形象，同一位伙伴

首页通过「二次元伙伴 / 3D 小猫」选择形象，默认二次元伙伴。每次只渲染当前选择的一个角色。切换会保留名字、性格、模型连接、聊天与 Agent 历史；连接个人服务后保存选择，Windows / Ubuntu 的同源桌宠窗口同步选项，Android 悬浮窗接收已选形象。

二次元伙伴使用六张原创 PNG 的局部眼眉 / 嘴部混合与 40×60 网格形变，提供呼吸、眨眼、轻微转头、头发摆动，以及浅笑、好奇、思考、惊讶、害羞等微表情。文字或朗读进度驱动 A/E/O/M 的近似口型，标点之间会停顿。未集成 Cubism Core，不支持导入 `.moc3`。实现范围见 [角色方案研究](docs/avatar-research.md)，素材说明见 [原创形象](public/avatars/akari/README.md) 与 [表情生成记录](docs/avatar-expression-prompts.md)。

橘白小猫由 Three.js WebGL 实时渲染，同一模型完成呼吸、眨眼、转头、摆尾、走动、抚摸、进食、睡眠与跳跃。短宽耳、连续脸颊和口鼻、贴合脸部的眼睛、连续前腿与圆爪改善模型比例；走动时展开后腿、将躯干转为四足站姿，以四拍短步和脚底约束保持贴地。渲染说明见 [3D 小猫方案](docs/renderer-decision.md)。

首页可选回应心情并点击「说句话」观察表情，也可直接抚摸、投喂或休息。休息可通过「叫醒」结束。页面隐藏时暂停，遵循系统减少动态效果设置。`/?animations=1` 旧书签也打开当前伙伴首页。旧版图集与 GIF 作为历史素材保留。

## Android 与多端连接

Android 是 Capacitor 原生应用，内置共享界面；手机不运行 Codex 二进制，Agent 由同账号选择的执行电脑或中央服务器运行。「设备与 Codex」中的「开启悬浮伙伴」请求系统悬浮窗权限；返回应用后再次点击开启，通知栏可随时停止。悬浮窗只加载 APK 内的当前角色资源，无原生 JS 桥或网络回退，不会自动开启悬浮权限或开机常驻。

Android 使用 HTTPS WebView，禁止混合内容和明文 HTTP；0.7.0 原生远程请求支持流式回复、认证图片上传与音频字节。部署到手机可访问的可信 HTTPS 地址，在连接窗口填写服务地址并登录；主机 owner 也可使用配对凭据。Web 跨来源部署需把访问 Origin 加入精确名单，反向代理需保持 SSE 不缓冲：

```sh
PETPAL_ALLOWED_ORIGINS=https://localhost,https://pet.example.com
```

`https://localhost` 是 Android WebView 的来源，不是服务地址。默认监听 127.0.0.1，可与同机 HTTPS 反向代理配合；需要直接监听网卡时显式设置 `PETPAL_HOST`。不要把令牌或模型 API Key 放进公开网页、构建产物或截图。

## 软件更新

「连接与设置 → 软件更新」显示客户端版本。主机管理员配置公开仓库与 Ed25519 [发布公钥](docs/petpal-update-public-key.txt)；成员可检查更新，桌面程序下载和交接仅由本机主账号执行。Windows 下载并校验后打开新版便携程序，保留原 EXE；Ubuntu 定位校验后的归档，由用户解压启动；Android 核对 APK 包名、签名与版本后交系统安装器；Web 仅在当前站点已部署新版时提供刷新。发布流程见 [更新与发布](docs/updates.md)。

## 环境变量

| 变量 | 用途 |
| --- | --- |
| `PETPAL_HOST` / `PETPAL_PORT` | Web 服务监听地址和端口，默认 `127.0.0.1:4318` |
| `PETPAL_DATA_DIR` | Web 数据目录，默认项目 `.data` |
| `PETPAL_TOKEN` | 可选服务令牌；不设置则生成并保存在数据目录 |
| `PETPAL_ALLOWED_ORIGINS` | 逗号分隔的允许来源，精确匹配 |
| `PETPAL_WORKSPACE` | Codex 默认工作目录；任务读写仍由策略控制 |

模型和语音服务的 API Key 保存在服务主机 `state.json`，**API Key 为本地明文存储**；POSIX 文件模式 0600、目录 0700，Windows 继承账户目录 ACL。不要提交或共享数据目录。API 回读只有 `hasApiKey`，不会返回密钥；图片也保存在服务主机私有数据目录。浏览器连接凭据仅存内存和当前 sessionStorage。账号密码使用哈希存储，历史和任务属于所连接的服务实例，没有云同步功能。

## 构建

```sh
npm ci
npm test
npm run build
npm run desktop:win
node scripts/linux-package.mjs
npm run android:sync
```

Android APK 构建：Windows 使用 `scripts/build-android.ps1`，Linux 使用 `scripts/build-android.sh`；要求 JDK 21 和 Android SDK，0.7.0 输出 debug APK。Ubuntu 两架构 portable 包的构建与逐字节校验见 [Ubuntu 打包](docs/linux-packaging.md)。`npm run desktop:linux` 是另行配置的 AppImage / deb 构建入口，本轮交付格式为 `.tar.gz`。X11、Wayland 与 ARM64 图形 / 桌宠行为需要分别实机确认。

项目结构：`src/` 共享前端；`src/avatar/` 双角色选择与 2D 渲染；`src/pet/` 3D 小猫与行为；`public/avatars/` 原创角色资源；`server/` 认证、持久化、图片、模型协议与 Codex 进程；`desktop/` Electron；`android/` Android 与悬浮服务；`tests/` 自动测试；`evidence/` 本地验收结果（不纳入 Git）。

## 验证范围

当前记录见 [0.7.0 验收](docs/acceptance-0.7.md)。自动化覆盖两种模型协议、登录隔离、授权撤销、队列 / steer 幂等、重启恢复、图片归属与限额、原生传输和下载目录。

0.7.0 后端已有真实 `gpt-6-luna` Responses 文字与单图请求成功，以及真实 Codex CLI 只读 + 询问任务完成的证据；本机与可信 HTTPS 入口返回相同服务实例，匿名语音、图片、下载和 Agent 请求均被拒绝。原有用户会话保持不变，验收仅新增明确标记的会话。CosyVoice 已有真实合成 / 浏览器播放证据，ASR 仍未实现。

Windows 最终便携 EXE 的资源、内置 CLI 和窗口 smoke 结果以本版验收文档为准，不沿用旧版结论。Ubuntu x64 / arm64 是跨平台打包与归档 / ELF 审计，尚无目标机 GUI 运行证据；Android 0.7.0 / code 9 是开发签名包，尚无手机实机验收。真实麦克风、摄像头、物理音频与各平台桌宠效果需在目标设备验证。本轮未对 RK3566 板卡安装、烧录或重启。

参考：[OpenAI App Server](https://developers.openai.com/codex/app-server)、[Responses streaming](https://developers.openai.com/api/docs/guides/streaming-responses)。

公开源码不包含账号数据、配对令牌、API Key、签名私钥、原生构建缓存或本机原始验收文件。历史验收文档里的 `evidence/` 指本地记录，未作为 GitHub 内容发布。
