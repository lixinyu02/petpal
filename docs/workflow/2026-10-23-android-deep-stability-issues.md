# Android 深度稳定性 Issues

- Date: 2026-10-23
- Complexity: L2
- Related design: 2026-10-23-android-deep-stability-design.md
- Current status: issue-1/2完成，issue-3 in_progress

## Issue List

- [x] issue-1 原生存储与跨Activity并发
- [x] issue-2 登录有界恢复与渲染进程容错
- [ ] issue-3 跨版本运行回归、QA包与交付

## issue-1

- ID: issue-1
- 标题: 原生存储与跨Activity并发
- 范围: vault UI锁/永久key/真实提交核验；代理全局owner；官方刷新profile/操作代际。
- 依赖: none
- 验收标准: 确定性复现前述故障并修复；旧凭据/文件与来源门禁保持；旧实例不能破坏新实例或重新激活已退出凭据。
- 状态: done
- 验证方式: Node179/179、JVM129/129；API36原生43/43零跳过（Vault13+Keystore4+Official25+Proxy1），自审修正fresh key生成及旧Scope晚401竞态；详见私有native-issue1-01。
- commit: 4e151ac

## issue-2

- ID: issue-2
- 标题: 登录有界恢复与渲染进程容错
- 范围: 登录网络及vault恢复超时、迟到隔离；WebView renderer退出与有界原生恢复。
- 依赖: issue-1
- 验收标准: 挂起请求不永久锁死入口；持久化完成与已发布账号一致；renderer退出不会导致默认全App崩溃或无限恢复。
- 状态: done
- 验证方式: 最终Node248/248、TypeScript与diff通过；JVM133/133；API36真实renderer终止3次→2自动重建→native恢复→手动重开，合成v2密文逐字保持、无Java Fatal。Cordova对已销毁WebView的3条清理warning保留，未当作崩溃。
- commit: 本issue提交（见Git历史）

## issue-3

- ID: issue-3
- 标题: 跨版本运行回归、QA包与交付
- 范围: 隔离构建、API33/35/36矩阵、权限/代理/官方入口/登录/渲染恢复、包审计和必要网页同步。
- 依赖: issue-2
- 验收标准: 最终包与源码摘要一致；测试和边界有证据；模拟器/夹具清理；真实数据、签名、正式下载及清单保持。
- 状态: in_progress
- 验证方式: Node/TypeScript/JVM、ADB instrumentation、APK逐资源/原生/CRC/签名/私密检查、Chrome及服务保全。
- commit: pending
