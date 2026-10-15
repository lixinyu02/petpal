# 桌面官方账号 Issues

- Date: 2026-10-15
- Complexity: L2
- Related design: 2026-10-15-official-account-design.md

## Task Overview

- Goal: 桌面官方 ChatGPT 登录、个人官方模型及 Chat/Agent 接入。
- Ordering rule: Complete issues in sequence.
- Current status: complete (official authorization, GPT 6 Luna Chat/Agent and observed usage UI verified)

## Issue List

- [x] issue-1 官方授权与私有运行时
- [x] issue-2 个人模型、Chat/Agent 与界面接入
- [x] issue-3 原生验收与使用说明
- [x] issue-4 保留授权的真实推理与用量续验

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
- 验证方式: Windows x64 and Ubuntu 24.04 WSLg x64 Electron 39.8.10 source clients passed real IPC/login-gate/settings smoke; native screenshots inspected. Linux source/dependency hashes matched; independent private-store probe 0700/0600. Related 145 tests and later 60 UI/App tests passed; build passed. At issue-3 acceptance the Windows live consent window expired without authorization, so real official models/inference/allowance were unverified; later Windows success supersedes that result in issue-4. See acceptance.md.
- commit: fix(issue-3): guard usage retries and verify native account entry

## issue-4

- ID: issue-4
- 标题: 保留授权的真实推理与用量续验
- 范围: 用户回复已授权后的非破坏性原生续验；保留已有官方注册，指定 GPT 6 Luna 验证 Chat、Agent 和实际用量 UI；延长原生授权等待窗口；修复实测发现的缺失 Content-Type SSE 和空 terminal output 汇总兼容
- 依赖: issue-3
- 验收标准: 不调用退出/取消或重复 OAuth 来检测已有授权；真实目录/推理/用量按结果记录；无资格/限额不自动重试；不披露凭据
- 状态: done
- 验证方式: 保留同一私有 profile 的 Windows 原生源码客户端真实授权成功，官方返回 7 个模型；按用户指定精确选择 gpt-6-luna，Chat HTTP 200 完成、只读无工具 Agent 短任务完成且实际模型匹配。最终连接观察到 2 次完成请求、输入 10993 / 输出 10 / 合计 11003 Token；原生页面手动刷新后状态和计数匹配，已目视检查脱敏截图。修复缺失 MIME SSE 及已完整 item.done 但最终 output=[] 的协议兼容，保留截断/身份/EOF 检查；启动 VM fixture 补齐可选官方模块。最终组合回归 171 项：170 passed，1 项需显式启用的 90 秒 guardian 超时测试 skipped；production build passed。真实 Windows 证据 windows-resume-bc96b300c5b54d33954ef407138161c2；Ubuntu 的真实 OAuth/推理、复杂 Agent 工具任务和新版安装包仍不在本次实测范围内。
- commit: fix(issue-4): handle official stream variants and verify Luna inference
