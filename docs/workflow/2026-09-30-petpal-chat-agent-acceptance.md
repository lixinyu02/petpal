# Chat 与后台 Agent 验收

日期：2026-09-30；对应 issue-43。网页与后端已部署到既有 HTTPS 入口。本轮沿用现有桌面执行协议，没有重新制作安装包或发布 Release。

## 结果

Chat 与伙伴语音页均提供折叠的 Chat + Agent 设置。先选电脑、Agent 模型与现有权限，再开启协作；模型通过 run_agent 传入任务文字，后台 Codex 执行，结果回到普通聊天消息。前台无需等待任务完成。

| 验证 | 实际结果 |
| --- | --- |
| Responses、Chat Completions 定向协议回归 | providers 与 provider-agent-tools 共 62 项通过；包含完整参数、单次派发、续接回执、非法及截断调用不执行 |
| 后台回执与 API 回归 | chat-assistant 与 chat-agent-api 共 23 项通过；覆盖幂等、隔离、撤权、取消、结果追加与保存失败 |
| 前端配置与语音快照 | preferences 与 voice-conversation 共 15 项通过 |
| 现有 Agent 与执行电脑回归 | users、agent-tasks、executors、desktop-executor 等定向组合 101 项通过 |
| 静态检查与构建 | TypeScript、Vite 构建通过 |
| GPT-6.1 Sol 实际协议 | 原生 Responses 工具调用和第二轮工具回执续聊成功 |
| Halogen Qwen 实际协议 | 旧中转未返回工具、Chat Completions 路由 404；原生 Responses 工具调用和普通聊天均成功。连接 ID、账号设置和历史保持 |
| 公网真实 Chat → Agent | Halogen Qwen 自然语言判断，派发 GPT-6.1 Sol 后台任务。前台约 7.5 秒返回，Agent 当时仍运行；最终结果在父 Chat 追加一次，状态显示已完成 |
| 实际任务 | 只读检测 QQ 音乐已安装、无系统媒体会话。Agent 的额外进程和安装目录读取被本轮权限阻止，并明确报告。没有打开、播放、暂停、切歌或改文件 |
| CosyVoice 流式 TTS | 首帧约 1153 ms，21 帧、6.16 秒音频 |
| ASR 流式入口 | 使用以上合成音频验证，收到 ready、3 次 transcript、done，并返回转写文本 |
| Chrome 412×960 | Chat 设置可滚动到开关，输入框可见；伙伴与语音协作设置显示正常；文档宽度 412，无横向溢出 |
| 部署与清理 | 后端重载保留完整生产 state 与 service-settings；网页原子替换 HTML、保留旧 assets；仅清理本轮独立 QA 会话 |

## 限制

- 没有系统媒体会话，不能据此宣称播放已成功；播放器的播放、登录、歌曲搜索和会员限制仍由既有 Agent 工具与目标软件决定。
- ASR 的输入是合成音频；真实手机麦克风、Android APK 和 Ubuntu 桌面包没有在本轮重新验收。
- Chat 只确认任务已派发；电脑离线、执行失败、审批和未知状态会明确展示，不自动换电脑或重放任务。

本机详细回执与 Chrome 截图保存于忽略目录 `evidence/chat-agent-20260930/`。凭据和生产数据仅在私有目录保存。
