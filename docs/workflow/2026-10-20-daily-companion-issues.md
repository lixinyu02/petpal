# 每日陪伴 Issues

- Date: 2026-10-20
- Complexity: L2
- Related design: 2026-10-20-daily-companion-design.md

## Task Overview

- Goal: 每用户每日问候、天气/节日内容与安卓后台通知。
- Ordering rule: Complete issues in sequence.
- Current status: 一个完整功能切片已实现并验收；子任务按互不重叠文件协作。网页/后端已上线，独立安卓测试包已交付。

## Issue List

- [x] issue-1 每日陪伴计划、记录与安卓提醒

## issue-1

- ID: issue-1
- 标题: 每日陪伴计划、记录与安卓提醒
- 范围: 服务端持久调度/内容、登录API、独立通知feed、安卓通知/导航、自动化页设置、测试包。
- 依赖: none
- 验收标准: 默认关闭、账号隔离；按时区触发且不重叠/不重复；天气失败有真实降级；节日准确；旧通知兼容；新通知在后台到达并点击查看本人记录；设置/暂停/试运行及运行记录可用。
- 状态: done
- 验证方式: Node 291/291；Java31/31；API36真实系统通知与HTTPS后台Service各1/1；Chrome 360/412/440宽度、真实北蔡镇天气、生产接口/保留检查、APK签名/资源/16KB对齐均通过。详见2026-10-20-daily-companion-verification.md；在线Memobase未配置、物理手机长期留存未验收，已明确边界。
- commit: 本issue的 feat(issue-1): add personalized daily companion routines 提交（本文件随同提交）。
