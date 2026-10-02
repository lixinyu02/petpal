# Cubism V7 观感美化

- Date: 2026-10-02
- Complexity: L1
- Related design: 2026-10-02-petpal-v7-portrait-polish-design.md

## issue-1

- ID: issue-1
- 标题: 美化 V7 展示并收敛日常动作
- 范围: V7 专用呈现、待机节奏与眨眼所有权、真实 Core/Chrome 验收、网页交付
- 依赖: 25a4813 的 V7；不修改模型源、几何和 MOC
- 验收标准: 原人物比例保持，画面柔和清晰；日常单一眨眼时钟，互动不被待机倍率影响，口型立即闭合；412×960 无溢出、透明桌宠无背景块
- 状态: done
- 验证方式: 相关回归、真实 Framework+MOC、TS／隔离构建、Chrome、正式资源读回
- commit: 本 issue 的 `style(issue-1): polish Cubism portrait and calm idle animation` 提交，实际 SHA 见 Git 日志

验收结果：223 项相关回归和 4 项真实 Core／Framework 专项测试通过；TS、隔离构建、Chrome 桌面与 412×960、互动及减少动画模式通过。正式静态部署成功，131 个 HTTPS 资源 hash 一致。后台、账号、token、下载及升级清单保留。详见 `docs/cubism/portrait-polish-validation.md`。
