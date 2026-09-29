# 伙伴语音对话 Issues

- Date: 2026-09-30
- Complexity: L2
- Related design: 2026-09-30-petpal-voice-conversation-design.md
- Current status: issue-38 todo

## issue-37

- ID: issue-37
- 标题: 流式 ASR 与伙伴语音对话闭环
- 范围: ASR 代理、音频捕获/分句/播放状态机、伙伴入口和服务设置
- 依赖: issue-36 done
- 验收标准: 已登录账号可主动语音聊天；字幕增量、停顿发送、分句流式 TTS、口型与打断/停止有效；越权和资源生命周期受控
- 状态: done
- 验证方式: 前后端语音聚焦测试通过（79 + 54 项，含部分重叠回归）；登录回归23项通过；TypeScript与隔离Vite构建通过；Chrome合成音频真实链路、字幕/口型/自动回听/打断/停止、412×960及960×412布局通过。源码归档406文件检查及公共审计9项回归通过。
- commit: 本次提交（feat(issue-37)）

## issue-38

- ID: issue-38
- 标题: 真实语音链路与网页上线验收
- 范围: 真实 ASR/LLM/TTS 音频测试、Chrome UI、备份部署、记录
- 依赖: issue-37
- 验收标准: 保存可复核识别与音频时延证据；网页可用，原生产数据保持，明确真机边界
- 状态: todo
- 验证方式: pending
- commit: pending
