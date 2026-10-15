# Agent Remote 对齐 Issues

- Date: 2026-10-15
- Complexity: L2
- Related design: 2026-10-15-agent-remote-parity-design.md

## Task Overview

- Goal: 补齐 Agent 排队调序、确定未送达引导回退、失联解除、会话修复和人工提问/审批。
- Ordering rule: Complete issues in sequence.
- Current status: all issues completed

## Issue List

- [x] issue-1 队列调序与确定性引导回退
- [x] issue-2 未知执行状态的人工解除
- [x] issue-3 保留历史的 CLI 会话修复
- [x] issue-4 原生用户提问与审批恢复

## issue-1

- ID: issue-1
- 标题: 队列调序与确定性引导回退
- 范围: queueRevision/CAS、队列排序 API/UI、steer_unsupported 本机及远程传播
- 依赖: none
- 验收标准: 仅重排待执行项；冲突/保存失败不覆盖；精确不支持才回退队列，未知结果不重发
- 状态: completed
- 验证方式: 后端队列相关 93/93、协议/API/UI 108/108；TypeScript 与隔离 Vite 构建通过。Chrome 实际上移 3→2、刷新保留 1/3/2，窄屏布局无横向溢出；截图 evidence/agent-parity-queue.png。自审确认仅明确 -32601 回退排队、无自动重试。
- commit: 8f2ac1e

## issue-2

- ID: issue-2
- 标题: 未知执行状态的人工解除
- 范围: 指定 runId+revision 确认、暂停保留队列、恢复 UI
- 依赖: issue-1
- 验收标准: 无 active、归属/CAS/状态校验；只解除指定未知任务，绝不自动重派
- 状态: completed
- 验证方式: 新后端11/11、相关既有88/88、队列/恢复UI39/39、相关App UI64/64；root独立API/队列/组织回归61/61。Chrome实测未勾选不可确认、成功后2条队列仍暂停且合成执行次数保持1，无新任务；截图evidence/agent-parity-recovery.png。自审覆盖save失败/并行save、rename同revision及迟到旧事件。
- commit: 2714b6f

## issue-3

- ID: issue-3
- 标题: 保留历史的 CLI 会话修复
- 范围: 精确 resume 丢失分类、无活动任务的人工上下文修复、当前配置复验、提示与输入保留
- 依赖: issue-2
- 验收标准: 清旧绑定并持久化后才能继续；历史保留、不自动发任务，撤权/未知/队列/竞态仍拒绝
- 状态: completed
- 验证方式: 新后端12/12、既有89/89，新UI28/28、队列/恢复39/39、App UI64/64；root上下文+恢复51/51、原生/relay92/92及额外分类54/54。TypeScript/Vite通过；Chrome重建后历史及未发草稿保留，执行次数仍1；截图evidence/agent-parity-context.png。自审确认未自动重发，旧快照不复活绑定。
- commit: ee7507e

## issue-4

- ID: issue-4
- 标题: 原生用户提问与审批恢复
- 范围: bounded schema、原生 registry、答题 API/快照/卡片、远程能力协商、合法审批决策及到期/resolved
- 依赖: issue-3
- 验收标准: 刷新可回答；不自动代答；答案不持久化泄漏；旧执行端有明确边界；超时/停止/作用域变更取消
- 状态: completed
- 验证方式: 最终Windows相关698项：697通过、1既有长时测试跳过；真实CLI回答/跳过/停止/超时4/4；Ubuntu新协议48/48与私密屏障19/19；Chrome刷新、412×960交互、单次回答任务完成通过；tsc/Vite/公开index扫描通过。自审补齐私密答案发送前持久化屏障，保存失败不发送，跨进程不复用私密线程。详见2026-10-15-agent-remote-parity-verification.md。
- commit: 本 issue 提交（见 Git 历史）
