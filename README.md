# 小伴 PetPal

可以聊天、陪伴和连接真实 Codex CLI 的个人伙伴。Web、Android、Windows 与 Ubuntu 共用 React 界面和 Node 服务。当前源码版本 **0.6.1**，普通聊天与 Codex 支持独立设置推理强度（包括 max），保留四端更新入口、二次元伙伴、3D 小猫、独立用户与模型权限、语音设备设置、内置 Codex 0.143.0 和 OpenCLI 1.8.8。

### 两种形象，同一位伙伴

首页通过「二次元伙伴 / 3D 小猫」选择形象，默认二次元伙伴。每次只渲染当前选择的一个角色。切换会保留名字、性格、模型连接、聊天与 Codex 历史；连接个人服务后会保存选择，Windows/Ubuntu 的同源桌宠窗口同步选项，Android 悬浮窗接收已选形象。

二次元伙伴使用六张原创 PNG 的局部眼眉/嘴部混合与 40×60 网格形变，提供呼吸、眨眼、轻微转头、头发摆动，以及浅笑、好奇、思考、惊讶、害羞等微表情。文字或系统朗读进度驱动 A/E/O/M 的近似口型，标点之间会停顿；这不是音素级唇形同步。未集成 Cubism Core，也不支持导入 `.moc3` 模型。实现范围见 [角色方案研究](docs/avatar-research.md)，素材说明见 [原创形象](public/avatars/akari/README.md) 与 [表情生成记录](docs/avatar-expression-prompts.md)。

橘白小猫由 Three.js WebGL 实时渲染，同一模型完成呼吸、眨眼、转头、摆尾、走动、抚摸、进食、睡眠与跳跃。短宽耳、连续脸颊和口鼻、贴合脸部的眼睛、连续前腿与圆爪改善了模型比例；走动时展开后腿、将躯干转为四足站姿，以四拍短步和脚底约束保持贴地。静坐和蜷睡姿势保留。渲染说明见 [3D 小猫方案](docs/renderer-decision.md)。

首页可选回应心情并点击「说句话」观察表情，也可直接抚摸、投喂或休息。休息可通过「叫醒」结束。页面隐藏时暂停，遵循系统减少动态效果设置。聊天与 Codex 从首页入口进入；`/?animations=1` 旧书签也打开当前伙伴首页。旧版记录见 [0.2.0 验收](docs/acceptance-0.2.md) 和 [0.1.0 验收](docs/acceptance-0.1.md)，图集与 GIF 作为历史素材保留。

## 0.6 软件更新

「连接与设置 → 软件更新」显示当前客户端版本。主机管理员配置公开仓库与 Ed25519 发布公钥；成员可以检查更新，桌面程序下载和交接仅由本机主账号执行。Windows 下载并校验后打开新版便携程序，保留原 EXE；Ubuntu 显示校验后的归档，由用户解压启动；Android 核对 APK 包名、签名与版本后交系统安装器；Web 仅在当前站点已部署新版时提供刷新，未部署的 GitHub 版本显示等待部署。发布流程见 [更新与发布](docs/updates.md)。

## 开始使用

