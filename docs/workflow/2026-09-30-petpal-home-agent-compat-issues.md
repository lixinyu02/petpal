# 首页选择器与 Qwen Agent Issues

- Date: 2026-09-30
- Complexity: L2
- Related design: 2026-09-30-petpal-home-agent-compat-design.md
- Current status: issue-57 done，issue-58 pending。

## issue-57

- ID: issue-57
- 标题: 修复首页冷加载选择器布局
- 范围: 共享披露面板和权限控件的组件样式、模型选择宽度、Chrome冷启动及412×960、保留下载部署。
- 依赖: issue-56
- 验收标准: 首页与工作台选择器均完整显示；弹层不遮挡关键控件或溢出；账号权限逻辑不变。
- 状态: done
- 验证方式: TypeScript/独立构建通过；Chrome首页冷启动权限背景/17px padding/两行grid、412×960的44px控件与两行工具栏、412×520模型菜单边界、搜索和键盘选择、工作台共享样式通过。30文件公网hash读回一致，Windows下载大小/mtime/hash不变；后端未为此CSS修复重启。
- commit: fix(issue-57): load home selectors independently and fit narrow screens

## issue-58

- ID: issue-58
- 标题: 修复 Chat 派发 Qwen Agent 与图片能力
- 范围: 真实错误定位、最小协议兼容、准确能力声明、实际只读任务和单图验收。
- 依赖: issue-57
- 验收标准: 实际 Qwen Agent 请求能够完成，错误保留可理解的原因；图片输入在模型能力及传输路径均支持；不自动换模型。
- 状态: pending
- 验证方式: 日志和上游协议、定向测试、隔离真实 Chat→Agent/Codex 与单图、生产读回。
- commit: pending
