# 记忆深测 Issues

- Date: 2026-10-25
- Complexity: L1
- Current status: completed_with_known_boundary
- Related design: 2026-10-25-memory-depth-design.md

## issue-1

- ID: issue-1
- 标题: 扩展多账号、同步恢复及真实模型记忆验收
- 范围: 有意义的新增确定性测试、随机命名空间真实提炼、隔离Chat模型回答、原数据保全及报告
- 依赖: none
- 验收标准: 并发/持久化/epoch隔离通过；区分事实提炼与回答引用；保留真实失败；zut原记忆不被测试改写；自有投影清理
- 状态: done
- 验证方式: 新增11项，10组最终121/121通过无跳过；6账号216次重复写、冲突/回滚/损坏/两轮epoch与237+5条分页续传通过。真实Chat引用/负对照及应用对象重开通过；三轮真实提炼/更正、19项检查和全部自有投影清理通过；zut journal SHA保持。中央/PC开关独立生效为已确认边界，单列account-wide pause=false，不声称该功能通过。详见同名verification.md与私有depth-acceptance.json。
- commit: 本次测试与验收提交
