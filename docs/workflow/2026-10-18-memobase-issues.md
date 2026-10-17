# Memobase 集成 Issues

- Date: 2026-10-18
- Complexity: L2
- Related design: 2026-10-18-memobase-design.md

## issue-1

- ID: issue-1
- 标题: 用户记忆服务、中央/PC同步和管理入口
- 范围: 固定Memobase客户端与受控运行时、用户durable journal/epoch、Chat/Agent注入、PC绑定同步与故障启动、设置UI和测试。
- 依赖: none
- 验收标准: 一账号一逻辑库，跨设备同步不串库；中央故障PC按需自启，恢复补同步且清空不复活；不拖慢聊天，现有能力保持。
- 状态: done
- 验证方式: 229/229 模块/API/UI/桌面生命周期、Agent/自动化/auth 与打包闭包定向回归通过；TS no-emit、隔离 Vite 构建和自审通过。冷启动断连、401/403、迟到 context、关闭记忆/停用账号与删除墓碑均有回归；真实跨机边界另记验收说明。
- commit: 本卡实现提交，提交号在 issue-2 收尾时回填。

## issue-2

- ID: issue-2
- 标题: 真实Memobase验收与中央服务上线
- 范围: 本地官方源拉取、真实容器/模型写入提炼、Chrome桌面与手机布局、受控部署及业务保留、源代码推送。
- 依赖: issue-1
- 验收标准: 真服务写入读取有证据，隔离库和PC故障恢复测试边界明确，正式下载/代理/聊天保持。
- 状态: in_progress
- 验证方式: 私有运行回执、真实HTTP/LLM与模拟故障区分、fresh idle部署/HTTPS回读。
- commit: pending
