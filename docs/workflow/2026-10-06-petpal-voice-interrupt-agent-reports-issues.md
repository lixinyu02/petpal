# 语音打断与后台任务回报 Issues

- Date: 2026-10-06
- Complexity: L1
- Related design: 2026-10-06-petpal-voice-interrupt-agent-reports-design.md
- Current status: issue-1 done

## issue-1

- ID: issue-1
- 标题: 自动语音插话、Agent主动进度与完成回报
- 范围: 语音状态机与输入门限、后台状态同步与模型上下文、文字/语音回报呈现、相关回归、网页后端上线
- 依赖: none
- 验收标准: 回答中插话取消旧流与旧语音且保留新输入；静音/短噪声不误触发；旧回调不覆盖新输入；任务完成不依赖前台轮询且重复刷新不重复回报；长期任务真实汇报；Chat能读取最新状态；语音新回报等待空闲且不重复；登录隔离保持
- 状态: done
- 验证方式: 375/375定向回归；tsc；隔离Vite构建；真实CosyVoice/ASR与Chrome15.267秒自动插话全链路（526ms触发、停止回执、二轮回复5）；隔离HTTP30秒主动进度/完成/重载；生产Chat→Agent无前台GET的回报与上下文验收（计时命令被策略阻止，操作本身不算通过）；公网HTTPS与412×960Chrome验收；15份下载文件/4份更新元数据保持。证据 evidence/voice-agent-loop-20261006。
- commit: feat(issue-1): support voice barge-in and proactive agent reports
