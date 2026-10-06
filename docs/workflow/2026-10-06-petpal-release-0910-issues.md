# PetPal 0.9.10 正式客户端重打 Issues

- Date: 2026-10-06
- Complexity: L2
- Related design: 2026-10-06-petpal-release-0910-design.md

## Task Overview

- Goal: 发布包含当前功能的六个正式分发文件与两源升级清单。
- Ordering rule: 按顺序完成 issue；同一 issue 内平台构建可并行。
- Current status: issue-1 done；issue-2 in_progress。

## Issue List

- [x] issue-1 版本与源码冻结合同
- [ ] issue-2 六包验收、正式发布及生产下载更新

## issue-1

- ID: issue-1
- 标题: 版本与源码冻结合同
- 范围: 0.9.10／Android20，新增模块包装和审计要求，隔离构建约定。
- 依赖: none
- 验收标准: 版本一致、模块不遗漏，相关回归及 tsc 通过，自审后冻结来源提交。
- 状态: done
- 验证方式: 142/142 包装／升级／下载回归、7/7 新缺失及摘要损坏故障验证，独立合同审查 67/67；tsc 和 diff --check 通过。JDK21、Gradle8.11.1、原APK signer与两架构缓存完整性已核实。
- commit: 本 issue 的源码冻结提交（提交后在发布验收文档记录完整SHA）。

## issue-2

- ID: issue-2
- 标题: 六包验收、正式发布及生产下载更新
- 范围: Windows两包、Ubuntu两包、Android、Web；完整归档和原生检查；GitHub stable/latest、服务器源、sequence12签名、旧下载可逆归档、网页与后端版本验收。
- 依赖: issue-1
- 验收标准: 六包来源一致、大小和hash一致；Windows实际启动通过；APK签名连续；两源五目标验签和升级；正式下载只展示当前版本；生产业务数据保留；设备验收边界明确。
- 状态: in_progress
- 验证方式: 平台完整包审计及 Windows 原生 smoke；公网字节回读；Chrome 登录下载和412×960检查；后端健康与业务字段前后核对。
- commit: pending
