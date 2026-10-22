# 交互回复

Chat 和直接 Agent 由当前模型自动决定如何呈现，不提供格式切换菜单，也不调用第二个 UI 模型。普通问答、说明、代码和静态表格优先 Markdown；需要收集选项或填写要求时可输出一个 OpenUI 区块。实际效果仍取决于当前模型遵循组件协议的能力。

支持 Panel、Stack、Text、Heading、Table、Field、Select、Checkbox、Button。表单按钮可以修改本地字段，或把文本与字段值追加到现有输入框；用户确认并发送后才会产生下一条任务。没有执行工具、网络调用、任意 HTML/JavaScript 或外链动作。

服务端为每条新回复记录 `outputRendering`，SSE meta 同步该字段。旧记录和用户消息维持原展示；代码示例、列表、引用及 HTML 容器内的围栏不激活交互。程序无效、截断、超限或组件加载失败时显示原文。

生成中的表单可填写，动作按钮在生成完成后启用。相同消息的流式更新、终态快照和轮询保留已填字段；离开当前对话、退出账号或整页刷新会清除未提交表单。语音只读周边说明；伙伴页面字幕提供进入对应对话的链接。

直接 Agent 的可信 HTTP 入口启用自动策略，队列持久化该选择；执行中的引导不更改当前回复协议。自动化和 Chat 委派的后台 Agent 任务保持原有内部协议。组合提示词不设人为字符预算，完整发送组件说明、已选上下文和用户任务，不因长度回退 Markdown、挤掉检索记忆或重置会话；组件说明缺失或无效时仍回退 Markdown。模型自身的上下文限制沿用上游错误处理。

SDK 与组件库按需加载，共享应用 React。普通消息不下载 SDK；运行遥测、开发检查器及其 CDN 下载均关闭。更换锁定 SDK 版本时需复核 `runtime-policy.mjs` 中的检查器标记。

组件库变更后运行 `node scripts/generate-openui-resources.mjs`，更新服务端静态提示词和许可清单，并运行 `node --test tests/openui-*.test.mjs`。部署包含 `server/openui/prompt.txt` 和前端构建；该功能不需要修改本机执行权限。

来源及许可见 `openui-reference.json`、仓库 `NOTICE` 和 `public/third-party/openui/`。本轮仅源码集成与隔离验收，客户端发布、真实模型输出质量和各实体终端的验收另行进行。
