# 小伴启动、下载与日夜主题优化 Issues

- Date: 2026-10-04
- Complexity: L2
- Related design: 2026-10-04-petpal-fast-start-local-downloads-theme-design.md

## Task Overview

- Goal: 默认关闭既有 3D 小猫、加快打开、服务器优先下载、自动日夜主题。
- Ordering rule: 一个集成 issue，独立模块并行实现，统一验收与提交。
- Current status: issue-1 done。

## Issue List

- [x] issue-1 启动、下载及主题集成优化

## issue-1

- ID: issue-1
- 标题: 启动、下载及主题集成优化
- 范围: 人物能力迁移、首屏依赖、静态缓存、本地正式包目录、日夜设置与部署。
- 依赖: none
- 验收标准: 旧猫开启记录不自动恢复；首屏成本有实测；最新正式包真实走服务器；日夜与自动模式跨边界正确且手机可用；登录与透明浮窗不回退。
- 状态: done
- 验证方式: 完整串行1711/1711；最终CSS顺序修正后TypeScript/build与18项聚焦通过；Chrome日/夜/自动、Chat/Agent/模型菜单、412×960无横溢出；公网最新5包HEAD/Range与本机全量6包摘要；后端空闲受控重启及状态、模型、更新资产保持。详见design验收结果与evidence/fast-start-20261004。
- commit: 本 issue 完成提交使用 feat(issue-1): speed up startup and serve local downloads with day-night theme。

## 自审

- [x] 四项用户要求已落实，旧开启记录默认关闭；再次明确启用仍是本机账号偏好。
- [x] 登录、消息解析、原生通知、下载最新版本、更新签名和透明浮窗边界保持。
- [x] 聚焦、完整回归、生产构建与真实Chrome、公网文件验证完成。
- [x] 未触及实板/PSTX；凭据、安装包和证据均未加入Git。
- [x] 设计、下载说明与安装包未重打的边界已同步。
