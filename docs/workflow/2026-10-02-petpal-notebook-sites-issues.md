# Notebook 网站适配 Issues

- Date: 2026-10-02
- Complexity: L2
- Related design: 2026-10-02-petpal-notebook-sites-design.md

## Task Overview

- Goal: 为 notebook 明确列出的十三个网站提供受控 Agent 接入。
- Ordering rule: Complete issues in sequence. 同一 issue 内独立组件由子代理并行实现。
- Current status: issue-1/2/3/4 done。网站浏览器查询的实际 Bridge 档案仍未就绪，已单独记录，不能视为端到端网站查询通过。

## Issue List

- [x] issue-1 接入浏览器网站策略、账号配置和 UI
- [x] issue-2 回归与真实浏览器验收
- [x] issue-3 Chrome / Browser Bridge 安装引导
- [x] issue-4 网页与后端部署

## issue-1

- ID: issue-1
- 标题: 接入十三个站点的固定功能入口
- 范围: 策略/catalog、runner/adapters、scope 配置、Agent 工具、UI 与打包闭包清单
- 依赖: none
- 验收标准: 十三个网站提供固定只读命令；六个自建站点使用明确默认域名并支持网址覆盖；旧公开查询与配置保持兼容；凭据不进入审批或输出
- 状态: done
- 验证方式: 158/158 相关测试与 TypeScript/Vite build 通过；原生新配置、CAS兼容与关闭失败恢复已补回归
- commit: eb0fb50

## issue-2

- ID: issue-2
- 标题: 浏览器与回归验收
- 范围: 相关回归、真实 Bridge 就绪情况、Chrome 网站访问、响应式 UI 与源码私密审查
- 依赖: issue-1
- 验收标准: 可访问页面记录可见内容；登录/验证码/Bridge 缺失和策略阻止明确；不把页面访问当 Agent 查询通过
- 状态: done（Agent→Bridge真实查询环境未就绪，已记录，不算通过）
- 验证方式: Chrome页面、隔离管理UI、412×960 DOM与158/158回归；完整限制见acceptance
- commit: 8810334

## issue-3

- ID: issue-3
- 标题: 缺少 Chrome 的执行电脑可由 Agent 引导准备环境
- 范围: 固定官方安装源、只读环境检测、Agent 固定工具、设置引导与原生打包闭包
- 依赖: issue-2
- 验收标准: Windows / Ubuntu x64 / ARM64 支持矩阵明确；未安装时可准备官方安装器；扩展授权及系统确认交用户；安装器启动不等于已安装/Bridge已就绪；继承所选执行电脑及现有审批
- 状态: done
- 验证方式: 最终108/108目标测试、build、Chrome草稿/权限和窄屏；真实Google MSI验签及两架构仓库元数据签名通过，未实际安装/授予扩展权限
- commit: 17156b3

## issue-4

- ID: issue-4
- 标题: 网页后端上线与认证验收
- 范围: 保留私有服务配置重启、认证接口及公网页面验收、源码审计和推送
- 依赖: issue-3
- 验收标准: health正常；未登录操作拒绝；授权清单及新引导入口可见；不改冻结0.9.6发布包和更新清单
- 状态: done
- 验证方式: 本机/公网health与401鉴权、69条查询/13站清单、Chrome test账号生产草稿入口；Qwen真实Codex只读status工具调用与返回已在rollout核实；源码index审计和origin/main推送
- commit: 本 issue 文档提交
