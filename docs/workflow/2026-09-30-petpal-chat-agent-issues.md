# Chat 与后台电脑协作 Issues

- Date: 2026-09-30
- Complexity: L2
- Related design: 2026-09-30-petpal-chat-agent-design.md

## Task Overview

- Goal: Chat/语音通过工具调用将软件操作派发预选电脑的 Agent，后台执行并真实反馈。
- Ordering rule: Complete issues in sequence.
- Current status: issue-43 done。

## Issue List

- [x] issue-43 Chat 调用后台 Agent

## issue-43

- ID: issue-43
- 标题: 为 Chat 和语音接入后台 Agent
- 范围: 模型函数调用、回执幂等/撤权、复用 Agent 队列和权限、响应与状态 UI、语音接线、部署验收。
- 依赖: issue-42
- 验收标准: Chat 模型可直接派发 Agent；普通聊天继续；不隐式换电脑或提升权限；账号隔离、取消、错误和未知状态可靠；412×960 可操作；生产历史配置保持。
- 状态: done
- 验证方式: 两协议工具回归 62 项、回执/API 23 项、语音/preferences 15 项和现有 Agent/账号/执行端组合 101 项通过；TypeScript/Vite 通过；Chrome 412×960 文字与伙伴语音入口通过；公网默认 Halogen Chat→Sol 后台 Agent→父 Chat 结果回传及 ASR/TTS 合成输入探测通过。生产配置/历史保持。实际播放、真实麦克风与新安装包未列为通过项。详见 2026-09-30-petpal-chat-agent-acceptance.md。
- commit: 本 issue 的 feat(issue-43) 提交。
