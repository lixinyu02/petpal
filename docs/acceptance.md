# 小伴 PetPal 0.3.0 交付与验收

记录日期：2026-09-26。源码目录：`petpal/`。本版实现原创伙伴微表情和可开关的本地系统朗读，保留 3D 小猫、两类模型协议与真实 Codex CLI。**70 项测试与生产构建通过；四个原生包已构建并取得本轮回执，Windows 最终 EXE 已实际运行。**完整源码归档已生成并通过白名单边界扫描、186 项 ZIP 成员回读及哈希核对；发布清单覆盖五个产物并与最终回执匹配。

历史交付记录分别保存在 [0.2.0 验收](acceptance-0.2.md) 和 [0.1.0 验收](acceptance-0.1.md)，旧包和证据保留。本页只按本轮实际观察记录 0.3.0，不把旧版浏览器或原生包结果当作本版验证。现有 RK3566 固件、开发板与 Codex Remote 原项目未修改。

## 本版能力

首页默认显示二次元伙伴，可切换至 3D 橘白小猫；主场景每次只有一个活动角色画布。两种形象共用名字、性格、模型连接、聊天与 Codex 历史。角色选择持久保存，切换不改变 Codex 工作区。

| 能力 | 当前实现 | 明确边界 |
| --- | --- | --- |
| 少女微表情 | 六张原创 1024×1536 RGBA PNG；局部眼眉/嘴部混合与 40×60 网格；呼吸、眨眼、轻转头、发丝摆动，以及浅笑、好奇、思考、惊讶、害羞 | 状态与常见词句触发表情；没有 Cubism Core、`.moc3` 或模型导入，不宣称语义情绪识别 |
| 文字口型 | 增量文字驱动 rest/A/E/O/M 近似形状，标点停顿，有限队列与消息消费记录避免积压重播；短回复结束后有限收尾再闭嘴 | 没有汉字读音识别或声学音素分析；系统朗读关闭时为无声演出 |
| 系统朗读 | 默认关闭；首页「语音朗读」、聊天「自动朗读回复」及「朗读上一条/停止」；完整成功回复分句播报 | 只选择匹配语言且 localService=true 的本地音色；无音色/接口受限时提示；无远程 TTS、语音输入或麦克风功能 |
| 朗读进度 | 真实 onstart 后才驱动语音口型，优先使用 onboundary；缺边界时在真实启动后估算并标明 | UTF-16 文本位置与估算均不是音素同步；start/end 事件不能证明扬声器可听 |
| 生命周期 | 停止、关闭开关、换会话、换角色、休息、隐藏窗口与离开页面清理语音；休息期间完成的回复不自动朗读 | 各端系统音色与 WebView 行为仍取决于设备 |
| 3D 小猫 | 保留短宽耳、连续脸颊/口鼻、贴脸眼睛、连续前腿、圆爪、蜷坐/睡眠；行走采用水平躯干、展开后腿、四拍短步与脚底约束 | 程序化卡通模型；本轮没有改成图片帧或更换引擎 |

实际纹理为 `idle`、`blink`、`talk`、`round`、`curious`、`warm`。素材与技术边界见 [素材说明](../public/avatars/akari/README.md)、[原始立绘提示](avatar-art-prompts.md)、[新增表情提示](avatar-expression-prompts.md)、[公开方案研究](avatar-research.md) 与 [本轮 L2 设计](workflow/2026-09-26-petpal-expressive-avatar-design.md)。旧图集/GIF 只作历史素材。

## 已取得的运行与构建验证

