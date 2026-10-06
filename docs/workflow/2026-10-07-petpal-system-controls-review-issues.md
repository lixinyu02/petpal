# PetPal 系统控制与替我审批 Issues

- Date: 2026-10-07
- Complexity: L2
- Related design: 2026-10-07-petpal-system-controls-review-design.md

## Task Overview

- Goal: 系统音量固定工具和当前 Agent 模型的替我审批适配，准确的批准与等待状态。
- Ordering rule: 顺序完成 issue；同一 issue 内独立模块可以并行。
- Current status: issue-1 done；issue-2 in_progress。

## Issue List

- [x] issue-1 系统控制、原生审核兼容和批准交互
- [ ] issue-2 原生与浏览器实测及文档收尾

## issue-1

- ID: issue-1
- 标题: 系统控制、原生审核兼容和批准交互
- 范围: 固定音量/设置工具、版本绑定审核 catalog、Guardian 事件、规则音量审核、审批有效期、执行器能力、权限/批准 UI、包装与定向测试。
- 依赖: none
- 验收标准: 不扩大账号/模型/电脑授权；API Guardian沿用当前模型；通用桌面操作仍确认；到期与取消能结束等待；UI不重复提交；包装不遗漏；相关回归和tsc通过。
- 状态: done
- 验证方式: 完整回归 2195 passed / 1 skipped / 0 failed（concurrency=4）；默认跳过90秒Guardian deadline，已另行真实CLI独立验收。高并发首次已有stream取消fixture超时，单文件6/6及限制并发全量均通过。末次生命周期55/55；实际TSX审批20项、TypeScript、独立Vite build、包装成员/源SHA、diff --check、自审通过。
- commit: this issue implementation commit

## issue-2

- ID: issue-2
- 标题: 原生与浏览器实测及文档收尾
- 范围: Windows音量恢复测试、可用上游真实Agent审查、Chrome权限和批准界面、能力/设备限制及使用说明。
- 依赖: issue-1
- 验收标准: 实际效果和失败边界明确、原音量/静音恢复、UI与原始回执一致、源码和已发布包分开报告。
- 状态: in_progress
- 验证方式: isolated live harness、Chrome插件截图、证据与文档、自审。
- commit: pending
