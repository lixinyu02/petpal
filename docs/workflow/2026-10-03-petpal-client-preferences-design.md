# 客户端启动与窗口偏好

- Date: 2026-10-03
- Complexity: L1
- Baseline: main 0e1fbc0
- Scope: Windows/Ubuntu 本机启动与窗口行为，四端设置入口及兼容提示。既有 Android 后台提醒与系统引导不改变权限。

## 目标与交互

在“设备连接”提供本机设置：开机自启、启动时最小化到托盘、启动显示桌宠、关闭主窗口留在托盘、桌宠置顶。默认保持现有行为，自启关闭、启动最小化关闭、桌宠显示/托盘/置顶开启。设置归属当前安装设备，不同步为远程执行电脑的设置，也不自动登录或授权 Agent。

视觉沿用安静的浅色背景与绿色开关，以简短说明、分隔行和明确读回状态组织。使用已有设置标签，不增加常驻首页控件；窄屏文字可换行而开关不压缩。交互只使用保存中反馈和状态切换，禁用重复操作，失败保留旧读回并可刷新。

## 实现

- 主进程以固定 app-preferences.json 原子持久化严格布尔偏好；恢复默认不能覆盖坏文件。状态读取以 OS 真正自启设置为准，不把文件中的请求意图当成系统已启用。
- Windows 使用 Electron 登录启动 API；便携版注册真实外壳路径，不能登记每次解包的临时 EXE。Ubuntu 使用 XDG autostart 下固定本应用 desktop entry，AppImage 注册 APPIMAGE 路径。开发启动不允许登记源码/工具路径。
- Windows 运行进程与自启条目使用固定 com.petpal.desktop ID；内部保留已登记目标，供便携客户端移动后的精确读回和失败恢复，不通过 IPC 接受路径或将路径返回页面。加载偏好不会迁移或修改系统启动项。
- 本机 IPC 仅可信主窗口；修改重复校验当前登录连接与固定 auth/me 身份，支持普通、远程和 Chat-only 用户，不依赖 Agent 权限。拒绝账号切换后的旧操作。
- 主窗口启动隐藏到托盘、首次桌宠显示、关闭退出/隐藏、桌宠即时置顶均消费同一持久状态。关闭退出使用现有完整 app.quit，保留任务中断提示。
- 退出先关闭设置写入入口，并等待正在保存的操作撤销未完成的系统变更，之后才结束进程；不能在系统启动项已写、偏好尚未提交时直接退出。
- Web 无法设置系统自启，提供桌面下载入口；旧桌面 bridge 显示更新说明；Android 将现有后台提醒与厂商自启动/省电入口统一放到设备设置。不会宣称手机重启自动恢复监听。

## 验证与交付边界

测试 OS 适配读回、便携路径/转义、并发保存与失败回滚、IPC 登录/切换竞态、窗口与退出行为、UI 过期响应。完成 TypeScript、生产构建和完整回归；Chrome 验收 Web 提示、模拟 bridge 的五项设置与 412×960；可用时用独立 Electron profile 验收真实窗口，系统自启只在隔离 fixture 验证，避免修改当前电脑的自启。打包白名单覆盖新模块，已有 0.9.7 安装包保持不变，待重新打包后新 PC 设置才对正式客户端可用。

## 已取得的界面与部署证据

- Chrome 插件访问正式 HTTPS 网站，以 test 账号验证“设备连接”的 Web 说明、下载入口，以及旧客户端缺少 bridge 时的更新提示；下载入口切换当前工作区视图。
- 同一临时 Chrome 页注入只存在于内存中的模拟 preferences bridge，操作五个开关并核对读回值。412×960 CSS viewport 的文档宽度为 412，五个开关的输入区域均为 44×44。证据为 evidence/client-preferences-20261003/chrome-verification.json、preferences-412.jpg；它验证 UI，不代表系统自启实机验收。模拟随后通过 reload 清除，账号退出，视口恢复，测试标签页关闭。
- 静态部署只新增 10 个带内容哈希的 JS/CSS 文件并原子替换 index.html，旧首页保存在私有目录。公网 12 项资源完整 SHA-256 比对通过；V12 MOC 未改变，后台 4318 未重启，下载包与更新清单未修改。证据为 deployment.json 与 public-verification.json。
- Windows Electron 39.8.10 独立 profile 的真实 IPC 读写、JSON 持久化、桌宠 native topmost 取消与恢复、真实设置面板五个开关均通过，进程正常 exit 0；native-ui-smoke/startup-result.json 与 preferences.png 为最终证据。开发环境自启禁用，systemAutoLaunchChanged=false，没有写当前用户的实际 Run 项。此结果不替代安装包的 OS 登录重启验收或 Ubuntu 实机验证。
- Windows/Linux 系统适配 35 个 fixture 覆盖真实 API 语义、固定注册名、含空格路径、移动目录、系统禁用、写盘/OS 失败回滚、私有元数据、关闭等待队列与鉴权竞态；登录 IPC 20 项、窗口/启动逻辑 18 项、设置组件 12 项及既有 workspace-storage 3 项，共 88 项聚焦回归通过。
- 最终完整回归以 `node --test --test-concurrency=1 tests/*.test.mjs` 执行，1678/1678 通过，0 failure/cancel/skip。并发运行出现的计时敏感用例另保存原日志，独立运行的 MCP/CosyVoice 85 项也全部通过；没有为通过检查而改变生产计时参数。既有 executor-relay 用例修复了 durable acknowledgement 早于异步 dispatch 的测试竞态，改为 5 秒总期限内持续实际取件，保留所有权限和密钥隔离检查。
- TypeScript、生产 Vite 构建和语法检查通过。公开源码以 Git index 的实际 blob 审计，测试只使用合成标记，没有提交用户凭据、设备路径、运行数据或证据。完整测试日志为 full-tests.log；系统重启自启及 Ubuntu/Android 实机仍是下一轮安装包验收范围。
