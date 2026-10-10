# 小伴 UI 流畅性优化 Issues

- Date: 2026-10-10
- Complexity: L1
- Related design: 2026-10-10-petpal-ui-fluidity-design.md

## Task Overview

- Goal: 减少人物 DOM 重复工作及长回复解析，保持语音和交互可靠。
- Ordering rule: Complete issues in sequence.
- Current status: 全部完成；验收见 2026-10-10-petpal-ui-fluidity-validation.md。

## Issue List

- [x] issue-1 人物悬停联合采样与稳定反馈写入
- [x] issue-2 自适应流式展示、语音字幕与页面验收

## issue-1

- ID: issue-1
- 标题: 人物悬停联合采样与稳定反馈写入
- 范围: interaction、gesture-feedback、CubismScene 与相关回归。
- 依赖: none
- 验收标准: 300 次静止刷新重复反馈/cursor 写入归零，联合命中只读一次 canvas rect；移动/滚动/隐藏和长按/区域变化仍重新验证。
- 状态: done
- 验证方式: 56 项手势/反馈/交互层回归通过，TypeScript 通过。真实模块和所选 Cubism onFeedback 注入静态几何计数：300 次 refresh 坐标读取 900→600、cursor 300→0、dataset 1500→0、style 300→0；不等同于浏览器耗时或 FPS。补充 CSS transform 序列化、当前几何变化、延迟验证回归。自审已核行为一致、取消、旧接口、精确改动及文档。
- commit: 031cde5

## issue-2

- ID: issue-2
- 标题: 自适应流式展示、语音字幕与页面验收
- 范围: chat-display、voice/conversation、CompanionWorld、ChatAssistant 与相关回归、构建、本机网页。
- 依赖: issue-1
- 验收标准: 短回复/首字立即性保留；长回复解析工作减少，最终文本和 Markdown 一致；TTS 原始分句、取消/打断/失败无回归；任务面板 props 稳定时不重渲染；下载文件哈希保持；Chrome 完成人物、长聊天和窄屏验收。
- 状态: done
- 验证方式: 227 项相关回归、TypeScript 和 Vite 通过；15 个下载文件哈希保持。Node 确定性12500字符流发布101→64，Chrome真实Markdown渲染75→52；100次父语音tick Tasks渲染100→0，任务/回调/会话/账号变化仍渲染。Chrome真实头/手/离开热点、412×960首页/Chat/模型弹层通过。补齐账号失效、自动插话新旧字幕和可见恢复滚动回归。自审及只读独立审查完成，详情见验收文档。
- commit: 本 issue 提交（perf(issue-2): smooth streaming replies and isolate task rendering）
