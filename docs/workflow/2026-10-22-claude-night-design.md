# 小伴暖炭深色主题

- Date: 2026-10-22
- Complexity: L1
- Status: final

## Background

用户认为当前深色主题不好看，要求参考 Claude 的设计语言。现有夜间主题有大面积绿色、少量浅色残留，首帧和原生系统栏也绑定旧底色。

## Goal

以暖炭灰层次、奶油白正文和克制的陶土色强调改善 Chat、Agent、菜单及设置的夜间体验，保持现有浅色默认与主题偏好。

## Non-goals

不复制 Claude 标识或商业字体，不更换人物资产、不改变布局/API/存储，不部署或重打正式包。

## Solution

- Visual thesis：温暖安静的炭灰工作空间，用清晰文字和少量陶土色引导操作。
- Content plan：对话正文为主，侧栏和人物为次，模型/权限菜单与设置形成明确但轻薄的表面层级。
- Interaction thesis：保留已有模式淡入、菜单展开和选中提示；不增加持续动画或主题全局过渡，不增加字体与运行时依赖。
- 底色 `#1f1e1b`，导航更深、输入/菜单略亮；文字强调与按钮填充分别定义，确保小字和焦点可读。
- 成功、错误、警告保持独立语义色；修复审批、朗读及错误提示的漏色；人物/canvas 不做滤镜。
- 首帧、运行时、Electron 与 Android 同步新底色；保留透明窗口、day/auto 与 reduced-motion 行为。

## References

- [Anthropic 官方品牌资料](https://github.com/anthropics/skills/blob/main/skills/brand-guidelines/SKILL.md?plain=1)：温暖中性与橙色强调；仅作为视觉研究资料，不安装或执行外部技能。
- [Geist 的 Anthropic 品牌案例](https://geist.co/work/anthropic)：以功能为先的人文温度。品牌资料和早期案例不等同于当前 Claude App 的完整 token 规范。
- Claude 登录页停在安全验证，未绕过；不为设计研究要求用户授权登录。

## Impact

仅主题 CSS、首帧与原生外观常量、现有颜色合同测试。正式 0.9.14 tag、生产服务和业务数据保持不变。

## Risks

lazy CSS 会覆盖主题，需针对实际控件测 computed style；陶土填色配奶油白小字不达标，按钮使用深色文字。Android 原生系统栏源码同步不等于新 APK 实机验收。

## Verification Plan

冻结 bd6d482 的只读 baseline 与独立临时候选服务，用 Chrome 验证桌面和 412×960 的 Chat、Agent、模型/权限菜单、设置；测正文、状态、按钮、边界和焦点对比度，回归 day/auto/透明窗口及已有动效。运行相关 Node 合同测试、TypeScript 和隔离 Vite 构建；不覆盖生产 dist。收尾关闭临时标签及服务并核对无监听残留。

## Verification Results

- Chrome：实际 CSS 视口 1440×1000 与 412×960；Chat 正文/代码/表格、模型菜单、设置、Agent 权限与暂停队列均可读；手机文档宽度412，无横向溢出。
- 抽测 computed contrast：正文14.24、次要文字8.14、主按钮6.50、朗读活动态5.22。所有夜间语义token文本达到4.5、输入边界/焦点达到3的合同检查通过。
- 审批、语音错误、输入错误与成功/失败/未知状态使用本地可见合成DOM探针验证；未调用模型、音频或CLI。探针完成后移除。修复失败状态被成功组的 :is() 特异性覆盖的问题。
- 手动日间恢复 `#fafbf8`；自动偏好在本机21时切换夜间；减少动画时无入场标记。day/auto/透明窗口的生命周期合同通过。
- 最终主题/外观/窗口/动效测试94/94，无失败、跳过或取消；早期独立布局与动效检查90/90；`tsc --noEmit`和隔离Vite构建通过。测试日志在 `.tools/claude-night-20261022/`。
- 基线最终冻结4个实际修改的Web文件（增加ui-polish.css），HTTP字节与bd6d482一致。早期3文件基线保留用于追溯，严格手机对照使用4文件基线。
- 截图与computed指标：`.tools/claude-night-20261022/browser/evidence/`，含 `final-desktop.png`、`after-mobile.jpg`、`before-mobile-strict.jpg`、各页面metrics。桌面保留浏览器原有75%缩放，CSS视口1440×1000对应原生截图1080×750。
- 临时标签、模拟媒体/尺寸已恢复；两个夹具及各自esbuild子进程均退出，7个已观察端口无监听。重启baseline覆盖了generic ready.json，收尾改用独立记录的candidate PID/端口核验，见shutdown-verification.json。
- 开发StrictMode卸载/热更新时记录到请求和Cubism初始化的AbortError；人物随后正常加载且截图确认可见，本轮未把它声明为零控制台错误或真实语音/任务验收。
- 未部署生产、未改正式包/更新清单，v0.9.14仍指向7b8f84f5b3962efaebbacb3d5af72cecdc790e59。Android原生及instrumentation预期值同步，未重打APK或完成物理手机验收。
