# Android 手机后台设置入口 Issues

- Date: 2026-10-01
- Complexity: L1
- Related design: 2026-10-01-petpal-android-background-settings-design.md
- Current status: issue-63 done

## issue-63

- ID: issue-63
- 标题: 常见手机品牌后台设置快捷入口与指导
- 范围: 原生固定设置桥、系统 handler 白名单/OEM 回退、折叠指导和窄屏 UI、Android 新版打包交付。
- 依赖: issue-62 done
- 验收标准: 按品牌给出省电/自启动/通知入口；不支持时准确回退并指导；不会自动改系统开关；账号切换/页面暂停时不执行迟到跳转；APK 和标准 Android 设置路径通过分层验收。
- 状态: done
- 验证方式: 相关前端25/25、原生57/57、tsc与隔离生产构建；Chrome 412×960功能及布局；API36模拟器真实四类设置打开/返回、非法动作拒绝、系统开关不变；最终APK同开发签名/资源/无私有凭据审计。完整Node串行1150/1151，既有Codex取消请求关闭等待间歇失败，相关实现未改，不能记为全量通过。详见对应 acceptance.md；本地 evidence/android-background-settings-20261001。
- commit: feat(issue-63): add Android phone background settings shortcuts（对应本 issue 的 Git 提交）

同一 issue 内并行独立文件，由主代理统一整合和提交；不触及 RK3566 板、板用 WSL 或其他仓库。

## 最终交付与边界

Android 0.9.3 / code13 / 开发签名，最终 APK SHA-256 `503db5c9c6d2ce454db99f58081ab48911e41052e0cdccf4eb016a03ea9733c6`。原生组件匹配和品牌指导覆盖与 OEM 真机验收分开；荣耀 / 三星等无可信自启动直达时使用应用详情和手动路径。保留旧下载包、生产私有数据和各次失败诊断。

按既有授权同步网页、发布 v0.9.3 Android prerelease，并保留 v0.9.1 为最新稳定版。公网静态文件 / APK 与 GitHub 资产哈希、认证下载目录和匿名拒绝核对记录在本地 release-verification.json。网页部署不增加旧 APK 的原生能力，Windows / Ubuntu 本轮不重打。
