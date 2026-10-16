# Android 续登与代理同步 Issues

- Date: 2026-10-16
- Complexity: L2
- Related design: 2026-10-16-android-session-proxy-sync-design.md

## Task Overview

- Goal: Android 关闭后保留有效登录，服务器分发代理配置和默认策略，手机保存并恢复选择。
- Ordering rule: Issues顺序推进；同一issue内并行独立实现组件。
- Current status: issue-1、issue-2 done，issue-3 in_progress（用户新增正式发布要求）。

## Issue List

- [x] issue-1 加密续登与按账号分发代理配置、原生同步及设置入口
- [x] issue-2 组合验收、开发APK与服务接口交付
- [ ] issue-3 安卓修复版正式发布与下载／升级清单

## issue-1

- ID: issue-1
- 标题: Android 续登与服务器代理同步
- 范围: 安全会话持久化、服务器配置权限/API、原生导入与策略保存、管理/手机UI及定向测试。
- 依赖: none
- 验收标准: 重启恢复仍有效会话，退出/401不复活，网络故障不清空；配置按账号分发，固定认证来源，无token/YAML泄漏，选择与模式恢复，坏更新保留原配置。
- 状态: done
- 验证方式: 联合 Node 131/131、Java 82/82、真实 Mihomo instrumentation 4/4、TS 与双隔离 Vite 构建通过；自审修复双登录持久化竞态、旧 UI 事件跨账号、异步文件覆盖、Android 目录别名误判、Selector/provider 未就绪和动态默认节点兼容问题。
- commit: ca1c9f8

## issue-2

- ID: issue-2
- 标题: 开发候选与实际验收
- 范围: 模拟器force-stop续登/退出、真实内核策略恢复与服务器文件下载、APK构建审核、必要后端部署及文档。
- 依赖: issue-1
- 验收标准: 可安装开发APK、结果与真机边界准确、后台接口可用且不改变正式客户端清单；生产部署保留用户数据。
- 状态: done
- 验证方式: 见 acceptance.md；API36 实际账号表单/强关/离线/退出、真实后端→Android UI→Mihomo→策略恢复通过，APK/公网上完整字节和签名审计通过。线上 Web/后端健康、业务数据和现有正式包/升级清单保持。实测修复原生桥线程崩溃与独立回环服务兼容，未冒充小米真机验收。
- commit: 本 issue 的 fix(issue-2) 提交

## issue-3

- ID: issue-3
- 标题: 安卓 0.9.13 正式修复版
- 范围: 安卓正式构建、混合平台最新下载支持、GitHub 正式 Release、本地正式下载与双源签名更新清单。
- 依赖: issue-2
- 验收标准: 0.9.13/code25同签名可升级，实际Android16登录不崩溃，正式完整下载SHA一致；安卓旧包不再作为最新版，Windows/Ubuntu仍可下载各自最新0.9.12；双源升级签名/序列均正确。
- 状态: in_progress
- 验证方式: 最终APK/模拟器重验、平台选择回归、GitHub和本地全量下载/签名清单校验；生产数据保护。
- commit: pending
