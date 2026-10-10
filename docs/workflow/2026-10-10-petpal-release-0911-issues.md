# PetPal 0.9.11 正式发布 Issues

- Date: 2026-10-10
- Complexity: L2
- Related design: 2026-10-10-petpal-release-0911-design.md
- Ordering rule: 按序完成 issue；同一 issue 的平台构建可以并行。

## Issue List

- [x] issue-1 版本与冻结来源
- [ ] issue-2 六包构建验收、正式发布与更新源同步

## issue-1

- ID: issue-1
- 标题: 版本与冻结来源
- 范围: package/lock0.9.11、Android21；包装与性能回归、类型检查、冻结来源提交。
- 依赖: none
- 验收标准: 版本一致；相关回归通过；来源提交可核验且工作区干净。
- 状态: done
- 验证方式: 144/144 包装、升级签名、下载与性能回归通过，tsc --noEmit 与 git diff --check 通过；沿用依赖/许可与既有 signer。
- commit: 本 issue 冻结提交，见 Git 中 chore(issue-1): freeze PetPal 0.9.11 release source。

## issue-2

- ID: issue-2
- 标题: 六包构建验收、正式发布与更新源同步
- 范围: Windows两包、Ubuntu两架构、APK、Web；两源sequence13、stable/latest、服务器下载与服务版本升级。
- 依赖: issue-1
- 验收标准: 六包来自同一冻结源码；包体审计及Windows启动通过；APK签名连续；两源更新有效；最新正式下载及业务状态保留；真实设备边界明确。
- 状态: in_progress
- 验证方式: pending
- commit: pending
