# 远程 PC 体验 Issues

- Date: 2026-09-30
- Complexity: L1
- Related design: 2026-09-30-petpal-remote-pc-design.md
- Current status: issue-53 todo

## issue-52

- ID: issue-52
- 标题: 默认关闭 3D 小猫并提供手动开关
- 范围: 有效伙伴偏好、首页选择、设置入口与浮窗兼容。
- 依赖: issue-51
- 验收标准: 新旧猫偏好均不在未启用时加载小猫，开关按账号/服务隔离，启用后可切换，关闭后回二次元且不污染历史。
- 状态: done
- 验证方式: 20 项偏好/隔离/挂载回归、TypeScript、独立 Vite build 通过；Chrome 默认仅二次元且未请求 PetScene，设置开启→切猫→关闭→回二次元通过。Android 仅同步已运行浮窗，实机未验收。
- commit: feat(issue-52): disable the 3D cat until this device explicitly opts in

## issue-53

- ID: issue-53
- 标题: 优化远程执行电脑选择
- 范围: Agent 与 Chat + Agent 主机入口、分组、在线状态与连接引导。
- 依赖: issue-52
- 验收标准: 同账号电脑易于辨认，离线不静默回退，任务期间锁定，手机版不拥挤且键盘可用。
- 状态: todo
- 验证方式: 主机偏好/渲染/隔离回归，Chrome 响应式操作。
- commit: pending

## issue-54

- ID: issue-54
- 标题: 验收 PC Codex CLI 公网远程执行并修复阻塞
- 范围: 发布包/真实执行器注册与任务链路，必要修复与交付，网页部署；同步未来桌面 smoke 的开关与 v2 public display 验收入口。
- 依赖: issue-53
- 验收标准: 使用真实 PC CLI 得到远程任务完成证据，或清楚区分外部阻塞；所有必要修复通过回归与实际复验，账号隔离和鉴权保持。
- 状态: todo
- 验证方式: Windows 隔离 profile 与公网同账号只读任务、真实 CLI 版本/结果，静态部署与包验证（如需）。
- commit: pending
