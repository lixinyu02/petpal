# 自然角色交互迭代

- Date: 2026-09-29
- Complexity: L2
- Related design: 2026-09-29-petpal-natural-companion-design.md
- Current status: issue-27 in_progress

## issue-27

- ID: issue-27
- 标题: 自然角色交互、人物表现与 UI 整理
- 范围: 共用手势、两种 Scene、模型动作、首页/工作台/悬浮窗交互和样式
- 依赖: issue-26 done
- 验收标准: 无显式抚摸/喂食/休息按钮，直接操作角色且不吞空白滚动；两种角色状态一致，跳跃无断层，桌面和手机布局清晰
- 状态: in_progress
- 验证方式: 手势/模型回归，TS/Vite，Chrome 实际点击和触控及截图
- commit: pending

## issue-28

- ID: issue-28
- 标题: 修复审查确认的运行与状态问题
- 范围: 执行器网络恢复及其它有复现证据的问题
- 依赖: issue-27
- 验收标准: 临时断网可恢复可用状态，已领取任务不重放，账号边界和未知执行状态保持准确
- 状态: todo
- 验证方式: 定向回归、全量测试、源码审查
- commit: pending

## issue-29

- ID: issue-29
- 标题: 部署并交付新版四端包
- 范围: 冻结构建、线上备份部署、四端包、更新签名、GitHub 发布与说明
- 依赖: issue-28
- 验收标准: 保留线上账号与历史，网页验收通过；包与冻结源码一致、下载可用，明确未验收的实机边界
- 状态: todo
- 验证方式: 原生 smoke、归档读回、Chrome 公网验收、GitHub 哈希及签名
- commit: pending
