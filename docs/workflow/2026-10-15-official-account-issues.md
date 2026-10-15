# 桌面官方账号 Issues

- Date: 2026-10-15
- Complexity: L2
- Related design: 2026-10-15-official-account-design.md

## Task Overview

- Goal: 桌面官方 ChatGPT 登录、个人官方模型及 Chat/Agent 接入。
- Ordering rule: Complete issues in sequence.
- Current status: issue-2 pending

## Issue List

- [x] issue-1 官方授权与私有运行时
- [ ] issue-2 个人模型、Chat/Agent 与界面接入
- [ ] issue-3 原生验收与使用说明

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
- 范围: scoped Provider、按任务 Agent 配置、模型选择和登录设置
- 依赖: issue-1
- 验收标准: 两模式采用官方当前目录；普通用户可管理本人官方账号；不共享他人凭据或回退第三方；原功能保留
- 状态: todo
- 验证方式: API/relay/UI 回归与 build
- commit: pending

## issue-3

- ID: issue-3
- 标题: 原生验收与使用说明
- 范围: Windows/Ubuntu 原生、发布清单覆盖与使用/边界说明
- 依赖: issue-2
- 验收标准: 原生入口可使用，官方真实登录和推理按实际完成情况记录，不误报已验
- 状态: todo
- 验证方式: 原生截图/收据、官方登录页面及用户实际授权后的模型请求
- commit: pending
