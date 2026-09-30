# 桌面音乐 MCP Issues

- Date: 2026-10-01
- Complexity: L2
- Current status: issue-60 done

## issue-60

- ID: issue-60
- 标题: 网易云与QQ音乐stdio MCP接入客户端和执行电脑
- 范围: 固定上游源码/许可、运行环境、stdio管理、动态工具与权限、PC本机设置和执行器、文档与验收。
- 依赖: issue-59
- 验收标准: 两项目真实工具可发现并按能力调用；Ubuntu限制可见；QQ返回链接不冒充播放；远程任务使用选中PC配置；凭据/取消/权限隔离保持。
- 状态: done
- 验证方式: 全套1035/1035、manager37/37、真实stdio工具与QQ只读调用、Windows源码原生启动、Linux打包源清单/哈希门禁、TypeScript/独立构建、Chrome公网与412×960、401/403/owner接口及私有状态和旧下载保留；详见acceptance。
- commit: 本次提交 `feat(issue-60): integrate desktop music MCP tools`
