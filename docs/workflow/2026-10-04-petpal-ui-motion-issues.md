# 界面动效 Issues

- Date: 2026-10-04
- Complexity: L1
- Related design: 2026-10-04-petpal-ui-motion-design.md

## Task Overview

- Goal: 增加流畅、可退出的前端动效。
- Ordering rule: 一个集成 issue，独立模块协作后统一验收。
- Current status: issue-1 done。

## Issue List

- [x] issue-1 动效样式、生命周期与消息反馈

## issue-1

- ID: issue-1
- 标题: 动效样式、生命周期与消息反馈
- 范围: 界面有限入口、交互反馈、语音波形、消息首次入场、可见性/减少动效清理、文档及验证。
- 依赖: none
- 验收标准: 新旧消息行为正确；流式刷新不重播；隐藏/减少动效即时停止且恢复不回放；不改变 fixed 图片预览/模型菜单定位或 Live2D；412×960 可用。
- 状态: done
- 验证方式: 完整串行回归 1810/1810、TypeScript、隔离 Vite 构建、源码凭据审计及 Chrome 插件真实动效/图片定位/减少动效/412×960/日夜主题/角色显示/线上入口验收通过；隐藏恢复由生命周期测试覆盖；未实测物理语音设备或重打客户端。
- commit: feat(issue-1): add lightweight interface motion（本 issue 集成提交；哈希见 Git）

## 自审

- [x] 内容层级和触控目标保持。
- [x] 有限动画完成/取消/卸载/隐藏清理。
- [x] 相关回归、构建及 Chrome 真实验收。
- [x] 模型、生产账号和正式安装包保持。
- [x] Chrome 发现并修复乐观消息 ID 替换重复淡入；三个旧测试 fixture 补齐真实入口桥接。
- [x] 静态部署提供备份，公网入口哈希一致，隔离 QA 文件未部署。
