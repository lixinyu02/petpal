# OpenCLI 通用网站 Issues

- Date: 2026-10-08
- Complexity: L1
- Related design: 2026-10-08-petpal-opencli-universal-design.md

## Task Overview

- Goal: 默认取消网站白名单，检查视频中的搜TXT授权/下载全流程。
- Ordering rule: Complete issues in sequence.
- Current status: issue-2 in_progress

## Issue List

- [x] issue-1 通用网站入口与一致权限
- [ ] issue-2 实际桥接和视频流程验收

## issue-1

- ID: issue-1
- 标题: 通用网站入口与一致权限
- 范围: runner、工具schema/版本/模型指令、设置UI、文档与必要回归。
- 依赖: none
- 验收标准: HTTP(S)任意域名/端口和跨站允许；非法scheme/URL凭据拒绝；租约/账号/关闭值/审批不变；旧快照跨页不能使用；实际能力明确。
- 状态: done
- 验证方式: 10文件145项通过；新增同URL重载与快照读取竞态、审批脱敏回归通过；TypeScript与独立生产构建通过。自审修正同地址重载及残留文档。浏览器设置页与真实桥接留在issue-2验收。
- commit: 本issue实现提交

## issue-2

- ID: issue-2
- 标题: 实际桥接和视频流程验收
- 范围: 内置OpenCLI实际连接、Chrome验证、本机运行服务与步骤证据。
- 依赖: issue-1
- 验收标准: 逐步明确视频184.82秒中的登录、免费授权、夸克ZIP下载、解压/取码、提交、搜索和TXT下载；所有无法完成的步骤保留具体限制。Chrome插件与内置工具证据分开。
- 状态: in_progress
- 验证方式: pending
- commit: pending
