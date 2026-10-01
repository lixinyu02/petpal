# 电脑与音乐控制默认启用 Issues

- Date: 2026-10-01
- Complexity: L1
- Current status: issue-64 done

## issue-64

- ID: issue-64
- 标题: 默认启用支持的电脑及音乐 MCP
- 范围: 两类 manager 新配置默认值、保留持久化关闭选择、UI 状态文案、当前部署配置启用与验证、0.9.4 Windows/Ubuntu 桌面交付。
- 依赖: issue-60/61/63 done
- 验收标准: 支持平台首次配置启用；旧设置保留；配置/status读取不启动或操作桌面；调用lazy连接仍受完整访问/审批/账号归属控制；平台不支持和依赖缺失准确提示。
- 状态: done
- 验证方式: 相关184/184测试、生产build/30文件部署回读、HTTPS0.9.4、当前服务70/14/9工具发现与重启数据核对、Chrome412×960、Windows实际EXE启动与4785文件回读、Ubuntu双架构全归档及ELF审计；见docs/acceptance-0.9.4.md和evidence/desktop-controls-defaults-20261001。未做Ubuntu GUI、Windows10新装或音乐播放验收。
- commit: 本 issue 的 feat(issue-64) 提交；SHA 由 Git 历史查询。

同一issue的独立文件并行验证，root统一审查、部署与提交。不触及RK3566、板用WSL、其他仓库或旧分发包；保留用户数据与现有授权策略。
