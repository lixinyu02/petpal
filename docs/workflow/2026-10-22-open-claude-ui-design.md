# 参考 Open Claude UI 的小伴界面

- Date: 2026-10-22
- Complexity: L1
- Status: final

## Background

用户确认参考 Caho1/open-claude-ui 的实际组件实现。上一轮 c3e1ef9 主要完成暖色调与漏色修补，本轮要落实表面层次、控件边缘和中性选中状态。

## Goal

以实际源码为依据，统一深色工作空间的表面阶梯、Chat/Agent 分段切换、Composer、模型/权限弹层与消息操作，保留手机端空间效率和已有性能修复。

## Non-goals

不引入整套外部组件或新运行时依赖，不换模型/权限/队列/上传/语音业务，不改人物像素、不部署或重打正式包。默认淡白 day 保持。

## Solution

- Visual thesis：安静、轻薄的中性深灰工作空间，以层次和可读文字承载信息，仅对主要操作使用陶土色。
- Content plan：聊天阅读为主；侧栏导航次之；模型与执行权限在独立浮层中清晰展开；输入框以单一表面连接文本、附件和发送操作。
- Interaction thesis：Chat/Agent 使用同宽轨道与装饰滑块；按现有 full/reduced/hidden 生命周期启停短暂反馈；保留消息与菜单既有淡入，不新增持续动效。
- 固定参考提交 `c1f923ae0051a871941b98a0e2e3183a545e6a85`：[Open Claude UI](https://github.com/Caho1/open-claude-ui/tree/c1f923ae0051a871941b98a0e2e3183a545e6a85)。源码核对 `code-examples/cds-theme.css`、`SegmentedControl.tsx`、`ChatComposer.tsx`。
- 映射上游 S0 `#0b0b0b`、S1 `#151515`、S2 `#1a1a19`、S3 `#20201f`、popover `#2c2c2a` 到小伴主题；文本与字段边界保留可访问性要求，装饰分隔采用更低对比。
- 分段选择以中性底衬/正文色提示；陶土用于主操作、链接及键盘焦点，错误/成功/警告各自保留。
- 参考 20px Composer、8px控件/菜单项、12px代码区、16px模态框的角色阶梯，保持触控44px与现有小屏Composer结构。
- 不变更固定弹层祖先的transform/contain，不给主工作区加滚动mask以免裁切焦点与菜单。
- 参考式样的本地实现保留来源和MIT许可，不加载上游示例模型、模拟附件、全局 :root 或第三方商业字体。

## Impact

一个连贯主题切片：theme.css/ui-polish.css/ui-motion.css、Web首帧与运行时、Electron/Android颜色合同、原有测试、来源说明。无API/schema变更。

## Risks

lazy CSS和既有!important级联可能覆盖中性选中/焦点；分段滑块不能接管按钮点击或成为fixed弹层坐标祖先；hover隐藏动作需保证触控/键盘仍可用。原生源码同步不代表新版APK已实机验收。

## Verification Plan

冻结 c3e1ef9 的五个受改Web文件，使用隔离合成数据服务和Chrome对照桌面1440×1000、手机412×960与窄屏360×800。检查Chat/Agent切换、模型/权限菜单、Composer、附件、消息操作、设置与day/auto/reduced/hidden行为。测对比度和几何，相关Node测试、tsc与隔离Vite构建；不覆盖生产dist。关闭模拟/标签/服务并核对PID和监听，无线上业务验收声明。

## Verification Results

- 固定参考四文件的下载字节与Git blob匹配，证据在 `.tools/open-claude-20261022/reference/manifest.json`；保留MIT全文于public/third-party/open-claude-ui/LICENSE.txt，NOTICE说明本地改写范围。未执行上游源码/skill，也未增加依赖。
- 冻结五个Web文件的c3e1ef9基线，HTTP返回与冻结字节吻合；候选独立数据/端口，未访问生产数据、真实CLI、语音或外部模型。
- Chrome实际CSS尺寸1440×1000、412×960、360×800；手机与窄屏scrollWidth等于视口宽，模式按钮均44px；等宽滑块在Agent状态精确移动一格。桌面沿用浏览器原有75%缩放，截图原生区域1080×750。
- 模型菜单、Agent权限菜单、设置/Chat代码和表格已视觉检查。手机权限弹层x16/y596/w350，右边366，底部806.8，位于412×960视口内；祖先transform/filter/paint/layout contain检查为空。
- 抽测实际对比度：正文15.27、次要文字8.77、Composer正文13.63、发送按钮文字5.85；标准表面/浮层/选中态与状态颜色的合同均达到4.5，字段边界和焦点达到3。
- 键盘Tab进入朗读按钮后消息操作opacity=1；桌面触控模拟any-pointer:coarse时3组操作均可见且模式按钮44px。混合触屏兜底经静态审查修复，未做实体混合设备验收。
- 减少动画时滑块过渡0s，无入场标记；full时120ms。浏览器切前后台仍报告visible，未把它算作后台实测；对夹具document.visibilityState作合成探针后，hidden→motion off/0s，恢复visible→full/120ms，原属性和事件状态已还原。
- 消息操作的隐藏规则放入@supports selector(:has(*))，无支持时保留可见；旧浏览器为源码降级审查，本轮Chrome本身支持:has，未声称旧版浏览器实机通过。
- 日间手动切换仍为#fafbf8；自动模式在本机22时为night/#151515。透明与主题生命周期现有合同通过，原生颜色和Android instrumentation预期值同步；未构建或实测新版APK/Electron安装包。
- 相关16组Node测试157/157、tsc与隔离Vite构建通过，无失败或跳过。日志在 `.tools/open-claude-20261022/`；未运行与CSS无关的后端全套测试。
- 截图、几何/对比度和生命周期结果在 `.tools/open-claude-20261022/browser/evidence/`，包括final-desktop.png、after-mobile-models.jpg、after-mobile-permissions.jpg、各metrics/probe文件。初次桌面截图超时，后续通过Chrome前台捕获完成，不把工具超时当产品故障。
- 标签与临时媒体/尺寸/触控模拟已清；两夹具及2个esbuild子进程退出，6个相关端口无监听，shutdown-verification.json保留。未部署线上、未修改正式包或更新清单。
