# OpenUI Render Issues

- Date: 2026-10-22
- Complexity: L1
- Related design: 2026-10-22-openui-render-design.md

## Task Overview

- Goal: 参考Codex Remote完成小伴Chat/Agent的自动交互输出。
- Ordering rule: Complete issues in sequence.
- Current status: issue-1 complete; issue-2 next

## Issue List

- [x] issue-1 官方SDK、受控组件与流式呈现基础
- [ ] issue-2 消息链路、语音、跨端验收

## issue-1

- ID: issue-1
- 标题: 受控OpenUI渲染基础
- 范围: 锁定依赖、组件/validator来源、分段协议、懒加载React宿主与主题CSS。
- 依赖: none
- 验收标准: 非交互消息不加载SDK；真实SDK支持九组件；危险动作/复杂度和坏源码受限；流式实例/状态稳定；原样回退可读。
- 状态: done
- 验证方式: SDK/协议/真实React渲染15/15，tsc通过，独立Vite构建通过。修正列表缩进示例误激活；prompt与库一致性通过。源码审查确认lazy失败原文降级、无toolProvider。当前宿主尚未接入消息列表；Chrome流式状态/首屏加载在issue-2验收。
- commit: feat(issue-1): add controlled lazy OpenUI renderer

## issue-2

- ID: issue-2
- 标题: 接入Chat与Agent并完成交互验收
- 范围: 服务提示词和每条消息策略、前端回填/历史/身份边界、朗读过滤、隔离接口与Chrome验收。
- 依赖: issue-1
- 验收标准: Chat/Agent可生成交互消息且历史保持；按钮只回填当前输入框、不自动派发；语音不读DSL；普通内部任务保持原协议；深浅/移动无溢出。
- 状态: todo
- 验证方式: 实际小伴隔离服务、现有相关回归、Chrome桌面/手机、tsc及独立构建。
- commit: pending
