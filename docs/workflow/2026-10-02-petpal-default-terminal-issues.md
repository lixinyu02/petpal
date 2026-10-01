# 默认执行电脑迭代

- Date: 2026-10-02
- Complexity: L1
- Related design: 2026-10-02-petpal-default-terminal-design.md
- Current status: issue-1 done，issue-2 pending

## issue-1

- ID: issue-1
- 标题: 账号默认执行电脑与 Chat + Agent 选择入口
- 范围: 账号设置、后端归属校验与持久化，前端默认电脑保存/读取和启用校验
- 依赖: none
- 验收标准: 同账号跨端读取默认电脑；越权拒绝；不持久化执行权限；无电脑时不静默退化；不离线转派
- 状态: done
- 验证方式: 95/95 默认电脑、偏好、协作、项目目录、账号权限与通知回归通过；TypeScript 与隔离 Vite 构建通过；Chrome 保存成功后才启用，刷新保留默认并关闭授权，实际 CSS 412×960 下 scrollWidth=412；保存失败/旧 snapshot/通知并发均有后端回归。审查补默认成功写入的前端 revision fence，避免旧 state 或通知缓存回滚。
- commit: 本 issue 提交（见 Git 历史）

## issue-2

- ID: issue-2
- 标题: 真实启动无畏契约与上线验收
- 范围: 国服入口核对、真实 Chat → Agent 启动任务、结果核实、网页后端部署与源码推送
- 依赖: issue-1
- 验收标准: 默认电脑正确承接任务；实际启动阶段有证据；公网新设置可见；配置/历史保留
- 状态: pending
- 验证方式: 实际工具轨迹、进程/窗口和Chrome生产界面
- commit: pending
