# OpenUI Render 验收

- 完成日期：2026-10-23
- 范围：Chat 与直接 Agent 的自动 Markdown/OpenUI 输出；不增加渲染选择器或额外模型调用。
- 基础实现：`14c2ac1`；消息链路实现见 `feat(issue-2): enable automatic OpenUI replies in Chat and Agent`。

## 自动化验证

相关测试 251/251 通过，无失败或跳过，覆盖 OpenUI SDK/协议/复杂度限制、真实隔离 HTTP ChatCompletions/Responses、Agent 队列/引导/恢复/权限/图片/记忆/审查、消息复用、Markdown 和语音。TypeScript 检查、生产 Vite 构建和 diff 检查通过。

本地日志：`.tools/openui-20261022/tests.log`、`build.log`。生产构建位于 `.tools/openui-20261022/dist`；OpenUI 懒加载块为 221.13 kB，gzip 69.81 kB。Zod 的 PURE 注释产生非阻塞构建警告。

## Chrome 实际操作

使用生产构建及真实 `createPetServer`/`JsonStore`，临时独立数据和固定输出的模型/Codex bridge 替身。最终验收入口为本机 5608 端口，不访问生产业务数据。

- 普通 Markdown 页面没有请求 OpenUI SDK 块或外部资源。交互消息只按需加载一次 SDK；没有开发检查器或 CDN 加载。
- Chat 与 Agent 生成中填写字段，经过增量和完成态更新，字段值、DOM 身份、消息身份及焦点保持；动作按钮仅在完成后启用。
- 选择、勾选、Set/Reset 正常。UseInPrompt 追加到原草稿并聚焦输入框；两次主动发送合计只有 1 次模型调用和 1 次 bridge 执行，表单动作未增加调用。
- 切换会话清除未提交表单，退出登录移除表单及输入框。旧消息、用户内容、列表示例不激活 UI。
- 非法/截断 DSL 显示原文。故意阻断 SDK 块时显示加载失败提示并保留原文，应用和输入框继续可用。
- 桌面 1440×1000、手机 412×960 深浅主题及 360×800 深色通过；文档宽度与视口一致，控件高度 44 px。

证据目录：`.tools/openui-20261022/browser/evidence/petpal-openui-qa-ZvtrQz/`，含 `browser-acceptance.json`、`build-binding.json`、`final-service-counts.json` 及深浅主题截图。源文件/构建哈希绑定记录用于核对本次实际验收版本。

## 边界与收尾

这验证了实际前后端协议、渲染和交互，不代表真实模型都会正确选择格式，也不代表实体 Android/Ubuntu/Windows 客户端通过。未连接真实 LLM、CLI 或音频服务，未部署线上、改版本或发布安装包。

早期 fixture 的 Origin 配置及请求计数位置问题已纠正；最终调用次数使用直接模型/bridge 计数，不能使用旧 `chatRequests`/`agentRequests`。控制台证据含已停止的早期 fixture 历史报错；未捕获指向最终 5608 入口的错误，不将该记录描述为全程零错误。

验收后关闭本任务 Chrome 页签、恢复请求阻断及设备模拟，停止三个临时 fixture。最终前端/后端/上游监听和进程已退出，保留证据与现有数据、安装包、回退资产。
