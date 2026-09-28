# 小伴 PetPal 0.2.0 交付与验收

记录日期：2026-09-26。源码目录：`petpal/`。0.2.0 双角色、四端构建和主机侧验收已完成。Windows 最终程序实际运行通过；Android 与 Ubuntu 保留目标设备未验证边界。下文不将 0.1.0 包结果算作本版验收。

0.1.0 原始交付记录完整保存在 [acceptance-0.1.md](acceptance-0.1.md)，既有图集、GIF、日志与回执保留。现有 RK3566 固件、开发板及 Codex Remote 原项目未修改。

## 本版范围

首页默认显示二次元伙伴，可切换到 3D 橘白小猫；每次只运行当前角色的渲染器。两种形象共享名字、性格、模型连接、聊天和 Codex 历史。`settings.companionKind` 持久保存 `anime` / `cat`，旧数据补默认值；切换不新建会话或改变 Codex 工作区。

| 角色 | 实现与动作 | 边界 |
| --- | --- | --- |
| 二次元少女 | 原创 1024×1536 RGBA PNG 立绘；40×60 网格形变；眼睛与嘴部局部混合；呼吸、眨眼、轻转头、头发摆动、抚摸回应、休息和互动口型 | 没有 Cubism Core、`.moc3` 或模型导入；没有语音输入与 TTS。聊天文本流可驱动口型，但没有音素同步 |
| 3D 小猫 | 连续几何与关节模型；重整短宽耳、脸颊/口鼻、贴面眼睛、前腿和圆爪；保留静坐、蜷睡，行走展开后腿并采用水平躯干、四拍短步、脚底高度约束；另有抚摸、进食、跳跃 | 程序化卡通角色；效果仍依赖目标设备 WebGL、GPU 和窗口合成环境 |

角色资源、提示词与技术取舍见 [素材说明](../public/avatars/akari/README.md)、[生成提示](avatar-art-prompts.md)、[方案研究](avatar-research.md) 和 [3D 渲染说明](renderer-decision.md)。本版借鉴公开项目的结构设计，未集成第三方角色或 Cubism 运行库。

页面隐藏时暂停，离开场景释放渲染资源，系统减少动态效果设置限制动作。`/?animations=1` 旧入口打开当前伙伴首页，不再承担四动作图集预览。旧动画只作为 0.1.0 来源记录保留。

## 已执行检查

| 项目 | 已观察的结果 | 证据与适用范围 |
| --- | --- | --- |
| Web 生产构建 | TypeScript 与 Vite 构建通过；有大于 500 kB 的 chunk 提示 | `evidence/web-build-0.2.log`；构建成功不替代目标设备图形验收 |
| 自动化合同测试 | **52 passed / 0 failed / 0 skipped** | `evidence/test-results-0.2.json`、`test-results-0.2-final.log`；覆盖后端、提供商、Codex 生命周期、行为状态、双角色设置/迁移与离线偏好/串行同步 |
| Windows 源码运行 | 双角色在主窗口与透明置顶桌宠均实际渲染；各自只有一个 canvas；切换同步；少女口型与闭眼状态、390×844 窗口检查；CLI 可用、运行中且已登录 | `evidence/native/avatar-review-final-source/result.json` 与同目录截图；这是开发源码运行，**不是最终便携包验收** |
| 猫模型与步态 | 侧姿截图确认四足站姿；模型级检查覆盖三档速度和 12 组坐/睡/吃/走过渡；稳定步态保持 2–3 只支撑脚，抬脚约 0.055 模型单位；调用方根节点位置/转向保留 | `evidence/native/avatar-review-final-source/cat-walk.png`、`cat-main.png`；模型地面检查使用精确顶点边界，不等于移动设备性能验收 |
| Android 原生源码 | 编译通过；**5 项资源策略测试通过**，校验固定本地资源、来源/协议、路径穿越、角色导航及严格 enum | `evidence/native/android-avatar-policy.json`；`deviceRuntimeVerified=false`，未安装到设备或模拟器 |
| 真实 Codex 模型请求 | Windows CLI 0.143.0 单次只读请求，19.312 秒返回精确 `PETPAL_CODEX_OK`，进程结束成功 | `evidence/codex-live.json`；**沿用 0.1.0 后端协议证据**，不是本版新增模型请求或打包验证 |
| Chat Completions / Responses | 既有 Chrome 协议/交互验收与当前自动测试使用隔离本地 HTTP fixture | `evidence/browser-acceptance.json` 为 0.1.0 记录；支持协议兼容判断，不代表用户供应商已经实测 |

前述 Windows 源码检查的截图包括 `main.png`、`pet.png`、`anime-mobile.png`、`anime-talk.png`、`anime-sleep.png`、`cat-main.png`、`cat-pet.png`、`cat-walk.png`。桌宠窗口可独立运行，角色静止图像不替代帧计数、交互状态与实际渲染检查。

