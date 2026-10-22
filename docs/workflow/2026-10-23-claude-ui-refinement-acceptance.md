# Open Claude UI 深化适配验收

- 完成日期：2026-10-23
- 上游固定提交：`Caho1/open-claude-ui@c1f923ae0051a871941b98a0e2e3183a545e6a85`，MIT 通知沿用 `NOTICE` 和 `public/third-party/open-claude-ui/LICENSE.txt`。
- issue-1：`c757e51`，共享几何与角色令牌；issue-2：`feat(issue-2): refine responsive composer and IME interactions`。

## 本轮落地

| 手册领域 | 适配结果 |
| --- | --- |
| 设计令牌 | 两主题统一 Composer 20px、气泡 18px、Panel 10px、Dialog 16px、按钮 6/8/10px；装饰发丝与 2px 键盘焦点分离；暖灰文字、陶土主操作、小范围强调，保留淡白默认与舒适的石墨灰底色 |
| 原子组件 | 两主题共享单闭合 Composer、Popover 微光阴影、999px 分段轨道；触控最少 44px；按压缩放 .98，快速响应使用 60/120ms 令牌 |
| 会话与输入 | Composer 文本增长/缩回、可见阅读区约束、IME 双锁；修复模型搜索确认中文时误选模型的路径；继续由当前模型决定 Markdown/OpenUI，按钮仅回填草稿 |
| 动效 | 仅在待回复状态挂载思考三点波浪；遵守减少动画和隐藏页面的既有生命周期；没有新增常驻动画计时器或运行依赖 |
| 媒体 | 保留现有真实语音和附件系统；本轮没有把示例音频、图库、iframe 或 diff viewer 当成已集成功能 |
| 桌面与自适应 | 按实际控件区域宽度 576/480/384/320 分档；因主机弹层为 fixed 后代，使用 ResizeObserver 跨档属性而不引入 layout containment；保留既有焦点管理、滚动与任务协议 |
| 工程与资产 | 未安装整包、Tailwind 或 Framer Motion；系统字体与既有图标继续使用；许可和设计记录同步 |
| Agent UI 指南 | 共享令牌也用于 OpenUI Panel；不复制上游示例模型/额度，不把视觉参考扩展为自动重试、执行沙箱或多代理业务 |

最新源码与用户提纲部分数值不同：源码 fast 为 60ms、浅色为 `#f9f9f7` 起始、深色为 `#0b0b0b` 起始；本项目借几何/角色而保留适合小伴的本地配色。上游所谓变量字体补偿只适用于支持 `wght` 轴的字体，未宣称对所有系统字体实现该算法。

## 自动化验证

- 输入与实际 App/ModelPicker、自动化只读入口、工作区存储：143/143，无跳过，日志 `.tools/composer-input-regression-20261023.log`。
- 最终滚动、消息、模态层、OpenUI、主题与对比度：53/53，无跳过，日志 `.tools/claude-refinement-20261023/final-ui-regression.log`。以上两组共 196 项。
- issue-1 主题/原生/Android/动效合同 62/62；初次并发 worker 异常未带具体断言，单独与低并发完整复跑通过，保留说明。
- TypeScript、生产 Vite 构建、CSS 解析和 diff check 通过。构建使用 `.tools/claude-refinement-20261023/dist`，未覆盖生产 dist。219 个源码/配置文件的绑定哈希复核无漂移。

## Chrome 操作与几何

使用 Chrome 插件、真实前后端与独立 JsonStore，模型/执行器/记忆/音频为合成夹具。最终入口为本机 11196；证据保留在 `.tools/claude-refinement-20261023/browser/evidence/petpal-claude-refinement-qa-NiKmZq/`。

- 1440×1000、412×960 深浅主题，360×800 和 320×800 深色：文档宽等于视口宽。44px 模式按钮与表单控件保持；320px Agent 单列各 296px。初验发现 CSS 通用规则优先级高于 tiny 规则，已修正、重构建并复验。
- 412px 空输入 44px，多行增至 116px 且内部滚动，清空缩回 44px；412×500 短屏时输入 46px、阅读区仍有约 57px。此为短视口模拟，不等同实体软键盘测试。
- 模型搜索的合成 compositionstart/end + Enter 不关闭菜单、不切模型；随后真正方向键和 Enter 正常切换。消息同类事件保持草稿且不发送；随后明确 Ctrl+Enter 成功。验证的是浏览器事件，不声称所有操作系统 IME 已实测。
- 320px 主机菜单、412×500 权限菜单均在视口内；主机菜单祖先无 transform/filter/contain/container-type 改变定位。模型菜单为 body Portal，412px 时 x16/w360，圆角 10px。
- 1440px 页面内临时约束聊天列为 360px：控件区约 291px，进入 tiny 单列且全页不溢出；约束样式随后完整还原。
- 当前主题 Composer 20px、用户气泡 18px，Composer 伪环 opacity=0；高分屏抽测装饰轮廓 0.5px、键盘焦点仍 2px。浏览器原有缩放影响分辨率媒体查询，不据此声称物理 DPR3 的 1/3px 验收。
- full 时三点使用 1.2s 波浪，reduce 时三点 animation=none、滑块 transition=0s。既有隐藏生命周期由自动化合同验证，本轮没有新增实体后台功耗结论。
- OpenUI 表单回填保留原草稿、聚焦输入框；合成模型与 bridge 各 1 次，只有明确发送触发。普通回复页面无 OpenUI SDK 请求或外部资源，未捕获指向最终入口的控制台错误。

Chrome 原有 75% 缩放导致 extension 的 viewport 尺寸与 CSS 尺寸不同，已以 CDP 实测 innerWidth/innerHeight 校准。第一次语义坐标点击命中了模式按钮，核查后改用同一 Chrome 插件的页面 DOM click 和键盘事件完成控件验收，没有据此宣称物理触控验收。开发夹具历史控制台日志不计作最终构建错误。

## 收尾与边界

关闭本任务页签、还原媒体/尺寸模拟及临时聊天列样式。开发和生产构建两夹具进程退出，6 个相关端口无监听，见 `browser/shutdown-verification.json`。保留源码、证据及业务/安装包资产。

本轮未连接真实模型/CLI/ASR/TTS，未打客户端包或部署线上；Windows/Ubuntu/Android 实体端仍需随客户端版本分别验收。上游 focus trap、模型额度、自动重试、脚本沙箱、多线程高亮不能仅凭文档描述算作已完成能力。