源码仓库：[lixinyu02/petpal](https://github.com/lixinyu02/petpal)。[0.6.1 Release](https://github.com/lixinyu02/petpal/releases/tag/v0.6.1) 提供 [Windows x64 便携 EXE](https://github.com/lixinyu02/petpal/releases/download/v0.6.1/PetPal-0.6.1-Windows-x64.exe)、Web 静态包、签名更新清单和校验摘要；本版未提供 Ubuntu / Android 安装包。软件内更新需管理员首次配置仓库与[发布公钥](docs/petpal-update-public-key.txt)，具体行为见[更新说明](docs/updates.md)。

Windows 便携版下载后直接打开对应版本程序。桌面版内置 Electron、个人服务与两个 CLI，无需另装 Node/npm。进入「连接与设置 → 电脑助手」，可填写 Responses 服务地址、模型与密钥，或继续使用本机 Codex 登录。OpenCLI 网页工具还需安装官方 Chrome Browser Bridge 扩展并选择浏览器档案。关闭主窗口后继续留在托盘，托盘菜单可显示伙伴、打开主界面或彻底退出。拖动伙伴窗口顶部的三个点移动窗口，点击顶部聊天图标打开主界面。

从源码运行 Web（Node.js 22+）：

```sh
npm ci
npm run build
npm start
```

打开启动日志给出的配对链接。默认服务地址 `http://127.0.0.1:4318`。链接中的 `#token=` 是本机服务的访问凭据，请只在自己的设备使用；前端读取后会立即清除地址栏片段。

开发模式：`npm run dev`。Vite 地址 `http://127.0.0.1:5173`，在连接窗口填写后端配对令牌；API 由 Vite 代理到 4318。

## 聊天与模型

1. 打开「连接与设置 → 模型连接」。
2. 填写连接名称、API 地址、模型 ID 和 API Key；无认证的本地模型可留空。
3. 选择 **Chat Completions** 或 **Responses**。API 地址可以是 `https://api.openai.com/v1`，也可直接包含对应接口后缀。
4. 保存并点击「测试」；测试会发出一条真实的简短模型请求。回到陪伴空间选择连接即可开始聊天。

支持中文增量回复、会话历史、停止生成、断流错误提示和失败后继续对话。聊天模式当前处理文本，不执行提供商工具调用。伙伴名字和性格提示词可以修改；摸头、投喂、休息是本地互动，不消耗模型额度。测试 fixture 不属于实际产品模型。

## 可开关的朗读

首页「语音朗读」和聊天页「自动朗读回复」默认关闭。开启后，首页的「说句话」会使用系统音色，聊天页在助手回复完整成功后分句朗读。聊天页也提供「朗读上一条」和「停止朗读」。关闭开关、停止、切换会话或角色、进入休息、隐藏窗口和离开页面都会终止当前朗读；休息期间完成的回复不自动发声。

只选择与文本语言匹配的本地系统音色，不接入远程 TTS，也不需要另填语音 API Key。缺少本地中文音色时会提示安装系统中文语音包；浏览器或 Android WebView 不支持语音时仍可文字聊天和无声互动。开启选项仅在当前页面会话生效。

口型优先跟随系统语音边界；引擎缺少边界事件时，只在实际开始朗读后估算进度并显示说明。0.3 Windows 已验证中文语音引擎和页面控件的真实 start/boundary/end 事件，未人工听音或录音核验扬声器效果。Android/Ubuntu 语音与目标设备 GUI 尚未实测。

## 0.4 账号、语音与设备

主机管理员在「连接与设置 → 账号」创建成员并分配模型。成员以账号密码登录，只能使用自己的聊天、伙伴设置、默认模型和语音配置；主机 Codex 仍只供 owner 使用。

「连接与设置 → 语音与设备」新增 [CosyVoice 朗读接入](docs/cosyvoice.md)：管理员配置固定 Gradio 服务和参考声音，账号可选择引擎、试听并朗读回复。音频由已认证的个人服务代理，按播放进度近似驱动口型。通用远程 TTS、远程 ASR 和浏览器识别仍为**配置预备**；保存不自动请求麦克风。此功能是 v0.6.1 发布后的源码更新，既有 Release 文件保持不变。

同页可选择本机麦克风、摄像头和扬声器。点击「测试麦克风」观察电平，点击「预览摄像头」显示当前画面，点击「播放测试音」检查输出；只有主动测试才申请输入设备权限，输入测试不录制、不上传。停止、隐藏页面或切换账号会释放媒体轨道。设备选择按服务实例和账号保存在当前浏览器，不能同步到其他设备。

扬声器选择只用于支持输出路由的网页音频。**系统 TTS 始终使用系统默认输出**，请在操作系统声音设置里更改；不支持网页输出路由的浏览器也使用系统默认扬声器。具体流程和原生权限边界见 [账号与语音配置](docs/user-accounts-and-voice.md)，当前证据见 [0.4 验收](docs/acceptance-0.4.md)。

## Codex 工作台

真实运行 `codex app-server` 的 stdio JSON-RPC 协议，包括 initialize、thread/start/resume、turn/start/interrupt 和操作审批。本机模式沿用现有 Codex 登录与只读工作区。API 模式在 PetPal 数据目录中使用独立配置、用户目录和工作区，关闭 shell/exec，内置文件工具保留只读限制；具名音乐与网页动作在确认后执行。API 模式不修改全局 Codex 配置。更改模型、地址、凭据或模式后需新建 Codex 会话，旧历史仍可阅读。

桌面包优先使用内置原生 CLI；源码版会发现项目 npm 依赖或 PATH 中的 CLI。内置版本固定为 `0.143.0`，由已验证的协议决定。首次登录可在源码目录执行：

```sh
npx --no-install codex login
```

Windows 便携包用户也可安装官方 CLI 后运行 `codex login`；二者共享当前用户的 Codex 登录状态。桌面默认工作区为个人应用数据目录下的 `workspace`；要读取自己的项目，可在启动前设置 `PETPAL_WORKSPACE` 为明确的项目目录。默认只读模式不改文件。

## Android 与多端连接

Android 是 Capacitor 原生应用，内置共享界面。手机端不运行 Codex 二进制，而是连接个人服务，Codex 由服务主机执行。「设备与 Codex」中的「开启悬浮伙伴」请求系统悬浮窗权限；返回应用后再次点击开启，通知栏可随时停止。悬浮窗只加载 APK 内的当前角色资源，无原生 JS 桥或网络回退。应用不会自动开启悬浮权限或开机常驻。

Android 使用 HTTPS WebView，禁止混合内容和明文 HTTP。部署个人服务到手机可访问的可信 HTTPS 地址，在连接窗口填服务地址与配对令牌。反向代理需保持 SSE 不缓冲，并把访问 Origin 加入服务名单：

```sh
PETPAL_ALLOWED_ORIGINS=https://localhost,https://pet.example.com
```

`https://localhost` 是 Android WebView 的来源，不是服务地址。默认监听 127.0.0.1，可与同机 HTTPS 反向代理配合；需要直接监听网卡时显式设置 `PETPAL_HOST`。不要把令牌或模型 API Key 放进公开网页、构建产物或截图。

## 环境变量

| 变量 | 用途 |
| --- | --- |
| `PETPAL_HOST` / `PETPAL_PORT` | Web 服务监听地址和端口，默认 `127.0.0.1:4318` |
| `PETPAL_DATA_DIR` | Web 数据目录，默认项目 `.data` |
| `PETPAL_TOKEN` | 可选服务令牌；不设置则生成并保存在数据目录 |
| `PETPAL_ALLOWED_ORIGINS` | 逗号分隔的允许来源，精确匹配 |
| `PETPAL_WORKSPACE` | Codex 工作目录；桌面默认隔离目录 |

模型和语音服务的 API Key 保存在服务主机 `state.json`，**API Key 为本地明文存储**；POSIX 文件模式 0600、目录 0700，Windows 继承账户目录 ACL。不要提交或共享数据目录。API 回读只有 `hasApiKey`，不会返回密钥。浏览器连接凭据仅存内存和当前 sessionStorage。0.3 安装包使用单一主机配对；0.4 的账号隔离、密码哈希及会话管理见 [账号与语音配置](docs/user-accounts-and-voice.md)，没有云同步功能。

## 构建

```sh
npm test
npm run build
npm run desktop:win
npm run desktop:linux
npm run android:sync
```

Android APK 构建：Windows 使用 `scripts/build-android.ps1`，Linux 使用 `scripts/build-android.sh`；要求 JDK 21 和 Android SDK。详见 [原生壳说明](docs/native-shells.md)。Ubuntu 桌宠透明置顶效果取决于桌面环境，X11 与 Wayland 需要分别实机确认；ARM64 对应 RK3566 时也需单独验收。

项目结构：`src/` 共享前端；`src/avatar/` 双角色选择与 2D 渲染；`src/pet/` 3D 小猫与行为；`public/avatars/` 原创角色资源；`server/` 持久化、模型协议与 Codex 进程；`desktop/` Electron；`android/` 原生 Android 与悬浮服务；`tests/` 合同测试；`evidence/` 本地验收结果（不纳入 Git）。

## 验证范围

本轮结果和边界见 [0.5 交付验收](docs/acceptance-0.5.md)。以下为保留的 0.4 历史验收：**116/116** 自动测试覆盖迁移、账号授权、会话撤销竞态、请求隔离、语音配置、媒体选择和原生权限策略，详情见 [0.4 验收](docs/acceptance-0.4.md)。

Windows 最终 EXE 的 32 项前后端资源逐字节一致，内置 Codex 启动、登录状态及进程退出检查通过；程序未商业签名。Android 开发签名 APK 的 v1/v2 签名、媒体权限守卫及 22 项 Web 资源通过；Ubuntu 两架构各 5,019 个实际文件全量核对通过。这些检查分别记录，不代表 Android / Ubuntu 实机 GUI 或音视频设备通过。

Chrome 本轮完成 owner → 成员 A → 成员 B → 成员 A 的实际界面流程；模型列表、默认模型与语音配置保持账号隔离。最终页面已检查桌面与手机布局，手机有效 CSS 宽度和页面 scrollWidth 均为 391，无横向溢出。网页测试音显示自动播放结束，未人工确认声音；未启动真实麦克风或摄像头，不能据此宣称物理设备验收完成。

真实 Codex 单次模型请求沿用 0.1.0 的 Windows 后端证据，未声称新增真实模型调用。Chat Completions / Responses 的自动化回归使用隔离 fixture；自己的供应商仍需填入密钥后点击测试。远程 TTS/ASR 尚未接入运行；Android/Ubuntu 的目标端图形与真实音视频设备仍需实测。没有对 RK3566 板卡安装、烧录或重启。

参考： [OpenAI App Server](https://developers.openai.com/codex/app-server)、[Responses streaming](https://developers.openai.com/api/docs/guides/streaming-responses)。


公开源码不包含账号数据、配对令牌、API Key、签名私钥、原生构建缓存或本机原始验收文件。历史验收文档里的 `evidence/` 指本地记录，未作为 GitHub 内容发布。
