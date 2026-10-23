# 深度流畅性优化 Issues

- Date: 2026-10-23
- Complexity: L2
- Related design: 2026-10-23-deep-fluidity-design.md
- Current status: issue-3 in_progress

## Issue List

- [x] issue-1 可复现性能基线与热点确认
- [x] issue-2 实测热点优化与语义回归
- [ ] issue-3 前后对照、最终QA包与交付

## issue-1

- ID: issue-1
- 标题: 可复现性能基线与热点确认
- 范围: 近期优化复核、源码热点审计、合成页面/流式/人物工作负载与浏览器/Android采集方案；不改产品。
- 依赖: none
- 验收标准: 固定baseline资源/条件/原始样本，确认具体可复现瓶颈与后续文件所有权，不能仅凭源码猜测收益。
- 状态: done
- 验证方式: Chrome聊天full/reduced各3轮、人物idle/pointer各3轮均有效；Android冻结旧APK启动/600消息滚动/12500字流式各3轮通过。两个基线报告保留精确文件、排除样本、指标和夹具自审；脚本语法/diff检查通过。未改产品。Android工具最终issue-3另验收提交。
- commit: perf(issue-1): freeze real chat and avatar fluidity baselines

## issue-2

- ID: issue-2
- 标题: 实测热点优化与语义回归
- 范围: 只优化issue-1确认的热点；保留内容、交互、滚动、流式结束及生命周期语义。
- 依赖: issue-1
- 验收标准: 真实工作负载指标改善有证据，相关边界回归通过；没有降低画质/动作/权限保障。
- 状态: done
- 验证方式: 聊天27/27、人物67/67定向测试；TypeScript/Vite/OpenUI通过。Chrome真实StrictMode语义10/10；聊天after两策略各3轮、100消息上翻锁定1轮、人物idle/pointer各3轮全部有效；夹具/依赖/模型资源SHA保持。清理调用100000+100000→0；人物固定负载rect约4362→2948。Profiler并非各组改善，提交延迟及完整边界在对照报告中分别解释。自审通过，无画质/节拍下降。
- commit: perf(issue-2): reduce chat commit and avatar interaction work

## issue-3

- ID: issue-3
- 标题: 前后对照、最终QA包与交付
- 范围: 冻结资源、API36真实性能及关键兼容运行、独立APK审计、必要网页保全同步、报告与清理。
- 依赖: issue-2
- 验收标准: 最终包与源码/资源一致，前后条件和收益/边界明确，关键功能不退化，正式源和业务数据保持。
- 状态: in_progress
- 验证方式: Chrome、ADB运行与帧指标、APK资源/签名/CRC、保全和清理核验。
- commit: pending
