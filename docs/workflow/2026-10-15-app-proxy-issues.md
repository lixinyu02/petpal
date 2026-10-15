# 桌面代理 Issues

- Date: 2026-10-15
- Complexity: L2
- Related design: 2026-10-15-app-proxy-design.md

## Task Overview

- Goal: Windows/Ubuntu x64/ARM64 内置 Clash 兼容内核与本应用代理、架构下载入口。
- Ordering rule: Complete issues in sequence.
- Current status: issue-2 done; issue-3 next

## Issue List

- [x] issue-1 固定内核资产、私有运行时与网络路由
- [x] issue-2 原生启停配置与设置界面接入
- [ ] issue-3 架构打包、下载分发与实际验收

## issue-1

- ID: issue-1
- 标题: 固定内核资产、私有运行时与网络路由
- 范围: 官方内核/许可/源码、资产获取校验、配置与子进程管理、稳定代理 dispatcher
- 依赖: none
- 验收标准: 四目标资产固定可验；默认关闭；无系统代理/TUN；私有配置不外泄；回环和局域网直连
- 状态: done
- 验证方式: 45/45 核心资产/配置/生命周期/网络组合回归通过；Windows x64 真核心实际校验和认证 HTTP 转发通过；Ubuntu WSL x64 用客户端同版 Electron Node 22.22.1 真核心校验与认证转发通过。四目标压缩与 raw hash、PE/ELF、离线源码/vendor/许可实读一致；ARM64 尚无实机运行。进程不可退出、启动安装代理期间崩溃、旧 SSE 取消/不重放、私网绕过均覆盖，独立自审完成。
- commit: feat(issue-1): add pinned private Mihomo runtime and app proxy routing

## issue-2

- ID: issue-2
- 标题: 原生启停配置与设置界面接入
- 范围: 可信 IPC、配置导入、启停/自启/节点选择、Electron/Node/CLI/ASR 网络接入
- 依赖: issue-1
- 验收标准: 当前本机 owner 才能修改；登录前不能调用；不暴露配置密钥；状态与实际内核一致
- 状态: done
- 验证方式: 192 项受影响后端/IPC/启动回归中 191 passed，1 项可选 ncm 官方 runtime 未安装 skipped；14/14 UI/preload 回归、生产构建通过。Windows 真原生隔离客户端实际验证访客拒绝、owner 导入、启停/自启持久化/节点列表；Node 与 Chromium 实际请求穿过带随机认证的核心和本地模拟节点，认证未转发到目标；session.resolveProxy 证实公网走自身代理、本机与 LAN DIRECT，关闭恢复 DIRECT。截图已目视验收，证据 evidence/app-proxy-native-9b41c7bf308a4cbea9828e2a4838487c。无真实用户订阅或代理出口测试。
- commit: feat(issue-2): connect desktop proxy settings and private network clients

## issue-3

- ID: issue-3
- 标题: 架构打包、下载分发与实际验收
- 范围: 包源清单、Windows ARM64、Ubuntu 双架构、下载架构选择、使用/许可/边界文档
- 依赖: issue-2
- 验收标准: 包内核/CLI/原生模块架构一致；下载不会误选架构；实际已验和未验分清；保留原分发源
- 状态: todo
- 验证方式: 相关回归、生产构建、Chrome 页面、实际内核/包校验
- commit: pending
