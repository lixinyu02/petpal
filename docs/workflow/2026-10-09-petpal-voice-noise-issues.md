# 语音抗干扰 Issues

- Date: 2026-10-09
- Complexity: L1
- Related design: 2026-10-09-petpal-voice-noise-design.md

## Task Overview

- Goal: 减少 ASR 误触发，保留语音打断和正常识别。
- Ordering rule: Complete issues in sequence.
- Current status: all done; 本机网页已更新

## Issue List

- [x] issue-1 调整采集、起音与底噪门控
- [x] issue-2 灵敏度设置与本机上线验收

## issue-1

- ID: issue-1
- 标题: 调整采集、起音与底噪门控
- 范围: audio、capture、conversation 与语音链回归。
- 依赖: none
- 验收标准: 持续低噪/短脉冲不创建 ASR；起音有确认/有界保留；环境门槛跨轮次保持；回声不触发，正常说话可打断。
- 状态: done
- 验证方式: 五个前端语音链文件39项通过；TypeScript通过；自审增加快速连续敲击的候选时长上限，候选音频有界，正常语音确认后保留全部词头。确认底噪不被讲话/播放训练、跨轮次保持、续音较低门槛、900ms结束及一次插话取消保持；diff检查通过。真实房间人声尚未验收。
- commit: de75c89

## issue-2

- ID: issue-2
- 标题: 灵敏度设置与本机上线验收
- 范围: 当前账号本机偏好、ASR 设置选择、hook 接线、生产构建与 Chrome。
- 依赖: issue-1
- 验收标准: 默认抗干扰，账号隔离且可选均衡/灵敏；设置变更停止旧收音；网页展示正常、发布下载保持。
- 状态: done
- 验证方式: 14文件135项回归、TypeScript、差异检查通过；含真实hook读取/设置变更取消、账户隔离/存储失败回退、动态底噪正反馈与音节间隔修复回归。保留下载的生产构建通过，15下载元数据保持；Chrome验证默认/保存/刷新，实际ASR连接测试通过，DOM实际412×960无横向溢出。详见acceptance.md；现场人声和安装包未验收/重打。
- commit: 本issue提交