## 平台交付状态

| 平台 | 0.2.0 产物 | 已验证与边界 |
| --- | --- | --- |
| Web | `dist/`，源码可 `npm ci && npm run build && npm start` | Chrome 角色交互/切换/刷新保留/聊天与Codex入口、零控制台错误通过；`evidence/browser-avatar-acceptance.json` |
| Windows x64 | `releases/desktop/PetPal-0.2.0-Windows-x64.exe` | 最终 EXE 实跑、单实例双角色、透明像素、内置 CLI 及退出回收、26项包内运行资源 hash 通过；`evidence/native/windows-final.json`；未商业签名 |
| Android | `releases/android/PetPal-0.2.0-Android-debug.apk` | 开发签名、原生类、全部18项Web资源与三张角色纹理逐字节通过；`evidence/native/android-final.json`；未安装目标设备 |
| Ubuntu x64 | `releases/ubuntu/PetPal-0.2.0-Ubuntu-x64.tar.gz` | 5325项归档、6个原生ELF与权限/架构、18项前端资源、后端与CLI一致性通过；`evidence/linux-package-x64-independent.json`；未运行Ubuntu GUI |
| Ubuntu ARM64 | `releases/ubuntu/PetPal-0.2.0-Ubuntu-arm64.tar.gz` | 同上，对应ARM64 ELF；`evidence/linux-package-arm64-independent.json`；无ARM64 GUI/RK3566实板运行证据 |

所有最终包均包含当前两类角色资源；旧版产物保留。Windows 运行时 package.json 由 electron-builder 规范化，按移除 scripts/devDependencies 的预期结果与运行包内容核对，其他源码/资源逐字节一致。Linux 两份 independent 回执均 ok:true，最终包不含 .data/.tools/preview 或个人认证目录。校验摘要见 `releases/release-manifest.json` 和 `SHA256SUMS.txt`。

本轮独立 Web 预览为 `http://127.0.0.1:4320/`，健康检查版本0.2.0，使用新建的隔离数据。原4318旧服务的重启受到自动审批审查阻止，未终止或修改其数据；不把原服务当作已升级。
Ubuntu X11 与 Wayland 的透明置顶能力需分别确认。本机普通 WSL Ubuntu 的既有 VHDX 缺失，未用其他专用系统替代 GUI 验收；没有绕过 Electron 沙箱，没有对 RK3566 实板安装、烧录或重启。

## 使用与数据边界

Chat/Responses 使用用户配置的 API 地址、模型和 API Key；实际供应商需保存连接后点击测试。后端本地明文保存 API Key，API 回读仅暴露 `hasApiKey`。服务令牌是访问凭据，浏览器仅在当前 sessionStorage 保存配对信息；未实现账号体系和云同步。

Windows/Ubuntu 通过真实 `codex app-server` 使用当前主机登录，默认只读工作区，支持任务取消和逐操作审批。Android/Web 远程连接个人服务，由服务主机执行 Codex；Android 不内置执行 CLI。Android 主 WebView 仅连接可信 HTTPS 后端，独立悬浮 WebView 只加载包内角色资源，没有 native JS 桥或网络回退。

本版 Windows 没有商业代码签名，Android 为开发签名；设备性能、系统悬浮权限及商店上架未验收。

## 来源与归档

参考用户指定的 Codex Remote 会话及进程协议设计，未复制其未提交修改、凭据或业务数据。当前目录不是 Git 仓库，没有提交、推送或部署公网。

源码打包脚本纳入 `src/avatar/`、`public/avatars/` 与本版文档，排除运行数据、令牌、私有日志、本机构建工具、SDK 缓存和依赖目录。源码交付为 `releases/PetPal-0.2.0-source.zip`，由白名单脚本生成并复核成员/哈希；配套 `SHA256SUMS.txt` 与 `release-manifest.json` 覆盖五个最终产物。

## 后续 0.3.0 开发状态

0.3.0 正在实现更细腻的微表情和默认关闭的系统语音朗读，包括停止、朗读上一条、真实语音状态驱动与性能/资源清理。项目版本元数据升级不代表功能或原生包已完成验收。只使用匹配语言的本地音色；缺少音色或平台不支持时应明确提示，估算口型不等于音素同步。

以上正文继续记录已经交付的 0.2.0，现有包、源码归档、回执和哈希保留。0.3.0 的功能测试、实际听音、最终 Windows/Android/Ubuntu 包及新摘要需在冻结后单独补齐，不得由 0.2.0 结果推断。当前仅 [issue-4](workflow/2026-09-26-petpal-expressive-avatar-issues.md) 为 in_progress，完整范围见 [L2 设计](workflow/2026-09-26-petpal-expressive-avatar-design.md)。
