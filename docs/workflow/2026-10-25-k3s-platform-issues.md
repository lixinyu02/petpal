# K3s 平台接入 Issues

- Date: 2026-10-25
- Complexity: L2
- Related design: 2026-10-25-k3s-platform-design.md

## issue-1
- ID: issue-1
- 标题: 平台目录与 K3s 资源申请协议
- 范围: 运行时能力投影、节点就绪门禁、资源冻结与原请求恢复
- 依赖: none
- 验收标准: 有界字段、明确节点、固定 PID、不可支持能力拒绝、原 Docker 兼容
- 状态: in_progress
- 验证方式: 平台协议/耐久状态/HTTP/WS 定向回归
- commit: pending

## issue-2
- ID: issue-2
- 标题: K3s 环境申请与平台绑定界面
- 范围: 节点类型、就绪原因、CPU/内存、CLI 模板与配对说明
- 依赖: issue-1
- 验收标准: 不可用原因可见、无法提交无效申请、原请求与账号切换安全
- 状态: pending
- 验证方式: 组件事件、类型检查、构建、Chrome
- commit: pending

## issue-3
- ID: issue-3
- 标题: 实际平台绑定与集群验收
- 范围: 发现现有平台、配对、K3s 节点探测与可行的真实执行、交付
- 依赖: issue-2
- 验收标准: 实际连接/能力回执与业务结果明确、现有数据和任务保全
- 状态: pending
- 验证方式: 私有运行回执、真实 HTTP/WS、Chrome
- commit: pending
