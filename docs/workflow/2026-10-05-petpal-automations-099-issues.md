# 自动化与 0.9.9 Issues

- Date: 2026-10-05
- Complexity: L2
- Related design: 2026-10-05-petpal-automations-099-design.md
- Current status: issue-1 done; issue-2 in_progress

## issue-1

- ID: issue-1
- 标题: 账号自动化、Agent工具与独立页面
- 范围: 持久调度/授权、用户路由、中央和远程Agent工具、UI与通知/草稿保护
- 依赖: none
- 验收标准: 同账号计划CRUD/去重/执行记录；真实Agent上下文创建与暂停；登录退出后计划保留；执行前重查范围，不跨主机回退/重启补跑/权限扩大；表单不丢失；时区及412×960可用
- 状态: done
- 验证方式: 最终完整串行2058/2058、TypeScript与diff检查；真实GPT-6.1 Sol创建及定时执行；Chrome与内置浏览器412×960/320×320验收，详见acceptance-automations-0.9.9.md
- commit: 1eff893

## issue-2

- ID: issue-2
- 标题: 0.9.9四端构建、上线与正式发布
- 范围: 六包、Windows真实运行/其他平台包验收、新后端和静态上线、两源升级与最新版下载
- 依赖: issue-1 done
- 验收标准: 冻结源码与六包一致；0.9.9 stable/sequence11/Android19；完整公网字节回读；页面可管理自动化，现有业务权限保持；旧包可恢复归档
- 状态: in_progress
- 验证方式: pending
- commit: pending
