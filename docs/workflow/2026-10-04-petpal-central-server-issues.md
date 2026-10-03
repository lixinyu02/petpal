# PC 中央服务器 Issues

- Date: 2026-10-04
- Complexity: L2
- Related design: 2026-10-04-petpal-central-server-design.md

## Task Overview

- Goal: PC 可设置成为多端共享的中央服务器。
- Ordering rule: 一个集成 issue，独立模块并行实现，统一验收。
- Current status: issue-1 done。

## Issue List

- [x] issue-1 PC 中央服务、原生设置与多端连接验收

## issue-1

- ID: issue-1
- 标题: PC 中央服务、原生设置与多端连接验收
- 范围: 后端多监听、原生持久化/受限 IPC、设备设置、打包契约、文档及验证。
- 依赖: none
- 验收标准: 默认关闭；只有本机 owner 可开启；密码就绪后外部密码会话共享同一状态；独立启停/重启恢复/端口失败回滚；流式和下载保持；本机连接不受影响；窄屏可用。
- 状态: done
- 验证方式: 最终完整串行回归 1785/1785；TypeScript、生产构建及差异检查通过；真实 Windows Electron 两阶段启用/恢复/停用、端口冲突回滚与 412×960 实测；Chrome 隔离网页及线上 HTTPS 入口 412×960 无横向溢出；Ubuntu/Windows 打包模块缺失与篡改验证 49/49；暂存公共源码审计通过。详见 design 的 Verification Results 和 `evidence/central-server-20261004/`。未重打客户端，Ubuntu/Android 真机及新增服务器的公网反代/跨设备媒体未验收。
- commit: `feat(issue-1): let desktop clients host a central server`（本 issue 的单独提交）

## 自审

- [x] 需求和能力边界一致。
- [x] 权限、流式、生命周期和失败回滚通过。
- [x] 测试、构建、Chrome 及真实 Windows 验收。
- [x] 不修改生产用户、模型或任务数据；既有安装包与无关工程保持。
- [x] 文档和 issue 状态同步。
