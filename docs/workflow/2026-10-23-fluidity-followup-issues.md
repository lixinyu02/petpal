# 深度流畅性优化第二轮 Issues

- Date: 2026-10-23
- Complexity: L2
- Related design: 2026-10-23-fluidity-followup-design.md

## Task Overview

- Goal: 减少已测剩余流式与启动开销并完成有边界的验收交付。
- Ordering rule: Complete issues in sequence; parallelize read-only investigation and independent work within the active issue.
- Current status: issue-1 complete; issue-2 next

## Issue List

- [x] issue-1 冻结基线与确认热点
- [ ] issue-2 实现并验证热点优化
- [ ] issue-3 集成运行验收与交付

## issue-1

- ID: issue-1
- 标题: 冻结基线与确认热点
- 范围: 真实组件冻结、启动依赖审计、确定实现与测量方法
- 依赖: none
- 验收标准: 原始基线可运行，产品代码未混入候选，设计具体化
- 状态: done
- 验证方式: 当前源码冻结 1950 inputs / 13 files，与上一轮最终 sourceDigest 相同；已审计全行投影/浅比较与启动静态依赖。新性能样本将在同一组交错采集。
- commit: 本 issue 提交

## issue-2

- ID: issue-2
- 标题: 实现并验证热点优化
- 范围: 当前热点最小实现、定向回归、Chrome 交错对照与真实 DOM
- 依赖: issue-1
- 验收标准: 内容/状态/焦点/滚动保持，保留可解释的同条件改善
- 状态: todo
- 验证方式: Node、TypeScript、Chrome profiling/StrictMode
- commit: pending

## issue-3

- ID: issue-3
- 标题: 集成运行验收与交付
- 范围: 冻结生产构建、Android 对应回归与 QA 包、网页部署/报告
- 依赖: issue-2
- 验收标准: 构建与运行通过，业务/正式下载保持，明确性能和平台边界
- 状态: todo
- 验证方式: 资源/包摘要、API36 关键运行、公开入口、保全收据
- commit: pending
