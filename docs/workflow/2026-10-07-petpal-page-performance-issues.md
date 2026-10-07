# PetPal 页面性能迭代 Issues

- Date: 2026-10-07
- Complexity: L1
- Related design: 2026-10-07-petpal-page-performance-design.md

## Task Overview

- Goal: 修正人物帧节奏与会话快照无效渲染，保持现有界面和互动。
- Ordering rule: 顺序完成issue，同一issue内独立检查可并行。
- Current status: issue-1 done，issue-2 in_progress，issue-3 todo。

## Issue List

- [x] issue-1 可见场景绘制节奏与限速
- [ ] issue-2 会话消息快照引用复用
- [ ] issue-3 页面性能与浏览器验收

## issue-1

- ID: issue-1
- 标题: 可见场景绘制节奏与限速
- 范围: 共享场景循环及Cubism/恢复人物/小猫场景集成；高刷新和后台生命周期测试。
- 依赖: none
- 验收标准: 30FPS节奏不因浮点边界和余数丢失降至20–28FPS；隐藏/取消不补帧；无迟到重启，dt与互动不变。
- 状态: done
- 验证方式: 120/120定向人物/调度回归、TypeScript与diff检查通过。相同10秒60/90/120/144Hz时间戳，旧绘制204/246/266/288帧，新绘制均300帧；仅调度模拟，RAF唤醒不变，不代表设备FPS/GPU省电。隐藏/取消/恢复/迟到、零时间戳和长间隔语义覆盖。
- commit: this issue implementation commit

## issue-2

- ID: issue-2
- 标题: 会话消息快照引用复用
- 范围: 会话快照合并及Chat/Agent/自动化入口、完整消息数据比较和真实TSX回归。
- 依赖: issue-1
- 验收标准: 未变消息引用与数组保持；内容/状态/模型/附件/顺序/删除均保持权威值；账号与导航取消语义不变。
- 状态: in_progress
- 验证方式: 定向合并/聊天/组织/任务/Markdown/滚动测试及长历史前后工作量对比。
- commit: pending

## issue-3

- ID: issue-3
- 标题: 页面性能与浏览器验收
- 范围: 隔离预览和build、浏览器桌面/窄屏及人物/消息互动、全量回归、自审和记录。
- 依赖: issue-2
- 验收标准: 回归无失败；本地构建通过；性能收益有可复核指标，设备与部署边界清楚。
- 状态: todo
- 验证方式: Chrome优先、412×960 CSS视口、完整回归、隔离构建、验收文档。
- commit: pending
