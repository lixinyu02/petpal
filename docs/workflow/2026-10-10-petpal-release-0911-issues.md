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
- 范围: package/lock0.9.11、Android21；移除废弃3D小猫、兼容旧选择、包装与性能回归、类型检查、重新冻结来源提交。
- 依赖: none
- 验收标准: 版本一致；相关回归通过；来源提交可核验且工作区干净。
- 状态: done
- 验证方式: 初始144/144包装、升级签名、下载与性能回归通过；退休小猫后的77/77相关回归及tsc通过，PS5/PS7 manifest字节一致。源码扫描、ncmcli与finalize共41/41；33组精确凭据例外的197项策略检查通过，强私钥规则保持。实际source --check通过：1343文件、112213367B、pendingCompanionRoots为空。沿用依赖/许可与既有 signer。
- commit: 初始0fcc2c0未发布；本卡所在fix(issue-1)提交重新冻结仅保留二次元伙伴的来源。

## issue-2

- ID: issue-2
- 标题: 六包构建验收、正式发布与更新源同步
- 范围: Windows两包、Ubuntu两架构、APK、Web；两源sequence13、stable/latest、服务器下载与服务版本升级。
- 依赖: issue-1
- 验收标准: 六包来自同一冻结源码；包体审计及Windows启动通过；APK签名连续；两源更新有效；最新正式下载及业务状态保留；真实设备边界明确。
- 状态: in_progress
- 验证方式: pending
- commit: pending
