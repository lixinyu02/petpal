# 默认执行电脑迭代

- Date: 2026-10-02
- Complexity: L1
- Related design: 2026-10-02-petpal-default-terminal-design.md
- Current status: issue-1 done，issue-2 done

## issue-1

- ID: issue-1
- 标题: 账号默认执行电脑与 Chat + Agent 选择入口
- 范围: 账号设置、后端归属校验与持久化，前端默认电脑保存/读取和启用校验
- 依赖: none
- 验收标准: 同账号跨端读取默认电脑；越权拒绝；不持久化执行权限；无电脑时不静默退化；不离线转派
- 状态: done
- 验证方式: 95/95 默认电脑、偏好、协作、项目目录、账号权限与通知回归通过；TypeScript 与隔离 Vite 构建通过；Chrome 保存成功后才启用，刷新保留默认并关闭授权，实际 CSS 412×960 下 scrollWidth=412；保存失败/旧 snapshot/通知并发均有后端回归。审查补默认成功写入的前端 revision fence，避免旧 state 或通知缓存回滚。
- commit: 7732004

## issue-2

- ID: issue-2
- 标题: 真实启动无畏契约与上线验收
- 范围: 国服入口核对、真实 Chat → Agent 启动任务、结果核实、UAC 权限边界说明、网页后端部署与源码推送
- 依赖: issue-1
- 验收标准: 默认电脑正确承接任务；实际启动阶段有证据；公网新设置可见；配置/历史保留
- 状态: done
- 验证方式: CPA Qwen Chat 真实 run_agent 派发 → Codex Start-Process 国服入口 → launcher/WeGame/tcls_core/WeGame 窗口轨迹；用户确认 UAC，未验证游戏主界面。官方启动链 manifest requireAdministrator 已只读核实；未修改系统提权策略。任务引导、完成回写与仅测试会话清理通过。Codex 29/29 回归、TypeScript、隔离构建通过。公网新 index 与本机一致，普通 test 账号保存/刷新默认通过，412×960 无横向溢出；32 原会话与全部 provider 配置保留。私有收据和截图仅存 ignored 目录，不发布到公共仓库；本轮不重打安装包。
- commit: 本 issue 提交（见 Git 历史）
