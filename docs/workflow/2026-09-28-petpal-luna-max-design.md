# Luna Max 与网络入口

- Complexity: L1。现有客户端尚无推理强度字段，需要贯通配置、UI、协议和真实 CLI，并重建 Windows 包。
- 将 `reasoningEffort` 作为可选连接设置；缺失或空字符串代表服务默认，不改变旧连接。普通 Responses 使用 `reasoning.effort`，Chat Completions 使用 `reasoning_effort`。Codex 独立配置和 turn/start 传递显式强度，变化时更新 revision，旧会话不能悄悄复用旧设置。
- 用户指定的本机默认连接改为 `gpt-6-luna` / `max`；不把这一私人网关或密钥写入公共默认配置。源码服务和桌面私有存储分别备份、更新及重新加载验证。Windows 发布 0.6.1，旧包保留。
- OpenAI Docs 已确认模型及强度：https://developers.openai.com/api/docs/models/gpt-6-luna 。网关是否接受参数仍以实际请求为准，不把模型名称中的 max 当作推理参数。
- 路由器通过用户授权的 SSH 检查，只收集网络与转发所需信息。先澄清具体目标端口，再添加精确规则；保留原规则，修改前备份，核对实际运行规则和连通性。证据与凭据留在忽略目录，公网访问与局域网回流分别报告。
- 验证：协议请求体、配置验证及 revision、旧数据兼容、UI 保存/清空、真实 CLI 请求参数、真实模型短请求、Windows 包内容/原生启动、脱敏源码审计。
