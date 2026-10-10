# 小伴 PetPal

可以聊天、陪伴和使用真实 Codex CLI 的个人伙伴。**0.9.11** 优化人物与页面加载、后台空闲查询和登录后的语音状态复用，并移除废弃的 3D 小猫，只保留二次元伙伴。保留语音插话打断、后台 Agent 进度与结果回报、对话归档及账号项目分类。桌面端内置 Codex、OpenCLI 与电脑／音乐控制，支持 Agent 项目目录、Qwen 图片输入和 Chat 派发 Agent。四端共用 React 界面；Node 个人服务负责账号、模型、图片、历史和 Agent 任务，支持 Chat Completions / Responses、CosyVoice 朗读和原创二次元伙伴。

**0.9.11 已正式公开发布**：下载优先使用服务器，GitHub Releases 提供备用下载。两份更新清单均为 stable / sequence 13，分别沿用 GitHub 和服务器各自的既有发布公钥，不能混用。平台验收、公开资产回读及更新结果详见 [软件内更新](docs/updates.md) 和 [0.9.11 验收](docs/acceptance-0.9.11.md)。

网页和本轮六个交付包均内置原创 **Cubism V12**：奶油白与浅橘角色，原生五官、头发与手部动作、直接鼠标／触控交互，以及跟随语音的表情和近似口型。V12 修复眼皮与眼白闭合不贴合、普通眨眼保留笑眼拱形的问题，保留原画和虹膜形状。模型使用真实 Cubism Core；CMO3 源码已保存并完成结构读回，官方 Editor 打开／保存／重导出尚未验收。历史 0.9.7 包仍内置 V11，网页更新不会替换旧包资源。详见 [V12 模型](docs/cubism/akari-natural-eyelids.md)、[眨眼验收](docs/cubism/akari-natural-eyelids-acceptance.md) 和 [本轮安装包验收](docs/acceptance-0.9.11.md)。

| 平台 | Chat 与图片 | Agent 执行位置 | 交付形式 |
| --- | --- | --- | --- |
| Web | 登录个人服务 | 同账号的在线电脑 / 中央服务器 | 0.9.11 Web 构建 / 自部署源码 |
| Android | 登录个人服务 | 同账号的在线电脑 / 中央服务器 | 0.9.11 开发签名 APK，versionCode 21 |
| Windows | 登录同一个人服务 | 此电脑 / 同账号其他电脑 / 中央服务器 | 0.9.11 x64 ZIP / 便携 EXE |
| Ubuntu | 登录同一个人服务 | 此电脑 / 同账号其他电脑 / 中央服务器 | 0.9.11 x64 / arm64 `.tar.gz` |

桌面包包含 Electron、Node 运行时、Codex **0.143.0** 和 OpenCLI **1.8.8**，无需另装 Node/npm。Agent 与 Chat + Agent 可选择执行电脑并填写该电脑上的现有项目目录，详见 [项目目录](docs/agent-project-directory.md) 和 [执行电脑](docs/execution-hosts.md)。手机和网页上的 Agent 在所选电脑执行，不会因此获得手机本地其他 App 的控制能力；网页更新也不会替换旧桌面客户端中的执行器。OpenCLI 查询目录覆盖 32 个站点、80 项查询（23 项公开查询、57 项浏览器查询），详见 [网站查询](docs/opencli-sites.md)。

## 下载与开始使用

