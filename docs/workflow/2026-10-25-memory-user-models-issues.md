# 用户记忆模型 Issues

- Date: 2026-10-25
- Complexity: L2
- Related design: 2026-10-25-memory-user-models-design.md

## issue-1
- ID: issue-1
- 标题: 用户模型偏好与受控 Memobase 路由
- 范围: 账号授权、epoch 绑定、私有路由、Python 上下文与有界并发
- 依赖: none
- 验收标准: 每账号可选授权模型；无跨用户密钥/记忆；峰值不超过 3；同账号合并仍顺序
- 状态: completed
- 验证方式: 142 项 Node 定向通过，2 项 Python 模型/并发/撤权测试通过；Qwen Chat Completions 实际 200；容器切换验收见 issue-2。
- commit: pending

## issue-2
- ID: issue-2
- 标题: 网页上线、Qwen 切换与历史同步恢复
- 范围: 普通用户模型入口、1–3 并发、受控上线、zut 同任务续传
- 依赖: issue-1
- 验收标准: 实际 Qwen 请求和新进度；原消息/事件不重复；Chrome 验证
- 状态: in_progress
- 验证方式: 组件/HTTP/构建、真实模型、私有对账
- commit: pending
