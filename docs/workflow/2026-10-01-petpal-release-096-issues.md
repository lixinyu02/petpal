# PetPal 0.9.6 客户端重新打包 Issues

- Date: 2026-10-01
- Complexity: L2
- Related design: 2026-10-01-petpal-release-096-design.md
- Current status: done

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
- 范围: 正式 0.9.6 冻结文件、HTTPS 下载镜像、GitHub stable release、两条签名更新源、网页版本部署和下载验收
- 依赖: issue-70 done
- 验收标准: 公共下载与冻结包 SHA-256 一致；GitHub 标签固定指向 eaae5322566c915b06070e7248f1770470cdd197；两源五目标 stable / sequence8、各自原公钥不变；Chrome 登录下载可选新包；保留旧资产和原来源选择
- 状态: done
- 验证方式: 两源五目标签名、原公钥及 0.9.5→0.9.6 检查通过；隔离 DesktopUpdateManager 从可信公网服务器完整下载 Windows 200440982 bytes 并独立复核 SHA-256，未安装或启动下载文件；网页/后端 0.9.6 已上线并保留原账号、会话、暂停队列、token 和历史下载。Windows EXE/ZIP 各全 smoke 及两次顺序启动通过。GitHub 十资产完整字节回读、正式 latest、冻结 tag、发布前后 ID/长度/digest 保持均通过；Chrome 登录下载页五包选择、URL、SHA 与实际 CSS 412×960 无横向溢出通过，test 已退出、viewport 和标签已清理。Web ZIP 无下载页卡片，仅作 GitHub 资产验收。见 docs/acceptance-0.9.6.md 和 ignored evidence/repackage-096-20261001。
- commit: 本 issue 同名提交 `chore(issue-71): publish stable 0.9.6 release`
