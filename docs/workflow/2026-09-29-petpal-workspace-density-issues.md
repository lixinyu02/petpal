# Agent 验收与工作台整理 Issues

- Date: 2026-09-29
- Complexity: L1
- Related design: 2026-09-29-petpal-workspace-density-design.md
- Current status: issue-33 / issue-34 done

## issue-33

- ID: issue-33
- 标题: 工作台信息层次与消息空间
- 范围: Chat/Agent上下文栏、连接说明、权限/语音/队列折叠、伙伴栏与响应布局
- 依赖: issue-32 done
- 验收标准: 主要入口清晰、消息区不被挤空；审批/错误/停止可见；原有选择、权限、语音和队列功能保留
- 状态: done
- 验证方式: tsc、隔离 Vite 构建、git diff --check 与 36 项相关回归通过。Chrome 1280×800、1280×600、390×844、412×915 检查模式切换、模型搜索、模拟执行电脑、权限/语音弹层、Escape 归焦、审批定位、队列编辑/暂停/恢复与错误常驻。1280×800 默认布局消息区从 699×258.5 增至 992.6×392.4 CSS px；中屏伙伴可展开。详情见后续验收记录。
- commit: 04e14b5（feat(issue-33): simplify chat and agent workspace layout）

## issue-34

- ID: issue-34
- 标题: 实际Agent验收与网页部署
- 范围: 真实任务证据、Chrome桌面/手机UI验收、备份部署与记录
- 依赖: issue-33
- 验收标准: 真实只读任务与队列结果清楚；完成响应布局与必要交互验收；线上数据保留；明确无在线桌面主机的实机边界
- 状态: done
- 验证方式: 真实终端退出码 0、审批、排队上下文、停止/暂停/手动恢复完成；无异机实机结论。备份部署保留 2 账号/16 会话及所有模型/语音/服务配置，23/23 公网文件哈希一致；未登录接口 401；Chrome 公网桌面/390px 手机复验通过，详见对应 acceptance.md。
- commit: 本 issue 提交（docs(issue-34): record live agent and workspace acceptance）
