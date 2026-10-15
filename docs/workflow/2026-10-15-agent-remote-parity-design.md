# 对照 Codex Remote 补齐 Agent 工作流

- Date: 2026-10-15
- Complexity: L2
- Status: final

## Background

用户指定「检查并优化 Codex Remote 客户端」任务 `01a119c9-3aa2-7bf3-8659-eb58dcaa3782`，优先 Agent 排队、断线恢复、审批和执行中引导。已读取该任务与参考仓库 E:/codexsdk 的稳定 HEAD d11c59d；该仓库另有活跃开发，本轮只读参考。小伴基线 cf51021。

小伴已有持久 submissionId 幂等回执、五条 FIFO、编辑删除/暂停恢复、轮询恢复与任务生命周期独立于 HTTP、手动审批和独立审查模型。继续使用这些机制，无需仅为外观一致改写 SSE。

## Goal

1. 待执行消息可调整顺序；精确证明原生不支持引导时转入原会话队列，未知送达保持 uncertain。
2. 远程任务失联后提供显式「已确认原任务停止」入口，只解除指定未知状态，不自动继续或重派。
3. 无活动/待执行/未知任务时可显式修复会话，清理 CLI 上下文并按当前授权配置继续使用原聊天历史；不自动重新发送输入。
4. 原生请求用户回答时提供独立提问表单，刷新可恢复待回答请求，并补全审批决策/过期事件兼容。

## Non-goals

不迁入 Docker、飞书、文档库或 Trae 平台，不升级当前 CLI、不改现有权限默认值，不自动接受审批、回答问题、解除未知状态或重试可能已执行的任务。本轮不发布线上服务、客户端或更新清单。

## Solution

### Queue and steer

新增独立 queueRevision，只随队列变更推进，不随 token 流变化。重排 API 接受完整、不重复的 entryIds 排列与预期版本，在会话锁内鉴权并持久化；只移动尚未启动的任务，不覆盖内容/模型/权限/目标电脑。手机和桌面使用上移/下移按钮。入队、出队、移除、停止清空、撤销等路径均维护队列版本；保存失败恢复旧顺序并暂停。

turn/steer 仅对可信 JSON-RPC method-not-found(-32601) 分类 steer_unsupported。该分类通过桌面执行端、中央 relay 白名单保留，复用确定未送达的排队回退。超时、连接中断、返回 turn 不一致仍是 uncertain，幂等回执禁止自动重发。

### Unknown execution recovery

新增 owner 限定确认接口，携带 runId 与当前 agent.revision（无活动任务时稳定）。确认原电脑上的旧任务确已结束后，服务器复验同账号、无 active、指定 unknown/uncertain 状态及持久化版本，只清对应状态并保持 paused。保留队列及所有消息。解除动作不调用 kick，不重新派发；用户另点继续队列。保存失败不清除未知状态，旧 run 的迟到回执不能改变新 run。

### Context repair

为 CLI resume 丢失和全局配置版本变化提供明确的人工修复入口。要求当前登录/Agent 权限、会话归属、无 active/queue/unknown/uncertain、CAS 版本正确。清 threadId、thread*绑定及审查绑定，更新会话使用的全局配置版本，保留全部网页消息与未发送输入，记录明确恢复提示。后续提交仍按当时显式选择的模型、执行电脑和权限重新校验，不变更冻结队列，不自动重发。识别精确 thread/resume rollout 缺失以给出可操作错误，不把网络或权限故障伪装成上下文丢失。

### Human input and approvals

用户问题独立于执行审批。原生 registry 绑定 request、run/thread/turn、当前进程；服务器快照绑定账号/会话/活动任务。返回结构化问题和绝对到期时间，答题 API 严格校验完整答案、选项、长度和请求 ID。回答/跳过必须用户显式操作，auto/full-access 不代答。重复同答案只确认一次，冲突拒绝。答案不写入普通事件或持久聊天；敏感回答不得进入日志、状态或公开输出。刷新不会自动跳过问题；停止、原生 resolved、进程/连接结束使其失效。

远程执行端通过 userInput 能力协商，旧端不接收不支持的答题命令；新事件和命令均严格校验并保留作用域。内置 CLI 0.143 的 features 列表已确认 default_mode_request_user_input（默认关闭）；仅在已验证的内置/API CLI 路径启用该功能，保留外部/未知 CLI 的兼容边界。审批始终遵循原请求可接受的拒绝/取消动作，未知权限形式不放行；补 requestedAt/expiresAt 和 resolved 的旧流式入口清理。

集成自审补充：私密回答的遮盖值只保留在内存，不能让下一次 CLI 进程或重启后的服务器恢复含有私密答案的旧线程。中央答题入口必须先通过 contextGeneration 事务清除 thread* 绑定并成功落盘，才把私密答案送到原任务；本轮任务的迟到 thread 事件和完成结果不得重新绑定。保护保存失败则不发送答案。下一次用户明确提交建立新 CLI 记忆，网页历史保留，不回放旧动作。

## Impact

server/codex、agent-tasks、app、executors/remote-codex，desktop executor，新提问 schema/组件，AgentQueue/App/API 类型与包源必需清单、受影响单元/集成和真实 CLI 测试。版本兼容字段以缺省值迁移，所有新操作均要求当前登录。

## Risks

远程断线不证明原任务停止，产品必须明确要求现场核验。配置修复不能继承旧 CLI 状态目录、旧审查绑定或撤销的模型权限。版本冲突不能以覆盖方式解决。敏感答案只发送到已选择的执行 Agent，不能当成普通聊天消息持久化。实际模型是否主动提问与模型/CLI 功能相关，协议测试、真实 CLI 合成模型和真实公网模型验收分开报告。

## Verification Plan

逐 issue 自审、回归并提交；Windows 和 WSL x64 Node 测关键后端契约；真实固定 CLI+本机合成模型服务验收可控提问/审批/引导，避免用户账号额度和真实电脑动作。Chrome 插件验收隔离网页上的调序、修复与答题，包含窄屏和刷新。最终 TypeScript/Vite 生产构建、源码扫描/包清单检查；保留用户已授权的官方账号预览，不读取全局 auth.json。
