# OpenUI 提示词不设人为字符预算

- Date: 2026-10-23
- Complexity: L1
- Status: final

## Background

评估 `thesysdev/open-intelligent-ui`（`03213439358bf3408ad61a46ec9e3230c5572e48`）时确认可复用现有 OpenUI 1.0.1；上游完整系统提示词 33411 字符。用户明确要求取消小伴的 32000 字符提示词预算，不因新增组件说明而降级或截断。

## Goal

当前 Chat/Agent 继续自主选择呈现方式，组件说明与用户任务不受组合提示词的人为字符上限限制；长提示词不触发 Markdown 降级、不挤掉已检索记忆、不因此重置原生会话，并能完整穿过本机和远程桌面执行链路。

## Non-goals

本轮评估并验证上游可复用性，尚不启用其完整组件库。账号、模型权限、原始 HTTP 消息校验、上传限制、渲染资源限额、既有记忆检索摘要和切换电脑的近期历史选取策略不属提示词预算。无生产部署或客户端打包。

## Solution

- 移除 `OUTPUT_PROMPT_LIMIT`、长度降级/隔离分支及静态 guide 文件的任意大小门槛。提示词缺失或无效时仍可降级，显式 Markdown 和内部结构化任务仍遵守既有协议。
- Chat、legacy Codex、队列 Agent 发送完整组件 guide、已选上下文与当前任务，不因总长度截断。
- Codex 原生 turn 输入及远程桌面 run 命令取消组合 prompt 的 32000 字符校验，保留类型、图片、身份、权限和 RPC 校验。
- 复用现有队列/会话与渲染元数据，不增加新模式选择器或第二次模型调用。

## Impact / Risks

较长请求将使用更多上游上下文；上游实际模型限制及其错误继续通过原有错误链路返回。必须验证真实桥接入参而不只使用 fake bridge，避免前端和中央服务通过而桌面拒绝。

## Verification Plan

长 guide/任务策略测试，ChatCompletions/Responses/legacy Codex 隔离 HTTP 测试，队列/线程/记忆回归，原生 CLI 与远程桌面长 prompt 协议测试，TypeScript、相关回归及 diff 检查。没有界面变更，不重复上一轮 Chrome 布局验收。

## Completion

完成日期 2026-10-23。policy/API/queue/memory 53 项、原生 Codex 与桌面执行器 73 项、上下文修复/Chat+Agent/队列 HTTP/图片 31 项，合计 157/157 通过，无跳过。TypeScript 和 diff 检查通过。

上游隔离兼容性探针 15 项通过，其中真实 33411 字符上游说明加 32000 字符任务共 65413 字符，策略保持 auto 且逐字完整；真实 `CodexBridge` 与 `DesktopExecutor` 使用 fake CLI 协议验证超过 48000 字符 prompt 完整送达，同一会话可续用。这不代表真实上游模型调用或实体系统验收。

详见 `../open-intelligent-ui-evaluation.md`。本轮未启用新组件、未部署服务或重打客户端；既有原始输入、消息传输及渲染校验不是此组合提示词预算，未扩大其范围。
