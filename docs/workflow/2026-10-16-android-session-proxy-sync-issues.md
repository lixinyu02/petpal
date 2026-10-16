# Android 续登与代理同步 Issues

- Date: 2026-10-16
- Complexity: L2
- Related design: 2026-10-16-android-session-proxy-sync-design.md

## Task Overview

- Goal: Android 关闭后保留有效登录，服务器分发代理配置和默认策略，手机保存并恢复选择。
- Ordering rule: Issues顺序推进；同一issue内并行独立实现组件。
- Current status: issue-1 done，issue-2 in_progress。

## Issue List

- [x] issue-1 加密续登与按账号分发代理配置、原生同步及设置入口
- [ ] issue-2 组合验收、开发APK与服务接口交付

## issue-1

- ID: issue-1
- 标题: Android 续登与服务器代理同步
- 范围: 安全会话持久化、服务器配置权限/API、原生导入与策略保存、管理/手机UI及定向测试。
- 依赖: none
- 验收标准: 重启恢复仍有效会话，退出/401不复活，网络故障不清空；配置按账号分发，固定认证来源，无token/YAML泄漏，选择与模式恢复，坏更新保留原配置。
- 状态: done
- 验证方式: 联合 Node 131/131、Java 82/82、真实 Mihomo instrumentation 4/4、TS 与双隔离 Vite 构建通过；自审修复双登录持久化竞态、旧 UI 事件跨账号、异步文件覆盖、Android 目录别名误判、Selector/provider 未就绪和动态默认节点兼容问题。
- commit: 本 issue 的 fix(issue-1) 提交

## issue-2

- ID: issue-2
- 标题: 开发候选与实际验收
- 范围: 模拟器force-stop续登/退出、真实内核策略恢复与服务器文件下载、APK构建审核、必要后端部署及文档。
- 依赖: issue-1
- 验收标准: 可安装开发APK、结果与真机边界准确、后台接口可用且不改变正式客户端清单；生产部署保留用户数据。
- 状态: in_progress
- 验证方式: 实际模拟器/本地服务、全包审核、部署健康及权限验收。
- commit: pending
