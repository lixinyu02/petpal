# 选择性记忆管理 Issues

- Date: 2026-10-25
- Complexity: L2
- Related design: 2026-10-25-memory-entry-management-design.md
- Current status: issue-2 in_progress

## issue-1

- ID: issue-1
- 标题: 账号隔离的条目读取、删除标记与存储清理
- 范围: Memobase 客户端、记忆服务、下行同步与召回过滤、HTTP API
- 依赖: none
- 验收标准: 精确选择、过期/他人条目拒绝；先遗忘后清理；缓存及备用同步不恢复同一条目；保留其余数据与原日期
- 状态: completed
- 验证方式: 144 项定向回归通过；追加暂停本机管理的远程用例后 7 项删除专用测试通过。覆盖账号/epoch/指纹、排队和重启、旧 context 迟到、备用不同 profile ID、授权撤销与取消原文自动召回；自审已修复暂停记忆时的远程管理准入。无真实账号删除。
- commit: 本 issue 提交

## issue-2

- ID: issue-2
- 标题: 搜索、单条与多选删除管理入口
- 范围: 记忆设置和响应式样式
- 依赖: issue-1
- 验收标准: 普通用户能管理自己的条目；明确确认、取消零写入、重复提交和换账号防护；手机布局不溢出
- 状态: in_progress
- 验证方式: 真实 TSX 交互测试、类型检查、私有候选构建、自审
- commit: pending

## issue-3

- ID: issue-3
- 标题: 正式上线与只读页面验收
- 范围: 受控后端重载、网页发布、Chrome
- 依赖: issue-2
- 验收标准: 正式入口可用；不删除任何用户真实记忆；导入任务、下载和信任配置保留
- 状态: todo
- 验证方式: 合成服务真实删除、正式 HTTP 只读、Chrome 账号隔离、发布摘要与保留证据
- commit: pending
