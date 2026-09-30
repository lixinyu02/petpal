# GPT-6.1 Sol 模型切换 Issues

- Date: 2026-09-30
- Complexity: L1
- Related design: 2026-09-30-petpal-sol-model-switch-design.md
- Current status: issue-42 done

## 范围调整

模型替换已通过管理员 API 完成，Chat 实际回复通过。Agent 实测发现已有本机 transport 只接受主机默认模型，错误拒绝账号选定的其他已授权模型。范围扩为 L1：修复活动任务的模型白名单，并对真实内置 CLI、实际上游和账号 UI 验收；不修改主机默认模型。

## issue-42

- ID: issue-42
- 标题: 将 Astra 入口替换为 GPT-6.1 Sol
- 范围: 已部署服务的模型配置、活动 Agent 模型校验、owner/test 授权与 Chat/Agent 可用性验收
- 依赖: 既有管理员模型配置 API
- 验收标准: 模型列表不再包含 Astra；Sol 6.1 可实际回复；test 可选新模型；历史会话、默认设置和语音配置保持
- 状态: done
- 验证方式: 上游模型目录、真实 Responses 请求通过；transport/实际内置 CLI 14 项与 Codex/权限/账号等 115 项回归（共 129 项）通过。Chrome test 的 Chat/Agent 列表和选择通过；公网 test 只读 Agent 使用 gpt-6.1-sol 返回 OK（16.2 秒）。确认空闲后精确核验进程并重载后端，重载前后 state 一致；最终 21 个既有对话及账号、默认模型、语音等配置保持，仅原连接的 name/model 改变。登录验收触发既有每账号保留八个登录的策略，最早三条 test 登录未保留，期间新增的一条实际登录保持；不回滚登录状态。本次临时验收对话和登录均已移除。仅更新后端与模型配置，未重打原生安装包。
- commit: 本 issue 的 fix(issue-42) 提交
