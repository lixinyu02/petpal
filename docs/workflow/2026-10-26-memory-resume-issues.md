# 记忆提炼接续 Issues

- Date: 2026-10-26
- Complexity: L1
- Related design: 2026-10-26-memory-resume-design.md
- Current status: issue-2 in_progress

## issue-1
- ID: issue-1
- 标题: 对账和单次既有缓冲恢复
- 范围: zut/dds 原生journal、档案作业、模型链路和官方flush
- 依赖: none
- 验收标准: 原scope/epoch/ID保持，部分写入排除、备份完成，恢复done且无新blob
- 状态: completed
- 验证方式: 真实容器两个账号Qwen模型合成请求2/2成功；pg_dump296068B及SQLite一致性备份完成；两条failed缓冲官方flush均done，原ID保持，insertedBlobs=0。失败前无profile/event部分写入，原日期、epoch、事件hash与资料对账通过；64439条档案及两份plan逐行摘要不变。
- commit: 本 issue 提交

## issue-2
- ID: issue-2
- 标题: 接续原任务与进度确认
- 范围: 原作业resume、有限后台接续器、用户可见进度边界
- 依赖: issue-1
- 验收标准: 原plan/ID接续且学习进度实际增加；全量未完成时不误报完成，失败原因记录
- 状态: in_progress
- 验证方式: 原生/作业进度、buffer、保留检查
- commit: pending
