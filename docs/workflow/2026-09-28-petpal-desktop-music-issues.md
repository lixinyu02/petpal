# 桌面音乐助手 Issues

- Date: 2026-09-28
- Complexity: L2
- Related design: 2026-09-28-petpal-desktop-music-design.md

## Task Overview

- Goal: 内置双 CLI、API配置与音乐软件控制。
- Ordering rule: issue 按顺序执行；当前跨层 issue 内分工。
- Current status: issue-6 done; issue-7 done

## Issue List

- [x] issue-6 桌面 API 与具名音乐工具
- [x] issue-7 Windows/Ubuntu 0.5 发行

## issue-6

- ID: issue-6
- 标题: 独立 Codex API、音乐和 OpenCLI 工具
- 范围: 后端凭据/线程隔离、动态工具审批、原生媒体/OpenCLI、UI设置与测试
- 依赖: issue-5 done
- 验收标准: owner专属，密钥不回显，API模式独立目录，旧线程不跨配置，固定目标工具与取消生效，能力限制可见
- 状态: done
- 验证方式: 最终169/169测试、tsc/Vite；真实CLI连接本地mock Responses完成工具审批/回传/恢复/拒写；Windows只读GSMTC状态；Chrome设置保存/回读及391px布局。未操作真实播放器或已有OpenCLI daemon。
- commit: not possible - not a git repository

## issue-7

- ID: issue-7
- 标题: Windows 与 Ubuntu 内置双 CLI 交付
- 范围: Windows portable、Ubuntu x64/ARM64、源包、manifest、使用文档
- 依赖: issue-6 done
- 验收标准: 两CLI与helper完整入包，无真实凭据；最终Windows运行及Linux字节审计；旧版保留
- 状态: done
- 验证方式: 最终Windows EXE真实运行通过、退出自有进程0、独立解包1,958文件匹配；Ubuntu两架构各6,955文件全量读回/ELF/OpenCLI闭包通过；源码ZIP秘密边界扫描与逐文件独立读回通过；四产物manifest哈希/实际验收门禁通过，Android0.4单独保留并核对。真实供应商API、实际音乐动作/网页操作和Ubuntu实机仍未验证，见acceptance-0.5.md。
- commit: not possible - not a git repository
