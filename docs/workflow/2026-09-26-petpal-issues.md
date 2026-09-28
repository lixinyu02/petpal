# 小伴 PetPal Issues

- Date: 2026-09-26
- Complexity: L2
- Related design: 2026-09-26-petpal-design.md

## Task Overview
- Goal: 交付四端桌宠完整前后端及实际 Codex 后台。
- Ordering rule: 设计先行；当前 issue 内独立模块并行实现，集成验收后推进。
- Current status: issue-1 done；issue-2 done。Android / Ubuntu 目标端运行验收仍未执行，交付边界见 docs/acceptance.md。

## Issue List
- [x] issue-1 四端基础、协议后端与双模式界面
- [x] issue-2 集成、可爱逐帧动画、浏览器验收与安装包交付

## issue-1
- ID: issue-1
- 标题: 四端基础、协议后端与双模式界面
- 范围: 前端、后端、CodexBridge、Electron、Android 原生壳
- 依赖: none
- 验收标准: Web build、后端与 Codex 合同验证、平台工程可构建
- 状态: done
- 验证方式: Web build；34 项 Node tests；真实 CLI handshake 与一次模型请求 PETPAL_CODEX_OK；Windows 基础便携包、Android APK 构建完成。
- commit: not possible - not a git repository

## issue-2
- ID: issue-2
- 标题: 集成、浏览器验收与安装包交付
- 范围: Chrome 真实流程、ImageGen 毛绒小猫四动作、桌面启动、四端打包、文档
- 依赖: issue-1
- 验收标准: 构建证据和可用入口齐全；明确每端验收边界
- 状态: done
- 验证方式: Chrome 桌面/手机布局、两协议流程、四动画播放/暂停/边界裁切通过；Windows 最终便携包真实启动、UI ready、内置 CLI 初始化/登录状态、透明置顶与退出回收通过；Android APK 编译/签名/素材核对通过；Ubuntu x64/ARM64 实际归档与六个 ELF/权限/来源完整性、前端及服务端源码比对通过。34 项测试全通过。目标 Android/Ubuntu 实机运行仍未执行，不计入已验收范围。最终源码白名单归档、文件摘要和明细见 releases 与 docs/acceptance.md。
- commit: not possible - not a git repository
