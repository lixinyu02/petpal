# 后台 Chat 与线程切换 Issues

- Date: 2026-10-25
- Complexity: L2
- Related design: 2026-10-25-background-chat-design.md
- Current status: completed

## issue-1

- ID: issue-1
- 标题: 独立运行归属与增量保护
- 范围: 注册表、恢复所有权、全量快照合并
- 依赖: none
- 验收标准: A/B 互不覆盖；同线程新一轮废弃旧恢复；关闭全部与删除有效；普通刷新不能覆盖运行中文字
- 状态: completed
- 验证方式: 注册表/合并 10 项通过；覆盖双线程、停止隔离、同线程恢复淘汰、临时 ID、账号退休、资源关闭、迟到全量读取及新线程保留。自审通过，无后端修改。
- commit: 11ce0c5

## issue-2

- ID: issue-2
- 标题: 接入发送导航停止与侧栏状态
- 范围: App Chat、导航、附件、语音、Agent 导航和历史侧栏
- 依赖: issue-1
- 验收标准: 发消息后可切线程/新建并发送；只停止当前线程；后台不清空他人草稿/附件、不朗读抢焦点；完成可见
- 状态: completed
- 验证方式: 605 项相关回归通过；自审补强 Agent 选择切换前的迟到帧/语音屏障，并对丢弃后失败草稿复活问题修复，最新 Chat/Agent 专项 32 项通过。TypeScript、Vite/OpenUI 候选构建通过。真实 App send/stop/navigation 函数覆盖双线程、返回、停止、迟到 meta、草稿图片、恢复、账号与 Agent 导航，侧栏 SSR 验证活动与未读状态。
- commit: ebfce29

## issue-3

- ID: issue-3
- 标题: Chrome 端到端验收及网页上线
- 范围: 隔离慢速模型、真实双线程与正式网页只读检查
- 依赖: issue-2
- 验收标准: 后台文本实际持续生成，返回后完整，另一线程可并发回复；网页上线且业务/记忆/下载保持
- 状态: completed
- 验证方式: Chrome 真实双线程通过：B 完成时 A 仍在输出，A 180 段完整返回、未读提示与清除均确认；与手动记忆编辑联合上线，97 个公网资源摘要与业务/记忆/下载保留通过。范围为应用内切换，不含刷新/关闭网页续跑；独立首页仍遵守卸载保护。详见 2026-10-25-memory-edit-acceptance.md。
- commit: 本 issue 提交
