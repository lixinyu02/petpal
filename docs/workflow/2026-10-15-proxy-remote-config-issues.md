# 远程 Clash 配置 Issues

- Date: 2026-10-15
- Complexity: L1
- Related design: 2026-10-15-proxy-remote-config-design.md

## Task Overview

- Goal: 从用户服务器托管链接下载、校验并导入 Clash YAML，支持手动更新。
- Ordering rule: Complete issues in sequence.
- Current status: complete

## Issue List

- [x] issue-1 远程配置下载、原子导入与设置入口

## issue-1

- ID: issue-1
- 标题: 远程配置下载、原子导入与设置入口
- 范围: 有界下载、来源私有存储、manager/IPC/preload/UI、打包清单与文档
- 依赖: none
- 验收标准: HTTP/HTTPS 可导入和更新；先停代理；失败保留原配置；鉴权及取消有效；来源 URL 不返回页面/日志
- 状态: done
- 验证方式: Windows 122/122 代理回归全过（真核心已启用，无跳过）；120/120 IPC/UI/包源整合回归通过；WSL x64 用客户端同版 Node 运行下载/manager/远程来源测试 62/62 通过并含 Linux 真核心。17/17 公开源码扫描器回归及源码打包边界检查通过。隔离 TypeScript/Vite 生产构建通过；Windows 原生客户端从真实本机 HTTP 服务器下载、真 Mihomo 校验和代理转发、刷新、登录页失败保留、运行时拒绝下载、手动导入清除来源均通过，UI 已目视验收。来源/下载请求不含应用凭据，状态/界面无来源 URL；测试结束退出自有客户端，保留已有官方账号预览。无真实用户托管地址/订阅，未重打或替换上一轮四架构包、未发布线上更新。
- commit: feat(issue-1): import and refresh hosted Clash configurations

## 验收记录

- 原生结果与截图：`evidence/proxy-remote-native-3cc93b042a814884b6f6a5c192241223/`。
- Windows 代理回归：`evidence/proxy-remote-final-tests.log`。
- Linux WSL 回归：`evidence/proxy-remote-wsl-tests.log`。
- IPC/UI/包源整合：`evidence/proxy-remote-integration-tests.log`。
- 隔离生产构建：`evidence/proxy-remote-build.json` 与 `evidence/proxy-remote-build.log`；没有覆盖正在运行服务的 dist。
- 源码打包检查：`evidence/proxy-remote-source-check.log`。

自审完成：来源和 YAML 同文件原子提交，权限/候选清理在提交前完成；停止会取消下载和旧队列；服务器响应/伪错误不透传；四架构未来构建必需清单包含新下载模块。当前已分发安装包的原生桥接不具备此新增入口，需后续重新构建。
