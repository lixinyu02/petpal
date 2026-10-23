# 0.9.15 正式发布 Issues

- Date: 2026-10-24
- Complexity: L2
- Related design: 2026-10-24-stable-release-0915-design.md
- Current status: issue-1 in_progress

## issue-1

- ID: issue-1
- 标题: 冻结正式版本与隔离构建入口
- 范围: 版本0.9.15/Android27、当前正式版本与签名序号核验、隔离构建根和源码输入绑定
- 依赖: UI连接修复已上线
- 验收标准: 旧tag不动、主工作区保全、构建输入可核验
- 状态: in_progress
- 验证方式: Git/版本/来源与私有内容检查
- commit: pending

## issue-2

- ID: issue-2
- 标题: 六包构建与平台验收
- 范围: Windows EXE/ZIP、Ubuntu x64/ARM64、Android、Web；同issue内独立平台并行
- 依赖: issue-1
- 验收标准: 新包与冻结源码一致，实际可测平台运行通过，未验边界明确
- 状态: todo
- 验证方式: 归档逐字节/签名连续性/私有数据/许可/运行证据
- commit: pending

## issue-3

- ID: issue-3
- 标题: 正式发布与更新目录晋升
- 范围: 聚合prepare/sign、GitHub draft全量回读后正式latest、服务器下载与软件升级清单
- 依赖: issue-2
- 验收标准: 六包十资产来源/完整SHA/签名正确，新旧正式资产保全
- 状态: todo
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
