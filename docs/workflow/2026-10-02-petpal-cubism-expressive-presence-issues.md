# Cubism 神态与场景动作增强

- Date: 2026-10-02
- Complexity: L2
- Related design: 2026-10-02-petpal-cubism-expressive-presence-design.md

## issue-1

- ID: issue-1
- 标题: 增加语境动作和低频待机神态
- 范围: V9 动作包、实际运行调度、微表情、回归、Chrome 与网页部署
- 依赖: a4dcf9d 的 V8 骨架及生命周期保护
- 验收标准: 新动作实际可触发并回位，脸发骨架不变；口型独立，停止不残留、动作不重复；新旧模型兼容；412×960 无溢出；部署保持业务状态
- 状态: done
- 验证方式: 真实 Core/Framework 与语义生命周期回归、TS/Vite、Chrome 视觉与公网资源哈希
- commit: 本 issue 完成提交（feat(issue-1): enrich Cubism expressions and contextual gestures）

结果：271/271 相关回归、TypeScript、Vite 和 Core 64 姿态通过。Chrome 真实状态切换与停止、单眼动作、低动态、412×960 无溢出通过；公网 170 个资源哈希一致，业务状态及后端保持。见 [验收记录](../cubism/expressive-presence-validation.md)。
