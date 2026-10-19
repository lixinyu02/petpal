# 云端 Docker 与服务互联 Issues

- Date: 2026-10-20
- Complexity: L2
- Related design: 2026-10-20-cloud-docker-design.md

## issue-1

- ID: issue-1
- 标题: 配对、云端运行环境、执行目标与远程桌面
- 范围: 独立服务连接凭据、Harbor petpal 接收方、Docker 本机/平台适配器、Agent/Chat/自动化分派、模型代理、桌面同源 WS 与前端页面。
- 依赖: none
- 验收标准: 账号及目标隔离、任务确实在所选环境执行，未知状态不重放；真实配对与桌面协议可用，原有电脑与记忆能力保持。
- 状态: done
- 验证方式: 模块/HTTP/WS/UI/Agent 行为测试、隔离真实服务与 Docker、TS/Vite、包闭包及自审。
- commit: 本提交 feat(issue-1)

## issue-2

- ID: issue-2
- 标题: 浏览器验收、受控上线与交付
- 范围: Chrome 桌面/手机布局、真实任务及桌面、业务保留、回退/guardian 与源码推送。
- 依赖: issue-1
- 验收标准: 实际能力及未验边界有证据；小伴上线不影响现有业务，不自动变更 Harbor/Platform 生产实例或安装包。
- 状态: in_progress
- 验证方式: 私有回执与截图、fresh idle、HTTPS/静态摘要/登录权限与业务保留。
- commit: pending
