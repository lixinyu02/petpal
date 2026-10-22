# Claude UI Refinement Issues

- Date: 2026-10-23
- Complexity: L1
- Related design: 2026-10-23-claude-ui-refinement-design.md

## Task Overview

- Goal: 按实际 Open Claude UI 源码补齐两主题控件、输入和窄屏体验。
- Ordering rule: Complete issues in sequence.
- Current status: issue-1 done; issue-2 in_progress

## Issue List

- [x] issue-1 统一两主题令牌与控件几何
- [ ] issue-2 补强输入、窄列与状态动效并验收

## issue-1

- ID: issue-1
- 标题: 共享表面角色与精密控件
- 范围: theme/ui-polish/ui-motion/OpenUI 的几何、发丝线、字体与时序令牌，来源记录。
- 依赖: none
- 验收标准: day/night 同一圆角体系，Composer 仅一个闭合轮廓，Popover 共享阴影，字段/文字/焦点对比度合格，透明和初始配色不回归。
- 状态: done
- 验证方式: 主题/原生/Android/动效回归 62/62、4 份 CSS 解析及 diff check 通过。初次并发执行 theme-settings worker 未给出具体断言失败，单独 4/4 与并发度 2 的完整复跑均通过；未改测试。Chrome computed style 和最终类型/构建在 issue-2 验证。
- commit: feat(issue-1): unify day and night Claude control tokens (本提交)

## issue-2

- ID: issue-2
- 标题: 输入与容器自适应交互
- 范围: 输入框自动高度、模型与消息输入法守卫、窄列布局、思考三点状态、Chrome 体验验收。
- 依赖: issue-1
- 验收标准: 中文选词不误发消息或切模型；长输入可增长并缩回；412/360/320 和窄聊天列不横溢；模型/权限弹层不偏移；轻动效服从减少动画及可见性。
- 状态: in_progress
- 验证方式: 有意义的输入/状态回归、生产构建、Chrome实际交互与computed geometry，记录验收边界。
- commit: pending
