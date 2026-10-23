# 0.9.15 正式发布 Issues

- Date: 2026-10-24
- Complexity: L2
- Related design: 2026-10-24-stable-release-0915-design.md
- Current status: issue-3 in_progress

## issue-1

- ID: issue-1
- 标题: 冻结正式版本与隔离构建入口
- 范围: 版本0.9.15/Android27、当前正式版本与签名序号核验、隔离构建根和源码输入绑定
- 依赖: UI连接修复已上线
- 验收标准: 旧tag不动、主工作区保全、构建输入可核验
- 状态: done
- 验证方式: 版本0.9.15/Android27；全量4024项首轮4017通过/6条件跳过/1短等待失败，同字节独立复验该文件5项全通过；合成凭据逐项审查后精确映射新增36项，主体扫描规则保持，19项边界测试/全源1862文件及源码包1799文件检查通过。冻结产品d8f0040925b951aabaa5de669db9a6abfe8116fe；独立detached worktree位于.tools/release-0.9.15-build-root；node_modules及所需官方缓存物理复制，不共享可写生产依赖。
- commit: d8f0040；本次入口验收提交

## issue-2

- ID: issue-2
- 标题: 六包构建与平台验收
- 范围: Windows EXE/ZIP、Ubuntu x64/ARM64、Android、Web；同issue内独立平台并行
- 依赖: issue-1
- 验收标准: 新包与冻结源码一致，实际可测平台运行通过，未验边界明确
- 状态: done
- 验证方式: 六包完整归档/源码/前端/许可/实际17个私有值解包扫描通过，聚合10份哈希绑定证据。Windows EXE完整smoke与ZIP独立启动/界面/模型/CLI/正常退出通过；ZIP两次附加手势自动化受固定鼠标移动打断、首趟Page.close不退出均保留，未冒称通过。Ubuntu两架构各17256归档条目，x64 WSLg启动/NAPI/CLI/合成代理通过，ARM64所选CLI经QEMU通过但完整GUI未验。Android API36实际升级/登录保持/8日续期/恢复/权限/双角色聊天22项及133 Java单测通过；313运行Web资源逐字节，唯一.aapt排除元数据.vite/manifest.json单独收据绑定，未重打/改APK。Web314文件/CRC/14许可及Chrome360px布局/合成流式回复通过。实体手机/Ubuntu硬件/完整ARM64GUI未验。入口.data/release-0.9.15/acceptance.json。
- commit: 本次平台验收记录提交

## issue-3

- ID: issue-3
- 标题: 正式发布与更新目录晋升
- 范围: 聚合prepare/sign、GitHub draft全量回读后正式latest、生产版本受控切换、服务器下载与软件升级清单
- 依赖: issue-2
- 验收标准: 六包十资产来源/完整SHA/签名正确，新旧正式资产保全
- 状态: in_progress
- 验证方式: GitHub与服务器完整回读、五平台更新信封验签
- commit: pending

## issue-4

- ID: issue-4
- 标题: 生产版本验收与交付
- 范围: 新服务/网页版本、运行态与业务保全、正式下载和更新入口
- 依赖: issue-3
- 验收标准: health/匿名认证/CORS/Chrome/客户端版本与正式源一致，报告可核验
- 状态: todo
- 验证方式: 当前receipt身份、资产SHA、业务和信任比较
- commit: pending
