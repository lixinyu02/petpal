# Android 长期登录 Issues

- Date: 2026-10-23
- Complexity: L2
- Related design: 2026-10-23-android-long-login-design.md

## Task Overview

- Goal: 已登录安卓尽量长期保持，并在断网或临时存储失败后恢复。
- Ordering rule: Complete issues in sequence.
- Current status: 三个issue完成，详见validation。

## Issue List

- [x] issue-1 长会话与可靠失效判断
- [x] issue-2 保存登录的重连体验
- [x] issue-3 部署、Android运行验收与QA包

## issue-1

- ID: issue-1
- 标题: 长会话与可靠失效判断
- 范围: 后端90/365天策略、每日续期、撤销/持久化边界、长任务计时器；Android API记住设备/401确认/原生恢复重试。
- 依赖: none
- 验收标准: 普通Web仍7天；Android有效会话可续期但过期/撤销不可复活；不存密码；业务401不误清；长任务不溢出或按旧截止误停。
- 状态: done
- 验证方式: 249/249 Node通过；TypeScript与diff检查通过；真实JsonStore队列/原子失败/重启、HTTP长期策略、Agent数值期限集成和fake-clock分段计时器已覆盖；自审通过。
- commit: a4e21e0

## issue-2

- ID: issue-2
- 标题: 保存登录的重连体验
- 范围: LoginGate恢复视图、前台/联网合并重试、明确切换账号与原生读取重试入口。
- 依赖: issue-1
- 验收标准: 断网不显示已退出；未验证不显示私有内容；事件去重、账号切换/卸载隔离、无后台轮询。
- 状态: done
- 验证方式: 102/102相关Node通过，含26项实际组件生命周期；TypeScript通过，自审修正本机桥接迟到返回。Chrome与Android运行验收随issue-3冻结包执行。
- commit: 65e60b3

## issue-3

- ID: issue-3
- 标题: 部署、Android运行验收与QA包
- 范围: 隔离构建、冷启动/进程重启、APK审计、网页与后端部署、状态保护和验收记录。
- 依赖: issue-2
- 验收标准: 测试与实际恢复有证据；业务数据、正式包、更新源和签名保持；提供独立测试包。
- 状态: done
- 验证方式: 最终Node276/276、JVM117/117；API33/36各3原生+5真实App阶段；APK313资源/41源/签名/私密/zipalign；Chrome与公网保全验收通过，详见validation。
- commit: 本issue提交（见Git历史）
