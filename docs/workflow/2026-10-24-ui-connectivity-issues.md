# UI 与连接性 Issues

- Date: 2026-10-24
- Complexity: L2
- Related design: 2026-10-24-ui-connectivity-design.md

## Task Overview

- Goal: 修复有当前证据的UI及连接恢复缺陷。
- Ordering rule: issue顺序推进，当前issue内并行独立调查。
- Current status: issue-2 in_progress

## Issue List

- [x] issue-1 当前界面与连接故障复现
- [ ] issue-2 最小修复与定向回归
- [ ] issue-3 浏览器集成验收与交付

## issue-1

- ID: issue-1
- 标题: 当前界面与连接故障复现
- 范围: Chrome截图、只读代码审查、隔离fixture与脱敏真实端点探测
- 依赖: none
- 验收标准: 有明确触发与预期行为，区分产品bug和外部服务异常
- 状态: done
- 验证方式: Chrome当前桌面/412登录与合成首页截图；真实api/Agent effect复现200截断JSON被吞成空对象后hosts写undefined导致渲染异常、半开读取无截止时间、恢复后旧错误残留；真实SettingsView复现保存期间新窗口被旧保存关闭，以及POST成功但refresh503后重复创建。确认连接dialog缺少名称。真实后端/五模型/ASR协议/TTS能力探测通过且state SHA保持。基线warmup测试存在401二次核验导致的旧计数断言失败，待同步精确合同。新fixture安全隔离并由root启动，Chrome工作台导航中出现插件超时，正在恢复验收连接。
- commit: 本issue提交

## issue-2

- ID: issue-2
- 标题: 最小修复与定向回归
- 范围: 仅issue-1确认缺陷的产品/测试文件
- 依赖: issue-1
- 验收标准: 缺陷复现变为通过，登录/消息/请求隔离保持
- 状态: in_progress
- 验证方式: 定向测试与TypeScript
- commit: pending

## issue-3

- ID: issue-3
- 标题: 浏览器集成验收与交付
- 范围: 同路径UI复验、构建/网页发布和报告
- 依赖: issue-2
- 验收标准: 有界面与状态证据，业务/下载/信任保全通过
- 状态: todo
- 验证方式: Chrome实际操作、完整资源SHA和运行态核验
- commit: pending
