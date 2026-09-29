# 伙伴语音对话 Issues

- Date: 2026-09-30
- Complexity: L2
- Related design: 2026-09-30-petpal-voice-conversation-design.md
- Current status: issue-37 / issue-38 done

## issue-37

- ID: issue-37
- 标题: 流式 ASR 与伙伴语音对话闭环
- 范围: ASR 代理、音频捕获/分句/播放状态机、伙伴入口和服务设置
- 依赖: issue-36 done
- 验收标准: 已登录账号可主动语音聊天；字幕增量、停顿发送、分句流式 TTS、口型与打断/停止有效；越权和资源生命周期受控
- 状态: done
- 验证方式: 前后端语音聚焦测试通过（79 + 54 项，含部分重叠回归）；登录回归23项通过；TypeScript与隔离Vite构建通过；Chrome合成音频真实链路、字幕/口型/自动回听/打断/停止、412×960及960×412布局通过。源码归档406文件检查及公共审计9项回归通过。
- commit: 661638f

## issue-38

- ID: issue-38
- 标题: 公网语音验收与消息展示完善
- 范围: 真实 ASR/LLM/TTS 音频测试、Chrome UI、公网高延迟音频合包修复、用户追加的 Markdown 显示与朗读适配、备份部署、记录
- 依赖: issue-37
- 验收标准: 保存可复核识别与音频时延证据；网页可用，原生产数据保持，明确真机边界
- 状态: done
- 验证方式: 真实ASR/LLM/CosyVoice及公网Chrome完整闭环通过；高RTT合包与Markdown前端回归91项、TypeScript、隔离Vite构建通过。Chat/Agent/语音字幕Markdown、实际纯文本TTS请求与412×960无溢出通过。公网静态资源哈希一致，最终数据保持审计通过，原16会话完整、新增2条合成验收会话；详情见同日前缀acceptance.md。
- commit: 本 issue 提交（fix(issue-38): improve public voice streaming and render markdown replies）
