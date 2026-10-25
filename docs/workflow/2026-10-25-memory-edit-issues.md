# 手动修正记忆 Issues

- Date: 2026-10-25
- Complexity: L2
- Related design: 2026-10-25-memory-edit-design.md
- Current status: completed

## issue-1

- ID: issue-1
- 标题: 账号修正层与安全同步
- 范围: 记忆服务、召回、API、同步和测试
- 依赖: none
- 验收标准: 修正立即生效且不会被提炼覆盖；并发冲突、账号隔离和同步缓存有效
- 状态: completed
- 验证方式: 129 项服务/同步/Chat/Agent/HTTP 回归通过；含手改后的异步覆盖防护、再次编辑冲突、重启、PC 离线和迟到快照、6000 字边界及凭据清理。自审检查账号和原子写入边界，无真实账号数据变更。
- commit: 68085ce

## issue-2

- ID: issue-2
- 标题: 单条编辑入口
- 范围: 记忆设置、响应式样式、界面测试
- 依赖: issue-1
- 验收标准: 编辑/取消/保存、冲突保留草稿、换账号保护和手机布局通过
- 状态: completed
- 验证方式: 22 项实际 TSX 处理函数测试通过；取消零写入、失败保留草稿、不自动重试、账号切换、成功后列表失败均覆盖。Chrome 合成账号编辑/保存/实际召回通过，手动标记和未改条目保留，桌面截图已检查。校准 CSS 412×960：documentWidth=407、编辑区 right=338，无横向溢出；该尺寸截图通道超时，无实体机验收。TypeScript 通过。
- commit: 703a423

## issue-3

- ID: issue-3
- 标题: 联合验收与网页上线
- 范围: 记忆编辑和后台线程的正式网页交付
- 依赖: issue-2
- 验收标准: 网页和后端生效，用户数据及下载保留；不改真实记忆、不暂停提炼
- 状态: completed
- 验证方式: 606 通过、1 条条件跳过；Chrome 合成编辑保存和实际召回通过；真实 Memobase 独立 UID 通过。后端受控重载、97 个公网资源摘要、用户/权限/旧记忆事件/63 个下载的保留校验通过。详见 memory-edit-acceptance.md。
- commit: 本 issue 提交
