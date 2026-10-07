# PetPal 页面性能迭代 Issues

- Date: 2026-10-07
- Complexity: L1
- Related design: 2026-10-07-petpal-page-performance-design.md

## Task Overview

- Goal: 修正人物帧节奏与会话快照无效渲染，保持现有界面和互动。
- Ordering rule: 顺序完成issue，同一issue内独立检查可并行。
- Current status: issue-1/2/3 done，源码与本地验收完成。

## Issue List

- [x] issue-1 可见场景绘制节奏与限速
- [x] issue-2 会话消息快照引用复用
- [x] issue-3 页面性能与浏览器验收

## issue-1

- ID: issue-1
- 标题: 可见场景绘制节奏与限速
- 范围: 共享场景循环及Cubism/恢复人物/小猫场景集成；高刷新和后台生命周期测试。
- 依赖: none
- 验收标准: 30FPS节奏不因浮点边界和余数丢失降至20–28FPS；隐藏/取消不补帧；无迟到重启，dt与互动不变。
- 状态: done
- 验证方式: 120/120定向人物/调度回归、TypeScript与diff检查通过。相同10秒60/90/120/144Hz时间戳，旧绘制204/246/266/288帧，新绘制均300帧；仅调度模拟，RAF唤醒不变，不代表设备FPS/GPU省电。隐藏/取消/恢复/迟到、零时间戳和长间隔语义覆盖。
- commit: e5df217

## issue-2

- ID: issue-2
- 标题: 会话消息快照引用复用
- 范围: 会话快照合并及Chat/Agent/自动化入口、完整消息数据比较和真实TSX回归。
- 依赖: issue-1
- 验收标准: 未变消息引用与数组保持；内容/状态/模型/附件/顺序/删除均保持权威值；账号与导航取消语义不变。
- 状态: done
- 验证方式: 211/211定向回归、TypeScript、语法及diff检查通过。全JSON字段、嵌套附件/未知元数据、重排/删除/新消息、跨会话/取消/epoch/revision、Chat+Agent/自动化/子任务刷新覆盖。500条元数据更新复用500条、尾条变化复用499条；1000条压力数据分别1000/999（高于产品500条限制，仅算法压力数据）。日志与回执在ignored evidence目录。
- commit: c9d9214

## issue-3

- ID: issue-3
- 标题: 页面性能与浏览器验收
- 范围: 隔离预览和build、浏览器桌面/窄屏及人物/消息互动、全量回归、受限测试端口清单修复、自审和记录。
- 依赖: issue-2
- 验收标准: 回归无失败；本地构建通过；性能收益有可复核指标，设备与部署边界清楚。
- 状态: done
- 验证方式: TypeScript与隔离Vite build通过；最终全量2303通过/0失败/1原有opt-in跳过；4190/6679测试端口补齐后11项定向通过。独立Chrome同402条/8秒/10快照，行渲染4020→0；桌面1280×800、412×960无横向溢出、Markdown/朗读入口/滚动位置/真实Cubism/头部互动及隐藏恢复通过。仅本机web、模拟模型/任务；未部署、重打包或重验四端原生实机。自审及独立只读审查无可操作问题，测试浏览器/预览已退出。
- commit: this issue acceptance commit (see Git history)
