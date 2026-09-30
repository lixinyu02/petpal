# 性能与视觉细化 Issues

- Date: 2026-09-30
- Complexity: L1
- Related design: 2026-09-30-petpal-performance-polish-design.md
- Current status: issue-51 todo

## issue-50

- ID: issue-50
- 标题: 减少人物资源传输和高频界面计算
- 范围: 资源编码/来源、角色加载依赖、稳定派生列表及历史侧栏；以审计结果决定具体实现。
- 依赖: issue-49
- 验收标准: 有体积或渲染工作减少的证据，角色质量和透明轮廓保持，完成/取消/隔离/语音及人物生命周期不回归。
- 状态: done
- 验证方式: 资源逐像素/构建依赖比较，定向回归、TS、隔离 Chrome 实测。
- commit: perf(issue-50), see Git history

## issue-51

- ID: issue-51
- 标题: 统一图标和布局层级并上线网页
- 范围: 图标/品牌入口/触控反馈、阅读列宽、手机/短屏排版、验收与部署。
- 依赖: issue-50
- 验收标准: 主要入口不歧义，图标有名称且尺寸一致，桌面/竖屏无溢出；公网静态与构建一致，历史/下载保持。
- 状态: todo
- 验证方式: Chrome 截图/实际视口/操作验收、公开源码审计、静态部署 hash、health/匿名门禁。
- commit: pending
