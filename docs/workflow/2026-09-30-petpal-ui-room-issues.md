# 聊天与伙伴界面减负 Issues

- Date: 2026-09-30
- Complexity: L1
- Related design: 2026-09-30-petpal-ui-room-design.md

## Task Overview

- Goal: 减少 Chat、Agent 与伙伴语音界面的常驻占用，配置按需展开。
- Ordering rule: Complete issues in sequence.
- Current status: issue-44 done。

## Issue List

- [x] issue-44 精简工具行与独立设置面板

## issue-44

- ID: issue-44
- 标题: 为聊天与伙伴语音界面留出空间
- 范围: 协作配置浮层、工作区工具行、语音页布局与文案、响应式验收及网页部署。
- 依赖: issue-43
- 验收标准: 展开协作配置不挤压人物/聊天；桌面 Chat 工具行合并；412×960 入口可发现、配置可完整滚动；键盘与弹层模型/权限操作可靠；生产状态保持。
- 状态: done
- 验证方式: TypeScript、Vite 构建；Chrome 桌面、412×960、短横屏和短手机视口；同值模型选择、权限子面板、Escape、遮罩、双向 Tab 循环与内部滚动。生产数据在每次静态部署中 hash 保持，后端未重启。详细记录见 2026-09-30-petpal-ui-room-validation.md。
- commit: 本 issue 的 `refactor(issue-44): simplify chat and voice controls` 提交。
