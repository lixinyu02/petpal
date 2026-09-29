# 412×960 与多端自适应验收

- 日期：2026-09-30（Asia/Shanghai）
- 实现：`9e78591bcfcb97743d21282fe398d35e624eeb4c`
- 范围：共享前端、Electron 与 Android 原生源码；仅更新网页，不重制安装包或 Release，版本仍为 0.9.0。

## 修改

陪伴首页以可用视口安排标题、角色舞台与底栏。二次元伙伴和 3D 小猫随舞台缩放；矮横屏改为横向构图。工作台在窄屏将模型和执行电脑分行，扩大主要触控入口，缩短视口时压缩输入区并保留滚动空间。权限、主机帮助和语音弹层按可视视口定位，保留缩放与 Escape 归焦。

Electron 主窗口不再强制 760×540，按显示器工作区限制尺寸；桌宠等比缩放并在显示器变化后重新限位。Android 明确 adjustResize，悬浮伙伴响应可用区域、旋转、密度、分辨率及 Insets 变化。新增原生模块已纳入 Windows/Linux 打包与读回校验清单。

## 自动验证

- `npx tsc --noEmit` 通过。
- `npx vite build --outDir evidence/adaptive-screen/dist` 通过；只有已有大于 500 kB 的构建分块提醒。
- `node --test tests/desktop-window-layout.test.mjs tests/native-overlay-entry.test.mjs tests/companion-interaction.test.mjs tests/companion-preference.test.mjs`：32/32 通过。
- Electron 额外窗口/既有 smoke 验证 9/9 通过，与上述 32 项部分重叠，不累加计数。
- Linux 清单一致性回归 `tests/linux-source-manifest.test.mjs`：1/1 通过，覆盖新 helper 的源码哈希规则。
- Android 离线 `:app:compileDebugJavaWithJavac :app:testDebugUnitTest` 成功，5 份 JUnit XML 共 25 项、0 failures/errors，其中新增几何边界测试 8 项。报告在 `android/app/build/reports/tests/testDebugUnitTest/index.html`；未声称存在独立 Gradle 日志。

## Chrome 页面验收

优先使用 Chrome 插件，隔离预览与线上均检查真实渲染。视口为 CSS 像素，避免浏览器 75% 桌面缩放导致尺寸读数混淆。

| 尺寸 | 检查 | 结果 |
| --- | --- | --- |
| 412×960 | 二次元与 3D 首页 | 页面宽 412、高 960；舞台约 379×582.8，人物完整，导航与底栏可见 |
| 412×960 | Chat、Agent、模型菜单、主机帮助、语音选项 | 模型/主机分行、标签不折断；弹层在视口内；消息区与输入区独立可用 |
| 412×960 | 设置 | 页面宽 412；设置标签可横向滚动，内容可纵向滚动，无页面横向溢出 |
| 360×640 | 3D 首页 | 舞台约 327×274，底栏位于 580–640，无横向溢出 |
| 412×560 | 模拟缩短视口、审批与排队 | 停止按钮 44×44 可达；权限弹层约 x16–366、y174–366；队列可展开、停止后暂停、恢复后完成 |
| 650×412 | 二次元首页断点 | 舞台约 244.3×308，三列构图，无横向溢出 |
| 700×412 | Agent 中等宽度矮窗口 | 页面宽 700，主机选择宽 328；顶部可滚动，输入区底边为 412 |
| 960×412 | Agent 横屏 | 页面宽 960，消息区域约 707×105.5，输入区底边为 412 |
| 1280×800 | 桌面 Agent | 页面宽 1280，消息区域约 992.6×392.4，输入区底边为 800 |

隔离 fixture 使用合成账号和模拟主机，不调用真实 LLM、Codex CLI 或电脑软件。本轮不重复上一轮真实 Agent 任务验收。缩短视口是浏览器模拟，不等同于安卓真机软键盘证据。

自审修正了 Agent 模型标签折行、651–899px 矮窗口强制并排导致主机名称挤压，以及 Linux 校验规则漏掉新窗口 helper 的问题。

## 网页部署

00:54:01 完成备份部署，部署前验证任务/审批/队列空闲及服务进程身份。最新完整状态、服务配置、旧静态资源与上一部署源码均已备份。后端 PID 从 217052 变为 232516。

回执确认 2 个账号、16 个会话及所有消息、模型、语音配置完整保留，服务实例与设置未变，CosyVoice 参考音频哈希未变。23 个部署文件与隔离构建一致。私有备份为 `.data/https/adaptive-screen-backup-20260930-005345-502-5f06f353`。

00:54:47 公网验证通过：23/23 文件 SHA-256 一致；health 正常，版本 0.9.0；匿名 `/api/state` 与 `/api/voice` 都返回 401。

Chrome 重新登录生产 test 账号验证 412×960 首页与 Agent：原有小猫偏好保留，页面宽度为 412，舞台 379×582.8；Agent 输入区为 x16–396、y728.9–960。未发送新的生产模型任务。浏览器日志仅记录登录切换时旧请求取消的 SessionChangedError；页面成功进入账号，没有观察到布局或角色渲染失败。最终已清除视口模拟并保留线上结果页。

隔离队列读回确认 run=completed、queueCount=0，先前停止的消息为 cancelled。预览进程及其子进程已按精确命令身份停止，4327 无监听。

## 边界与证据

本轮未制作 APK 或 Ubuntu 安装包，已安装的旧原生包不包含这些源码更新。Ubuntu 窗口仅完成计算/事件测试，没有真实 Ubuntu 窗口管理器、混合 DPI 多屏验证；Android 没有真机旋转、浮窗拖动、IME 或 Android 15 安全区运行证据。

截图、构建/测试日志与公网验证保存在 Git 忽略的 `evidence/adaptive-screen/`；私有部署回执为 `.data/https/adaptive-screen-deployment-20260930-005345-502-5f06f353.json`。不提交凭据、令牌、生产状态或参考音频。
