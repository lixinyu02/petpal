# OpenCLI 网站查询 Issues

- Date: 2026-10-01
- Complexity: L2
- Related design: 2026-10-01-petpal-opencli-sites-design.md
- Current status: issue-66 todo

## Issue List

- [x] issue-65 网站查询、默认开启、账号隔离与真实 Agent 验收
- [ ] issue-66 网页后端上线与 Windows/Ubuntu 新版交付

## issue-65

- ID: issue-65
- 标题: 网站查询与默认开启
- 范围: 固定库存/查询清单、隔离子进程、manager与配置、动态工具、中央API、本机IPC、UI、相关测试和真实Agent调用。
- 依赖: issue-64 done
- 验收标准: 查询已审阅的公开网站，Agent真实调用包内OpenCLI；默认开启/手动关闭保持；账号隔离、权限审批及子进程限制通过；UI准确区分库存与开放能力。
- 状态: done
- 验证方式: 相关229项测试通过；修复音乐首次读取竞争后补68项通过，TypeScript与生产构建通过。真实内置Codex0.143.0/GPT-6.1 Sol/选定DesktopExecutor已调用内置OpenCLI1.8.8查询npm与V2EX（非shell替代）；其余10个开放网站worker联网探测均返回非空数据。Chrome验收开关保存、参数加载、仅打包标记和412×960无横向溢出。最终manager生命周期审查两项修复与39项回归通过。关闭失败保留自有进程/锁所有权并明确恢复边界。Qwen局域网上游两次中断，未算通过；未验收Browser Bridge实际网页操作；后台与执行电脑共处Windows，非跨物理主机。
- commit: feat(issue-65): enable scoped built-in OpenCLI site queries

## issue-66

- ID: issue-66
- 标题: 上线及桌面交付
- 范围: 网页/后端部署、新Windows/Ubuntu包与公开预览Release。
- 依赖: issue-65 done
- 验收标准: 用户数据与下载保留，HTTPS读回；新版PC内置新入口，Windows实际启动查询，Ubuntu双架构审计；旧包能力边界明确。
- 状态: todo
- 验证方式: pending
- commit: pending

同一issue按独立文件并行实现，由root统一集成、审查、部署和提交。不触及RK3566实板、板用WSL或其他仓库。
