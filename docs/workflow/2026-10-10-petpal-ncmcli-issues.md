# 网易云 CLI 技能 Issues

- Date: 2026-10-10
- Complexity: L2
- Related design: 2026-10-10-petpal-ncmcli-design.md

## Task Overview

- Goal: 内置官方CLI技能及受控入口，可选CLI运行时、账号隔离调用与用户安装/配置/登录引导。
- Ordering rule: Complete issues in sequence.
- Current status: issue-1 done

## Issue List

- [x] issue-1 官方CLI运行时与隔离命令
- [ ] issue-2 技能发现、动态工具和用户引导
- [ ] issue-3 打包适配与实际验收

## issue-1

- ID: issue-1
- 标题: 官方CLI可选运行时与独立账号运行管理
- 范围: 官方来源核验、依赖风险隔离、运行模块和测试
- 依赖: none
- 验收标准: 真实CLI可运行；账号/模型修订隔离；状态不主动登录；命令有界、可取消且无凭据输出；配置/登录由用户
- 状态: done
- 验证方式: node --test tests/ncmcli.test.mjs，19通过、0失败、0跳过；真实0.1.7离线版本/未配置错误；生成向导实际执行fixture；取消/关闭/上传别名/链接/PATH误判回归；自审通过。主manifest/lock已移除本轮CLI依赖，未变更既有依赖。
- commit: feat(issue-1): add isolated optional ncmcli runtime

## issue-2

- ID: issue-2
- 标题: 内置技能自动发现与Agent工具
- 范围: 技能资产、Codex物化、desktop-tools、音乐指令、说明
- 依赖: issue-1
- 验收标准: API模式skills/list发现；选定电脑按当前账号调用；继承权限与审批；提供可运行的用户配置/扫码向导
- 状态: todo
- 验证方式: pending
- commit: pending

## issue-3

- ID: issue-3
- 标题: 两端包规则与本机实际验收
- 范围: Linux/Windows清单、测试、文档和本机服务
- 依赖: issue-2
- 验收标准: 包规则包含技能与模块且不引入CLI旧依赖；真实版本/帮助/技能发现；回归通过；登录/API与播放边界清楚；现有客户端文件保持
- 状态: todo
- 验证方式: pending
- commit: pending
