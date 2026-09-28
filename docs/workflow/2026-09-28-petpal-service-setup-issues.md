# Windows 使用方式与本机服务配置

- Complexity: L2。需要精确 HTTP origin 例外，以及真实网关省略流式 item 事件的 CLI 兼容处理。
- Design Note: 默认继续要求 HTTPS。仅部署者通过 `PETPAL_CODEX_HTTP_ORIGINS` 明确列出的 HTTP origin 可用，不允许通配符或由 API 修改白名单。API Key 仅在本机忽略目录中落盘，经后端传给独立 Codex 环境；不改全局 Codex 配置。后台仅监听回环地址。

## issue-10
- ID: issue-10
- 标题: 指定网关适配与后端启动
- 范围: 精确 HTTP origin 例外、受限 Responses 流适配、后台启动入口、可用模型探测、独立 Codex 实际请求、Windows 0.6 便携包与桌面私有设置
- 依赖: issue-9 done
- 验收标准: 默认 HTTP 仍拒绝；指定源可保存/重启；密钥不进入源码或日志；本机服务可访问；记录真实 Codex 请求结果及范围
- 状态: done
- 验证方式: 单元和后端边界回归、服务健康/模型列表、真实独立 Codex 请求、Git 暂存扫描
- commit: 本 issue 的 `feat: configure private Codex gateways and desktop service startup` 提交

## 验收结果

- 全量测试 247/247；置顶修正后的桌面设置/更新回归 22/22；新增精确测试凭据白名单后的源码扫描回归 8/8。
- 指定服务的管理页与实际 API 端口不同，通过管理页只读发现并验证模型列表、健康接口和 Responses。真实内置 CLI 经 Chrome 页面收到「小伴 Codex 连接成功。」并保存为非空完成回复，未请求工具或读取用户文件。
- 源码服务监听 `127.0.0.1:4318`，已用最终兼容代码重启并复核健康和独立 CLI 状态。接口、模型和密钥也经现有 API 写入桌面独立数据；再次读取桌面部署文件并验证配置一致。没有改全局 Codex、系统代理、DNS、防火墙或开机启动。
- Windows `PetPal-0.6.0-Windows-x64.exe`：180,836,363 bytes，SHA-256 `d2d9b5ab885c21b290199156654b4a2fa58501a629bf53295f2ec7aea356d91e`。最终 EXE 解包核对 1,963 个文件，47 个构建输入未变化。独立 profile / 受限 PATH 的实际 EXE smoke 退出码 0，后端 0.6、Codex、OpenCLI、透明、置顶、角色切换均通过；测试遗留进程 0。该包仍未签名。
- 首次便携包置顶失败证据保留。原生窗口探针定位层级后，只修改 Windows 层级，源码 smoke 和重新生成的最终 EXE 均通过；未降低验收条件。
- 原生包 smoke 未调用真实模型或执行音乐/浏览器操作；真实网关请求来自已启动的源码服务。没有宣称新的 Ubuntu / Android 包或真实播放器操作已验收。
- 私有凭据、端点调试资料和个人数据均在忽略目录；暂存区扫描及源码分发边界扫描通过。最终本机证据：`evidence/service-setup/live-check.json`、`evidence/service-setup/codex-connected.png`、`evidence/native/windows-0.6-final-verification.json`。这些本机记录不进入 Git。
