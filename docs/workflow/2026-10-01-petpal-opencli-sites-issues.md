# OpenCLI 网站查询 Issues

- Date: 2026-10-01
- Complexity: L2
- Related design: 2026-10-01-petpal-opencli-sites-design.md
- Current status: issue-67 in_progress

## Issue List

- [x] issue-65 网站查询、默认开启、账号隔离与真实 Agent 验收
- [x] issue-66 网页后端上线与 Windows/Ubuntu 新版交付
- [ ] issue-67 GitHub 公开预览与云端完整读回

## issue-65

- ID: issue-65
- 标题: 网站查询与默认开启
- 范围: 固定库存/查询清单、隔离子进程、manager与配置、动态工具、中央API、本机IPC、UI、相关测试和真实Agent调用。
- 依赖: issue-64 done
- 验收标准: 查询已审阅的公开网站，Agent真实调用包内OpenCLI；默认开启/手动关闭保持；账号隔离、权限审批及子进程限制通过；UI准确区分库存与开放能力。
- 状态: done
- 验证方式: 相关229项测试通过；修复音乐首次读取竞争后补68项通过，TypeScript与生产构建通过。真实内置Codex0.143.0/GPT-6.1 Sol/选定DesktopExecutor已调用内置OpenCLI1.8.8查询npm与V2EX（非shell替代）；其余10个开放网站worker联网探测均返回非空数据。Chrome验收开关保存、参数加载、仅打包标记和412×960无横向溢出。最终manager生命周期审查两项修复与39项回归通过。关闭失败保留自有进程/锁所有权并明确恢复边界。Qwen局域网上游两次中断，未算通过；未验收Browser Bridge实际网页操作；后台与执行电脑共处Windows，非跨物理主机。
- commit: 11748d1

## issue-66

- ID: issue-66
- 标题: 上线及桌面交付
- 范围: 网页/后端部署、0.9.5版本准备、新Windows/Ubuntu包和最终包审计；公开发行单独归入issue-67。
- 依赖: issue-65 done
- 验收标准: 用户数据与下载保留，HTTPS读回；新版PC内置新入口，Windows实际启动查询，Ubuntu双架构审计；旧包能力边界明确。
- 状态: done
- 验证方式: 0.9.5后端/静态页面上线，可信HTTPS读回12站23查询及enabled:true；账号/聊天/暂停队列、通知集合与10项旧下载逐字节保留。工具版本及revision按既有门禁迁移，新Agent需新配置。Windows最终便携EXE实际启动smoke退出0、执行电脑在线、包内PetPal.exe/Manager/worker真实npm/V2EX查询通过、ZIP完整性通过；10832文件/11项已知私密值无命中。Ubuntu x64/ARM64各12527项完整tar审计，38项OpenCLI运行时/共享依赖、98文件193边静态闭包与23适配器导入通过，ELF62/183、GLIBC2.34；双包私密扫描通过，实际UbuntuGUI未验证。Linux缺失/修改包回归40项与源码扫描9项通过。Qwen经HTTPS网关补测仍上游中断，GPT验收保持通过。
- commit: chore(issue-66): prepare verified OpenCLI desktop preview 0.9.5

## issue-67

- ID: issue-67
- 标题: 公开预览发行
- 范围: 已验收桌面包的HTTPS下载镜像、GitHub预发布、manifest/checksums和完整云端读回；保持旧包与stable latest。
- 依赖: issue-66 done
- 验收标准: 四个大包和两项校验元数据完整公开，正式URL、字节数和SHA256一致；网页登录后下载目录出现新包；临时转传分支精确清理。
- 状态: in_progress
- 验证方式: pending
- commit: pending

同一issue按独立文件并行实现，由root统一集成、审查、部署和提交。不触及RK3566实板、板用WSL或其他仓库。
