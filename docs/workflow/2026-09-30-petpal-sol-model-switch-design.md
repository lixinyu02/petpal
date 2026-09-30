# GPT-6.1 Sol 配置与 Agent 模型切换

- Date: 2026-09-30
- Complexity: L1（从纯配置 L0 扩展）
- Status: final

## 背景与目标

用户要求在小伴停用 GPT-6 Astra，并加入 GPT-6.1 Sol。上游 `/models` 已列出 `gpt-6.1-sol`，实际 Responses 请求通过。使用管理员 API 更新原 Astra 连接的模型 ID 与名称，复用连接 ID，让 owner/test 的授权和旧会话继续可用。历史消息、账号默认模型、语音设置和 Codex 全局配置保持。

## 已发现的 Agent 问题

真实 Agent 任务已收到 `gpt-6.1-sol` 的 turn 参数，但本机 Responses transport 仅接受 `body.model === config.model`。它拒绝每轮选择的其他模型，导致 Codex turn 失败；已有动态模型测试仅检查 RPC 参数，没有穿过实际 HTTP transport，未覆盖这个问题。

## 修复

默认 transport 仍只接受配置模型。新增可选的同步授权回调，要求结果严格为 `true`；桥接层只对当前子进程中尚未完成、停止或结束清理的活动任务所选模型授权。任务登记在 turn/start 前，完成/失败/取消后授权自动失效。上游 URL、凭据、loopback token、路径/方法检查、请求限制与 SSE 校验保持。账号授权和同源 Responses 判断仍由提交接口完成。

## 验证与发布

增加 transport 边界测试和真实内置 CLI 的模型切换回归，验证完成后不能再用已结束任务的模型。运行相关 Codex/权限测试；在确认没有运行中 Chat/Agent 或排队任务后重启既有后端，保留 state 和私有回退快照。公网验证 test 的 Responses 回复和只读 Agent 简短回复，并在 Chrome 核对 Chat/Agent 模型选择器。仅清理本次创建的临时验收会话和登录，不修改已有消息。不重打原生客户端；使用远程后端的客户端刷新配置后生效。
