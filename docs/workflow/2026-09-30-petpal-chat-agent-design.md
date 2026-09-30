# Chat 与后台电脑协作

- Date: 2026-09-30
- Complexity: L2
- Status: updated

## Background

用户希望保留文字和语音 Chat 工作区，由聊天在预选电脑上自主完成操作，例如用 QQ 音乐放歌。用户明确要求直接由 Chat 调 Agent，因此复用现有 Codex 执行、权限、审批和队列，不另造专用音乐协议。

## Goal

在 Chat 和语音模式启用 Chat + Agent，预选执行电脑、Agent 模型和权限。Chat 模型通过 run_agent 工具派发操作任务，独立后台 Codex 会话执行，前台可以继续聊天，结果真实反馈。音乐和其它软件操作由既有 Agent 工具承担。

## Non-goals

本轮不重打四端安装包、不发 Release、不变更 RK3566 固件。不能绕过账号的 Agent 权限，不能让模型选择其它用户、执行电脑、模型或提升权限。不能把派发成功表述为操作已经完成。

## Solution

- 保留 Chat / Agent 主切换；Chat 的折叠协作行包含开关、预选电脑、Agent 模型和现有权限控件。自动开关每次登录默认关闭。
- messages 请求增加可选 assistant={enabled,hostId,providerId,permissions} 和 UUID submissionId；服务端验证并冻结预设。模型只能传 task 文本，一轮最多一个派发。
- Responses 和 Chat Completions 增加严格 run_agent 函数工具；完整响应结束后验证调用参数再执行，返回后台提交回执，工具结果续接一轮普通文本流。关闭开关不向模型提供工具，旧普通 Chat 不受影响。
- Halogen 的旧 Responses 中转会丢弃 function_call，且没有 Chat Completions 路由。实际验收改用其已公布、验证过普通文本和工具调用的原生 Responses API，保留连接 ID、模型、账号默认与授权；无需源码协议特例或失败后重试。
- 前台请求开始前持久化提交回执；相同 UUID 重试不会再次调用模型或派发任务。一个回执关联一个独立 codex 会话，复用 agentTasks.submit 的排队、审批、撤权、取消和远程 unknown 状态。
- 后台任务不占父 Chat 的 active map；前台只等待排队回执、不等待 Agent 完成。UI 轮询父 Chat 更新任务；后台最终结果追加一次可朗读的普通消息。
- 模型不能选主机或提升权限；离线不自动回退中央电脑。普通用户只能选择已分配且符合当前 Responses 配置的 Agent 模型。
- 删除父 Chat 前停止和清除子任务队列；注销/撤权和服务退出复用既有任务生命周期。重启不自动重放决策或后台执行。

## Impact

server/app、store、providers、新协作回执模块、App/CompanionWorld/voice hook、消息 SSE 类型。桌面协议不变，现有执行端可使用该联动。

## Risks

工具调用依赖当前 Chat 模型支持；异常调用、未完成响应或多调用不会执行。Agent 能力取决于目标电脑安装的软件及已有工具，不能保证歌曲搜索或播放成功。任务派发与执行完成明确区分。语音后台结果不能在监听或前台 TTS 中途抢麦克风；当轮朗读派发回执，后续显示真实结果并可手动朗读。

## Verification Plan

两种协议工具流、幂等/重启、跨账号/撤权、不回退、错误/未知/取消、前后台 Chat 并发及语音每轮快照回归；TypeScript 和构建；Chrome 文字/语音入口及 412×960 布局；实际 Chat→Agent 无副作用任务与 ASR/TTS 探测。部署前确认生产无活动任务，保持账号、模型、语音配置与历史，公开源码审计后提交推送。

验收结果见 [Chat 与后台 Agent 验收](2026-09-30-petpal-chat-agent-acceptance.md)。实际播放和真实麦克风输入未作为本轮通过项。

## Visual thesis

沿用奶油白和浅橘，让聊天记录和伙伴保持主视觉，后台协作收进一行折叠工具。

## Content plan

主工作区维持聊天；工具行负责启用和电脑选择；任务状态只显示执行电脑、动作和结果；详情按需展开。

## Interaction thesis

折叠设置平滑展开、任务状态轻量过渡、保持现有伙伴呼吸和微表情，避免增加常驻动作按钮。
