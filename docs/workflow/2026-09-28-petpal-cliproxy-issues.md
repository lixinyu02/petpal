# CLIProxyAPI 连接适配

- Complexity: L0（现有 0.6 Responses 配置与传输层可复用；先验证实际网关，再决定是否需要代码修复）。
- Design Note: 使用管理页面现有客户端 API key，不修改网关、上游账户或管理密钥。实际 `/v1/models` 决定模型 ID。新 HTTP origin 追加至本机部署允许名单，保留旧配置私有备份；源码服务与桌面配置分别更新。所有密钥和网关调试材料只留在忽略的私有目录。

## issue-11
- ID: issue-11
- 标题: 接入新的 CLIProxyAPI 网关
- 范围: 客户端鉴权、模型发现、普通 Responses 聊天、Codex Responses、两套本机配置和运行态验证
- 依赖: issue-10 done
- 验收标准: 真实模型列表、普通聊天与真实内置 CLI 返回非空文字；桌面重读配置有效；旧连接保留备份；不修改外部服务或公开凭据
- 状态: done
- 验证方式: 已登录 Chrome 管理页面只读查看、鉴权模型查询、实际 Responses 请求、后端健康与配置重读、公开源码边界扫描
- commit: 本 issue 的 `docs(issue-11): record verified CLIProxyAPI setup` 提交

## 验收结果

- Chrome 已登录的 CLI Proxy API Management Center 显示服务版本 7.2.66。只读查看既有客户端 `api-keys`，未修改网关、管理登录密码、上游认证文件或路由。密钥输入框读取后取消编辑，凭据只保存到本机忽略目录。
- 鉴权 `/v1/models` 返回 11 个模型。默认选择实际列出的 `gpt-6-sol`；OpenAI Docs 的模型目录也将其用于 coding / agentic workflows，但网关可用性以本次实测为准。官方参考：https://developers.openai.com/api/docs/models
- 源码服务的普通 Responses 聊天返回「新网关聊天连接成功。」；Chrome → 源码后端 → 内置真实 Codex CLI 返回「新网关 Codex 连接成功。」；两条消息均非空且保存为 complete。本次没有执行播放器、浏览器工具或读取用户文件的模型请求。
- Windows 桌面端和源码服务分别保存新的 Codex、普通聊天连接及默认模型；再次读取桌面部署文件与存储配置校验通过，桌面用户及历史 ID 保持一致。原 Codex、默认模型和部署设置有本机私有备份，原 HTTP origin 保留。原有普通聊天连接不覆盖。
- 已完成必要的源码后端重启，新服务保持本机回环监听；应用运行代码无变化，继续使用已验收的 0.6 Windows EXE，不重建四端包、不重复全量代码测试。
- 本机证据：`evidence/cliproxy-setup/acceptance.json`、`evidence/cliproxy-setup/codex-connected.png`；个人连接、备份、模型查询及详细请求结果均在忽略目录。公开提交只包含通用说明与脱敏验收记录。
