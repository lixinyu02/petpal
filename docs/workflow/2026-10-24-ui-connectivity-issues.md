# UI 与连接性 Issues

- Date: 2026-10-24
- Complexity: L2
- Related design: 2026-10-24-ui-connectivity-design.md

## Task Overview

- Goal: 修复有当前证据的UI及连接恢复缺陷。
- Ordering rule: issue顺序推进，当前issue内并行独立调查。
- Current status: done

## Issue List

- [x] issue-1 当前界面与连接故障复现
- [x] issue-2 最小修复与定向回归
- [x] issue-3 浏览器集成验收与交付

## issue-1

- ID: issue-1
- 标题: 当前界面与连接故障复现
- 范围: Chrome截图、只读代码审查、隔离fixture与脱敏真实端点探测
- 依赖: none
- 验收标准: 有明确触发与预期行为，区分产品bug和外部服务异常
- 状态: done
- 验证方式: Chrome当前桌面/412登录与合成首页截图；真实api/Agent effect复现200截断JSON被吞成空对象后hosts写undefined导致渲染异常、半开读取无截止时间、恢复后旧错误残留；真实SettingsView复现保存期间新窗口被旧保存关闭，以及POST成功但refresh503后重复创建。确认连接dialog缺少名称。真实后端/五模型/ASR协议/TTS能力探测通过且state SHA保持。基线warmup测试存在401二次核验导致的旧计数断言失败，待同步精确合同。新fixture安全隔离并由root启动，Chrome工作台导航中出现插件超时，正在恢复验收连接。
- commit: 本issue提交

## issue-2

- ID: issue-2
- 标题: 最小修复与定向回归
- 范围: 仅issue-1确认缺陷的产品/测试文件
- 依赖: issue-1
- 验收标准: 缺陷复现变为通过，登录/消息/请求隔离保持
- 状态: done
- 验证方式: 13个定向文件182测试点通过，tsc通过；隔离Vite生产构建/OpenUI校验通过。360窄屏旧版select376px越出315px父容器，修复后315px/44px且箭头可见；连接成功JSON/超时/hosts、Agent恢复、保存互锁及401契约回归通过；追加实际api+SettingsView回归，明确2xx但正文损坏后只刷新、不重复创建，普通网络失败仍保留草稿。执行电脑状态读取失败时不显示旧绿色在线标记。
- commit: 本issue提交

## issue-3

- ID: issue-3
- 标题: 浏览器集成验收与交付
- 范围: 同路径UI复验、构建/网页发布和报告
- 依赖: issue-2
- 验收标准: 有界面与状态证据，业务/下载/信任保全通过
- 状态: done
- 验证方式: Chrome最终412窄屏损坏2xx保存/刷新恢复及公网页面，IAB主故障流程；182回归、tsc/build/OpenUI通过。网页314文件SHA一致；本地/公网health200、匿名401、CORS204；旧资源/49下载和业务保全通过。报告2026-10-24-ui-connectivity-verification.md。
- commit: 本issue提交
