# 荣耀 Magic8 安卓屏幕适配 Issues

- Date: 2026-10-20
- Complexity: L1
- Related design: 2026-10-20-honor-magic8-design.md

## Task Overview

- Goal: 荣耀 Magic8 上系统安全区、输入法和响应式布局可用。
- Ordering rule: Complete issues in sequence.
- Current status: 实现、源码自审、浏览器/模拟器验收及独立 APK 完成。

## Issue List

- [x] issue-1 安卓安全区与 Magic8 响应式适配及验收包

## issue-1

- ID: issue-1
- 标题: 安卓安全区与 Magic8 响应式适配及验收包
- 范围: 原生 systemBars/displayCutout/IME、短视口与响应式缺陷、Chrome/模拟器验收和独立 APK。
- 依赖: none
- 验收标准: 主要操作不被系统栏/键盘遮挡，横屏与放大显示可滚动使用，保留登录/代理/官方认证/通知；提供可核验 APK，明确真机限制。
- 状态: done
- 验证方式: Chrome 实测 360/400/412/440 宽及横屏/短屏；API36 三组各 4 项实际运行测试通过；111 项前端测试、98 项 Java 单元测试、TypeScript、Web/APK 构建与 APK 完整性审计通过。详见 verification.md。
- commit: 本 issue 的完成提交（fix(issue-1): adapt Android safe areas and Magic8 layouts）。

## Self-review

- [x] Requirement alignment: 针对真实可用视口适配，没有硬编码设备型号或限制系统缩放。
- [x] Regression risk: 保留账号/官方认证/代理/通知/悬浮功能；新的外观桥受本地安全主页面约束。
- [x] Test coverage: 相关测试与模拟器通过；未声称荣耀真机或真实聊天/语音上游的验收。
- [x] Dirty changes: 初始工作树干净；只提交本 issue 源码、测试和文档；生成资产与验收数据不入库。
- [x] Docs sync: 设计、issue 和验收文档已同步。
