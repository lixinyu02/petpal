# 小伴 OpenUI 交互输出

- Date: 2026-10-22
- Complexity: L1
- Status: draft

## Background

用户要求同样适配 Codex Remote 的 OpenUI Render。已读取 E:/codexsdk 的当前作者源及策略；参考工程正在并行开发，保持其未提交工作，记录文件哈希而不假定全仓冻结。

## Goal

Chat 与直接 Agent 消息自动选择普通 Markdown 或显式 OpenUI 交互块；表单、选项、表格在同一条回复内呈现，按钮可将填写内容加入当前输入框，由用户发送。

## Solution

- 官方 @openuidev/react-lang/lang-core 1.0.1，受控九组件与 validator 参考 Codex Remote；复用小伴现有 React，由 Vite 懒加载，无 CDN/第二个 UI 模型。
- 仅标记为 auto/openui 的助手消息解析显式顶层 openui fence；旧历史、用户消息和示例代码保持原显示。无效或截断内容保留安全 Markdown 与提示。
- 服务端每条回复保存输出策略，自动策略通过同一组件库的提示词指导当前模型；自动化及其他结构化内部调用保持原协议。
- 流式更新稳定组件实例，表单草稿留在当前消息的内存；切换会话/身份后卸载。UseInPrompt 仅填入草稿；Set/Reset 只在本地修改声明状态。无工具提供器、无任意脚本/网络动作。
- TTS只读周边解释，跳过OpenUI围栏。沿用石墨灰/淡白主题，触控44px，宽表在组件内滚动。

## Impact / Risks

涉及 SDK 依赖、消息渲染、Chat/Agent提示词与输出元数据、朗读过滤。重点验证队列/远程执行恢复时策略不丢失、完成态不重置表单、流中不执行按钮、旧历史不误激活，以及无交互回答不加载SDK。

## Non-goals

不复制参考项目独立工作台的路由或鉴权；本轮复用小伴对话历史呈现相同输出。无线上部署、客户端打包、生产数据修改。

## Verification Plan

组件/协议安全与流式测试、真实小伴隔离HTTP任务测试、现有聊天/队列/朗读回归、TypeScript与独立Vite构建；Chrome桌面、412×960和360×800操作表单、回填草稿、流中状态/坏源码/主题/懒加载验收。真实模型和实体设备是否运行另行记录。
