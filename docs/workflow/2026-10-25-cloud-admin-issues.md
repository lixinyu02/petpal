# 云端权限与创建修复 Issues

- Date: 2026-10-25
- Complexity: L2
- Related design: 2026-10-25-cloud-admin-design.md
- Current status: completed (权限/状态修复；K3s PID 阻塞见验收报告)

## issue-1
- ID: issue-1
- 标题: 核查原申请并修正生命周期适配
- 范围: 平台回执/集群状态、驱动、幂等与错误显示所需信息
- 依赖: none
- 验收标准: 失败有实证定位；原项目保留；修复以原ID和受控管理员验证
- 状态: completed
- 验证方式: 实证：zut 项目原 ID 保留、Pod 两容器 Running/restart0，但节点 profile 仍 creating/revision10，实际 pids.max=18836，kubelet configz=512；节点原有回执含 kubernetes_pids_limit_unconfirmed。未将 Pod Running 当成平台就绪，也未放宽隔离。修复 creating/unknown 被误映射 stopped、刷新丢失创建错误；合并已有且直接相关的120s冷启动和原生revision修正。60项回归59通过1条件跳过。K3s实际PID校验仍阻塞，需节点侧修复，本任务不通过放宽上限恢复zut申请。
- commit: 6fe6d3a

## issue-2
- ID: issue-2
- 标题: 管理员创建与前后端权限隔离
- 范围: API、服务准入、目录、UI和回归
- 依赖: issue-1
- 验收标准: 普通账号隐藏新建且POST/恢复start被拒绝，管理员正常，已有环境保留
- 状态: completed
- 验证方式: 111 项服务/API/实际 TSX/平台/互联/桌面回归：110 通过、1 条条件跳过。涵盖两种来源直接创建403、未完成start403、降权异步边界、旧事件、未知回执恢复、已有环境启停、PID错误可见和隐藏入口。TypeScript 通过；Chrome 在 issue-3 验收。
- commit: 8ac16bc

## issue-3
- ID: issue-3
- 标题: 上线与保留验证
- 范围: 网页/服务、Github提交、正式接口只读和拒绝验收
- 依赖: issue-2
- 验收标准: 正式策略生效且用户/记忆/下载/旧云端资料保留
- 状态: completed
- 验证方式: 110通过/1条件跳过，TypeScript/Vite/OpenUI通过；正式zut创建和pending-start403、匿名401、管理员400无副作用，Chrome0创建入口且pending启动disabled；48公网资源完整SHA，用户/记忆/63下载/原云端身份保留。K3s PID仍未通过，未创建/启动资源，详见 cloud-admin-acceptance.md。
- commit: 本 issue 提交
