# 服务器更新源 Issues

- Date: 2026-09-30
- Complexity: L2
- Related design: 2026-09-30-petpal-server-updates-design.md
- Current status: issue-59 done (2026-10-01)

## issue-59

- ID: issue-59
- 标题: 四端支持服务器签名更新源并上线
- 范围: 来源配置、后端签名清单检查、共用设置UI、Electron/Android下载策略、发布工具、正式源部署与验收。
- 依赖: issue-58
- 验收标准: GitHub兼容；可信服务器检查/下载可用，越界/篡改/回退/变源被拒绝；正式网页入口和源可用；生产数据、下载保留。
- 状态: done
- 验证方式: Node 64/64、JVM 17/17、插件Java编译、TypeScript/独立构建；正式五目标清单及Windows185MB真实下载校验；公网30文件哈希、test/匿名权限和Chrome412×960通过，详见 ../acceptance-server-updates.md。
- commit: feat(issue-59): support signed server update sources（与本Issue同一提交）
