# PetPal 0.9.7 正式客户端 Issues

- Date: 2026-10-03
- Complexity: L2
- Related design: 2026-10-03-petpal-release-097-design.md
- Current status: done

## issue-1

- ID: issue-1
- 标题: 构建并验收 0.9.7 客户端及最新下载规则
- 范围: 下载 API/UI/404、0.9.7 多端构建、归档字节审计及 Windows 实际启动
- 依赖: Cubism V11 工作已完成
- 验收标准: 只展示最新稳定版；新包包含最新模型与交互；多端包字节审核通过；Windows 两包实际启动
- 状态: done
- 验证方式: 306 项相关回归、16 项下载回归、TypeScript；Windows EXE/ZIP 实际完整启动与字节检查；Android 签名/归档/原生类和 Ubuntu 两架构归档/依赖审计通过。见 docs/acceptance-0.9.7.md。
- commit: 本 issue 同名提交 chore(issue-1): build stable 0.9.7 clients and latest downloads

## issue-2

- ID: issue-2
- 标题: 发布正式版并归档历史公共下载
- 范围: GitHub stable、服务器下载、两源签名清单、网页部署、旧包私有归档
- 依赖: issue-1 done
- 验收标准: 两源五目标 0.9.7/stable/sequence9；公开下载字节核验；Chrome 仅最新正式版；旧公共包不再直链可用；原业务数据和私有回退资产保留
- 状态: done
- 验证方式: 十项 GitHub 资产完整读回、frozen tag/latest；两源五目标更新检查；六个服务器包完整摘要；34 个历史公共文件私有归档后 HTTP 核验；Chrome 登录下载页及 412×960 验收。完整证据位于 evidence/release-097-20261003。
- commit: 本 issue 同名提交 docs(issue-2): record stable 0.9.7 publication and archive
