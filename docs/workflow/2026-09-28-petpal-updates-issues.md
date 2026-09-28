# 四端更新与 GitHub Issues

- Date: 2026-09-28
- Complexity: L2
- Related design: 2026-09-28-petpal-updates-design.md
- Current status: issue-8 done; issue-9 next

## issue-8
- ID: issue-8
- 标题: 四端更新协议、设置与原生交接
- 范围: 签名GitHub清单/版本校验、后端配置API、共用设置页、Electron和Android下载校验/安装交接、Web部署版本刷新、测试
- 依赖: issue-7 done
- 验收标准: 四端均有入口和真实能力说明；仅通过可信校验的合适版本可交给安装流程；取消与账号切换不产生迟到操作
- 状态: done
- 验证方式: 204/204 Node 测试、tsc/Vite build、Chrome桌面/391px布局与部署版本提示；Android编译与17项JVM测试；插件名及verifying轮询契约已复核
- commit: 本次首次源码提交（feat(issue-8)）

## issue-9
- ID: issue-9
- 标题: GitHub发布工具与公开源码
- 范围: 发布清单签名工具/文档、0.6发布准备、Git初始化、公开源检查、提交并推送lixinyu02/petpal
- 依赖: issue-8 done
- 验收标准: 不含本机敏感状态；源可重建；公开仓库可读取且远端提交SHA匹配
- 状态: todo
- 验证方式: staged文件清单/秘密扫描、相关发布工具测试、GitHub读取验证
- commit: pending
