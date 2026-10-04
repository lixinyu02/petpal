# 四端交互与恢复体验迭代

- Date: 2026-10-04
- Complexity: L2
- Status: final
- Baseline: `512cbc692b9e9391c31b581848cd24d7e452ed88`，local main，开工 clean。

## Background and Goals

Web、Android 与 Windows/Ubuntu 使用相同工作台，原生壳负责系统返回、桌面窗口与设备生命周期。本轮修复检查中确认的实际体验缺口：短窗口下载内容被裁切、普通弹层焦点离开背景、Android 返回直接退出、中文输入与移动换行不一致、权限设置返回后设备列表不刷新、桌面启动期间再次打开意图丢失以及浮窗渲染失败不能恢复。

视觉延续暖白、墨绿和现有 V12 伙伴；内容保持人物/聊天工作区为中心，交互保持短过渡、明确焦点和触控可达。复用 adaptive-dev-workflow 与 frontend-skill，单个集成 issue 中按独立模块协作，统一冻结验收。

## Solution

- 下载区域作为有限高度中的滚动区域，保留顶栏、窄屏布局与安全区。
- 共享普通弹层与移动导航提供焦点移入、Tab 圈定、Escape 关闭和关闭后恢复焦点。已有模型选择器与 Chat + Agent 弹层保持自己的嵌套处理优先级。
- Android 原生只向可信本地、前台主 WebView 派发可取消的返回事件；前端优先关闭顶层 UI，其次从设置/下载回聊天，最后从聊天回伙伴主页。未消费才交给系统返回。单次 pending、页面导航/后台切换失效，不提供新的可由任意 JS 调用的原生接口。缺 WebView 时保留 Capacitor 原有提示，避免 NPE。
- 中文 IME 组合/229 不发送；移动 Enter 换行，桌面 Enter 发送，Ctrl/Cmd+Enter 在各端发送；按钮继续可用。
- 返回前台时重新枚举音视频设备，多个恢复事件去重；旧页面/账号的迟到响应无效，不覆盖语音配置草稿。
- Windows/Ubuntu 启动尚未就绪时保留手动二次打开意图，自启动仍遵循不抢焦点的偏好；桌宠渲染失败只清理失败浮窗，后续可重新打开，主窗口/后端/执行任务继续保留。

## Boundaries and Risks

不改变账号权限、Codex 任务提交/自动访问行为、生产 ASR/TTS 配置、模型资产或正式 0.9.7 下载安装包/签名清单。仅因手机返回或 UI 清理，不得取消任务、重复发送、提交表单或自动保存草稿。返回与焦点需要尊重嵌套弹层；IME 必须按组合状态而非键名猜测；原生迟到 callback 不得退出新页面。

本轮网页独立上线；原生源码通过真实编译/隔离运行验收。正式安装包仍为 0.9.7，本轮不重新发布。安装包/物理设备的证据分别记录，不以 Chrome 视口模拟替代 Android 或 Ubuntu 实机验收。

## Verification

实际 TSX/DOM 控制器、Java 返回状态 policy、生产 Electron VM 生命周期回归；TypeScript、最终全套串行回归和生产构建。Chrome 插件检查 412×960、320 宽/短屏、下载底部可达、导航/弹层 Tab/Escape/焦点恢复、输入换行与模型菜单/图片定位。Android Java/Gradle 构建与 Windows Electron 隔离 smoke；Ubuntu 共用壳与打包模块契约验证。静态部署备份和公网 hash核验，正式下载与 V12 模型逐字节保持。精确提交同步 GitHub。

## Results

- 完整串行回归 1884/1884，0 失败、0 跳过；新增 59 项覆盖实际 App 输入/返回、设备恢复、真实弹层控制器和桌面生命周期回调。TypeScript 与 production Vite 构建通过，保留既有延迟加载的 three chunk 体积提示。
- Chrome 插件在隔离后端验证 412×960 触屏 Enter 换行、Ctrl+Enter 单次发送、本地 Responses 流式回复、公开图标上传与预览；1280×800 桌面 Enter 发送。导航 Tab/Shift+Tab 圈定和 Escape 恢复、模型 autofocus 恢复、账号编辑、图片、Chat + Agent 内嵌模型的分层返回通过。测试返回事件由本地 QA 页面 F8 提供，不冒充 Android 按键。
- 320×540 下载页内部滚动区 clientHeight=488、scrollHeight=1056、scrollTop=568，底部可达，document scrollWidth=320；正式网页另以 412×960 与 320×540 复核。
- Android JDK 21 / Gradle offline 重新编译 MainActivity，BackNavigationPolicyTest 8/8 通过；缺 WebView 的 onCreate 和新 Intent 入口都有 guard。没有生成 APK 或 Android 真机验收。
- Windows Electron 39.8.10 startup-only 在全新用户目录/CODEX_HOME 中 exit 0、7.85 秒、遗留进程 0；登录门禁、回环后端、本机执行器登记、Codex 可用与 OpenCLI 1.8.8 只读探针通过。没有使用生产账号、模型、Agent、语音或系统自启；第一次验收失败来自隔离 CODEX_HOME 未预建，修正验收环境后通过。Ubuntu 共用生产 main.cjs 的 VM 与源码打包合同通过，未进行 Ubuntu 实机/安装包运行。
- 源码包检查 1203 文件，boundaryScan=pass；模型、0.9.7 release-manifest、SHA256SUMS 和已签名升级清单逐字节保留。
- 网页静态上线，无后端重启；公网 index SHA-256 与构建一致：`82a5471888f82771240a181bada87332aceb7dc02a170a015cf9b4341fd63938`。部署备份、原生回执、全回归日志和 Chrome 截图在忽略的 `evidence/platform-ux-20261004/`。

## Delivery Boundary

共享网页更新已经生效。Android、Windows、Ubuntu 的客户端源码修复包含在本轮提交中，已发布的 0.9.7 安装包需要后续重打才能获得这些改动；没有将源码/Chrome/开发 Electron 验证记为安装包或物理设备验收。生产聊天、模型配置、任务、语音服务及 RK3566 固件保持。
