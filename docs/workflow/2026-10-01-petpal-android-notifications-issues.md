# Android 后台任务通知 Issues

- Date: 2026-10-01
- Complexity: L2
- Related design: 2026-10-01-petpal-android-notifications-design.md
- Current status: issue-62 done

## issue-62

- ID: issue-62
- 标题: 安卓后台监听远程 Agent 终态并通知
- 范围: 持久化账号 feed、受限设备凭据、原生后台服务/权限/点击、设置与会话围栏、APK 构建和分层验收。
- 依赖: issue-61 done
- 验收标准: 真正原生后台监听，任务与通知持久化；直接 Agent/Chat 派发均覆盖；账号隔离与注销撤销；补发去重；不泄露全文或密钥；APK可构建并明确设备验收边界。
- 状态: done
- 验证方式: Node 回归记录 final-tests.log 1143/1143；最后提醒 UI 小修 tsc 与 controller 17/17；真实 Codex/Qwen 已选执行器直接 Agent 与 Chat 子任务 feed/replay/ack/revoke 通过；最终 APK 编译/同开发签名/资源审计通过。API36 模拟器最终 android-runtime-result.json 为 ok:true，直接 Agent 退后台完成、加密凭据、通知可见/实际点击、启动 Activity 后重新登录打开会话、注销清理及服务端撤销通过。失败/Chat父对话/切scope等由后端/controller/native测试覆盖，不扩大为所有设备分支通过。证据目录 evidence/android-notifications-20261001。
- commit: feat(issue-62): add Android background Agent notifications（对应本 issue 的 Git 提交）

同一 issue 内并行互不冲突文件，完成后统一审查与提交。既有 RK3566 板级工程、板用 WSL 和 Codex SDK不在范围。

## 最终交付与后续验收

本 issue 限定范围已完成。最终 APK 为 Android 0.9.2 / versionCode 12 / 开发签名，SHA-256 `bfa3a099c35fa10985871872da6d3ba9c2c89bfd562fd0e646304c4ead522aac`，包含最后 UI/原生补丁并完成独立资源审计。root 统一提交与发布 `v0.9.2` prerelease，并核对 GitHub 与个人服务器同一 APK；保留旧包、私有数据和此前失败诊断。

最终设备实测范围是 API36 模拟器中的直接 Agent 完成通知、实际点击启动 Activity 后重新登录打开任务对话，以及注销后原生清理和服务端撤销。Chat 父对话、失败/切scope/恢复等分支通过后端/controller/native测试；Android13～15、实体手机/厂商省电、长期电池和完整冷启动/断网/切账号设备矩阵尚未验收，不作为本轮通过项。

设备进程被系统回收、force-stop 或重启后不承诺自动保活；恢复界面显示停止时由用户手动重新开启。Android 不内置 Codex CLI/OpenCLI，Windows/Ubuntu 不在本轮重打范围。README 与 release-notes 保持实现能力、测试层级和设备结论分开，不将 controller fixture 或后端 feed 成功替代未经验证的设备分支。