| 项目 | 观察结果 | 证据与边界 |
| --- | --- | --- |
| 最终自动测试 | **70 passed / 0 failed / 0 skipped**，已包含 App 与演出衔接修复后的回归 | `evidence/test-results-0.3.json`、`test-results-0.3-final.log`；Node 合同测试，不替代图形或声音验收 |
| 生产构建 | TypeScript 与 Vite 通过，保留大于 500 kB chunk 提示 | `evidence/web-build-0.3.log`；构建成功不等于每端 GPU 已实测 |
| Windows 源码 Electron | 主窗口和透明置顶桌宠分别只有一个 WebGL 角色；anime/cat 切换同步，CLI 可用/运行中/已登录；关闭后无自有残留进程 | `evidence/native/windows-v03-source/result.json`、同目录 `README.md`；源码运行，不是最终 EXE |
| Windows 最终 EXE | 实际便携程序重复通过双角色、表情、语音/UI 与 App 两项回归；限制 PATH 到 Windows 系统目录后内置 Codex 仍可运行/已登录；关闭后自有进程 0 | `evidence/native/windows-final.json` 的 portableSmoke、restrictedPath、ownedProcessesRemaining；通用 windows-final 目录已同步最终 EXE 的截图与 result |
| 表情与响应式 | 五类表情有实际帧变化和近似口型，停止后回 idle/闭嘴；390×844 手机宽度场景检查；关键表情、系统朗读和休息截图已目视检查 | 同目录 `anime-warm/curious/thoughtful/surprised/shy/mobile.png`、`anime-system-speech.png`、`app-sleep-quiet.png`；不代表真实手机 GPU/触控实测 |
| Windows 系统引擎 | 本地 Microsoft Huihui / zh-CN 的短句 probe 得到真实 start、boundary、end，outcome=ended | `systemSpeech`；`audioAudibilityVerified=false`，没有人工听音或录音 |
| 首页实际朗读控件 | 默认关闭；开启后两句收到 **2 start / 15 boundary / 2 end / 0 error**；源码运行停止后 21 ms、最终 EXE 41 ms 闭嘴，实际隐藏窗口取消当前/队列语音 | `speechUi`；真实系统事件，时延仅本次观察而非承诺；未验证扬声器听感 |
| App 单块短回复 | 单个 SSE chunk 同时包含 meta/delta/done，React/WebGL 仍呈现 warm 表情与 mouthOpen=0.428，有限收尾后回 idle/0；自动朗读关闭时没有 utterance | `appFixture.singleChunk/settled`、`app-singlechunk-response.png`；隔离 transport fixture，没有调用上游模型 |
| App 休息保护 | 手动朗读有真实 start/boundary；点击休息中断语音并闭嘴；自动朗读开启时，休息期间第二条完整回复没有创建新 utterance | `appFixture.sleepCancelled/sleepingReply`、`app-sleep-quiet.png` |
| Chrome 插件 | 两次连接及一次恢复文档调用均超时，停止重复尝试 | 本轮 UI 以 Electron 实测为证；未完成 Chrome 验收，0.2 的 browser-avatar-acceptance.json 仅保留为历史 |

本轮汇总回执为 `evidence/expressive-avatar-acceptance-0.3.json`。运行原始记录与最终包 SHA/资源回执分别保存，源码运行与最终 EXE 不混写。最终 Windows 目录中的表情、手机、系统朗读、短回复和休息截图随源码白名单归档。

## 平台交付状态

| 平台 | 0.3.0 产物 / 方式 | 当前状态 |
| --- | --- | --- |
| Web | `npm ci`、`npm run build`、`npm start`；共享前端 `dist/` | 已完成冻结后的生产构建；本轮 Chrome 未通过连接阶段 |
| Windows x64 | `releases/desktop/PetPal-0.3.0-Windows-x64.exe` | 最终 EXE 实跑与回收通过，22 项 Web / 8 项运行源码 / 6 张纹理一致；真实 TTS 事件与 App 两项回归通过；NotSigned |
| Android | `releases/android/PetPal-0.3.0-Android-debug.apk` | 版本 name=0.3.0 / code=3，v1/v2 开发签名验证、22 项 Web 资源与六纹理一致；无设备安装、GUI或语音验收 |
| Ubuntu x64 | `releases/ubuntu/PetPal-0.3.0-Ubuntu-x64.tar.gz` | 已完成 5329 项归档、6 个 ELF/权限/架构、22 项前端及 7 项运行源码核对；5016 个文件全量 SHA/大小双向一致；无 Ubuntu GUI/声音验收 |
| Ubuntu ARM64 | `releases/ubuntu/PetPal-0.3.0-Ubuntu-arm64.tar.gz` | 对应 ARM64 归档及同等核对通过，包含六张角色纹理；无 ARM64 GUI、声音或 RK3566 实板验收 |
| 源码 | `releases/PetPal-0.3.0-source.zip` | 已生成，186 项 ZIP 成员回读、白名单边界扫描与 SHA-256 核对通过；结果见 `evidence/source-package.json` |

