# CPA HTTPS 同步核对

- Date: 2026-10-02
- Complexity: L0

## Design Note

用户要求同步当前已启用 HTTPS 的 CPA。现有生产配置已经迁移，因此本轮核对实际地址、模型可选范围与流式请求，并修正公开说明中的旧 HTTP 示例。传输源码已有正常 CA / 主机名校验，不需要重写或放宽 TLS；不修改私有密钥、默认模型、权限、发布包或更新清单。

## issue-1

- ID: issue-1
- 标题: 核对并同步 CPA HTTPS 配置说明
- 范围: 生产配置只读核对、真实 models / Responses / Chat Completions 验收及公开说明
- 依赖: none
- 验收标准: Codex 与对应模型连接统一为 HTTPS /v1；模型可用于 Agent；真实流式回复成功；TLS 校验保持；远程执行电脑使用中央配置
- 状态: done
- 验证方式: 生产四个 CPA provider 与 Codex 均为 https://magicdatou.top:8317/v1；四个模型均在 eligibleProviderIds；鉴权 models HTTP 200、15 个模型且四个已配置模型全部存在；GPT-6 Luna/max 与 Qwen3.8 Flash 的 Responses 实际测试通过；GPT-6 Luna/max 的 Chat Completions 实际返回 CPA_CHAT_OK、3 个文本 delta。独立只读审查确认中央 Codex 与远程 executor 不降低协议或关闭 TLS；本轮未改变运行时代码，不重复既有回归。私有回执在忽略目录，不提交配置和密钥。
- commit: 本 issue 文档提交

## 当前连接行为

- 正式 API Base URL 使用证书匹配域名；management.html#/login 仅用于管理。
- Agent 可用模型要求 Responses provider 与 Codex 的规范化地址相同，迁移时应一起更新。
- 远程 PC 通过中央 relay 使用最新 CPA；本机回环 transport 的 HTTP 不是上游降级。
- PC 独立本机模式保留个人设置，需要在本机同步两个连接位置；不会覆盖用户自定义模型服务。
- 本次为生产配置复验和说明更新，无需重启后端；旧客户端及发布 tag 保持原状。
