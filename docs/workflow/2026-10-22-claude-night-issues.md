# 小伴暖炭深色主题 Issues

- Date: 2026-10-22
- Complexity: L1
- Related design: 2026-10-22-claude-night-design.md

## Task Overview

- Goal: 深色主题更温暖、克制，消除漏色并同步四端源码入口。
- Ordering rule: Complete issues in sequence.
- Current status: issue-1 done

## Issue List

- [x] issue-1 完成夜色主题、首帧和原生颜色合同并验收

## issue-1

- ID: issue-1
- 标题: 统一暖炭深色体验
- 范围: theme/ui-polish CSS、首帧、Electron/Android 夜色常量、相关测试与本地浏览器验收；紧密耦合的一个主题切片。
- 依赖: none
- 验收标准: 文本≥4.5:1、输入边界/焦点≥3:1；Chat/Agent/审批/朗读/菜单无浅色漏块；默认日间和透明窗口保持；桌面及412×960无新增溢出；生产与正式包不动。
- 状态: done
- 验证方式: Chrome1440×1000与412×960；Chat/Agent/模型菜单/权限/设置与合成状态探针；最终94/94、独立布局动效90/90，tsc和隔离Vite通过。日间/自动/透明合同保持，详见design的Verification Results。生产与正式包未动，Android未重打实机验收。
- commit: fix(issue-1): refine warm charcoal night theme（本议题源码与文档同次提交）

## Review

- [x] Requirement alignment：暖炭/奶油白/陶土色，参考官方品牌资料，保留小伴身份。
- [x] Regression risk：首帧/原生常量/日间/自动/透明/减少动画已核对。
- [x] Test coverage：相关合同、对比度、Chrome实际界面、类型与隔离构建完成，未将合成任务算真实执行。
- [x] Dirty changes：只包含本主题、原生常量、测试与文档；不改业务数据和发布资产。
- [x] Docs sync：设计及结果已记录，临时进程/监听/标签已收尾。
