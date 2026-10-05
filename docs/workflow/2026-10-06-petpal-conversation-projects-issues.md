# 对话管理与项目分类 Issues

- Date: 2026-10-06
- Complexity: L2
- Related design: 2026-10-06-petpal-conversation-projects-design.md

## Task Overview

- Goal: 完成四端共享的对话管理与项目分类，先上线网页和后端。
- Ordering rule: Complete issues in sequence.
- Current status: issue-1 已完成，issue-2 待上线验收。

## Issue List

- [x] issue-1 实现并验证项目与对话管理
- [ ] issue-2 Chrome 验收与网页/后端上线

## issue-1

- ID: issue-1
- 标题: 实现并验证项目与对话管理
- 范围: 持久化/API、侧栏/弹窗、App 集成、账号/任务/并发回归。
- 依赖: none
- 验收标准: Chat/Agent 可分类、重命名、归档恢复、确认删除；用户隔离且保存失败/后台并发不损坏数据。
- 状态: done
- 验证方式: 563/563 受控并发回归（账号、Chat/Agent、语音、通知、自动化、归档/项目）；tsc 与隔离 Vite 构建通过。Chrome 完成重命名、项目创建/移动/重命名、归档恢复、删除确认取消、草稿保留、刷新持久化、412×960 无溢出与焦点验证。隔离实际 HTTP 验证删除项目保留聊天、删除空闲 Agent 后 404、新 Agent 继承项目。并发审查发现并修复旧保存快照覆盖正文的问题。证据 evidence/conversation-projects-20261006。
- commit: feat(issue-1): add conversation organization and account projects

## issue-2

- ID: issue-2
- 标题: Chrome 验收与网页/后端上线
- 范围: 桌面/412×960、部署备份、公网验证、文档同步。
- 依赖: issue-1
- 验收标准: 真实浏览器完成操作并确认持久化；公网提供新网页/API，现有下载包和更新元数据保持。
- 状态: todo
- 验证方式: Chrome 插件操作/截图、部署回执、HTTPS health/index/API。
- commit: pending
