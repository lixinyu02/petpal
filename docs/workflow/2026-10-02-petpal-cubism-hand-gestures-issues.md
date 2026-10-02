# Cubism 手部与情绪动作增强

- Date: 2026-10-02
- Complexity: L2
- Related design: 2026-10-02-petpal-cubism-hand-gestures-design.md

## issue-1

- ID: issue-1
- 标题: 新增真实合手与衣袖绑定和情绪动作
- 范围: V8 作者 profile、模型产物、原生曲线、运行桥调度、Core／Chrome 验收、网页上线
- 依赖: 08e0ccc 的 V7 美化与稳定头脸
- 验收标准: 三个新参数有真实几何响应，双手接触不分裂，脸发领口固定；动作自然起落、旧模型兼容、停止与安静状态不残留手势；小屏无溢出；部署保留业务状态
- 状态: done
- 验证方式: 真 Core 参数／组合网格测试，真实 Framework 调度测试，相关回归、TS／构建，Chrome 对照和正式 HTTPS 资源读回
- commit: 本 issue 完成提交（feat(issue-1): add native Cubism hand gestures and speech reactions）

完成记录：官方 Core 64 姿态、121 个组合几何姿态、75 组手部共同位移采样通过；相关回归 248/248、TypeScript、Vite 生产构建通过。Chrome 真模型对照与线上 TapHead／Greet、减少动态、412×960 无水平溢出通过。静态部署后 147 个公网资源 SHA-256 一致；业务状态和后端保持。详见 [验收说明](../cubism/hand-gestures-validation.md)。
