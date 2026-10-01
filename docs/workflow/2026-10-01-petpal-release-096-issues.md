# PetPal 0.9.6 客户端重新打包 Issues

- Date: 2026-10-01
- Complexity: L2
- Related design: 2026-10-01-petpal-release-096-design.md
- Current status: in_progress

## issue-70

- ID: issue-70
- 标题: 重打多平台客户端并验收 Qwen 图片
- 范围: 图片链路、版本、Android/Windows/Ubuntu 构建审核
- 依赖: issue-69 done
- 验收标准: 最新项目目录等能力进入安装包；Qwen 图片实际调用有据；新包字节审核与适用启动检查通过；保留原数据
- 状态: done
- 验证方式: Android 开发签名/版本/dex/全部资产读回、Windows EXE/ZIP 完整字节与实际启动、Ubuntu 两架构完整归档/ELF/依赖来源通过；Qwen 4 次真实识图 completed；图片 19 项、打包与更新 76 项、调整后的目录 fixture 27 项回归通过。见 docs/acceptance-0.9.6.md。
- commit: 本 issue 同名提交 `chore(issue-70): rebuild 0.9.6 clients`

## issue-71

- ID: issue-71
- 标题: 发布 0.9.6 安装包并更新下载入口
- 范围: 冻结文件、HTTPS 下载镜像、GitHub release、网页版本部署、下载验收
- 依赖: issue-70 done
- 验收标准: 公共下载与冻结包 SHA-256 一致；GitHub 指向本轮代码；Chrome 登录下载可选新包；保留旧资产和正式更新渠道
- 状态: in_progress
- 验证方式: pending
- commit: pending