源码仓库：[lixinyu02/petpal](https://github.com/lixinyu02/petpal)。[0.9.11 正式发布入口](https://github.com/lixinyu02/petpal/releases/tag/v0.9.11) 提供六个交付文件及校验摘要；下载中心仅显示最新正式客户端，优先使用以下服务器地址。旧 GitHub Release 保留作回退，服务器旧客户端保存在可恢复的私有归档。

- Windows 0.9.11 x64 ZIP（推荐）：[服务器下载](https://magicdatou.top:44318/downloads/PetPal-0.9.11-Windows-x64.zip) / [GitHub 备用](https://github.com/lixinyu02/petpal/releases/download/v0.9.11/PetPal-0.9.11-Windows-x64.zip)。完整解压到本地新文件夹，再双击 `PetPal.exe`；不要在 ZIP 内运行或单独移动 EXE，无需安装 Node.js / Git。
- Windows 0.9.11 x64 便携 EXE：[服务器下载](https://magicdatou.top:44318/downloads/PetPal-0.9.11-Windows-x64.exe) / [GitHub 备用](https://github.com/lixinyu02/petpal/releases/download/v0.9.11/PetPal-0.9.11-Windows-x64.exe)。无需独立安装，每次先展开内置工具，请等待启动提示。两种 Windows 包均未做 Authenticode 签名。
- Ubuntu 0.9.11 x64：[服务器](https://magicdatou.top:44318/downloads/PetPal-0.9.11-Ubuntu-x64.tar.gz) / [GitHub 备用](https://github.com/lixinyu02/petpal/releases/download/v0.9.11/PetPal-0.9.11-Ubuntu-x64.tar.gz)；arm64：[服务器](https://magicdatou.top:44318/downloads/PetPal-0.9.11-Ubuntu-arm64.tar.gz) / [GitHub 备用](https://github.com/lixinyu02/petpal/releases/download/v0.9.11/PetPal-0.9.11-Ubuntu-arm64.tar.gz)。解压后运行 `./start-petpal.sh`；完整归档、来源和 ELF 审核通过，本轮没有 Ubuntu 目标机 CLI / GUI 运行验收。
- Android 0.9.11 APK：[服务器下载](https://magicdatou.top:44318/downloads/PetPal-0.9.11-Android-debug.apk) / [GitHub 备用](https://github.com/lixinyu02/petpal/releases/download/v0.9.11/PetPal-0.9.11-Android-debug.apk)。versionCode 21，包名和开发证书保持，具备覆盖同签名旧包的条件；仍是开发签名 APK。本轮没有手机或模拟器安装验收。
- Web 0.9.11 静态包：[服务器下载](https://magicdatou.top:44318/downloads/PetPal-0.9.11-Web.zip) / [GitHub 备用](https://github.com/lixinyu02/petpal/releases/download/v0.9.11/PetPal-0.9.11-Web.zip)。需配合同版本 Node 后端。
- [0.9.11 源码归档](https://github.com/lixinyu02/petpal/archive/refs/tags/v0.9.11.zip)：发布标签固定指向 `9ff5eeca4c8117fdf14fe082053f41b7b3381121`，包含前后端和原生壳，可按锁文件重建。Windows 使用 `npm run desktop:win`，构建隔离前端并生成 EXE / ZIP，不覆盖运行中的 `dist`。

以 Release 的实际文件、校验摘要及 [0.9.11 验收说明](docs/acceptance-0.9.11.md) 为准。登录后的「下载」页提供平台、架构、版本和开发签名标记；不存在的包不会显示下载按钮，网络失败可重试。Windows EXE 实际启动、真实 Cubism 与完整手势烟测通过，ZIP 在中文及空格目录下两次冷启动通过。本轮未单独重复 ZIP 完整手势和中央服务器界面验收。Ubuntu / Android 的归档和静态审核不等于目标设备运行验收。

旧 Android 0.9.0 APK 不包含后台任务提醒，可升级至当前正式版 0.9.11；网页升级不会给旧 APK 增加原生通知服务。后台通知需要配套新版后端，验收范围见 [Android 后台任务通知](docs/workflow/2026-10-01-petpal-android-notifications-issues.md)。

Android 0.9.3 在「后台任务提醒 → 让提醒更稳定」增加省电限制、自启动设置、应用通知入口。识别小米、华为、荣耀、OPPO / 一加 / realme、vivo / iQOO、三星、魅族、华硕和其他 Android，提供对应指导。入口不可用时安全回退并说明实际打开的页面；需要升级 APK 才能使用新桥，详见 [手机后台设置](docs/android-background-settings.md)。

进入应用后先连接并登录个人服务。电脑客户端登录同一公共服务账号后自动登记为执行电脑；Web、Android 和桌面版都在 Agent 的「执行电脑」下拉框选择目标。选择电脑保持当前账号、模型和中央聊天历史，不会切换整套后端或要求重新登录。主账号在「连接与设置 → 电脑助手」配置中央 Responses 地址、模型与密钥；成员使用管理员分配的模型和 Agent 权限。中央服务器原有的本机 Codex 登录模式继续保留。

桌面主窗口关闭后继续留在托盘，也继续为当前登录账号接收任务；注销账号、切换个人服务或在托盘彻底退出会关闭这台电脑的执行连接并停止其任务。拖动伙伴窗口顶部的三个点移动窗口，点击聊天图标打开工作台。

0.9.4 桌面包已包含 Computer Use 与 [音乐 MCP 设置桥](docs/music-mcp.md)。新配置在 Windows 默认开启电脑控制、网易云 MCP、QQ MCP；Ubuntu 默认开启电脑控制与 QQ MCP，网易云桌面播放控制继续使用 MPRIS，上游网易云 MCP 不支持 Linux。已有手动关闭状态和配置原样保留。读取设置不会启动应用或安装依赖，Agent 实际调用时自动连接，并继续遵循账号完整访问权限与任务审批。音乐 MCP 首次使用仍需安装 Python、点击“准备依赖”；QQ MCP 仅查询和返回播放链接，不会据此启动 QQ 桌面播放。旧客户端需升级安装包才能获得这些原生桥。

从源码运行 Web（Node.js 22+）：

```sh
npm ci
npm run build
npm start
```

打开启动日志给出的配对链接。默认服务地址 `http://127.0.0.1:4318`。链接中的 `#token=` 用于主机 owner 配对，前端读取后会立即清除地址栏片段。普通成员使用管理员创建的账号密码登录；未认证不能访问模型、聊天、语音合成、图片和 Agent 接口。

开发模式：`npm run dev`。Vite 地址 `http://127.0.0.1:5173`，API 由 Vite 代理到 4318，在登录页登录或使用主机配对凭据。

## 对话与项目

侧栏可以切换全部对话、未分类和自己的项目，并在「当前／归档」之间查看。对话旁的更多操作提供重命名、移动到项目、归档／恢复和确认删除。项目支持创建、重命名和删除；删除项目只把对话移回未分类。新建 Chat 或 Agent 对话会继承正在筛选的项目。

归档保留消息及后台任务，手动名称不会被下一轮自动标题覆盖。删除前需要停止回复、结束后台任务并清空队列；未发送的文字和图片会保留。项目分类独立于 Agent 的执行电脑与工作目录，各账号的数据分别保存。此功能已上线网页和后端，并纳入当前 0.9.11 四端客户端。

## Chat 与图片

1. 打开「连接与设置 → 模型连接」。
2. 填写连接名称、API 地址、模型 ID 和 API Key；无认证的本地模型可留空。
3. 选择 **Chat Completions** 或 **Responses**。API 地址可以是 `https://api.openai.com/v1`，也可包含对应接口后缀。
4. 保存并点击「测试」；测试会发出真实的简短模型请求。回到工作台选择模型开始聊天。

支持中文增量回复、会话历史、停止生成、断流错误提示、模型搜索和推理强度设置（包括 max）。可发送文字、图片或纯图片；两种协议都会传递实际图片内容，后续消息保留图片上下文。Chat 不执行提供商工具调用。伙伴名字和性格提示词可以修改；摸头、投喂、休息是本地互动，不消耗模型额度。

图片支持 PNG、JPEG、WebP，每条最多 4 张、单张最多 8 MiB，边长最多 8192、总像素最多 32MP；每个账号最多保存 1000 张或 500 MiB，包含尚未发送的图片。Chat 单次上下文最多 16 张或 32 MiB，重复引用也计数。图片按账号认证读取，历史只公开所属图片的元数据。

连接可标记为仅文字；图片能力遵循管理员配置，不再按模型名称强制禁用。`halogen-qwen3.8-flash-next` 的图片能力已重新验收并启用；明确标为仅文字的连接仍拒绝含图输入，图片不会被静默丢弃。图片请求失败会保留相应内容并显示错误。

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

PC 客户端在“设备连接 → 中央服务器”提供本机服务入口，可独立启停固定端口、恢复启动设置，并声明已有可信 HTTPS 入口。其他设备使用本机服务的账号密码，共用模型、对话与执行电脑；本机页面继续使用原 loopback 连接。0.9.10 桌面包已包含该原生桥，Windows 两包的实际中央服务器设置与重启恢复通过；Ubuntu 本轮仅完成归档审核。历史 0.9.7 包不包含该桥，详见 [PC 中央服务器](docs/central-server.md)。

主机管理员在「连接与设置 → 账号」创建成员、分配模型及 Agent 授权。成员的聊天、伙伴设置、默认模型和语音配置独立；退出登录、停用、改密码或降低授权会使受影响会话失效并停止对应后台任务。

自动朗读默认关闭，每条完成的 AI 回复旁提供「朗读 / 停止」按钮，使用当前账号选择的语音引擎；点击另一条会停止上一条。关闭朗读、切换会话或账号、隐藏窗口、进入休息及离开页面会停止当前播放。二次元伙伴按实际播放进度近似同步口型，不能视为音素级唇形同步。

系统朗读使用与语言匹配的本地音色；缺少中文音色时需安装系统中文语音包。已接通的远程引擎为 [CosyVoice](docs/cosyvoice.md)：主机管理员配置固定服务、参考声音及可选密钥，成员可以选择、试听并朗读消息。CosyVoice3 支持按账号保存自动、原声复刻、自然、开心、伤心、生气、轻柔，以及情绪程度；人物在实际播放时跟随上游选择的语气。自动是文本规则，口型仍为播放进度和能量近似。1倍速边生成边播放，其他语速完整合成。音频通过已认证的个人服务返回，失败不自动换成系统音色。新增情绪元信息由新版客户端协商取得，已发布旧安装包仍可播放。

通用远程 TTS、个人远程 ASR 和浏览器识别选项仍为**配置预备**；伙伴语音聊天独立接入管理员配置的共享 WebSocket ASR。主动开启后走 ASR→Chat→分段 CosyVoice。0.9.10 在回答时保留麦克风和浏览器回声消除，以持续语音门限检测插话；插话会取消旧 Chat、TTS 与排队句子，等待停止回执后识别并发送新输入，按钮打断仍可用。共享 ASR 仍为 60 秒有限会话，保存配置不会开启录音。后台 Agent 的新进度与结果加入父 Chat，语音模式在空闲时朗读新回报。功能证据见 [语音打断与 Agent 回报](docs/workflow/2026-10-06-petpal-voice-interrupt-agent-reports-design.md)；早期半双工行为保留在 [9 月上游验收](docs/workflow/2026-09-30-petpal-upstream-voice-acceptance.md)。实体麦克风、扬声器回声、主观听感和 Android / Ubuntu 真机仍需分别验证，本轮打包没有重新进行真实上游语音端到端验收。

「语音与设备」可选择本机麦克风、摄像头和扬声器。主动点击「测试麦克风」「预览摄像头」「播放测试音」才开始对应测试；输入测试不录制、不上传。停止、隐藏页面或切换账号会释放媒体轨道。设备选择按服务实例和账号保存在当前浏览器，不能同步到其他设备。

扬声器选择只用于支持输出路由的网页音频。**系统 TTS 始终使用系统默认输出**；不支持网页输出路由的浏览器也使用系统默认扬声器。设备流程见 [账号与语音配置](docs/user-accounts-and-voice.md)，当前能力和证据以 [0.7.0 验收](docs/acceptance-0.7.md) 为准。

## 二次元伙伴

首页、Windows / Ubuntu 桌宠窗口及 Android 悬浮窗统一使用二次元伙伴。旧版保存的小猫选择兼容为二次元显示，不改变名字、性格、模型连接、账号、聊天与 Agent 历史。

二次元伙伴使用原创 Cubism V12 的 `.model3.json`、`.moc3`、纹理、动作与物理资源，由官方 Cubism Core 6.0.1 实际加载；运行源码位于 `src/avatar/cubism/`，当前模型位于 `public/avatars/akari-cubism-v12/`。22 个原生参数涵盖眼睛、眉毛、嘴、头发及手部，提供呼吸、眨眼、轻微转头和丰富表情；鼠标／触控在头部、手部等区域触发对应交互。文字进度或实际声音能量驱动近似口型，不能视为音素级唇形识别。CMO3 已结构读回，官方 Editor 重导出尚未验收，详见 [V12 模型与来源](docs/cubism/akari-natural-eyelids.md)。八张原创立绘、无损 WebP、网格形变和 GIF 属于历史方案与素材，保留原始 PNG 于 `artwork/akari/`；历史说明见 [角色方案研究](docs/avatar-research.md) 与 [表情生成记录](docs/avatar-expression-prompts.md)。

3D 小猫已废弃；当前包不再包含小猫渲染模块、模型或动画资源。Three.js 仍用于二次元伙伴在 Cubism 不可用时的恢复渲染，不参与正常 Cubism 加载。

伙伴支持直接鼠标或触控交互，头部抚摸、手部动作和语音倾听姿态由对应区域与状态触发；休息可通过「叫醒」结束。页面隐藏时暂停，遵循系统减少动态效果设置。`/?animations=1` 旧书签也打开当前伙伴首页。旧版图集与 GIF 作为历史素材保留。

## Android 与多端连接

Android 是 Capacitor 原生应用，内置共享界面；手机不运行 Codex 二进制，Agent 由同账号选择的执行电脑或中央服务器运行。「连接与设置 → 设备连接」中的「开启悬浮伙伴」请求系统悬浮窗权限；返回应用后再次点击开启，通知栏可随时停止。悬浮窗只加载 APK 内的当前角色资源，无原生 JS 桥或网络回退，不会自动开启悬浮权限或开机常驻。

Android 0.9.2 在「连接与设置 → 账号 → 后台任务提醒」折叠区域提供通知功能。先登录可信 HTTPS 服务，在应用前台点击「开启后台提醒」并允许系统通知。独立原生前台服务长轮询当前账号的任务事件，任务仍由 Agent 中选定的远程电脑执行。后台提醒与悬浮伙伴是独立开关。

常驻通知和设置内的「停止提醒」都可停止监听。首次开启以当前事件位置为基线，不回放旧任务；已启用期间断网会从保存的位置补收，最多保留 500 条 / 30 天。通知仅含任务状态，设备凭据只能读取/确认提醒及撤销自身，以 Android Keystore 加密保存。点击后验证同一服务、账号和会话归属，直接 Agent 打开任务对话，Chat 派发任务返回父 Chat；若需要重新登录，匹配身份后再打开，通知凭据不会替代聊天登录。直接 Agent 的需登录点击流程已在 API 36 模拟器实测通过，Chat 父对话定位由后端/controller 测试覆盖。

恢复后若显示「已停止，需要重新开启」，请手动点击「重新开启」；「正在启动」表示服务尚在启动，不需要重复点击。「系统设置」打开小伴的系统应用设置页，再由用户检查通知权限或电池限制，并不会自动申请省电豁免。退出、换账号、服务切换、权限失效或登录到期会撤销监听，通知凭据不会替代聊天登录。

这采用直接连接个人 HTTPS 后端的前台服务，不依赖 Google 或厂商推送账号。系统强制停止应用、重启设备或厂商省电限制后不保证继续接收，重新打开界面也不会自动开启已停止的监听。没有自动开机启动、唤醒锁或自动电池豁免。specialUse 用途是用户开启的持续任务提醒，未来商店上架需另行满足其声明和审核要求。

Android 使用 HTTPS WebView，禁止混合内容和明文 HTTP；0.7.0 原生远程请求支持流式回复、认证图片上传与音频字节。部署到手机可访问的可信 HTTPS 地址，在连接窗口填写服务地址并登录；主机 owner 也可使用配对凭据。Web 跨来源部署需把访问 Origin 加入精确名单，反向代理需保持 SSE 不缓冲：

```sh
PETPAL_ALLOWED_ORIGINS=https://localhost,https://pet.example.com
```

`https://localhost` 是 Android WebView 的来源，不是服务地址。默认监听 127.0.0.1，可与同机 HTTPS 反向代理配合；需要直接监听网卡时显式设置 `PETPAL_HOST`。不要把令牌或模型 API Key 放进公开网页、构建产物或截图。

## 软件更新

「连接与设置 → 软件更新」显示客户端版本，并支持 **GitHub Releases / HTTPS 服务器** 两种来源。主机管理员选择来源并配置对应 Ed25519 公钥；成员须登录后检查更新，桌面程序下载和交接仅由本机主账号执行。

- GitHub：`source: "github"`，公开仓库 `lixinyu02/petpal`，继续使用原 [GitHub 发布公钥](docs/petpal-update-public-key.txt)。
- 服务器：`source: "server"`，清单地址 `https://magicdatou.top:44318/downloads/updates/petpal-update.json`，使用同目录的独立 [服务器发布公钥](https://magicdatou.top:44318/downloads/updates/update-public.pem)。服务器资产与重定向限定清单同源、所在目录及子目录。

两种发布身份的公钥不能交叉使用。切换来源、清单地址、仓库或公钥会改变配置 revision，须重新检查；同公钥的防回滚序号记录会保留。Windows 下载并校验后打开新版便携程序，保留原 EXE；Ubuntu 定位校验后的归档，由用户解压启动；Android 核对 APK 包名、签名与版本后交系统安装器；Web 仅在当前站点已部署新版时提供刷新。发布流程与签名命令见 [更新与发布](docs/updates.md)。

服务器更新源最初只上线网页与后端。Android 0.9.2 包含新版来源选择和原生下载支持；Windows 与 Ubuntu 以各自安装包的版本为准，网页升级不会改变旧包的原生能力。

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

Android APK 构建：Windows 使用 `scripts/build-android.ps1`，Linux 使用 `scripts/build-android.sh`；要求 JDK 21 和 Android SDK，输出 debug APK。脚本默认单独构建 `.data/android-web-build`，不覆盖已部署的 `dist`；文件名和界面版本取自 Android `versionName`。PowerShell 的 `-WebDirectory` / `-OutputDirectory` 可指定验收目录，已有同名不同内容 APK 会拒绝覆盖。Ubuntu 两架构 portable 包的构建与逐字节校验见 [Ubuntu 打包](docs/linux-packaging.md)。`npm run desktop:linux` 是另行配置的 AppImage / deb 构建入口，本轮交付格式为 `.tar.gz`。X11、Wayland 与 ARM64 图形 / 桌宠行为需要分别实机确认。

项目结构：`src/` 共享前端；`src/avatar/` 二次元伙伴与 Cubism 渲染；`src/pet/` 共享互动与行为；`public/avatars/` 原创角色资源；`server/` 认证、持久化、图片、模型协议与 Codex 进程；`desktop/` Electron；`android/` Android 与悬浮服务；`tests/` 自动测试；`evidence/` 本地验收结果（不纳入 Git）。

## 验证范围

当前记录见 [0.7.0 验收](docs/acceptance-0.7.md)。自动化覆盖两种模型协议、登录隔离、授权撤销、队列 / steer 幂等、重启恢复、图片归属与限额、原生传输和下载目录。

历史0.7.0 后端已有真实 `gpt-6-luna` Responses 文字与单图请求成功，以及真实 Codex CLI 只读 + 询问任务完成的证据；本机与可信 HTTPS 入口返回相同服务实例，匿名语音、图片、下载和 Agent 请求均被拒绝。后续版本已接通共享ASR和CosyVoice3情绪语气，当前证据以对应 workflow 验收为准。

0.9.4 Windows 最终便携 EXE 已实际启动，并完成 Computer Use 70 项工具发现；相关 manager、API、桌面执行器、音乐与打包回归 184／184 通过。Ubuntu x64 / arm64 完整归档与 ELF 审计通过，尚无这两份新包的实体 GUI 运行证据。Android 仍为 0.9.3 / code 13 开发签名包，模拟器与厂商实体手机验收分别记录。真实麦克风、摄像头、物理音频与各平台桌宠效果需在目标设备验证。本轮未对 RK3566 板卡安装、烧录或重启。

Android 0.9.2 最终 APK 已通过独立 API 36 模拟器的直接 Agent 设备链路：真实 Qwen/Codex 任务退后台完成、设备凭据加密、系统通知可见、实际系统点击启动 Activity、重新登录后验证并打开任务对话，以及注销后的原生清理和服务端撤销。失败任务、Chat 父对话、切换 scope、去重与恢复另由后端/controller/native 测试覆盖。该结论不扩展为 Android 13～15、实体手机、厂商省电、长期电池表现或全部冷启动/断网/切账号设备矩阵通过。Node 自动测试、原生单元测试、APK 审计与设备实测分别记录。

参考：[OpenAI App Server](https://developers.openai.com/codex/app-server)、[Responses streaming](https://developers.openai.com/api/docs/guides/streaming-responses)。

公开源码不包含账号数据、配对令牌、API Key、签名私钥、原生构建缓存或本机原始验收文件。历史验收文档里的 `evidence/` 指本地记录，未作为 GitHub 内容发布。
