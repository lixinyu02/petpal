# 记忆提炼模型可见性

- Date: 2026-10-25
- Complexity: L0

## Design Note

中央 Memobase 的提炼模型独立于会话模型，由管理员统一管理。普通账号过去看不到任何当前模型信息。仅向已认证账号返回经过验证的模型 ID，不包含 API Key 或上游地址；按用户后续要求，已扩展为每用户授权模型选择和 1–3 路 LLM 并发；独立全局入口由管理员保留。

## issue-1
- ID: issue-1
- 标题: 展示当前提炼模型并明确管理员切换入口
- 范围: 运行时公开元数据、记忆状态投影与网页显示
- 依赖: none
- 验收标准: 普通用户可见模型 ID、不可见凭据及全局编辑；管理员可明确选择新模型
- 状态: completed
- 验证方式: 原生运行时/服务/组件定向测试、类型检查、Chrome
- commit: incorporated into memory-user-models issue-1
