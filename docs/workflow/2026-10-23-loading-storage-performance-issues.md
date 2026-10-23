# 页面启动与状态写入性能 Issues

- Date: 2026-10-23
- Complexity: L1
- Related design: 2026-10-23-loading-storage-performance-design.md

## Task Overview

- Goal: 优化打开速度和状态写入性能，保持可靠性。
- Ordering rule: Complete issues in sequence.
- Current status: issue-1 done; issue-2 todo

## Issue List

- [x] issue-1 减少重复物理写入与会话查找开销
- [ ] issue-2 并行启动页面与数据并实际验收

## issue-1

- ID: issue-1
- 标题: 减少重复物理写入与会话查找开销
- 范围: JsonStore、会话整理扩展、隔离回归和前后基准
- 依赖: none
- 验收标准: 逻辑操作/事件/授权顺序不变；重复内容可省物理写入；外部文件变化与失败后仍可靠保存；紧凑格式和线性查找有可复现收益。
- 状态: done
- 验证方式: 独立复验186/186；14项新增缓存/文件身份/失败/顺序/授权与索引回归。三轮合成基准：文件减少25%；32次重复顺序保存415→188ms、重复突发398→173ms、不同快照404→303ms；不同快照仍32次写入。详见validation。
- commit: 本 issue 提交

## issue-2

- ID: issue-2
- 标题: 并行启动页面与数据并实际验收
- 范围: 登录门禁、页面模块预载、初始数据单次预取、构建部署与Chrome
- 依赖: issue-1
- 验收标准: 登录后页面与数据准备并行；无跨账号/跨模式复用或永久挂起；原有重试和兼容保持；真实页面、聊天及生产入口正常。
- 状态: todo
- 验证方式: pending
- commit: pending
