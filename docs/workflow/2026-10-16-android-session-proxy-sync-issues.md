# Android 续登与代理同步 Issues

- Date: 2026-10-16
- Complexity: L2
- Related design: 2026-10-16-android-session-proxy-sync-design.md

## Task Overview

- Goal: Android 关闭后保留有效登录，服务器分发代理配置和默认策略，手机保存并恢复选择。
- Ordering rule: Issues顺序推进；同一issue内并行独立实现组件。
- Current status: issue-1 至 issue-3 done，issue-4 in_progress（用户明确正式发布）。

## Issue List

- [x] issue-1 加密续登与按账号分发代理配置、原生同步及设置入口
- [x] issue-2 组合验收、开发APK与服务接口交付
- [x] issue-3 正式包与分平台最新下载目录准备
- [ ] issue-4 GitHub、本地正式发布和签名升级清单

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
- commit: e9d3802

## issue-3

- ID: issue-3
- 标题: Android/Web 0.9.13 正式包准备
- 范围: Android 正式构建、Web 归档、混合平台最新下载支持与最终源代码冻结。
- 依赖: issue-2
- 验收标准: 0.9.13/code25同签名可升级，实际Android16登录不崩溃，APK/Web归档全量验证；分平台目录可保留Windows/Ubuntu各自最新0.9.12而不复活旧安卓。
- 状态: done
- 验证方式: 正式0.9.13/code25 APK和Web归档完整读取/CRC/许可/私有数据扫描，APK与0.9.12签名连续通过；正式包覆盖dev.2成功，API36实际退出/清空/登录/重开/代理恢复五阶段通过；分平台下载服务、静态路由、真实React下载视图46项通过。
- commit: 本 issue 的 build(issue-3) 提交

## issue-4

- ID: issue-4
- 标题: 正式发布与双源更新
- 范围: 双源序列15签名、GitHub正式v0.9.13、本地官方客户端下载、Web/后端13上线及生产保留验收。
- 依赖: issue-3
- 验收标准: Android/Web13正式包与最终审计SHA一致；Win/Ubuntu12保留原URL和SHA；正式下载中心和应用内升级可见；匿名不能调用代理配置API；用户数据保持。
- 状态: in_progress
- 验证方式: GitHub和服务器完整字节回读、清单签名及序列、实际下载UI、服务健康与业务数据保留。
- commit: pending
