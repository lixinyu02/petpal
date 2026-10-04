# 四端体验迭代 Issues

- Date: 2026-10-04
- Complexity: L2
- Related design: 2026-10-04-petpal-cross-platform-experience-design.md

## Task Overview

- Goal: 改善四端输入、返回、焦点、滚动与原生恢复体验。
- Ordering rule: 单个集成 issue，独立模块对齐同一交互/生命周期合同后统一验收。
- Current status: issue-1 done。

## Issue List

- [x] issue-1 四端交互与恢复

## issue-1

- ID: issue-1
- 标题: 四端交互与恢复
- 范围: 共享输入/焦点/返回、下载滚动、设备恢复刷新、Android 返回与无 WebView 容错、桌面启动与浮窗恢复、测试和上线。
- 依赖: none
- 验收标准: 手机输入不误提交；返回按顶层层级；焦点在弹层内且关闭后恢复；下载底部可达；前台设备刷新无重叠/旧响应；原生窗口恢复不影响后端任务；生产模型和下载保持。
- 状态: done
- 验证方式: 完整串行回归 1884/1884；TypeScript、生产构建与源码包边界扫描通过；Chrome 412×960 / 320×540 / 1280×800 的输入、弹层、分层返回、焦点与下载验收；Android 生产编译和 Java 8/8；Windows 真 Electron 隔离启动 exit 0 / 7.85 秒；Ubuntu 共用壳 VM/打包合同，无实机验收。静态上线公网 hash一致，正式 0.9.7 下载/签名与 V12 模型保持。详见 design 的 Results。
- commit: 本 issue 的 `fix(issue-1): refine cross-platform input and lifecycle recovery` 提交。

## 自审

- [x] 返回/焦点不触发表单或业务写入；保存中 disabled dismiss 消费返回，未发送文字/图片保留。
- [x] 生命周期取消与迟到响应边界通过；嵌套/portal/autoFocus、预先 inert 和 hidden 的补充发现已修复。
- [x] UI、Java、Electron、构建和全回归证据分别记录；原生安装包与 Android/Ubuntu 物理验收未运行。
- [x] 正式下载、模型、私有账号与运行任务保持；生产仅登录测试账号做 UI 只读复核。
- [x] 源码包边界扫描与静态部署回执一致；精确提交并同步 GitHub。
