# 工作区过渡动效 Issues

- Date: 2026-10-22
- Complexity: L1
- Related design: 2026-10-22-workspace-transitions-design.md
- Ordering rule: 单issue，独立验证可分工。

## issue-1

- ID: issue-1
- 标题: 补齐对话、模式及导航的短过渡
- 范围: useUiEntrance既有ref支持、App两处入口、导航及消息浮动按钮CSS。
- 依赖: none
- 验收标准: 对话/模式切换产生有限淡入，逐字回复/输入/语音不重播；消息导航收放立即保持原有inert/焦点行为；reduced/隐藏无额外动效；日夜及412×960不溢出、菜单定位保持。
- 状态: done
- 验证方式: hook/动效/App等160项、兼容回归39项通过；Chrome观察到会话和控制区有限动画start/end，输入不重播且原滚动节点保持；reduced媒体不产生新动画；412×960导航收起时inert/aria-hidden立即生效，日夜无横向溢出，菜单定位保持。tsc、隔离构建及自审通过，详见verification。
- commit: 本issue对应的实现提交（以Git历史为准）
