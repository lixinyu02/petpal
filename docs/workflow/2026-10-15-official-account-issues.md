# 桌面官方账号 Issues

- Date: 2026-10-15
- Complexity: L2
- Related design: 2026-10-15-official-account-design.md

## Task Overview

- Goal: 桌面官方 ChatGPT 登录、个人官方模型及 Chat/Agent 接入。
- Ordering rule: Complete issues in sequence.
- Current status: implementation and native entry verified; real user consent/inference pending

## Issue List

- [x] issue-1 官方授权与私有运行时
- [x] issue-2 个人模型、Chat/Agent 与界面接入
- [x] issue-3 原生验收与使用说明

## issue-1

- ID: issue-1
- 标题: 官方授权与私有运行时
- 范围: OAuth、账号存储、Responses 网关、可信原生 IPC
- 依赖: none
- 验收标准: 正式公开协议、每个小伴用户隔离、取消/刷新/退出有效、无 token 暴露和全局 Codex 修改
- 状态: done
- 验证方式: 153/153 targeted tests passed (auth, gateway, IPC, preferences, update and Linux package source checks); reviewed callback races, private storage and packaging. Real official consent/inference not performed.
- commit: feat(issue-1): add private desktop ChatGPT authorization runtime

## issue-2

- ID: issue-2
- 标题: 个人模型、Chat/Agent 与界面接入
- 范围: scoped Provider、按任务 Agent 配置、模型选择和登录设置，以及用户追加的官方用量状态页面
- 依赖: issue-1
- 验收标准: 两模式采用官方当前目录；普通用户可管理本人官方账号；不共享他人凭据或回退第三方；原功能保留
- 状态: done
- 验证方式: 562/562 targeted auth/gateway/IPC/API/Chat/Agent/relay/review/automation/UI/default/session/package regressions passed; production build passed. Real bundled Codex 0.143 executed a local synthetic official-protocol tool loop. Official quota has no public balance API: page shows observed request state/tokens and links official Usage; live consent/inference still pending.
- commit: feat(issue-2): connect personal official models and usage to Chat and Agent

## issue-3

- ID: issue-3
- 标题: 原生验收与使用说明
- 范围: Windows/Ubuntu 原生、发布清单覆盖与使用/边界说明
- 依赖: issue-2
- 验收标准: 原生入口可使用，官方真实登录和推理按实际完成情况记录，不误报已验
- 状态: done
- 验证方式: Windows x64 and Ubuntu 24.04 WSLg x64 Electron 39.8.10 source clients passed real IPC/login-gate/settings smoke; native screenshots inspected. Linux source/dependency hashes matched; independent private-store probe 0700/0600. Related 145 tests and later 60 UI/App tests passed; build passed. Windows live consent window expired without authorization, so real official models/inference/allowance are explicitly unverified. See acceptance.md.
- commit: fix(issue-3): guard usage retries and verify native account entry
