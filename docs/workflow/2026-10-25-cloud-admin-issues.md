# 云端权限与创建修复 Issues

- Date: 2026-10-25
- Complexity: L2
- Related design: 2026-10-25-cloud-admin-design.md
- Current status: issue-2 in_progress

## issue-1
- ID: issue-1
- 标题: 核查原申请并修正生命周期适配
- 范围: 平台回执/集群状态、驱动、幂等与错误显示所需信息
- 依赖: none
- 验收标准: 失败有实证定位；原项目保留；修复以原ID和受控管理员验证
- 状态: completed
- 验证方式: 实证：zut 项目原 ID 保留、Pod 两容器 Running/restart0，但节点 profile 仍 creating/revision10，实际 pids.max=18836，kubelet configz=512；节点原有回执含 kubernetes_pids_limit_unconfirmed。未将 Pod Running 当成平台就绪，也未放宽隔离。修复 creating/unknown 被误映射 stopped、刷新丢失创建错误；合并已有且直接相关的120s冷启动和原生revision修正。60项回归59通过1条件跳过。K3s实际PID校验仍阻塞，需节点侧修复，本任务不通过放宽上限恢复zut申请。
- commit: 本 issue 提交

## issue-2
- ID: issue-2
- 标题: 管理员创建与前后端权限隔离
- 范围: API、服务准入、目录、UI和回归
- 依赖: issue-1
- 验收标准: 普通账号隐藏新建且POST/恢复start被拒绝，管理员正常，已有环境保留
- 状态: in_progress
- 验证方式: 服务/API/TSX/Chrome
- commit: pending

## issue-3
- ID: issue-3
- 标题: 上线与保留验证
- 范围: 网页/服务、Github提交、正式接口只读和拒绝验收
- 依赖: issue-2
- 验收标准: 正式策略生效且用户/记忆/下载/旧云端资料保留
- 状态: todo
- 验证方式: 类型/构建/公网摘要、备份与业务检查
- commit: pending
