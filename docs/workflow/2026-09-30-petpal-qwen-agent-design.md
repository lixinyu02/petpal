# Qwen Agent 模型适配

- Date: 2026-09-30
- Complexity: L1
- Status: complete

历史记录：下文保留 issue-47 的原始设计。图片能力与网关连接后续在 issue-58 更新，当前行为见 [首页选择器与 Qwen Agent 兼容修复](2026-09-30-petpal-home-agent-compat-design.md)。

## 目标与发现

用户希望在 Agent 使用 Qwen3.8 Flash。现有模型 ID 是 `halogen-qwen3.8-flash-next`，已存在原生 Halogen Chat 连接；Agent 仅接受与管理员 Codex 服务同源的 Responses 模型，不能只改筛选规则而把请求和密钥送往不同服务。

当前 CLIProxyAPI 同样已列出这一模型。实际验证同源接口的显式 `reasoning.effort=none`、函数调用与工具结果续接均成功。现有 Codex 默认为 GPT Luna / max，空强度会继承这个默认，因此新增 Agent 连接显式使用 none。

## 实现

新增同源 Agent Qwen 连接并给已有 Agent 授权的 test 账号分配。保留现有原生 Qwen Chat 连接、全局 GPT 配置、账号权限和聊天记录。通过管理 API 持久化配置，避免直接改生产状态或绕过保存机制。

Qwen 的图片限制沿用后端已存在的纯文本能力检查；界面按实际 Agent 选中模型同步禁用图片按钮和图像粘贴，并阻止把已选择的图片发给纯文本模型。工具调用、执行电脑、审批与排队仍沿用现有协议。

## 验证与部署

同源 Responses 工具实测、实际捆绑 Codex 无文件修改的终端任务与续接、test 账号真实任务均通过。模型切换、Agent 权限、附件与远程执行定向回归 48/48，TypeScript 和独立 Vite 构建通过。网页已原子更新 HTML，27 个静态文件逐项比对通过，旧 assets 与 Windows 下载镜像保留；无需后端重启。Chrome 已确认 Qwen/none/仅文字选项、图片入口禁用及切回 GPT 后恢复。公开结论见同日期 qwen-agent-acceptance.md，凭据和原始运行材料保留于忽略目录。
