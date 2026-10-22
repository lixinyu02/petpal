# Open Claude UI 深化适配

- Date: 2026-10-23
- Complexity: L1
- Status: draft

## Background

用户要求继续参考 Caho1/open-claude-ui 的八篇设计手册。上游仍为已使用的 `c1f923ae0051a871941b98a0e2e3183a545e6a85`（MIT）；本轮核对实际 tokens、输入控件、响应式与交互实现，不能把 README 的全部能力当成现成产品功能。现有小伴的 CDS 几何与轮廓主要覆盖 night，day 存在重复圆角和焦点描边；模型搜索缺少 IME 守卫。

## Goal

完善两套主题的一致控件几何、表面角色、细轮廓、可读字体和轻量反馈；让输入框自然增长、中文输入安全；按聊天列实际宽度排版模型/主机控件，优先保证手机和窄桌面。

## Design

- Visual thesis：淡白与柔和石墨灰的轻薄工作空间，以表面阶梯、排版和细边表达层次，小范围陶土色表达正在思考，不增加装饰性框层。
- Content plan：会话阅读占主位；模式、模型与目标电脑紧凑分组；输入与附件作为同一个 Composer；额外状态在需要时呈现。
- Interaction thesis：共用 60/120/200/300ms 时序和缓动；分段滑块只改变装饰几何；思考波浪只在待回复时播放；输入高度按 RAF 合并，不在每次流式 token 上测量。
- 统一 Composer 20px、用户气泡 18px、Panel 10px、Dialog 16px、按钮 6/8/10px、胶囊轨道与高分屏装饰发丝线。字段与键盘焦点继续保持可见边界和 2px 焦点，不以发丝替代。
- 保留此前淡白默认和较柔和 night 底色，不把上游近黑调色板当必须逐字复制的品牌要求。补全 day 的 navigation/popover/selected/button 角色，几何与阴影两主题共享。
- CSS 容器放在不会捕获 fixed 菜单坐标的阅读区域；Portal 沿用 viewport 定位。保留 44px 触控、安全区、短屏和减少动画策略。
- 复用小伴模态焦点陷阱与语音引擎；不引入 Tailwind、Framer Motion 或新运行依赖，不复制示例模型、额度、自动重试、脚本沙箱或 macOS 专属宿主行为。

## Risks

既有 lazy CSS 与 !important 会覆盖共享几何；容器查询可能影响 fixed 元素包含块；输入法 compositionend 顺序在 WebKit/WebView 不同；文本区域增长要能缩回且避开软件键盘。分别以 computed style、Portal 几何、输入事件与 ResizeObserver 验收。

## Verification Plan

issue-1 检查主题对比度/透明首帧/原生颜色合同、CSS 语法与类型，保存一次提交；issue-2 验证真实输入事件、模型选择、输入高度、窄列布局、减少动画和思考状态。Chrome 插件验收桌面、412×960、360×800、320px 及桌面窄聊天列的 day/night；生产构建使用隔离输出目录，无真实模型/CLI/语音调用、无线上部署或安装包制作。
