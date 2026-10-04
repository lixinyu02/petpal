# 页面美观与动效 Issues

- Date: 2026-10-04
- Complexity: L1
- Related design: 2026-10-04-petpal-ui-polish-design.md

## Task Overview

- Goal: 提升视觉层次、主页入口集中度与自然过渡。
- Ordering rule: 一个集成 issue，各模块对齐同一视觉与生命周期合同后统一验收。
- Current status: issue-1 done。

## Issue List

- [x] issue-1 页面美化与有限过渡

## issue-1

- ID: issue-1
- 标题: 页面美化与有限过渡
- 范围: 主页/工作台/设置样式、文案、主页与 Agent 弹层入口、测试和浏览器/线上验收。
- 依赖: none
- 验收标准: 日夜文字与层级清晰；412×960/320/短屏可操作；新有限动画正确收尾且不因业务刷新重播；人物canvas、fixed菜单/图片定位保持；生产模型和正式下载保持。
- 状态: done
- 验证方式: 完整串行回归 1825/1825、TypeScript、隔离 Vite 构建；Chrome 日夜/1920×1080/412×960/320×640/400×480 短屏、真实动画事件及标记收尾、减少动效恢复、模型菜单与图片 fixed 定位、流式 Markdown 通过；公网静态 index 哈希一致，模型/正式下载和更新元数据保持。语音面板和隐藏/睡眠/异步切角由真实 TSX 回归覆盖，未验收物理音频或重打客户端。
- commit: feat(issue-1): refine interface layout and companion transitions（本 issue 集成提交；哈希见 Git）

## 自审

- [x] 需求、范围和视觉层级一致。
- [x] 减少动效/隐藏、fixed 定位与懒加载样式检查。
- [x] 相关检查、构建与 Chrome 真实截图/动画事件。
- [x] 只提交本轮源码，私有数据/验收目录保持忽略。
- [x] 文档和静态部署回执一致。
