# 快捷入口 Issues

- Date: 2026-10-18
- Complexity: L2
- Related design: 2026-10-18-quick-launch-design.md

## issue-1

- ID: issue-1
- 标题: 快捷任务兼容存储、页面与导航
- 范围: quickLaunch可选标记、既有自动化编辑/运行复用、模板、工作台与伙伴首页入口、相关测试；实测发现的官方天气分组缺口兼容修复。
- 依赖: none
- 验收标准: 配置一次可一键运行；定时显式开启；账号/主机/模型权限与幂等不变；旧记录及草稿保护兼容，412×960不横向溢出。
- 状态: done
- 验证方式: 自动化schema/服务/API/tools/executor与天气135/135、UI事件/App导航/ack/主题/共享代理157/157（总292）；TypeScript与隔离Vite构建通过，自审修复到期once关闭定时后编辑、天气分组缺口和reduced-motion/窄屏动作宽度。
- commit: dcd8525

## issue-2

- ID: issue-2
- 标题: 浏览器验收与线上交付
- 范围: Chrome桌面及手机尺寸交互、天气和派发/定时验收、Web与后台部署和数据保留检查。
- 依赖: issue-1
- 验收标准: 有实际可操作入口及可查看任务结果；不自动创建持续计划，正式包/代理/业务状态保持；浏览器/模型/真机验收边界准确。
- 状态: done
- 验证方式: Chrome桌面及412×960交互、正式test账号HTTPS界面、真实OpenCliManager天气三次、合成执行器manual/once完整派发与去重；fresh idle/固定回退/私有备份/一次重启/资产原子发布/guardian接管/业务与下载哈希保持，详见acceptance。
- commit: docs(issue-2): record shortcut rollout and acceptance
