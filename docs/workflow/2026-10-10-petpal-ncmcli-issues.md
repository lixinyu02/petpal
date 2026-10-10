# 网易云 CLI 技能 Issues

- Date: 2026-10-10
- Complexity: L2
- Related design: 2026-10-10-petpal-ncmcli-design.md

## Task Overview

- Goal: 内置官方CLI技能及受控入口，可选CLI运行时、账号隔离调用与用户安装/配置/登录引导。
- Ordering rule: Complete issues in sequence.
- Current status: complete

## Issue List

- [x] issue-1 官方CLI运行时与隔离命令
- [x] issue-2 技能发现、动态工具和用户引导
- [x] issue-3 打包适配与实际验收

## issue-1

- ID: issue-1
- 标题: 官方CLI可选运行时与独立账号运行管理
- 范围: 官方来源核验、依赖风险隔离、运行模块和测试
- 依赖: none
- 验收标准: 真实CLI可运行；账号/模型修订隔离；状态不主动登录；命令有界、可取消且无凭据输出；配置/登录由用户
- 状态: done
- 验证方式: node --test tests/ncmcli.test.mjs，19通过、0失败、0跳过；真实0.1.7离线版本/未配置错误；生成向导实际执行fixture；取消/关闭/上传别名/链接/PATH误判回归；自审通过。主manifest/lock已移除本轮CLI依赖，未变更既有依赖。
- commit: 3b0694d

## issue-2

- ID: issue-2
- 标题: 内置技能自动发现与Agent工具
- 范围: 技能资产、Codex物化、desktop-tools、音乐指令、说明
- 依赖: issue-1
- 验收标准: API模式skills/list发现；选定电脑按当前账号调用；继承权限与审批；提供可运行的用户配置/扫码向导
- 状态: done
- 验证方式: 六组相关回归74通过、0失败、0跳过（issue2-final-regression.txt）；真实Codex0.143 skills/list发现私有技能；UTF-8技能验证通过；独立场景forward-test与自审完成；同账号执行器替换不能绕过未退出进程占用。
- commit: 9b4f5eb

## issue-3

- ID: issue-3
- 标题: 两端包规则与本机实际验收
- 范围: Linux/Windows清单、测试、文档和本机服务
- 依赖: issue-2
- 验收标准: 包规则包含技能与模块且不引入CLI旧依赖；真实版本/帮助/技能发现；回归通过；登录/API与播放边界清楚；现有客户端文件保持
- 状态: done
- 验证方式: 执行器/模型切换/真实Codex/音乐MCP相关144通过；真实Codex动态工具及Electron-as-Node 2通过；包装专项66通过；全部0失败0跳过。tsc/Vite、脚本语法和diff检查通过；真实ASAR默认技能来源物化成功。后端health200、授权200/未登录401；原2账号/46对话/消息/模型/会话及15下载文件保持；Chrome正常。详见对应validation.md，无在线音乐API或实包验收声明。
- commit: 对应 feat(issue-3): verify ncmcli packaging and local runtime 本地提交
