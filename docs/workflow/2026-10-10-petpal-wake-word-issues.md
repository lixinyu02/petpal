# 账号唤醒词 Issues

- Date: 2026-10-10
- Complexity: L2
- Related design: 2026-10-10-petpal-wake-word-design.md

## Task Overview

- Goal: 用户录入关键词，唤醒后连续对话，空闲回待机。
- Ordering rule: Complete issues in sequence.
- Current status: issue-2 in_progress

## Issue List

- [x] issue-1 账号配置与严格匹配
- [ ] issue-2 连续语音状态机
- [ ] issue-3 设置界面与本机验收

## issue-1

- ID: issue-1
- 标题: 账号唤醒配置和句首匹配
- 范围: 共享纯模块、voice 配置/API类型、配置和账号隔离测试
- 依赖: none
- 验收标准: 旧账号默认关闭；配置有界且原子；只匹配句首，不泄露密钥或越权修改账号
- 状态: done
- 验证方式: 31 项 voice-settings、voice-wake-word、users 测试通过；真实隔离 HTTP 测试验证未登录拒绝、body.userId 无效、按账号保存与重启保持。自审确认不可变、有界、密钥投影保持；共享纯模块放在 server/ 以随现有原生打包规则携带。
- commit: feat(issue-1): add account wake phrases and strict prefix matching

## issue-2

- ID: issue-2
- 标题: 等待唤醒、连续对话、空闲回待机
- 范围: conversation/hook/type、状态机和边界回归测试
- 依赖: issue-1
- 验收标准: 未匹配不创建Chat/Agent/TTS；partial不触发；单词/词+问题/多轮/超时/插话/报告/取消均正确；静音无ASR资源占用
- 状态: in_progress
- 验证方式: pending
- commit: pending

## issue-3

- ID: issue-3
- 标题: 关键词录入与待机UI、本机服务验收
- 范围: VoiceSettings、CompanionWorld、CSS、Chrome、构建和本机后端
- 依赖: issue-2
- 验收标准: 登录用户可保存多词与超时；首页明确等待/手动唤醒；窄屏不溢出；下载包保持；真实上游与模拟边界明确
- 状态: todo
- 验证方式: pending
- commit: pending
