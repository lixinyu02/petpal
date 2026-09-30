# 远程 PC 体验 Issues

- Date: 2026-09-30
- Complexity: L1
- Related design: 2026-09-30-petpal-remote-pc-design.md
- Current status: done

## issue-52

- ID: issue-52
- 标题: 默认关闭 3D 小猫并提供手动开关
- 范围: 有效伙伴偏好、首页选择、设置入口与浮窗兼容。
- 依赖: issue-51
- 验收标准: 新旧猫偏好均不在未启用时加载小猫，开关按账号/服务隔离，启用后可切换，关闭后回二次元且不污染历史。
- 状态: done
- 验证方式: 20 项偏好/隔离/挂载回归、TypeScript、独立 Vite build 通过；Chrome 默认仅二次元且未请求 PetScene，设置开启→切猫→关闭→回二次元通过。Android 仅同步已运行浮窗，实机未验收。
- commit: feat(issue-52): disable the 3D cat until this device explicitly opts in

## issue-53

- ID: issue-53
- 标题: 优化远程执行电脑选择
- 范围: Agent 与 Chat + Agent 主机入口、分组、在线状态与连接引导。
- 依赖: issue-52
- 验收标准: 同账号电脑易于辨认，离线不静默回退，任务期间锁定，手机版不拥挤且键盘可用。
- 状态: done
- 验证方式: 16 项 helper/主机偏好/Chat 快照回归、TypeScript、Vite build 通过；Chrome 1280×800、412×960 与 412×560，搜索刷新保留、重开清空、离线不回退、任务禁选、Chat 弹层焦点/Escape 通过。夹具电脑为模拟，未计为真实 PC。
- commit: feat(issue-53): unify searchable execution computer selection

## issue-54

- ID: issue-54
- 标题: 验收 PC Codex CLI 公网远程执行并修复阻塞
- 范围: 发布包/真实执行器注册与任务链路，必要修复与交付，网页部署；同步未来桌面 smoke 的开关与 v2 public display 验收入口，修复默认隐藏角色选择造成的零高画布与 Android 离开设置页后的浮窗同步竞态；按新增要求迁移 CLIProxyAPI HTTPS 连接。
- 依赖: issue-53
- 验收标准: 使用真实 PC CLI 得到远程任务完成证据，或清楚区分外部阻塞；所有必要修复通过回归与实际复验，账号隔离和鉴权保持。
- 状态: done
- 验证方式: 真实 Windows 0.9.1 ZIP 的隔离 profile 经公网注册与两轮心跳；内置 Codex 0.143.0 / 6.1 Sol 实际执行一次平台查询，输出 Win32NT、exit 0，任务 completed，仅批准固定审批一次且 read-only/ask 保持，进程/会话清理和原包哈希核实通过。完整源码 native smoke、39 项定向回归、27 项浮窗/伙伴回归、TS及PS AST通过；30 文件最终静态发布读回/公网全文SHA一致，Chrome 412×960、1280×800、960×480人物可见。HTTPS models鉴权200、实际Responses流式和四模型/Codex迁移通过。详见 acceptance.md，Ubuntu/Android与不同ISP未实机验证。
- commit: fix(issue-54): repair default avatar layout and verify remote PC execution