Linux 本轮证据为 `evidence/linux-package-{x64,arm64}-independent.json` 与 `linux-package-{x64,arm64}-allfiles-0.3.json`，均明确 0.3.0、ok=true、runtimeVerified=false；完整说明见 [Linux 包审计](../evidence/linux-package-audit.md)。旧 0.2 Linux 回执已另存 `evidence/linux-0.2-final-20260926-160916/`。

Windows/Android 本轮回执分别为 `evidence/native/windows-final.json`、`android-final.json`，均明确版本 0.3.0。Windows 为 178,464,822 bytes，SHA-256 `68571c2bf5cbced70a355242314957453c2bb5e28d68b3e2e3c5021531c85129`；Android 为 21,385,677 bytes，SHA-256 `049b87d29be67bb966c1d95287958765761791e2e7927d845ab0f63e114fe3c1`。旧 Windows 完整证据目录保留于 `evidence/native/baseline/0.2.0/windows-final/`。

桌面内置 Codex CLI 仍为 0.143.0；Windows/Ubuntu 从真实 CLI 启动，Android/Web 经个人服务调用主机 CLI。发行脚本从 package.json 读取当前版本，要求回执文件名、版本、长度和 SHA 一致后才生成汇总清单，旧版回执不能用于通过新版产物校验。

## 未覆盖的运行验收

Windows 已观察语音引擎和页面事件，但没有扬声器听音或录音，不把事件成功写成声音质量通过。Android/Ubuntu 尚无目标设备 GUI、悬浮生命周期、系统中文音色或实际发声证据。Ubuntu X11 与 Wayland 的透明置顶需分别确认；ARM64 和 RK3566 不由 x64 主机结果推断。

真实 Codex 单次模型调用沿用 `evidence/codex-live.json` 的 0.1.0 Windows 后端证据：0.143.0、只读、19.312 秒返回 `PETPAL_CODEX_OK`，不属于本版新增模型调用。Chat Completions / Responses 的自动化与 App 短回复检查采用 fixture；用户供应商需配置后点击测试。

没有对 RK3566 开发板安装、烧录、切换系统或重启，也没有把旧服务当作已经升级。本轮服务预览应以其实际健康版本和启动回执为准。

## 数据与分发边界

LLM API Key 在服务主机本地明文保存，API 回读仅提供 hasApiKey；配对信息在浏览器 sessionStorage 保存。没有账户体系或云同步。系统朗读不引入额外密钥或网络 TTS，不读取麦克风。

真实 Codex 通过当前主机账户运行，默认只读工作区并逐操作审批。Android 主 WebView 使用可信 HTTPS 后端；独立悬浮 WebView 只加载 APK 内资源，没有 native JS 桥或网络回退。商业代码签名、上架与目标设备性能须独立记录。

源码白名单递归纳入 `src/avatar/`、`public/avatars/`、测试与文档，排除运行数据、令牌、私有日志、本机工具和 SDK。新白名单包含本轮版本化验收 JSON、五种表情/手机截图，以及 `anime-system-speech.png`、`app-singlechunk-response.png`、`app-sleep-quiet.png`；不纳入旧 0.2 浏览器截图充当当前证据。源码 ZIP、SHA256SUMS 与 release-manifest 已由发布脚本生成，五个产物的哈希均与最终回执一致。源码精确摘要以 `releases/SHA256SUMS.txt` 和 `release-manifest.json` 为准，本文不嵌入随文档修订变化的源码包哈希。

当前目录不是 Git 仓库，没有创建提交、推送或部署公网。[issue-4](workflow/2026-09-26-petpal-expressive-avatar-issues.md) 已完成；听音、Chrome 与 Android/Ubuntu 设备运行的未覆盖边界按上文保留。
