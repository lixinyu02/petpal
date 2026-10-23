# Android 权限与系统兼容 Issues

- Date: 2026-10-23
- Complexity: L2
- Related design: 2026-10-23-android-permissions-design.md

## Task Overview

- Goal: 完善按需授权、状态诊断、恢复入口与生命周期兼容。
- Ordering rule: Complete issues in sequence; native/UI are coupled subtasks within issue-1.
- Current status: issue-1 done; issue-2 in_progress。

## Issue List

- [x] issue-1 原生权限恢复与统一设置
- [ ] issue-2 Android 运行态验收与 QA 安装包

## issue-1

- ID: issue-1
- 标题: 原生权限恢复与统一设置
- 范围: 权限诊断/固定设置桥、媒体回调互锁、悬浮窗前台启动、权限面板及相关回归。
- 依赖: none
- 验收标准: 登录后按需授权；权限拒绝可恢复；无任意系统路由；媒体/附件回调不互相覆盖；账号切换无迟到状态；当前厂商引导保持。
- 状态: done
- 验证方式: Node 71/71；JVM 117/117；TypeScript/Vite 和 :app:assembleDebugAndroidTest 成功；Chrome 实际组件 320px 深色、412px 浅色无横向溢出，按钮44px；自审完成。运行态授权流程由 issue-2 验收。
- commit: 本 issue 的 fix(issue-1) 提交（提交后由 issue-2 记录 SHA）。

## issue-2

- ID: issue-2
- 标题: Android 运行态验收与 QA 安装包
- 范围: 修正 Android 构建输出路径参数传递、独立 APK、隔离模拟器权限和设置流程、Manifest 检查与验收记录。
- 依赖: issue-1
- 验收标准: 真实原生桥/设置/拒绝恢复有运行证据；不改已有 AVD 和正式更新源；标明真机边界。
- 状态: in_progress
- 验证方式: Gradle APK/instrumentation、ADB 模拟器和产物 SHA256。
- commit: pending
