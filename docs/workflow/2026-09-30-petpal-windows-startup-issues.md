# Windows 启动修复 Issues

- Date: 2026-09-30
- Complexity: L1
- Related design: 2026-09-30-petpal-windows-startup-design.md

## Task Overview

- Goal: 修复 Windows 无提示失败并交付更可靠的启动包。
- Ordering rule: Complete issues in sequence.
- Current status: issue-45 / issue-46 done。完整结果见同日 acceptance 文档。

## Issue List

- [x] issue-45 启动异常诊断与加载失败处理
- [x] issue-46 Windows ZIP、便携启动提示与公开发布验收

## issue-45

- ID: issue-45
- 标题: 让启动失败可诊断并处理页面加载错误
- 范围: 主进程启动、脱敏诊断模块、对应回归、隔离运行验收。
- 依赖: issue-44
- 验收标准: 目录权限、坏数据或加载失败不能静默退出；保留用户数据；日志无凭据与原始异常内容；正常启动正确等待窗口加载。
- 状态: done
- 验证方式: 启动及桌面定向回归 85/85 通过；真实隔离 source startup-only 5.77 秒退出 0，完整 smoke 15.49 秒退出 0，登录门禁、执行器上线、Codex/OpenCLI、双人物及手势通过；无效 service-settings 真实故障退出 1 并记录脱敏阶段，原文件保留。证据位于私有 evidence/windows-client-20260930/source-startup、source-full、source-fault；最终包验收属于 issue-46。
- commit: ebdfdea。

## issue-46

- ID: issue-46
- 标题: 提供一次解压的 Windows 包并更新下载入口
- 范围: 打包、版本、下载说明、Windows EXE/ZIP、最终包验收与 GitHub 发布。
- 依赖: issue-45
- 验收标准: 中文空格路径、干净 profile 和无 Node/Git PATH 可启动；内置 CLI、OpenCLI 与窗口通过；公开下载显示正确版本与 hash。
- 状态: done
- 验证方式: 816/816 全量回归，版本补充 13/13、诊断与公开源码补充 19/19；最终 EXE 源字节 readback 与原生 core smoke、ZIP 7,777 文件完整 readback 及中文空格路径 core smoke 通过；普通 EXE 重复双击产生独立目录，主实例资源不变、第二实例正常退出。公开网页 27 文件部署、匿名 401 与授权 200、私有状态逐字节一致。GitHub v0.9.1 六项资产及两项大文件云端全文读回通过，公开小清单匿名读回和 sequence 6 签名验证通过。Chrome 下载中心默认 ZIP 0.9.1、EXE 可切换、SHA 正确，Android / Ubuntu 保留 0.9.0。旧可选扩展 smoke-app 夹具未通过，具体边界记录于 acceptance 文档；不能计入通过项。
- commit: 8de6447 实现与冻结；验收文档随本条补齐提交。
