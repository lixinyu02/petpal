# 工作台流畅性与 UI Issues

- Date: 2026-09-30
- Complexity: L1
- Related design: 2026-09-30-petpal-ui-smoothness-design.md
- Current status: complete

## issue-48

- ID: issue-48
- 标题: 修正流式显示、历史渲染与滚动调度
- 范围: Chat 显示批处理、稳定消息渲染、跟随底部与读取历史的边界、人物循环审计。
- 依赖: issue-47
- 验收标准: 流式文字无丢失，完成/错误/停止/账号切换无迟到回写；历史阅读不被拉回；隔离性能测量与必要回归通过，已有 Agent/语音语义保持。
- 状态: done
- 验证方式: Chrome 长历史/固定流式回复、完成/突发/停止/错误/断流/滚动；167 项唯一覆盖定向回归、TS 与隔离构建，见 acceptance。
- commit: b4c8f1e

## issue-49

- ID: issue-49
- 标题: 精简工作台 UI 并上线网页
- 范围: 消息阅读反馈、空会话布局、轻量交互样式、412×960 适配、Rust 评估和验收记录。
- 依赖: issue-48
- 验收标准: 模式/模型/电脑/审批/停止可达，桌面与竖屏无溢出；原子部署保留历史和下载镜像，Chrome 结果可复核。
- 状态: done
- 验证方式: Chrome 桌面/412×960/412×560、最终回归和构建、公开源码审计；27 文件部署比对、镜像保持、公网登录/静态资源/健康/匿名门禁通过，见 acceptance。
- commit: feat(issue-49)，对应本次提交
