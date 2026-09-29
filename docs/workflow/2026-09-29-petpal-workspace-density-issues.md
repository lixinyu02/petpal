# Agent 验收与工作台整理 Issues

- Date: 2026-09-29
- Complexity: L1
- Related design: 2026-09-29-petpal-workspace-density-design.md
- Current status: issue-34 in_progress

## issue-33

- ID: issue-33
- 标题: 工作台信息层次与消息空间
- 范围: Chat/Agent上下文栏、连接说明、权限/语音/队列折叠、伙伴栏与响应布局
- 依赖: issue-32 done
- 验收标准: 主要入口清晰、消息区不被挤空；审批/错误/停止可见；原有选择、权限、语音和队列功能保留
- 状态: done
- 验证方式: tsc、隔离 Vite 构建、git diff --check 与 36 项相关回归通过。Chrome 1280×800、1280×600、390×844、412×915 检查模式切换、模型搜索、模拟执行电脑、权限/语音弹层、Escape 归焦、审批定位、队列编辑/暂停/恢复与错误常驻。1280×800 默认布局消息区从 699×258.5 增至 992.6×392.4 CSS px；中屏伙伴可展开。详情见后续验收记录。
- commit: 本 issue 提交（feat(issue-33): simplify chat and agent workspace layout）

## issue-34

- ID: issue-34
- 标题: 实际Agent验收与网页部署
- 范围: 真实任务证据、Chrome桌面/手机UI验收、备份部署与记录
- 依赖: issue-33
- 验收标准: 真实只读任务与队列结果清楚；完成响应布局与必要交互验收；线上数据保留；明确无在线桌面主机的实机边界
- 状态: in_progress
- 验证方式: 已有 Agent 相关 152 项隔离回归通过；真实终端执行、审批、排队上下文、停止/暂停/手动恢复已完成。等待备份部署与公网复验。
- commit: pending
