# 小伴上游语音更新 Issues

- Date: 2026-09-30
- Complexity: L2
- Related design: 2026-09-30-petpal-upstream-voice-design.md

## Task Overview

- Goal: 适配 ASR / CosyVoice3 情绪控制并完成真实语音验收。
- Ordering rule: Complete issues in sequence.
- Current status: issue-55 done，issue-56 todo。

## Issue List

- [x] issue-55 后台协议和账号情绪配置
- [ ] issue-56 播放表情联动、设置与实际上线验收

## issue-55

- ID: issue-55
- 标题: 后台协议和账号情绪配置
- 范围: ASR兼容、TTS能力探测/两条合成路径/情绪回执、账号配置、有效回归。
- 依赖: none
- 验收标准: 新旧上游安全兼容；忙碌/空错误正确；自动和显式情绪不混入正文；鉴权、取消、限流不回退。
- 状态: done
- 验证方式: 后台108/108通过；ASR真实4.56秒样例最终192ms完成；产品API中性/开心/自动/原声/1.2倍速WAV/取消及再合成通过，详见acceptance。自审鉴权、严格旧客户端协商、超时/取消、正文与元信息隔离及公开文档同步通过。
- commit: feat(issue-55): adapt ASR and CosyVoice3 emotion protocols

## issue-56

- ID: issue-56
- 标题: 播放表情联动、设置与实际上线验收
- 范围: 共同播放状态、人物、紧凑语音设置、回归、Chrome、独立构建、受控网页/后台部署。
- 依赖: issue-55
- 验收标准: 同一份合成语气驱动实际播放表情；停止/缓冲/账号切换无残留；生产下载保留，公网验收清晰区分听感/真机边界。
- 状态: todo
- 验证方式: 前端契约测试、完整回归、Chrome真实播放、ASR→Chat→TTS串行闭环、公网hash。
- commit: pending
