# PetPal Computer Use Issues

- Date: 2026-10-01
- Complexity: L2
- Related design: 2026-10-01-petpal-computer-use-design.md

## Task Overview

- Goal: 固定 Zavora stdio / 图片 / 权限 / 选中执行电脑 / 管理与真实验收。
- Ordering rule: 同一 issue 内并行独立文件；完成后审查、提交与部署。
- Current status: issue-61 done

## Issue List

- [x] issue-61 集成并实测 Zavora Computer Use

## issue-61

- ID: issue-61
- 标题: 接入固定 Zavora MCP 并完成实际桌面操作验收
- 范围: manager、权限/截图中继、native IPC、设置、打包门禁、Windows/Ubuntu 分层验收、网页/后端上线。
- 依赖: issue-60 done，baseline 0b1966c
- 验收标准: 默认关闭、账号隔离、真实 schema 与错误、审批/自动执行、有效图片进入 Codex；Windows 独立窗口及第三方模型链路成功；Ubuntu 限制准确；UI/测试通过；现有数据与下载保持。
- 状态: done
- 验证方式: 完整回归 1099/1099、native 增量 4/4、TypeScript/Vite、Windows 自建窗口与真实 Electron、Qwen/Codex/所选注册执行端真实链路、Ubuntu22 x64 产品 manager 的 X11 容器 GUI、ARM64 QEMU Node 加载、Chrome 412×960；公网 HTTPS 部署后 health 200、anonymous 401、owner 200/member 403、默认停用、业务状态/网络配置/token/旧下载保持。详见 acceptance 文档，证据目录 evidence/computer-use-mcp-20261001。
- commit: feat(issue-61): integrate Zavora computer use with verified native runtimes（本提交）

## Release Notes

网页与后端已部署至 https://magicdatou.top:44318/；两用户、五模型连接、28 对话和一条暂停队列保留。原 Agent 对话保留历史，需要新建对话注册新工具。桌面安装包按既定选择延后，没有把旧包标为包含新桥。Ubuntu x64 的容器 GUI 与 ARM64 的编译/模拟加载不能替代物理 Ubuntu/ARM 桌面验收。

首次完整运行发现启动 VM fixture 缺少新 IPC factory、Linux provenance 测试仍断言未打补丁，均修正；真实 Codex transport 的一次超时以阶段标签诊断，多组独立复测及最终完整回归通过，没有放宽 10 秒等待或产品断言。
