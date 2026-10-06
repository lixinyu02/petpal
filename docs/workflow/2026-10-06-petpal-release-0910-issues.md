# PetPal 0.9.10 正式客户端重打 Issues

- Date: 2026-10-06
- Complexity: L2
- Related design: 2026-10-06-petpal-release-0910-design.md

## Task Overview

- Goal: 发布包含当前功能的六个正式分发文件与两源升级清单。
- Ordering rule: 按顺序完成 issue；同一 issue 内平台构建可并行。
- Current status: issue-1 done；issue-2 done。

## Issue List

- [x] issue-1 版本与源码冻结合同
- [x] issue-2 六包验收、正式发布及生产下载更新

## issue-1

- ID: issue-1
- 标题: 版本与源码冻结合同
- 范围: 0.9.10／Android20，新增模块包装和审计要求，隔离构建约定。
- 依赖: none
- 验收标准: 版本一致、模块不遗漏，相关回归及 tsc 通过，自审后冻结来源提交。
- 状态: done
- 验证方式: 142/142 包装／升级／下载回归、7/7 新缺失及摘要损坏故障验证，独立合同审查 67/67；tsc 和 diff --check 通过。JDK21、Gradle8.11.1、原APK signer与两架构缓存完整性已核实。
- commit: `d2ded9c66aad81310d8d40baa74761a3a8242242`。

## issue-2

- ID: issue-2
- 标题: 六包验收、正式发布及生产下载更新
- 范围: Windows两包、Ubuntu两包、Android、Web；完整归档和原生检查；GitHub stable/latest、服务器源、sequence12签名、旧下载可逆归档、网页与后端版本验收。
- 依赖: issue-1
- 验收标准: 六包来源一致、大小和hash一致；Windows实际启动通过；APK签名连续；两源五目标验签和升级；正式下载只展示当前版本；生产业务数据保留；设备验收边界明确。
- 状态: done
- 验证方式: 六包完整归档、来源、Core／许可及已知私有值检查通过；Windows EXE 完整原生 smoke、EXE／ZIP 两次真实启动和中央服务器入口通过，ZIP 完整手势 smoke 仍有失败记录。APK 签名连续、code20，Ubuntu 两架构仅完成全包静态审计，未做 Android／Ubuntu 目标设备运行验收。GitHub Actions run37447926269 attempt1 完整读取六包与四 metadata，原三项资产 ID 保持；Release404334344 为 stable/latest，tag 固定来源。服务器六包及五更新包完整 HTTPS 字节回读通过，sequence12 清单原子上线、旧清单保留；两源实际更新服务各五目标发现0.9.10，当前Web不升级。精确13旧公共文件可恢复归档、15新文件保留；首次只读归档verify失败原因unknown，原日志保留，随后诊断验证28条HEAD通过，未再次apply。Chrome下载页仅显示0.9.10并服务器优先，412×960无横向溢出；最终本机／公网health为200／0.9.10，业务投影保留。详见 `docs/acceptance-0.9.10.md`，不得合并不同平台和回读地点的验收结论。
- commit: 本 issue 的发布验收与使用文档提交，见 Git 中 `docs(issue-2): finalize PetPal 0.9.10 release`。
